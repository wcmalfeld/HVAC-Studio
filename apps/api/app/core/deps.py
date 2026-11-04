"""Request dependencies: current user (session cookie) and tenant (ADR-004) with role permissions."""

from __future__ import annotations

import ipaddress
import uuid
from dataclasses import dataclass

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import ApiError, forbidden, not_found
from app.core.security import decode_session_token
from app.models import Organization, OrganizationMembership, Role, User

ORG_HEADER = "X-Organization-Id"

WRITE_ROLES = frozenset({Role.owner, Role.admin, Role.designer, Role.sales})
MANAGE_ROLES = frozenset({Role.owner, Role.admin})


def _ip(v: str | None) -> str | None:
    try:
        return str(ipaddress.ip_address(v.strip())) if v else None
    except ValueError:
        return None


def client_ip(request: Request) -> str | None:
    """Peer IP, or — when the peer is a trusted proxy — the right-most untrusted X-Forwarded-For hop."""
    host = _ip(request.client.host if request.client else None)
    trusted = set(get_settings().trusted_proxies)
    if host is None or host not in trusted:
        return host
    hops = [h for h in (request.headers.get("x-forwarded-for") or "").split(",") if h.strip()]
    for hop in reversed(hops):
        ip = _ip(hop)
        if ip is None:
            break
        if ip not in trusted:
            return ip
    return host


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(get_settings().session_cookie_name)
    user_id = decode_session_token(token) if token else None
    user = db.get(User, user_id) if user_id else None
    if user is None:
        raise ApiError(401, "unauthorized", "Authentication required")
    return user


@dataclass(frozen=True)
class Tenant:
    user: User
    org: Organization
    role: Role

    @property
    def org_id(self) -> uuid.UUID:
        return self.org.id

    # --- permissions ---
    @property
    def can_write(self) -> bool:
        return self.role in WRITE_ROLES

    @property
    def can_manage(self) -> bool:
        return self.role in MANAGE_ROLES

    def require_write(self) -> None:
        if not self.can_write:
            raise forbidden("Your role is read-only in this organization")

    def require_manage(self) -> None:
        if not self.can_manage:
            raise forbidden("Only organization owners and admins can perform this action")


def load_membership(db: Session, user: User, org_id: uuid.UUID) -> OrganizationMembership | None:
    return db.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == org_id, OrganizationMembership.user_id == user.id
        )
    )


def parse_uuid(value: str, entity: str = "Resource") -> uuid.UUID:
    """Path ids that are not UUIDs are treated as non-existent (404), never as server errors."""
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        raise not_found(entity) from None


def get_tenant(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Tenant:
    raw = request.headers.get(ORG_HEADER)
    if not raw:
        raise ApiError(400, "organization_required", f"Missing {ORG_HEADER} header")
    try:
        org_id = uuid.UUID(raw)
    except ValueError:
        raise ApiError(400, "organization_required", f"Malformed {ORG_HEADER} header") from None
    membership = load_membership(db, user, org_id)
    if membership is None:
        raise not_found("Organization")
    return Tenant(user=user, org=membership.organization, role=Role(membership.role))
