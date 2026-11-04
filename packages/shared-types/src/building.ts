/**
 * HVAC Studio — canonical building model (schema version 1).
 *
 * This is THE contract shared by the web app, the geometry engine and the API.
 * The API mirrors it in Pydantic (apps/api/app/schemas/building.py). Any change
 * here requires a schemaVersion bump and a migration note in docs/architecture.
 *
 * Units (canonical, never screen pixels):
 *   - Length: inches (float64). US contractor dimensions are multiples of 1/16",
 *     which binary floating point represents exactly.
 *   - Angles: degrees.
 *   - Plan coordinates: x to the right, y UP (math convention). Renderers flip y.
 *   - Derived values (area, volume) are NEVER stored in the model; they are
 *     computed by @hvac/building-geometry.
 */
import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

export const Id = z.string().min(1).max(64);

export const Point = z.object({ x: z.number().finite(), y: z.number().finite() });
export type Point = z.infer<typeof Point>;

/** Where a value came from. AI-inferred values must never be treated as user-verified. */
export const Provenance = z.object({
  source: z.enum(["user", "measured", "imported", "inferred", "default"]),
  /** 0..1, required when source === "inferred". */
  confidence: z.number().min(0).max(1).optional(),
  note: z.string().max(500).optional(),
});
export type Provenance = z.infer<typeof Provenance>;

export const AdjacentSpace = z.enum([
  "outdoors",
  "conditioned",
  "unconditioned",
  "garage",
  "attic",
  "crawlspace",
  "basement_unconditioned",
  "ground",
]);
export type AdjacentSpace = z.infer<typeof AdjacentSpace>;

/** Thermal assembly. Either rValue or uFactor may be given; null means "not yet entered" (never silently defaulted). */
export const Assembly = z.object({
  constructionType: z.string().max(120).nullable().default(null),
  insulation: z.string().max(120).nullable().default(null),
  /** h·ft²·°F/Btu */
  rValue: z.number().positive().nullable().default(null),
  /** Btu/(h·ft²·°F) */
  uFactor: z.number().positive().nullable().default(null),
});
export type Assembly = z.infer<typeof Assembly>;

export const Floor = z.object({
  id: Id,
  name: z.string().min(1).max(80),
  /** Finished floor elevation above grade reference, inches. */
  elevation: z.number().finite(),
  /** Floor-to-floor height, inches. */
  floorToFloorHeight: z.number().positive(),
  /** Default ceiling height for rooms on this floor, inches. */
  defaultCeilingHeight: z.number().positive(),
  order: z.number().int(),
});
export type Floor = z.infer<typeof Floor>;

export const Wall = z.object({
  id: Id,
  floorId: Id,
  /** Centerline endpoints, inches. */
  start: Point,
  end: Point,
  thickness: z.number().positive(),
  height: z.number().positive(),
  kind: z.enum(["exterior", "interior"]),
  adjacentSpace: AdjacentSpace,
  assembly: Assembly,
  provenance: Provenance,
});
export type Wall = z.infer<typeof Wall>;

export const WindowProps = z.object({
  windowType: z.string().max(80).nullable().default(null),
  uFactor: z.number().positive().nullable().default(null),
  shgc: z.number().min(0).max(1).nullable().default(null),
  frameMaterial: z.enum(["vinyl", "wood", "aluminum", "fiberglass", "composite", "other"]).nullable().default(null),
  panes: z.number().int().min(1).max(4).nullable().default(null),
  shading: z.string().max(120).nullable().default(null),
});
export type WindowProps = z.infer<typeof WindowProps>;

export const DoorProps = z.object({
  construction: z.string().max(120).nullable().default(null),
  uFactor: z.number().positive().nullable().default(null),
});
export type DoorProps = z.infer<typeof DoorProps>;

const OpeningBase = z.object({
  id: Id,
  wallId: Id,
  /** Distance from wall.start to the opening CENTER, along the wall, inches. */
  offset: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
  /** Bottom of opening above floor, inches. */
  sillHeight: z.number().min(0),
  provenance: Provenance,
});

export const WindowOpening = OpeningBase.extend({ type: z.literal("window"), props: WindowProps });
export const DoorOpening = OpeningBase.extend({ type: z.literal("door"), props: DoorProps });
export const Opening = z.discriminatedUnion("type", [WindowOpening, DoorOpening]);
export type Opening = z.infer<typeof Opening>;
export type WindowOpening = z.infer<typeof WindowOpening>;
export type DoorOpening = z.infer<typeof DoorOpening>;

export const RoomType = z.enum([
  "living", "family", "kitchen", "dining", "bedroom", "bathroom", "laundry",
  "office", "hallway", "closet", "utility", "mechanical", "garage", "basement", "bonus", "other",
]);
export type RoomType = z.infer<typeof RoomType>;

export const Room = z.object({
  id: Id,
  floorId: Id,
  name: z.string().min(1).max(80),
  roomType: RoomType,
  /** Simple polygon, inches. Winding is normalized by the geometry engine. */
  boundary: z.array(Point).min(3),
  /** Inches. null => use floor.defaultCeilingHeight. */
  ceilingHeight: z.number().positive().nullable().default(null),
  conditioned: z.boolean().default(true),
  occupants: z.number().int().min(0).nullable().default(null),
  zoneId: Id.nullable().default(null),
  floorAssembly: Assembly.extend({ adjacentSpace: AdjacentSpace.nullable().default(null) }),
  ceilingAssembly: Assembly.extend({ adjacentSpace: AdjacentSpace.nullable().default(null) }),
  provenance: Provenance,
});
export type Room = z.infer<typeof Room>;

export const BuildingModel = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  /** Clockwise degrees from plan +y ("up") to true north. 0 => up is north. */
  northAngleDeg: z.number().min(0).lt(360),
  displayUnits: z.enum(["imperial", "metric"]),
  floors: z.array(Floor).min(1),
  walls: z.array(Wall),
  openings: z.array(Opening),
  rooms: z.array(Room),
});
export type BuildingModel = z.infer<typeof BuildingModel>;

/** Envelope returned by GET/PUT /api/v1/projects/{id}/building. */
export const BuildingDocument = z.object({
  projectId: z.string(),
  /** Monotonic revision. PUT must send the revision it edited (optimistic concurrency → 409 on conflict). */
  revision: z.number().int().min(0),
  model: BuildingModel,
  updatedAt: z.string(),
});
export type BuildingDocument = z.infer<typeof BuildingDocument>;

export function emptyBuildingModel(floorId = "floor-1"): BuildingModel {
  return {
    schemaVersion: SCHEMA_VERSION,
    northAngleDeg: 0,
    displayUnits: "imperial",
    floors: [{ id: floorId, name: "First Floor", elevation: 0, floorToFloorHeight: 120, defaultCeilingHeight: 96, order: 0 }],
    walls: [],
    openings: [],
    rooms: [],
  };
}
