"""Building document endpoints (ADR-002) + granular document-patch endpoints (PRD §24)."""

from __future__ import annotations

import copy
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Path, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import Tenant, client_ip, get_tenant
from app.core.errors import ApiError, bad_request, not_found, unprocessable
from app.models import Building, BuildingRevision, User
from app.schemas.api import (
    AssignedTo,
    BuildingPut,
    BuildingRevisionDetail,
    BuildingRevisionOut,
    ComponentCreate,
    RestoreIn,
)
from app.services import buildings as bsvc
from app.services import projects as psvc

router = APIRouter(tags=["building"])

# Postgres INTEGER bounds: larger values would reach the DB and raise (500) instead of a 404/422.
INT4_MAX = 2**31 - 1
RevPath = Annotated[int, Path(ge=0, le=INT4_MAX)]

RevisionQuery = Annotated[
    int | None,
    Query(
        ge=0,
        le=INT4_MAX,
        description="Optional optimistic-concurrency guard: 409 revision_conflict if it is not current.",
    ),
]

ProjectIdQuery = Annotated[
    uuid.UUID | None,
    Query(
        alias="projectId",
        description="Project that owns the element. Required when the id exists in more than one project.",
    ),
]


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _require_obj(body: Any, what: str) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise unprocessable(
            f"{what} must be a JSON object", details=[{"loc": [], "msg": "Expected object", "type": "type_error"}]
        )
    return body


def _patch_result(b: Building, item: dict[str, Any] | None, **extra: Any) -> dict[str, Any]:
    out = bsvc.to_document(b)
    del out["model"]
    out["item"] = item
    out.update(extra)
    return out


# ---------- whole document ----------


@router.get("/projects/{project_id}/building")
def get_building(project_id: str, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)):
    p = psvc.get_project(db, tenant, project_id)
    return bsvc.to_document(bsvc.get_building(db, tenant, p))


@router.put("/projects/{project_id}/building")
def put_building(
    project_id: str,
    body: BuildingPut,
    request: Request,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    p = psvc.get_project(db, tenant, project_id)
    tenant.require_write()
    b = bsvc.get_building(db, tenant, p, for_update=True)
    bsvc.commit_model(
        db, tenant, p, b, body.model, expected_revision=body.revision, action="building.save", ip=client_ip(request)
    )
    return bsvc.to_document(b)


# ---------- revision history ----------


def _rev_creator(db: Session, ids: set[uuid.UUID]) -> dict[uuid.UUID, AssignedTo]:
    if not ids:
        return {}
    return {u.id: AssignedTo(id=str(u.id), name=u.name) for u in db.scalars(select(User).where(User.id.in_(ids)))}


@router.get("/projects/{project_id}/building/revisions", response_model=list[BuildingRevisionOut])
def list_revisions(
    project_id: str,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0, le=INT4_MAX)] = 0,
):
    p = psvc.get_project(db, tenant, project_id)
    b = bsvc.get_building(db, tenant, p)
    rows = db.execute(
        select(
            BuildingRevision.revision,
            BuildingRevision.schema_version,
            BuildingRevision.note,
            BuildingRevision.created_at,
            BuildingRevision.created_by,
        )
        .where(BuildingRevision.building_id == b.id, BuildingRevision.organization_id == tenant.org_id)
        .order_by(BuildingRevision.revision.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    users = _rev_creator(db, {r.created_by for r in rows if r.created_by})
    return [
        BuildingRevisionOut(
            revision=r.revision,
            schema_version=r.schema_version,
            note=r.note,
            created_at=r.created_at,
            created_by=users.get(r.created_by),
        )
        for r in rows
    ]


def _get_revision(db: Session, tenant: Tenant, b: Building, rev: int) -> BuildingRevision:
    r = db.scalar(
        select(BuildingRevision).where(
            BuildingRevision.building_id == b.id,
            BuildingRevision.organization_id == tenant.org_id,
            BuildingRevision.revision == rev,
        )
    )
    if r is None:
        raise not_found("Revision")
    return r


@router.get("/projects/{project_id}/building/revisions/{rev}", response_model=BuildingRevisionDetail)
def get_revision(project_id: str, rev: RevPath, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)):
    p = psvc.get_project(db, tenant, project_id)
    r = _get_revision(db, tenant, bsvc.get_building(db, tenant, p), rev)
    users = _rev_creator(db, {r.created_by} if r.created_by else set())
    return BuildingRevisionDetail(
        revision=r.revision,
        schema_version=r.schema_version,
        note=r.note,
        created_at=r.created_at,
        created_by=users.get(r.created_by),
        model=r.model,
    )


@router.post("/projects/{project_id}/building/revisions/{rev}/restore")
def restore_revision(
    project_id: str,
    rev: RevPath,
    request: Request,
    body: RestoreIn | None = None,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    p = psvc.get_project(db, tenant, project_id)
    tenant.require_write()
    b = bsvc.get_building(db, tenant, p, for_update=True)
    r = _get_revision(db, tenant, b, rev)
    bsvc.commit_model(
        db,
        tenant,
        p,
        b,
        copy.deepcopy(r.model),
        expected_revision=body.revision if body else None,
        action="building.restore",
        note=f"Restored from revision {rev}",
        ip=client_ip(request),
        audit_meta={"restoredFrom": rev},
    )
    return bsvc.to_document(b)


# ---------- granular patches ----------


def _locked_project_building(db: Session, tenant: Tenant, project_id: str):
    p = psvc.get_project(db, tenant, project_id)
    tenant.require_write()
    return p, bsvc.get_building(db, tenant, p, for_update=True)


@router.post("/projects/{project_id}/floors", status_code=201)
def add_floor(
    project_id: str,
    request: Request,
    body: Annotated[Any, Body()],
    revision: RevisionQuery = None,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    floor = dict(_require_obj(body, "Floor"))
    p, b = _locked_project_building(db, tenant, project_id)
    floor.setdefault("id", _new_id("floor"))
    floor.setdefault("order", max((f["order"] for f in b.model["floors"]), default=-1) + 1)
    model = {**b.model, "floors": [*b.model["floors"], floor]}
    bsvc.commit_model(
        db,
        tenant,
        p,
        b,
        model,
        expected_revision=revision,
        action="building.floor_add",
        note="Floor added",
        ip=client_ip(request),
        audit_meta={"floorId": floor["id"]},
    )
    return _patch_result(b, next(f for f in b.model["floors"] if f["id"] == floor["id"]))


@router.post("/projects/{project_id}/rooms", status_code=201)
def add_room(
    project_id: str,
    request: Request,
    body: Annotated[Any, Body()],
    revision: RevisionQuery = None,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    room = dict(_require_obj(body, "Room"))
    p, b = _locked_project_building(db, tenant, project_id)
    room.setdefault("id", _new_id("room"))
    model = {**b.model, "rooms": [*b.model["rooms"], room]}
    bsvc.commit_model(
        db,
        tenant,
        p,
        b,
        model,
        expected_revision=revision,
        action="building.room_add",
        note="Room added",
        ip=client_ip(request),
        audit_meta={"roomId": room["id"]},
    )
    return _patch_result(b, next(r for r in b.model["rooms"] if r["id"] == room["id"]))


def _patch(item: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    if "id" in patch and patch["id"] != item["id"]:
        raise bad_request("The id of an element cannot be changed", "immutable_id")
    return bsvc.merge_patch(item, patch)


@router.patch("/rooms/{room_id}")
def patch_room(
    room_id: str,
    request: Request,
    body: Annotated[Any, Body()],
    revision: RevisionQuery = None,
    project_id: ProjectIdQuery = None,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    patch = _require_obj(body, "Room patch")
    tenant.require_write()
    b = bsvc.find_building_containing(db, tenant, "rooms", room_id, project_id)
    p = bsvc.project_for_building(db, tenant, b)
    model = bsvc.patch_element(b.model, "rooms", room_id, lambda r: _patch(r, patch))
    bsvc.commit_model(
        db,
        tenant,
        p,
        b,
        model,
        expected_revision=revision,
        action="building.room_update",
        note="Room updated",
        ip=client_ip(request),
        audit_meta={"roomId": room_id},
    )
    return _patch_result(b, next(r for r in b.model["rooms"] if r["id"] == room_id))


@router.delete("/rooms/{room_id}")
def delete_room(
    room_id: str,
    request: Request,
    revision: RevisionQuery = None,
    project_id: ProjectIdQuery = None,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    tenant.require_write()
    b = bsvc.find_building_containing(db, tenant, "rooms", room_id, project_id)
    p = bsvc.project_for_building(db, tenant, b)
    model = bsvc.patch_element(b.model, "rooms", room_id, lambda r: None)
    bsvc.commit_model(
        db,
        tenant,
        p,
        b,
        model,
        expected_revision=revision,
        action="building.room_delete",
        note="Room deleted",
        ip=client_ip(request),
        audit_meta={"roomId": room_id},
    )
    return _patch_result(b, None, deletedIds=[room_id])


@router.post("/projects/{project_id}/components", status_code=201)
def add_component(
    project_id: str,
    body: ComponentCreate,
    request: Request,
    revision: RevisionQuery = None,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    p, b = _locked_project_building(db, tenant, project_id)
    coll = bsvc.COMPONENT_COLLECTIONS[body.kind]
    comp = dict(body.component)
    comp.setdefault("id", _new_id(body.kind))
    model = {**b.model, coll: [*b.model[coll], comp]}
    bsvc.commit_model(
        db,
        tenant,
        p,
        b,
        model,
        expected_revision=revision,
        action="building.component_add",
        note=f"{body.kind.capitalize()} added",
        ip=client_ip(request),
        audit_meta={"componentId": comp["id"], "kind": body.kind},
    )
    return _patch_result(b, next(c for c in b.model[coll] if c["id"] == comp["id"]), kind=body.kind)


def _find_component(
    db: Session, tenant: Tenant, component_id: str, project_id: uuid.UUID | None = None
) -> tuple[Building, str, str]:
    for kind, coll in bsvc.COMPONENT_COLLECTIONS.items():
        try:
            return bsvc.find_building_containing(db, tenant, coll, component_id, project_id), kind, coll
        except ApiError as e:  # 404 → try the next collection
            if e.status_code != 404:
                raise
    raise not_found("Component")


@router.patch("/components/{component_id}")
def patch_component(
    component_id: str,
    request: Request,
    body: Annotated[Any, Body()],
    revision: RevisionQuery = None,
    project_id: ProjectIdQuery = None,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    patch = _require_obj(body, "Component patch")
    tenant.require_write()
    b, kind, coll = _find_component(db, tenant, component_id, project_id)
    p = bsvc.project_for_building(db, tenant, b)
    model = bsvc.patch_element(b.model, coll, component_id, lambda c: _patch(c, patch))
    bsvc.commit_model(
        db,
        tenant,
        p,
        b,
        model,
        expected_revision=revision,
        action="building.component_update",
        note=f"{kind.capitalize()} updated",
        ip=client_ip(request),
        audit_meta={"componentId": component_id, "kind": kind},
    )
    return _patch_result(b, next(c for c in b.model[coll] if c["id"] == component_id), kind=kind)


@router.delete("/components/{component_id}")
def delete_component(
    component_id: str,
    request: Request,
    revision: RevisionQuery = None,
    project_id: ProjectIdQuery = None,
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
):
    tenant.require_write()
    b, kind, coll = _find_component(db, tenant, component_id, project_id)
    p = bsvc.project_for_building(db, tenant, b)
    model = bsvc.patch_element(b.model, coll, component_id, lambda c: None)
    deleted = [component_id]
    if kind == "wall":
        # Openings are hosted by walls; deleting a wall deletes its openings (otherwise they would dangle).
        hosted = [o["id"] for o in model["openings"] if o["wallId"] == component_id]
        model = {**model, "openings": [o for o in model["openings"] if o["wallId"] != component_id]}
        deleted += hosted
    bsvc.commit_model(
        db,
        tenant,
        p,
        b,
        model,
        expected_revision=revision,
        action="building.component_delete",
        note=f"{kind.capitalize()} deleted",
        ip=client_ip(request),
        audit_meta={"componentId": component_id, "kind": kind, "deletedIds": deleted},
    )
    return _patch_result(b, None, kind=kind, deletedIds=deleted)
