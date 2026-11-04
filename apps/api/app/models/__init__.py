"""SQLAlchemy ORM models. Every tenant-owned table carries an indexed organization_id."""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

NAMING = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


def _pk() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, default=uuid.uuid4)


def _created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now())


def _org_fk() -> Mapped[uuid.UUID]:
    return mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)


class Role(enum.StrEnum):
    owner = "owner"
    admin = "admin"
    designer = "designer"
    sales = "sales"
    viewer = "viewer"


class ProjectStatus(enum.StrEnum):
    draft = "draft"
    in_progress = "in_progress"
    awaiting_information = "awaiting_information"
    ready_for_review = "ready_for_review"
    completed = "completed"
    archived = "archived"


class ProjectType(enum.StrEnum):
    new_construction = "new_construction"
    replacement = "replacement"
    addition = "addition"
    remodel = "remodel"
    other = "other"


class WorkflowStage(enum.StrEnum):
    building = "building"
    loads = "loads"
    equipment = "equipment"
    ducts = "ducts"
    proposal = "proposal"
    done = "done"


def _pg_enum(cls: type[enum.Enum], name: str) -> Enum:
    return Enum(cls, name=name, values_callable=lambda e: [m.value for m in e], validate_strings=True)


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = _pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    authentication_provider: Mapped[str] = mapped_column(String(40), nullable=False, default="password")
    created_at: Mapped[datetime] = _created()

    __table_args__ = (Index("uq_users_email_lower", func.lower(email), unique=True),)


class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[uuid.UUID] = _pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    subscription_plan: Mapped[str] = mapped_column(String(40), nullable=False, default="free")
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = _created()


class OrganizationMembership(Base):
    __tablename__ = "organization_memberships"
    id: Mapped[uuid.UUID] = _pk()
    organization_id: Mapped[uuid.UUID] = _org_fk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role: Mapped[Role] = mapped_column(_pg_enum(Role, "membership_role"), nullable=False)
    created_at: Mapped[datetime] = _created()

    organization: Mapped[Organization] = relationship(lazy="joined")
    user: Mapped[User] = relationship(lazy="joined")

    __table_args__ = (UniqueConstraint("organization_id", "user_id", name="uq_membership_org_user"),)


class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[uuid.UUID] = _pk()
    organization_id: Mapped[uuid.UUID] = _org_fk()
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str | None] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(40))
    address: Mapped[str | None] = mapped_column(String(400))
    created_at: Mapped[datetime] = _created()


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[uuid.UUID] = _pk()
    organization_id: Mapped[uuid.UUID] = _org_fk()
    customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id", ondelete="SET NULL"), index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    address: Mapped[str | None] = mapped_column(String(400))
    status: Mapped[ProjectStatus] = mapped_column(
        _pg_enum(ProjectStatus, "project_status"), nullable=False, default=ProjectStatus.draft
    )
    project_type: Mapped[ProjectType] = mapped_column(
        _pg_enum(ProjectType, "project_type"), nullable=False, default=ProjectType.replacement
    )
    workflow_stage: Mapped[WorkflowStage] = mapped_column(
        _pg_enum(WorkflowStage, "workflow_stage"), nullable=False, default=WorkflowStage.building
    )
    assigned_to_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    # Status before archiving, restored on unarchive.
    status_before_archive: Mapped[ProjectStatus | None] = mapped_column(_pg_enum(ProjectStatus, "project_status"))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Soft delete: rows stay for audit/recovery; every query filters deleted_at IS NULL.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )

    customer: Mapped[Customer | None] = relationship(lazy="joined")
    assigned_to: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[assigned_to_user_id])

    __table_args__ = (Index("ix_projects_org_updated", "organization_id", "updated_at"),)


class Building(Base):
    __tablename__ = "buildings"
    id: Mapped[uuid.UUID] = _pk()
    organization_id: Mapped[uuid.UUID] = _org_fk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    model: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (
        # Supports @> containment lookups for rooms/components by id.
        Index("ix_buildings_model_gin", "model", postgresql_using="gin", postgresql_ops={"model": "jsonb_path_ops"}),
    )


class BuildingRevision(Base):
    __tablename__ = "building_revisions"
    id: Mapped[uuid.UUID] = _pk()
    organization_id: Mapped[uuid.UUID] = _org_fk()
    building_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("buildings.id", ondelete="CASCADE"), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    model: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    note: Mapped[str | None] = mapped_column(String(200))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _created()

    __table_args__ = (UniqueConstraint("building_id", "revision", name="uq_building_revisions_building_rev"),)


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[uuid.UUID] = _pk()
    organization_id: Mapped[uuid.UUID] = _org_fk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    document_type: Mapped[str] = mapped_column(String(40), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _created()


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[uuid.UUID] = _pk()
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(40))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    ip: Mapped[str | None] = mapped_column(INET)
    created_at: Mapped[datetime] = _created()

    __table_args__ = (Index("ix_audit_logs_org_created", "organization_id", "created_at"),)


__all__ = [
    "AuditLog",
    "Base",
    "Building",
    "BuildingRevision",
    "Customer",
    "Document",
    "Organization",
    "OrganizationMembership",
    "Project",
    "ProjectStatus",
    "ProjectType",
    "Role",
    "User",
    "WorkflowStage",
    "utcnow",
]
