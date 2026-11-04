"""Project queries and mutations. Every query is scoped by the tenant's organization_id."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import Tenant, parse_uuid
from app.core.errors import not_found, unprocessable
from app.models import (
    Customer,
    OrganizationMembership,
    Project,
    ProjectStatus,
    ProjectType,
    WorkflowStage,
    utcnow,
)
from app.schemas.api import AssignedTo, CustomerIn, CustomerOut, ProjectOut, ProjectUpdate


def to_out(p: Project) -> ProjectOut:
    return ProjectOut(
        id=str(p.id),
        organization_id=str(p.organization_id),
        name=p.name,
        address=p.address,
        status=p.status.value,
        project_type=p.project_type.value,
        workflow_stage=p.workflow_stage.value,
        customer=(
            CustomerOut(
                id=str(p.customer.id),
                name=p.customer.name,
                email=p.customer.email,
                phone=p.customer.phone,
                address=p.customer.address,
            )
            if p.customer
            else None
        ),
        assigned_to=AssignedTo(id=str(p.assigned_to.id), name=p.assigned_to.name) if p.assigned_to else None,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


def _base(tenant: Tenant) -> Select[tuple[Project]]:
    return select(Project).where(Project.organization_id == tenant.org_id, Project.deleted_at.is_(None))


def get_project(db: Session, tenant: Tenant, project_id: str | uuid.UUID, *, for_update: bool = False) -> Project:
    pid = project_id if isinstance(project_id, uuid.UUID) else parse_uuid(project_id, "Project")
    stmt = _base(tenant).where(Project.id == pid)
    if for_update:
        stmt = stmt.with_for_update(of=Project)
    project = db.scalar(stmt)
    if project is None:
        raise not_found("Project")
    return project


def _escape_like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def list_projects(
    db: Session,
    tenant: Tenant,
    *,
    q: str | None,
    status: str | None,
    stage: str | None,
    include_archived: bool,
    limit: int,
    offset: int,
) -> tuple[list[Project], int]:
    stmt = _base(tenant).outerjoin(Customer, Project.customer_id == Customer.id)
    if q and q.strip():
        pattern = f"%{_escape_like(q.strip())}%"
        stmt = stmt.where(
            or_(
                Project.name.ilike(pattern, escape="\\"),
                Project.address.ilike(pattern, escape="\\"),
                Customer.name.ilike(pattern, escape="\\"),
            )
        )
    if status:
        stmt = stmt.where(Project.status == ProjectStatus(status))
    if stage:
        stmt = stmt.where(Project.workflow_stage == WorkflowStage(stage))
    if not include_archived and status != ProjectStatus.archived.value:
        stmt = stmt.where(Project.archived_at.is_(None))

    total = db.scalar(select(func.count()).select_from(stmt.with_only_columns(Project.id).subquery())) or 0
    items = db.scalars(stmt.order_by(Project.updated_at.desc(), Project.id).limit(limit).offset(offset)).unique()
    return list(items), total


def create_customer(db: Session, tenant: Tenant, data: CustomerIn) -> Customer:
    c = Customer(
        organization_id=tenant.org_id,
        name=data.name,
        email=str(data.email).lower() if data.email else None,
        phone=data.phone,
        address=data.address,
    )
    db.add(c)
    db.flush()
    return c


def _check_assignee(db: Session, tenant: Tenant, user_id: str) -> uuid.UUID:
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise unprocessable(
            "assignedToUserId is not a member of this organization",
            details=[{"loc": ["assignedToUserId"], "msg": "Not a member", "type": "invalid_assignee"}],
        ) from None
    exists = db.scalar(
        select(OrganizationMembership.id).where(
            OrganizationMembership.organization_id == tenant.org_id, OrganizationMembership.user_id == uid
        )
    )
    if not exists:
        raise unprocessable(
            "assignedToUserId is not a member of this organization",
            details=[{"loc": ["assignedToUserId"], "msg": "Not a member", "type": "invalid_assignee"}],
        )
    return uid


def set_archived(p: Project, archived: bool, now: datetime | None = None) -> None:
    now = now or utcnow()
    if archived and p.archived_at is None:
        p.status_before_archive = p.status if p.status != ProjectStatus.archived else None
        p.status = ProjectStatus.archived
        p.archived_at = now
    elif not archived and p.archived_at is not None:
        p.status = p.status_before_archive or ProjectStatus.in_progress
        p.status_before_archive = None
        p.archived_at = None


def apply_update(db: Session, tenant: Tenant, p: Project, data: ProjectUpdate) -> list[str]:
    fields = data.model_fields_set
    changed: list[str] = []
    if "name" in fields and data.name is not None:
        p.name = data.name
        changed.append("name")
    if "address" in fields:
        p.address = data.address
        changed.append("address")
    if "project_type" in fields and data.project_type is not None:
        p.project_type = ProjectType(data.project_type)
        changed.append("projectType")
    if "workflow_stage" in fields and data.workflow_stage is not None:
        p.workflow_stage = WorkflowStage(data.workflow_stage)
        changed.append("workflowStage")
    if "assigned_to_user_id" in fields:
        p.assigned_to_user_id = (
            _check_assignee(db, tenant, data.assigned_to_user_id) if data.assigned_to_user_id else None
        )
        changed.append("assignedToUserId")
    if "status" in fields and data.status is not None:
        new = ProjectStatus(data.status)
        if new == ProjectStatus.archived:
            set_archived(p, True)
        else:
            if p.archived_at is not None:
                set_archived(p, False)
            p.status = new
        changed.append("status")
    if changed:
        p.updated_at = utcnow()
    return changed
