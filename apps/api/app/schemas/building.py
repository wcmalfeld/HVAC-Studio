"""Pydantic mirror of packages/shared-types/src/building.ts (schema version 1).

Keep this file in lock-step with building.ts. Differences from Zod are deliberate and stricter:
  - extra keys are rejected (Zod strips them) so typos never silently drop data;
  - numbers are strict (no "12" strings, no NaN/Infinity), mirroring z.number().finite().
`.nullable().default(null)` fields may be omitted on input and are always emitted on output.
`.optional()` fields (Provenance.confidence/note) are omitted on output when unset, never sent as null.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_serializer
from pydantic.alias_generators import to_camel

SCHEMA_VERSION: Literal[1] = 1

Id = Annotated[str, Field(min_length=1, max_length=64)]
Finite = float
Positive = Annotated[float, Field(gt=0)]
NonNeg = Annotated[float, Field(ge=0)]


class ContractModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
        extra="forbid",
        strict=True,
        allow_inf_nan=False,
    )

    def to_json(self) -> dict[str, Any]:
        return self.model_dump(mode="json", by_alias=True)


class Point(ContractModel):
    x: Finite
    y: Finite


ProvenanceSource = Literal["user", "measured", "imported", "inferred", "default"]


class Provenance(ContractModel):
    source: ProvenanceSource
    # 0..1, expected when source == "inferred" (enforced by the geometry engine's validation, not the schema).
    confidence: Annotated[float, Field(ge=0, le=1)] = None  # type: ignore[assignment]
    note: Annotated[str, Field(max_length=500)] = None  # type: ignore[assignment]

    @model_serializer(mode="wrap")
    def _omit_unset_optionals(self, handler: Any) -> dict[str, Any]:
        data = handler(self)
        return {k: v for k, v in data.items() if not (k in ("confidence", "note") and v is None)}


AdjacentSpace = Literal[
    "outdoors",
    "conditioned",
    "unconditioned",
    "garage",
    "attic",
    "crawlspace",
    "basement_unconditioned",
    "ground",
]


class Assembly(ContractModel):
    construction_type: Annotated[str, Field(max_length=120)] | None = None
    insulation: Annotated[str, Field(max_length=120)] | None = None
    r_value: Positive | None = None
    u_factor: Positive | None = None


class SurfaceAssembly(Assembly):
    adjacent_space: AdjacentSpace | None = None


class Floor(ContractModel):
    id: Id
    name: Annotated[str, Field(min_length=1, max_length=80)]
    elevation: Finite
    floor_to_floor_height: Positive
    default_ceiling_height: Positive
    order: int


class Wall(ContractModel):
    id: Id
    floor_id: Id
    start: Point
    end: Point
    thickness: Positive
    height: Positive
    kind: Literal["exterior", "interior"]
    adjacent_space: AdjacentSpace
    assembly: Assembly
    provenance: Provenance


class WindowProps(ContractModel):
    window_type: Annotated[str, Field(max_length=80)] | None = None
    u_factor: Positive | None = None
    shgc: Annotated[float, Field(ge=0, le=1)] | None = None
    frame_material: Literal["vinyl", "wood", "aluminum", "fiberglass", "composite", "other"] | None = None
    panes: Annotated[int, Field(ge=1, le=4)] | None = None
    shading: Annotated[str, Field(max_length=120)] | None = None


class DoorProps(ContractModel):
    construction: Annotated[str, Field(max_length=120)] | None = None
    u_factor: Positive | None = None


class _OpeningBase(ContractModel):
    id: Id
    wall_id: Id
    offset: NonNeg
    width: Positive
    height: Positive
    sill_height: NonNeg
    provenance: Provenance


class WindowOpening(_OpeningBase):
    type: Literal["window"]
    props: WindowProps


class DoorOpening(_OpeningBase):
    type: Literal["door"]
    props: DoorProps


Opening = Annotated[WindowOpening | DoorOpening, Field(discriminator="type")]

RoomType = Literal[
    "living",
    "family",
    "kitchen",
    "dining",
    "bedroom",
    "bathroom",
    "laundry",
    "office",
    "hallway",
    "closet",
    "utility",
    "mechanical",
    "garage",
    "basement",
    "bonus",
    "other",
]


class Room(ContractModel):
    id: Id
    floor_id: Id
    name: Annotated[str, Field(min_length=1, max_length=80)]
    room_type: RoomType
    boundary: Annotated[list[Point], Field(min_length=3)]
    ceiling_height: Positive | None = None
    conditioned: bool = True
    occupants: Annotated[int, Field(ge=0)] | None = None
    zone_id: Id | None = None
    floor_assembly: SurfaceAssembly
    ceiling_assembly: SurfaceAssembly
    provenance: Provenance


class BuildingModel(ContractModel):
    schema_version: Literal[1]
    north_angle_deg: Annotated[float, Field(ge=0, lt=360)]
    display_units: Literal["imperial", "metric"]
    floors: Annotated[list[Floor], Field(min_length=1)]
    walls: list[Wall]
    openings: list[Opening]
    rooms: list[Room]

    @field_validator("schema_version", mode="before")
    @classmethod
    def _no_bool_version(cls, v: Any) -> Any:
        # Literal[1] would otherwise accept True (True == 1).
        if isinstance(v, bool):
            raise ValueError("schemaVersion must be the integer 1")
        return v


class BuildingDocument(ContractModel):
    project_id: str
    revision: Annotated[int, Field(ge=0)]
    model: BuildingModel
    updated_at: str


def empty_building_model(floor_id: str = "floor-1") -> dict[str, Any]:
    """Equivalent of emptyBuildingModel() in building.ts (already normalized JSON)."""
    return {
        "schemaVersion": SCHEMA_VERSION,
        "northAngleDeg": 0,
        "displayUnits": "imperial",
        "floors": [
            {
                "id": floor_id,
                "name": "First Floor",
                "elevation": 0,
                "floorToFloorHeight": 120,
                "defaultCeilingHeight": 96,
                "order": 0,
            }
        ],
        "walls": [],
        "openings": [],
        "rooms": [],
    }


def structural_errors(model: BuildingModel) -> list[dict[str, Any]]:
    """Integrity checks that would corrupt the document if accepted: duplicate ids and dangling references.

    Geometry-quality checks (overlaps, self-intersection, openings past wall ends…) belong to
    @hvac/building-geometry and are intentionally NOT duplicated here.
    """
    errors: list[dict[str, Any]] = []

    def dupes(items: list[Any], coll: str, seen: dict[str, str]) -> None:
        for i, it in enumerate(items):
            if it.id in seen:
                errors.append(
                    {
                        "loc": [coll, i, "id"],
                        "msg": f"Duplicate id '{it.id}' (already used by {seen[it.id]})",
                        "type": "duplicate_id",
                    }
                )
            else:
                seen[it.id] = coll

    dupes(model.floors, "floors", {})
    dupes(model.rooms, "rooms", {})
    # Walls and openings share one id space: /components/{id} addresses both.
    component_ids: dict[str, str] = {}
    dupes(model.walls, "walls", component_ids)
    dupes(model.openings, "openings", component_ids)

    floor_ids = {f.id for f in model.floors}
    wall_ids = {w.id for w in model.walls}
    for i, w in enumerate(model.walls):
        if w.floor_id not in floor_ids:
            errors.append(
                {"loc": ["walls", i, "floorId"], "msg": f"Unknown floor '{w.floor_id}'", "type": "dangling_ref"}
            )
    for i, r in enumerate(model.rooms):
        if r.floor_id not in floor_ids:
            errors.append(
                {"loc": ["rooms", i, "floorId"], "msg": f"Unknown floor '{r.floor_id}'", "type": "dangling_ref"}
            )
    for i, o in enumerate(model.openings):
        if o.wall_id not in wall_ids:
            errors.append(
                {"loc": ["openings", i, "wallId"], "msg": f"Unknown wall '{o.wall_id}'", "type": "dangling_ref"}
            )
    return errors
