/**
 * Room / floor / building metrics.
 *
 * ROOM ↔ WALL ASSOCIATION RULES
 * A wall is associated with a room edge (room boundary normalized CCW) when ALL hold:
 *   1. Parallel: angle between the wall centerline and the edge < 0.5°.
 *   2. Close: perpendicular distance from the wall centerline (its midpoint) to the edge's line
 *      ≤ wall.thickness / 2 + 1". So a room boundary may be drawn on the wall centerline or on either face.
 *   3. Overlapping: the wall's projection onto the edge overlaps the edge by > 1".
 * The exposure length is that overlap length.
 * A wall is EXPOSED (counts toward envelope) when wall.kind === "exterior" OR wall.adjacentSpace !== "conditioned".
 * Openings in an exposed wall count toward the room only for the part of their width inside the overlap.
 * Gross exposed wall area = overlap × min(room ceiling height, wall.height).
 * Room ceiling height = room.ceilingHeight ?? floor.defaultCeilingHeight.
 * Exposure azimuth = compass azimuth of the edge's OUTWARD normal (away from the room interior; for a CCW
 * boundary that is the right-hand normal), using model.northAngleDeg (see compassAzimuth).
 * Multiple matches of the same wall in the same direction for one room are merged into one exposure.
 */
import type { AdjacentSpace, BuildingModel, Floor, Opening, Point, Room, Wall } from "@hvac/shared-types";
import { boundingBox, normalizeCCW, polygonArea, polygonPerimeter, type BBox } from "./polygon";
import { cross, dot, length, sub } from "./vec";
import { compassAzimuth, compassLabel, openingSpan, wallLength, type CompassLabel } from "./wall";
import { sqInToSqFt, cuInToCuFt, INCHES_PER_FOOT } from "./units";

export const PARALLEL_TOLERANCE_DEG = 0.5;
export const ASSOCIATION_EXTRA_DISTANCE_IN = 1;
export const MIN_OVERLAP_IN = 1;
const SIN_PARALLEL = Math.sin((PARALLEL_TOLERANCE_DEG * Math.PI) / 180);

export interface RoomExposure {
  wallId: string;
  direction: CompassLabel;
  azimuthDeg: number;
  lengthFt: number;
  grossAreaSqFt: number;
  windowAreaSqFt: number;
  doorAreaSqFt: number;
  adjacentSpace: AdjacentSpace;
}

export interface RoomMetrics {
  roomId: string;
  areaSqFt: number;
  perimeterFt: number;
  ceilingHeightIn: number;
  volumeCuFt: number;
  /** Longer side of the axis-aligned bounding box, ft. */
  boundingLengthFt: number;
  /** Shorter side of the axis-aligned bounding box, ft. */
  boundingWidthFt: number;
  exteriorWallLengthFt: number;
  grossExteriorWallAreaSqFt: number;
  windowAreaSqFt: number;
  doorAreaSqFt: number;
  netExteriorWallAreaSqFt: number;
  exposures: RoomExposure[];
}

export interface FloorSummary {
  floorId: string;
  roomCount: number;
  conditionedAreaSqFt: number;
  conditionedVolumeCuFt: number;
  exteriorWallLengthFt: number;
  windowAreaSqFt: number;
  doorAreaSqFt: number;
  /** windowAreaSqFt / conditionedAreaSqFt (0 when no conditioned area). */
  windowToFloorRatio: number;
}

export const isExposedWall = (w: Wall): boolean => w.kind === "exterior" || w.adjacentSpace !== "conditioned";

export const roomCeilingHeight = (room: Room, floor: Floor | undefined): number =>
  room.ceilingHeight ?? floor?.defaultCeilingHeight ?? 0;

/** One wall matched against one room edge (all lengths inches, edge parameters measured from edge start). */
export interface EdgeWallMatch {
  wall: Wall;
  edgeIndex: number;
  edgeStart: Point;
  edgeEnd: Point;
  /** Overlap interval along the edge, inches from edgeStart. */
  overlapStart: number;
  overlapEnd: number;
  overlapLength: number;
  /** Outward unit normal of the edge. */
  outwardNormal: Point;
}

/** Match a single wall against edge a→b of a CCW boundary; null when the association rules fail. */
export function matchWallToEdge(wall: Wall, a: Point, b: Point): Omit<EdgeWallMatch, "edgeIndex" | "wall"> | null {
  const e = sub(b, a);
  const L = length(e);
  const wl = wallLength(wall);
  if (L < 1e-9 || wl < 1e-9) return null;
  const u = { x: e.x / L, y: e.y / L };
  const wv = sub(wall.end, wall.start);
  if (Math.abs(cross(u, wv)) / wl >= SIN_PARALLEL) return null;
  const mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
  if (Math.abs(cross(u, sub(mid, a))) > wall.thickness / 2 + ASSOCIATION_EXTRA_DISTANCE_IN) return null;
  const s0 = dot(sub(wall.start, a), u);
  const s1 = dot(sub(wall.end, a), u);
  const lo = Math.max(0, Math.min(s0, s1));
  const hi = Math.min(L, Math.max(s0, s1));
  if (hi - lo <= MIN_OVERLAP_IN) return null;
  return { edgeStart: a, edgeEnd: b, overlapStart: lo, overlapEnd: hi, overlapLength: hi - lo, outwardNormal: { x: u.y, y: -u.x } };
}

// ---- per-model index (cached; models are treated as immutable values) ----
interface ModelIndex {
  floors: Map<string, Floor>;
  rooms: Map<string, Room>;
  wallsByFloor: Map<string, { wall: Wall; bbox: BBox }[]>;
  openingsByWall: Map<string, Opening[]>;
}
const indexCache = new WeakMap<BuildingModel, ModelIndex>();
export function modelIndex(model: BuildingModel): ModelIndex {
  let idx = indexCache.get(model);
  if (idx) return idx;
  idx = { floors: new Map(), rooms: new Map(), wallsByFloor: new Map(), openingsByWall: new Map() };
  for (const f of model.floors) if (!idx.floors.has(f.id)) idx.floors.set(f.id, f);
  for (const r of model.rooms) if (!idx.rooms.has(r.id)) idx.rooms.set(r.id, r);
  for (const w of model.walls) {
    const list = idx.wallsByFloor.get(w.floorId) ?? [];
    const pad = w.thickness / 2 + ASSOCIATION_EXTRA_DISTANCE_IN;
    const bb = boundingBox([w.start, w.end]);
    list.push({ wall: w, bbox: { minX: bb.minX - pad, minY: bb.minY - pad, maxX: bb.maxX + pad, maxY: bb.maxY + pad, width: bb.width + 2 * pad, height: bb.height + 2 * pad } });
    idx.wallsByFloor.set(w.floorId, list);
  }
  for (const o of model.openings) {
    const list = idx.openingsByWall.get(o.wallId) ?? [];
    list.push(o);
    idx.openingsByWall.set(o.wallId, list);
  }
  indexCache.set(model, idx);
  return idx;
}

/** All wall/edge associations for a room (exposed and non-exposed walls). */
export function roomWallMatches(model: BuildingModel, room: Room): EdgeWallMatch[] {
  const idx = modelIndex(model);
  const pts = normalizeCCW(room.boundary);
  const rb = boundingBox(pts);
  const candidates = (idx.wallsByFloor.get(room.floorId) ?? []).filter(
    ({ bbox }) => bbox.minX <= rb.maxX && rb.minX <= bbox.maxX && bbox.minY <= rb.maxY && rb.minY <= bbox.maxY,
  );
  const out: EdgeWallMatch[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    for (const { wall } of candidates) {
      const m = matchWallToEdge(wall, a, b);
      if (m) out.push({ ...m, wall, edgeIndex: i });
    }
  }
  return out;
}

function emptyMetrics(roomId: string): RoomMetrics {
  return {
    roomId, areaSqFt: 0, perimeterFt: 0, ceilingHeightIn: 0, volumeCuFt: 0, boundingLengthFt: 0, boundingWidthFt: 0,
    exteriorWallLengthFt: 0, grossExteriorWallAreaSqFt: 0, windowAreaSqFt: 0, doorAreaSqFt: 0, netExteriorWallAreaSqFt: 0, exposures: [],
  };
}

/** Metrics for one room. Throws if roomId is unknown. */
export function computeRoomMetrics(model: BuildingModel, roomId: string): RoomMetrics {
  const idx = modelIndex(model);
  const room = idx.rooms.get(roomId);
  if (!room) throw new Error(`Unknown room: ${roomId}`);
  if (room.boundary.length < 3) return emptyMetrics(roomId);
  const floor = idx.floors.get(room.floorId);
  const ceil = roomCeilingHeight(room, floor);
  const areaSqIn = polygonArea(room.boundary);
  const bb = boundingBox(room.boundary);

  const byKey = new Map<string, RoomExposure>();
  for (const m of roomWallMatches(model, room)) {
    if (!isExposedWall(m.wall)) continue;
    const h = Math.min(ceil, m.wall.height);
    const u = { x: (m.edgeEnd.x - m.edgeStart.x), y: (m.edgeEnd.y - m.edgeStart.y) };
    const ul = length(u);
    u.x /= ul; u.y /= ul;
    let windowSqIn = 0;
    let doorSqIn = 0;
    for (const o of idx.openingsByWall.get(m.wall.id) ?? []) {
      const span = openingSpan(o, m.wall);
      const p0 = dot(sub(span.start, m.edgeStart), u);
      const p1 = dot(sub(span.end, m.edgeStart), u);
      const w = Math.min(m.overlapEnd, Math.max(p0, p1)) - Math.max(m.overlapStart, Math.min(p0, p1));
      if (w <= 0) continue;
      const a = w * o.height;
      if (o.type === "window") windowSqIn += a; else doorSqIn += a;
    }
    const azimuthDeg = compassAzimuth(m.outwardNormal, model.northAngleDeg);
    const key = `${m.wall.id}|${azimuthDeg.toFixed(3)}`;
    const prev = byKey.get(key);
    const add = {
      lengthFt: m.overlapLength / INCHES_PER_FOOT,
      grossAreaSqFt: sqInToSqFt(m.overlapLength * h),
      windowAreaSqFt: sqInToSqFt(windowSqIn),
      doorAreaSqFt: sqInToSqFt(doorSqIn),
    };
    if (prev) {
      prev.lengthFt += add.lengthFt;
      prev.grossAreaSqFt += add.grossAreaSqFt;
      prev.windowAreaSqFt += add.windowAreaSqFt;
      prev.doorAreaSqFt += add.doorAreaSqFt;
    } else {
      byKey.set(key, { wallId: m.wall.id, direction: compassLabel(azimuthDeg), azimuthDeg, adjacentSpace: m.wall.adjacentSpace, ...add });
    }
  }
  const exposures = [...byKey.values()];
  const sum = (f: (e: RoomExposure) => number) => exposures.reduce((s, e) => s + f(e), 0);
  const gross = sum((e) => e.grossAreaSqFt);
  const win = sum((e) => e.windowAreaSqFt);
  const door = sum((e) => e.doorAreaSqFt);
  return {
    roomId,
    areaSqFt: sqInToSqFt(areaSqIn),
    perimeterFt: polygonPerimeter(room.boundary) / INCHES_PER_FOOT,
    ceilingHeightIn: ceil,
    volumeCuFt: cuInToCuFt(areaSqIn * ceil),
    boundingLengthFt: Math.max(bb.width, bb.height) / INCHES_PER_FOOT,
    boundingWidthFt: Math.min(bb.width, bb.height) / INCHES_PER_FOOT,
    exteriorWallLengthFt: sum((e) => e.lengthFt),
    grossExteriorWallAreaSqFt: gross,
    windowAreaSqFt: win,
    doorAreaSqFt: door,
    netExteriorWallAreaSqFt: Math.max(0, gross - win - door),
    exposures,
  };
}

/**
 * Floor totals. roomCount counts all rooms on the floor; every other figure counts CONDITIONED rooms only
 * (envelope of the conditioned space), summing their room exposures.
 */
export function computeFloorSummary(model: BuildingModel, floorId: string): FloorSummary {
  const s: FloorSummary = { floorId, roomCount: 0, conditionedAreaSqFt: 0, conditionedVolumeCuFt: 0, exteriorWallLengthFt: 0, windowAreaSqFt: 0, doorAreaSqFt: 0, windowToFloorRatio: 0 };
  for (const r of model.rooms) {
    if (r.floorId !== floorId) continue;
    s.roomCount++;
    if (r.conditioned === false) continue;
    const m = computeRoomMetrics(model, r.id);
    s.conditionedAreaSqFt += m.areaSqFt;
    s.conditionedVolumeCuFt += m.volumeCuFt;
    s.exteriorWallLengthFt += m.exteriorWallLengthFt;
    s.windowAreaSqFt += m.windowAreaSqFt;
    s.doorAreaSqFt += m.doorAreaSqFt;
  }
  s.windowToFloorRatio = s.conditionedAreaSqFt > 0 ? s.windowAreaSqFt / s.conditionedAreaSqFt : 0;
  return s;
}

/** Whole-building totals (floorId = "building"). */
export function computeBuildingSummary(model: BuildingModel): FloorSummary & { floorCount: number } {
  const t: FloorSummary & { floorCount: number } = { floorId: "building", floorCount: model.floors.length, roomCount: 0, conditionedAreaSqFt: 0, conditionedVolumeCuFt: 0, exteriorWallLengthFt: 0, windowAreaSqFt: 0, doorAreaSqFt: 0, windowToFloorRatio: 0 };
  for (const f of model.floors) {
    const s = computeFloorSummary(model, f.id);
    t.roomCount += s.roomCount;
    t.conditionedAreaSqFt += s.conditionedAreaSqFt;
    t.conditionedVolumeCuFt += s.conditionedVolumeCuFt;
    t.exteriorWallLengthFt += s.exteriorWallLengthFt;
    t.windowAreaSqFt += s.windowAreaSqFt;
    t.doorAreaSqFt += s.doorAreaSqFt;
  }
  t.windowToFloorRatio = t.conditionedAreaSqFt > 0 ? t.windowAreaSqFt / t.conditionedAreaSqFt : 0;
  return t;
}
