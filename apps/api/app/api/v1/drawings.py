"""Drawing import foundation (PRD §7): upload, metadata, file streaming. AI analysis is a later phase."""

from __future__ import annotations

import hashlib
import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.deps import Tenant, client_ip, get_tenant, parse_uuid
from app.core.errors import ApiError, not_found
from app.models import Document, Project
from app.schemas.api import DrawingOut
from app.services import projects as psvc
from app.services.audit import audit
from app.services.drawings import ALLOWED, sanitize_filename, validate_upload
from app.services.storage import get_storage

router = APIRouter(tags=["drawings"])

DRAWING_TYPE = "drawing"


def _out(d: Document) -> DrawingOut:
    return DrawingOut(
        id=str(d.id),
        project_id=str(d.project_id),
        document_type=d.document_type,
        filename=d.filename,
        content_type=d.content_type,
        size=d.size,
        sha256=d.sha256,
        revision=d.revision,
        created_at=d.created_at,
        file_url=f"/api/v1/drawings/{d.id}/file",
    )


def _get_drawing(db: Session, tenant: Tenant, drawing_id: str) -> Document:
    did = parse_uuid(drawing_id, "Drawing")
    d = db.scalar(
        select(Document)
        .join(Project, Project.id == Document.project_id)
        .where(
            Document.id == did,
            Document.organization_id == tenant.org_id,
            Project.organization_id == tenant.org_id,
            Project.deleted_at.is_(None),
            Document.document_type == DRAWING_TYPE,
        )
    )
    if d is None:
        raise not_found("Drawing")
    return d


@router.post("/projects/{project_id}/drawings", response_model=DrawingOut, status_code=201)
def upload_drawing(
    project_id: str,
    request: Request,
    file: UploadFile = File(...),
    tenant: Tenant = Depends(get_tenant),
    db: Session = Depends(get_db),
) -> DrawingOut:
    p = psvc.get_project(db, tenant, project_id)
    tenant.require_write()
    max_bytes = get_settings().max_upload_bytes
    # Sync handler (runs in the threadpool) so blocking DB/disk work never stalls the event loop.
    data = file.file.read(max_bytes + 1)
    content_type = validate_upload(file.filename, file.content_type, data, max_bytes)
    ext = ALLOWED[content_type][1]
    filename = sanitize_filename(file.filename, ext)
    digest = hashlib.sha256(data).hexdigest()
    doc_id = uuid.uuid4()
    key = f"orgs/{tenant.org_id}/projects/{p.id}/drawings/{doc_id}{ext}"
    get_storage().put(key, data)
    prior = db.scalar(
        select(Document.revision)
        .where(
            Document.project_id == p.id,
            Document.organization_id == tenant.org_id,
            Document.document_type == DRAWING_TYPE,
            Document.filename == filename,
        )
        .order_by(Document.revision.desc())
        .limit(1)
    )
    d = Document(
        id=doc_id,
        organization_id=tenant.org_id,
        project_id=p.id,
        document_type=DRAWING_TYPE,
        filename=filename,
        content_type=content_type,
        size=len(data),
        sha256=digest,
        storage_key=key,
        revision=(prior or 0) + 1,
        uploaded_by=tenant.user.id,
    )
    db.add(d)
    audit(
        db,
        "drawing.upload",
        org_id=tenant.org_id,
        user_id=tenant.user.id,
        entity_type="document",
        entity_id=d.id,
        ip=client_ip(request),
        metadata={"projectId": str(p.id), "filename": filename, "size": len(data), "sha256": digest},
    )
    try:
        db.commit()
    except Exception:
        get_storage().delete(key)
        raise
    db.refresh(d)
    return _out(d)


@router.get("/projects/{project_id}/drawings", response_model=list[DrawingOut])
def list_drawings(project_id: str, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)):
    p = psvc.get_project(db, tenant, project_id)
    rows = db.scalars(
        select(Document)
        .where(
            Document.project_id == p.id,
            Document.organization_id == tenant.org_id,
            Document.document_type == DRAWING_TYPE,
        )
        .order_by(Document.created_at.desc())
    ).all()
    return [_out(d) for d in rows]


@router.get("/drawings/{drawing_id}", response_model=DrawingOut)
def get_drawing(drawing_id: str, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)):
    return _out(_get_drawing(db, tenant, drawing_id))


@router.get("/drawings/{drawing_id}/file")
def get_drawing_file(drawing_id: str, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)):
    d = _get_drawing(db, tenant, drawing_id)
    storage = get_storage()
    if not storage.exists(d.storage_key):
        raise ApiError(404, "file_missing", "The stored file for this drawing is missing")
    headers = {
        "Content-Length": str(d.size),
        "Content-Disposition": f"inline; filename*=UTF-8''{quote(d.filename)}",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
        "ETag": f'"{d.sha256}"',
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    }
    return StreamingResponse(storage.open_stream(d.storage_key), media_type=d.content_type, headers=headers)


def _not_implemented() -> None:
    raise ApiError(501, "not_implemented", "AI drawing interpretation is planned for a later phase")


@router.post("/drawings/{drawing_id}/analyze", status_code=501)
def analyze_drawing(drawing_id: str, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)):
    _get_drawing(db, tenant, drawing_id)
    _not_implemented()


@router.get("/drawings/{drawing_id}/analysis", status_code=501)
def get_analysis(drawing_id: str, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)):
    _get_drawing(db, tenant, drawing_id)
    _not_implemented()


@router.post("/drawings/{drawing_id}/approve", status_code=501)
def approve_analysis(drawing_id: str, tenant: Tenant = Depends(get_tenant), db: Session = Depends(get_db)):
    _get_drawing(db, tenant, drawing_id)
    _not_implemented()
