"""Audit log writer. Entries are added to the caller's session and commit with the business change."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog


def audit(
    db: Session,
    action: str,
    *,
    org_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
    entity_type: str | None = None,
    entity_id: Any = None,
    ip: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    db.add(
        AuditLog(
            organization_id=org_id,
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            ip=ip,
            metadata_=metadata or {},
        )
    )
