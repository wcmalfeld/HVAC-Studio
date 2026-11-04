"""Pydantic mirror of packages/shared-types/src/api.ts, plus API-only payloads not (yet) in the contract.

Wire format is camelCase; timestamps are ISO-8601 UTC strings ending in "Z"; ids are UUID strings.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    PlainSerializer,
    StringConstraints,
    field_validator,
)
from pydantic.alias_generators import to_camel

from app.core.security import MIN_PASSWORD_LENGTH


def iso_utc(d: datetime) -> str:
    if d.tzinfo is None:
        d = d.replace(tzinfo=UTC)
    return d.astimezone(UTC).isoformat().replace("+00:00", "Z")


UtcDatetime = Annotated[datetime, PlainSerializer(iso_utc, return_type=str)]
Str = Annotated[str, StringConstraints(strip_whitespace=True)]

RoleT = Literal["owner", "admin", "designer", "sales", "viewer"]
ProjectStatusT = Literal["draft", "in_progress", "awaiting_information", "ready_for_review", "completed", "archived"]
ProjectTypeT = Literal["new_construction", "replacement", "addition", "remodel", "other"]
WorkflowStageT = Literal["building", "loads", "equipment", "ducts", "proposal", "done"]


class Camel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
        from_attributes=True,
    )


class CamelIn(Camel):
    """Request bodies reject unknown keys so typos surface as 422 instead of being ignored."""

    model_config = ConfigDict(extra="forbid")


# ---------- users / orgs ----------


class UserOut(Camel):
    id: str
    name: str
    email: str
    created_at: UtcDatetime


class OrganizationOut(Camel):
    id: str
    name: str
    role: RoleT
    created_at: UtcDatetime


class Me(Camel):
    user: UserOut
    organizations: list[OrganizationOut]


class _Password(CamelIn):
    @field_validator("password", check_fields=False)
    @classmethod
    def _pw(cls, v: str) -> str:
        if len(v) < MIN_PASSWORD_LENGTH:
            raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
        return v


class RegisterIn(_Password):
    name: Annotated[Str, Field(min_length=1, max_length=200)]
    email: EmailStr
    password: Annotated[str, Field(max_length=256)]
    organization_name: Annotated[Str, Field(min_length=1, max_length=200)]


class LoginIn(CamelIn):
    email: Annotated[Str, Field(min_length=1, max_length=320)]
    password: Annotated[str, Field(min_length=1, max_length=256)]


class OrganizationCreate(CamelIn):
    name: Annotated[Str, Field(min_length=1, max_length=200)]


class MemberOut(Camel):
    user_id: str
    name: str
    email: str
    role: RoleT
    joined_at: UtcDatetime


class MemberInvite(CamelIn):
    email: EmailStr
    role: RoleT


# ---------- projects ----------


class CustomerOut(Camel):
    id: str
    name: str
    email: str | None
    phone: str | None
    address: str | None


class CustomerIn(CamelIn):
    name: Annotated[Str, Field(min_length=1, max_length=200)]
    email: EmailStr | None = None
    phone: Annotated[Str, Field(max_length=40)] | None = None
    address: Annotated[Str, Field(max_length=400)] | None = None


class AssignedTo(Camel):
    id: str
    name: str


class ProjectOut(Camel):
    id: str
    organization_id: str
    name: str
    address: str | None
    status: ProjectStatusT
    project_type: ProjectTypeT
    workflow_stage: WorkflowStageT
    customer: CustomerOut | None
    assigned_to: AssignedTo | None
    created_at: UtcDatetime
    updated_at: UtcDatetime


class ProjectCreate(CamelIn):
    name: Annotated[Str, Field(min_length=1, max_length=200)]
    address: Annotated[Str, Field(max_length=400)] | None = None
    project_type: ProjectTypeT = "replacement"
    customer: CustomerIn | None = None
    # API extension (not in api.ts): seed the building from the sample-house fixture.
    sample: bool = False


class ProjectUpdate(CamelIn):
    name: Annotated[Str, Field(min_length=1, max_length=200)] | None = None
    address: Annotated[Str, Field(max_length=400)] | None = None
    status: ProjectStatusT | None = None
    project_type: ProjectTypeT | None = None
    workflow_stage: WorkflowStageT | None = None
    assigned_to_user_id: str | None = None


class ProjectList(Camel):
    items: list[ProjectOut]
    total: int


# ---------- building ----------


class BuildingPut(CamelIn):
    revision: Annotated[int, Field(ge=0, le=2**31 - 1)]
    model: dict[str, Any]  # validated separately against the strict BuildingModel mirror


class RestoreIn(CamelIn):
    # Optional optimistic-concurrency guard: the revision the client currently holds.
    revision: Annotated[int, Field(ge=0, le=2**31 - 1)] | None = None


class BuildingRevisionOut(Camel):
    revision: int
    schema_version: int
    note: str | None
    created_at: UtcDatetime
    created_by: AssignedTo | None


class BuildingRevisionDetail(BuildingRevisionOut):
    model: dict[str, Any]


class ComponentCreate(CamelIn):
    kind: Literal["wall", "opening"]
    component: dict[str, Any]


# ---------- drawings ----------


class DrawingOut(Camel):
    id: str
    project_id: str
    document_type: str
    filename: str
    content_type: str
    size: int
    sha256: str
    revision: int
    created_at: UtcDatetime
    file_url: str
