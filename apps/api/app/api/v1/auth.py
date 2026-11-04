"""Auth (ADR-003), current user, organizations & members."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.deps import client_ip, get_current_user, load_membership, parse_uuid
from app.core.errors import ApiError, conflict, forbidden, not_found
from app.core.security import create_session_token, get_auth_rate_limiter, hash_password, verify_password
from app.models import Organization, OrganizationMembership, Role, User
from app.schemas.api import (
    LoginIn,
    Me,
    MemberInvite,
    MemberOut,
    OrganizationCreate,
    OrganizationOut,
    RegisterIn,
    UserOut,
)
from app.services.audit import audit

router = APIRouter()


def _set_session_cookie(response: Response, user: User) -> None:
    s = get_settings()
    response.set_cookie(
        s.session_cookie_name,
        create_session_token(user.id),
        max_age=s.session_ttl_days * 24 * 3600,
        httponly=True,
        secure=s.cookie_secure,
        samesite="lax",
        path="/",
        domain=s.cookie_domain,
    )


def _rate_limit(request: Request, scope: str, email: str) -> None:
    key = f"{scope}:{client_ip(request) or '?'}:{email.strip().lower()}"
    if not get_auth_rate_limiter().hit(key):
        raise ApiError(429, "rate_limited", "Too many attempts. Please wait a minute and try again.")


def _orgs_for(db: Session, user: User) -> list[OrganizationOut]:
    rows = db.scalars(
        select(OrganizationMembership)
        .join(Organization, Organization.id == OrganizationMembership.organization_id)
        .where(OrganizationMembership.user_id == user.id)
        .order_by(Organization.created_at, Organization.name)
    ).all()
    return [
        OrganizationOut(
            id=str(m.organization.id), name=m.organization.name, role=m.role.value, created_at=m.organization.created_at
        )
        for m in rows
    ]


def _me(db: Session, user: User) -> Me:
    return Me(
        user=UserOut(id=str(user.id), name=user.name, email=user.email, created_at=user.created_at),
        organizations=_orgs_for(db, user),
    )


def _find_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(func.lower(User.email) == email.strip().lower()))


@router.post("/auth/register", response_model=Me, status_code=201, tags=["auth"])
def register(body: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)) -> Me:
    _rate_limit(request, "register", str(body.email))
    email = str(body.email).lower()
    if _find_user_by_email(db, email):
        raise conflict("An account with this email already exists", "email_taken")
    user = User(name=body.name, email=email, password_hash=hash_password(body.password))
    org = Organization(name=body.organization_name)
    db.add_all([user, org])
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise conflict("An account with this email already exists", "email_taken") from None
    db.add(OrganizationMembership(organization_id=org.id, user_id=user.id, role=Role.owner))
    audit(
        db,
        "auth.register",
        org_id=org.id,
        user_id=user.id,
        entity_type="user",
        entity_id=user.id,
        ip=client_ip(request),
    )
    db.commit()
    _set_session_cookie(response, user)
    return _me(db, user)


@router.post("/auth/login", response_model=Me, tags=["auth"])
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)) -> Me:
    _rate_limit(request, "login", body.email)
    user = _find_user_by_email(db, body.email)
    ok = verify_password(user.password_hash if user else None, body.password)
    if not user or not ok:
        audit(
            db,
            "auth.login_failed",
            org_id=None,
            user_id=user.id if user else None,
            ip=client_ip(request),
            metadata={"email": body.email.strip().lower()[:320]},
        )
        db.commit()
        raise ApiError(401, "invalid_credentials", "Incorrect email or password")
    audit(db, "auth.login", org_id=None, user_id=user.id, entity_type="user", entity_id=user.id, ip=client_ip(request))
    db.commit()
    _set_session_cookie(response, user)
    return _me(db, user)


@router.post("/auth/logout", status_code=204, tags=["auth"])
def logout() -> Response:
    s = get_settings()
    resp = Response(status_code=204)
    resp.delete_cookie(
        s.session_cookie_name, path="/", domain=s.cookie_domain, secure=s.cookie_secure, httponly=True, samesite="lax"
    )
    return resp


@router.get("/users/me", response_model=Me, tags=["users"])
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Me:
    return _me(db, user)


# ---------- organizations ----------


@router.get("/organizations", response_model=list[OrganizationOut], tags=["organizations"])
def list_orgs(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[OrganizationOut]:
    return _orgs_for(db, user)


@router.post("/organizations", response_model=OrganizationOut, status_code=201, tags=["organizations"])
def create_org(
    body: OrganizationCreate, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> OrganizationOut:
    org = Organization(name=body.name)
    db.add(org)
    db.flush()
    db.add(OrganizationMembership(organization_id=org.id, user_id=user.id, role=Role.owner))
    audit(
        db,
        "organization.create",
        org_id=org.id,
        user_id=user.id,
        entity_type="organization",
        entity_id=org.id,
        ip=client_ip(request),
    )
    db.commit()
    return OrganizationOut(id=str(org.id), name=org.name, role="owner", created_at=org.created_at)


def _member_or_404(db: Session, user: User, org_id: str) -> OrganizationMembership:
    m = load_membership(db, user, parse_uuid(org_id, "Organization"))
    if m is None:
        raise not_found("Organization")
    return m


@router.get("/organizations/{org_id}/members", response_model=list[MemberOut], tags=["organizations"])
def list_members(org_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    me_m = _member_or_404(db, user, org_id)
    rows = db.scalars(
        select(OrganizationMembership)
        .where(OrganizationMembership.organization_id == me_m.organization_id)
        .order_by(OrganizationMembership.created_at)
    ).all()
    return [
        MemberOut(
            user_id=str(m.user.id), name=m.user.name, email=m.user.email, role=m.role.value, joined_at=m.created_at
        )
        for m in rows
    ]


@router.post("/organizations/{org_id}/members", response_model=MemberOut, status_code=201, tags=["organizations"])
def add_member(
    org_id: str,
    body: MemberInvite,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MemberOut:
    me_m = _member_or_404(db, user, org_id)
    if me_m.role not in (Role.owner, Role.admin):
        raise forbidden("Only organization owners and admins can manage members")
    if body.role == "owner" and me_m.role != Role.owner:
        raise forbidden("Only owners can add another owner")
    invitee = _find_user_by_email(db, str(body.email))
    if invitee is None:
        # Minimal invite flow: the user must already have an account (email invites come later).
        raise ApiError(
            404, "user_not_found", "No HVAC Studio account exists for that email. Ask them to register first."
        )
    if load_membership(db, invitee, me_m.organization_id):
        raise conflict("That user is already a member of this organization", "already_member")
    m = OrganizationMembership(organization_id=me_m.organization_id, user_id=invitee.id, role=Role(body.role))
    db.add(m)
    audit(
        db,
        "organization.member_add",
        org_id=me_m.organization_id,
        user_id=user.id,
        entity_type="user",
        entity_id=invitee.id,
        ip=client_ip(request),
        metadata={"role": body.role},
    )
    db.commit()
    return MemberOut(
        user_id=str(invitee.id), name=invitee.name, email=invitee.email, role=body.role, joined_at=m.created_at
    )
