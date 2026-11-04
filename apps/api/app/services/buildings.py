"""Building document service (ADR-002): validated JSONB document with monotonic revision + history.

All writes go through `commit_model`, which validates, enforces optimistic concurrency, increments the
revision, appends a building_revisions row, bumps project.updated_at and writes an audit entry.
Granular endpoints (rooms/components/floors) are document patches that also go through it.
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Callable
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.deps import Tenant
from app.core.errors import ApiError, conflict, not_found, unprocessable
from app.core.errors import format_validation_errors as _fmt
from app.models import Building, BuildingRevision, Project, utcnow
from app.schemas.api import iso_utc
from app.schemas.building import SCHEMA_VERSION, BuildingModel, empty_building_model, structural_errors
from app.services.audit import audit

logger = logging.getLogger("hvac.buildings")


def validate_model(raw: Any, *, loc_prefix: tuple[str | int, ...] = ("model",)) -> dict[str, Any]:
    """Validate against the strict Pydantic mirror + structural integrity; return normalized JSON."""
    try:
        model = BuildingModel.model_validate(raw)
    except ValidationError as e:
        details = _fmt(e.errors())
        for d in details:
            d["loc"] = [*loc_prefix, *d["loc"]]
        raise unprocessable("Building model failed schema validation", "invalid_building_model", details) from None
    errs = structural_errors(model)
    if errs:
        for d in errs:
            d["loc"] = [*loc_prefix, *d["loc"]]
        raise unprocessable("Building model has inconsistent references", "invalid_building_model", errs)
    return model.to_json()


def load_sample_model() -> dict[str, Any] | None:
    """Lazily load packages/shared-types/fixtures/sample-house.json; None if absent or invalid."""
    path = get_settings().sample_house_path
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError):
        logger.warning("sample-house fixture at %s is unreadable; using empty model", path)
        return None
    # Accept either a bare BuildingModel or a BuildingDocument-like wrapper {model: …}.
    if isinstance(raw, dict) and "model" in raw and "schemaVersion" not in raw:
        raw = raw["model"]
    try:
        return validate_model(raw)
    except ApiError as e:
        logger.warning("sample-house fixture failed validation (%s); using empty model", e.details)
        return None


def create_building(
    db: Session, project: Project, user_id: uuid.UUID | None, model: dict[str, Any] | None = None, note: str = "Created"
) -> Building:
    m = model if model is not None else empty_building_model()
    b = Building(
        organization_id=project.organization_id,
        project_id=project.id,
        schema_version=SCHEMA_VERSION,
        revision=0,
        model=m,
        updated_at=utcnow(),
        updated_by=user_id,
    )
    db.add(b)
    db.flush()
    db.add(
        BuildingRevision(
            organization_id=b.organization_id,
            building_id=b.id,
            revision=0,
            schema_version=b.schema_version,
            model=m,
            note=note,
            created_by=user_id,
        )
    )
    return b


def get_building(db: Session, tenant: Tenant, project: Project, *, for_update: bool = False) -> Building:
    stmt = select(Building).where(Building.organization_id == tenant.org_id, Building.project_id == project.id)
    if for_update:
        stmt = stmt.with_for_update()
    b = db.scalar(stmt)
    if b is None:  # should not happen: created with the project
        raise not_found("Building")
    return b


def to_document(b: Building) -> dict[str, Any]:
    return {
        "projectId": str(b.project_id),
        "revision": b.revision,
        "model": b.model,
        "updatedAt": iso_utc(b.updated_at),
    }


def commit_model(
    db: Session,
    tenant: Tenant,
    project: Project,
    building: Building,
    new_model: dict[str, Any],
    *,
    expected_revision: int | None,
    action: str,
    note: str | None = None,
    ip: str | None = None,
    audit_meta: dict[str, Any] | None = None,
) -> Building:
    """Caller must hold a row lock on `building` (get_building(for_update=True))."""
    if expected_revision is not None and expected_revision != building.revision:
        raise conflict(
            "The building was modified elsewhere. Reload to get the latest revision.",
            "revision_conflict",
            {"currentRevision": building.revision},
        )
    validated = validate_model(new_model)
    now = utcnow()
    building.revision += 1
    building.model = validated
    building.schema_version = SCHEMA_VERSION
    building.updated_at = now
    building.updated_by = tenant.user.id
    project.updated_at = now
    db.add(
        BuildingRevision(
            organization_id=building.organization_id,
            building_id=building.id,
            revision=building.revision,
            schema_version=building.schema_version,
            model=validated,
            note=note,
            created_by=tenant.user.id,
        )
    )
    audit(
        db,
        action,
        org_id=tenant.org_id,
        user_id=tenant.user.id,
        entity_type="building",
        entity_id=project.id,
        ip=ip,
        metadata={"revision": building.revision, **(audit_meta or {})},
    )
    db.commit()
    return building


# ---------- tenant-scoped element lookup (rooms / components by id) ----------

COMPONENT_COLLECTIONS = {"wall": "walls", "opening": "openings"}


def find_building_containing(
    db: Session, tenant: Tenant, collection: str, element_id: str, project_id: uuid.UUID | None = None
) -> Building:
    """Find the caller-org building whose model.<collection> contains an element with this id.

    Uses JSONB containment (served by the GIN jsonb_path_ops index) and is ALWAYS filtered by the
    tenant's organization_id, so ids from other orgs are indistinguishable from missing ones.
    Element ids are only unique within a building (duplicated / sample projects share them), so if
    more than one project matches and no ``project_id`` is given, the call is refused with 409.
    """
    if collection not in ("rooms", "walls", "openings"):
        raise ValueError(collection)
    probe = json.dumps({collection: [{"id": element_id}]})
    stmt = (
        select(Building.id)
        .join(Project, Project.id == Building.project_id)
        .where(
            Building.organization_id == tenant.org_id,
            Project.organization_id == tenant.org_id,
            Project.deleted_at.is_(None),
            Building.model.op("@>")(text("CAST(:probe AS jsonb)").bindparams(probe=probe)),
            *([Project.id == project_id] if project_id is not None else []),
        )
        .order_by(Building.updated_at.desc())
        .limit(2)
    )
    matches = list(db.scalars(stmt))
    if len(matches) > 1:
        raise ApiError(
            409,
            "ambiguous_element_id",
            "This id exists in more than one project; pass ?projectId=<project id> to choose one.",
        )
    building_id = matches[0] if matches else None
    if building_id is None:
        raise not_found("Room" if collection == "rooms" else "Component")
    b = db.scalar(
        select(Building).where(Building.id == building_id, Building.organization_id == tenant.org_id).with_for_update()
    )
    if b is None:
        raise not_found("Room" if collection == "rooms" else "Component")
    return b


def project_for_building(db: Session, tenant: Tenant, b: Building) -> Project:
    p = db.scalar(
        select(Project).where(
            Project.id == b.project_id, Project.organization_id == tenant.org_id, Project.deleted_at.is_(None)
        )
    )
    if p is None:
        raise not_found("Project")
    return p


def merge_patch(target: Any, patch: Any) -> Any:
    """RFC 7396 JSON merge patch, except arrays replace and explicit null sets null (fields are nullable,
    so null must mean 'clear the value', not 'delete the key'); the result is re-validated anyway."""
    if not isinstance(patch, dict) or not isinstance(target, dict):
        return patch
    out = dict(target)
    for k, v in patch.items():
        out[k] = merge_patch(out.get(k), v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def patch_element(
    model: dict[str, Any], collection: str, element_id: str, fn: Callable[[dict[str, Any]], dict[str, Any] | None]
) -> dict[str, Any]:
    """Return a new model with fn applied to the element (fn returns None to delete)."""
    items = []
    for it in model[collection]:
        if it.get("id") == element_id:
            res = fn(it)
            if res is not None:
                items.append(res)
        else:
            items.append(it)
    return {**model, collection: items}
