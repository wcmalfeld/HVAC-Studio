"""Projects CRUD, search, duplicate, archive (tenant-scoped)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import Tenant, client_ip, get_tenant
from app.models import Project, ProjectStatus, ProjectType, utcnow
from app.schemas.api import (
    ProjectCreate,
    ProjectList,
    ProjectOut,
    ProjectStatusT,
    ProjectUpdate,
    WorkflowStageT,
)
from app.services import buildings as bsvc
from app.services import projects as svc
from app.services.audit import audit

router = APIRouter(tags=["projects"])


@router.get("/projects", response_model=ProjectList)
def list_projects(
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    q: Annotated[str | None, Query(max_length=200)] = None,
    status: ProjectStatusT | None = None,
    stage: WorkflowStageT | None = None,
    include_archived: Annotated[bool, Query(alias="includeArchived")] = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=2**31 - 1)] = 0,
) -> ProjectList:
    items, total = svc.list_projects(
        db, tenant, q=q, status=status, stage=stage, include_archived=include_archived, limit=limit, offset=offset
    )
    return ProjectList(items=[svc.to_out(p) for p in items], total=total)


@router.post("/projects", response_model=ProjectOut, status_code=201)
def create_project(
    body: ProjectCreate, request: Request, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)
) -> ProjectOut:
    tenant.require_write()
    customer = svc.create_customer(db, tenant, body.customer) if body.customer else None
    now = utcnow()
    p = Project(
        organization_id=tenant.org_id,
        customer_id=customer.id if customer else None,
        name=body.name,
        address=body.address,
        project_type=ProjectType(body.project_type),
        created_by=tenant.user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(p)
    db.flush()
    model = bsvc.load_sample_model() if body.sample else None
    bsvc.create_building(db, p, tenant.user.id, model, note="Created from sample" if model else "Created")
    audit(
        db,
        "project.create",
        org_id=tenant.org_id,
        user_id=tenant.user.id,
        entity_type="project",
        entity_id=p.id,
        ip=client_ip(request),
        metadata={"sample": bool(model)},
    )
    db.commit()
    db.refresh(p)
    return svc.to_out(p)


@router.get("/projects/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)) -> ProjectOut:
    return svc.to_out(svc.get_project(db, tenant, project_id))


@router.patch("/projects/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: str,
    body: ProjectUpdate,
    request: Request,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
) -> ProjectOut:
    p = svc.get_project(db, tenant, project_id, for_update=True)
    tenant.require_write()
    changed = svc.apply_update(db, tenant, p, body)
    if changed:
        audit(
            db,
            "project.update",
            org_id=tenant.org_id,
            user_id=tenant.user.id,
            entity_type="project",
            entity_id=p.id,
            ip=client_ip(request),
            metadata={"fields": changed},
        )
    db.commit()
    db.refresh(p)
    return svc.to_out(p)


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(
    project_id: str, request: Request, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)
) -> Response:
    p = svc.get_project(db, tenant, project_id, for_update=True)
    tenant.require_manage()
    p.deleted_at = utcnow()
    audit(
        db,
        "project.delete",
        org_id=tenant.org_id,
        user_id=tenant.user.id,
        entity_type="project",
        entity_id=p.id,
        ip=client_ip(request),
        metadata={"name": p.name},
    )
    db.commit()
    return Response(status_code=204)


@router.post("/projects/{project_id}/duplicate", response_model=ProjectOut, status_code=201)
def duplicate_project(
    project_id: str, request: Request, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)
) -> ProjectOut:
    src = svc.get_project(db, tenant, project_id)
    tenant.require_write()
    src_building = bsvc.get_building(db, tenant, src)
    now = utcnow()
    name = f"Copy of {src.name}"[:200]
    copy = Project(
        organization_id=tenant.org_id,
        customer_id=src.customer_id,
        name=name,
        address=src.address,
        status=ProjectStatus.draft,
        project_type=src.project_type,
        workflow_stage=src.workflow_stage,
        assigned_to_user_id=src.assigned_to_user_id,
        created_by=tenant.user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(copy)
    db.flush()
    bsvc.create_building(
        db,
        copy,
        tenant.user.id,
        src_building.model,
        note=f"Duplicated from project {src.id} revision {src_building.revision}",
    )
    audit(
        db,
        "project.duplicate",
        org_id=tenant.org_id,
        user_id=tenant.user.id,
        entity_type="project",
        entity_id=copy.id,
        ip=client_ip(request),
        metadata={"sourceProjectId": str(src.id), "sourceRevision": src_building.revision},
    )
    db.commit()
    db.refresh(copy)
    return svc.to_out(copy)


def _set_archive(project_id: str, archived: bool, request: Request, tenant: Tenant, db: Session) -> ProjectOut:
    p = svc.get_project(db, tenant, project_id, for_update=True)
    tenant.require_write()
    was = p.archived_at is not None
    svc.set_archived(p, archived)
    if was != archived:
        p.updated_at = utcnow()
        audit(
            db,
            "project.archive" if archived else "project.unarchive",
            org_id=tenant.org_id,
            user_id=tenant.user.id,
            entity_type="project",
            entity_id=p.id,
            ip=client_ip(request),
        )
    db.commit()
    db.refresh(p)
    return svc.to_out(p)


@router.post("/projects/{project_id}/archive", response_model=ProjectOut)
def archive_project(
    project_id: str, request: Request, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)
) -> ProjectOut:
    return _set_archive(project_id, True, request, tenant, db)


@router.post("/projects/{project_id}/unarchive", response_model=ProjectOut)
def unarchive_project(
    project_id: str, request: Request, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)
) -> ProjectOut:
    return _set_archive(project_id, False, request, tenant, db)
