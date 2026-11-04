/**
 * Pure building-model operations used by the editor store. Every function mutates an immer
 * draft (or a plain object) of the BuildingModel. All coordinates are inches, plan y-up.
 * No React, no DOM — unit tested in model-ops.test.ts.
 */
import type { BuildingModel, Floor, Opening, Point, Room, Wall } from "@hvac/shared-types";
import { current, isDraft } from "immer";
import {
  autoWallsForRoom,
  boundingBox,
  dist,
  newId,
  pointsEqual,
  projectPointOnSegment,
  rotatePoint,
  wallLength,
} from "@hvac/building-geometry";

export type EntityKind = "wall" | "opening" | "room";
export const JOIN_TOLERANCE_IN = 0.5;

export function emptyAssembly() {
  return { constructionType: null, insulation: null, rValue: null, uFactor: null };
}

export function entityKind(model: BuildingModel, id: string): EntityKind | null {
  if (model.walls.some((w) => w.id === id)) return "wall";
  if (model.openings.some((o) => o.id === id)) return "opening";
  if (model.rooms.some((r) => r.id === id)) return "room";
  return null;
}

export function existingIds(model: BuildingModel): Set<string> {
  const s = new Set<string>();
  for (const w of model.walls) s.add(w.id);
  for (const o of model.openings) s.add(o.id);
  for (const r of model.rooms) s.add(r.id);
  return s;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function makeWall(floorId: string, start: Point, end: Point, opts: Partial<Pick<Wall, "thickness" | "height" | "kind">> = {}): Wall {
  const kind = opts.kind ?? "exterior";
  return {
    id: newId("wall"),
    floorId,
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y },
    thickness: opts.thickness ?? (kind === "exterior" ? 6 : 4.5),
    height: opts.height ?? 96,
    kind,
    adjacentSpace: kind === "exterior" ? "outdoors" : "conditioned",
    assembly: emptyAssembly(),
    // Geometry is drawn by the user, but thickness is a tool default (and height too unless supplied),
    // so the element is marked "default" until the user confirms its dimensions in the panel.
    provenance:
      opts.thickness !== undefined && opts.height !== undefined
        ? { source: "user" }
        : { source: "default", note: "Thickness/height from tool defaults — verify" },
  };
}

/** Mark a tool-defaulted element as user-entered once the user edits its dimensions. */
export function confirmDimensions(el: { provenance: { source: string; note?: string } }) {
  if (el.provenance.source === "default") el.provenance = { source: "user" };
}

export function makeRoom(floorId: string, boundary: Point[], name: string): Room {
  return {
    id: newId("room"),
    floorId,
    name,
    roomType: "other",
    boundary: boundary.map((p) => ({ x: p.x, y: p.y })),
    ceilingHeight: null,
    conditioned: true,
    occupants: null,
    zoneId: null,
    floorAssembly: { ...emptyAssembly(), adjacentSpace: null },
    ceilingAssembly: { ...emptyAssembly(), adjacentSpace: null },
    provenance: { source: "user" },
  };
}

export const OPENING_DEFAULTS = {
  window: { width: 36, height: 48, sillHeight: 36 },
  door: { width: 36, height: 80, sillHeight: 0 },
} as const;

/** New opening with the documented size defaults; all engineering props null (never defaulted). */
export function makeOpening(type: "window" | "door", wallId: string, offset: number): Opening {
  const d = OPENING_DEFAULTS[type];
  const base = { id: newId(type === "window" ? "win" : "door"), wallId, offset, width: d.width, height: d.height, sillHeight: d.sillHeight, provenance: { source: "default" as const, note: "Size from tool defaults — verify" } };
  if (type === "window") {
    return { ...base, type: "window", props: { windowType: null, uFactor: null, shgc: null, frameMaterial: null, panes: null, shading: null } };
  }
  return { ...base, type: "door", props: { construction: null, uFactor: null } };
}

export function nextRoomName(model: BuildingModel): string {
  let n = model.rooms.length + 1;
  const names = new Set(model.rooms.map((r) => r.name));
  while (names.has(`Room ${n}`)) n++;
  return `Room ${n}`;
}

/** Clamp an opening center offset so the opening stays on its wall. */
export function clampOpeningOffset(offset: number, width: number, wallLen: number): number {
  if (wallLen <= width) return wallLen / 2;
  return Math.min(wallLen - width / 2, Math.max(width / 2, offset));
}

/** True when segment (a,b) lies on an existing wall's centerline (collinear and contained). */
export function segmentCoveredByWall(a: Point, b: Point, walls: Wall[], tol = JOIN_TOLERANCE_IN): boolean {
  for (const w of walls) {
    const pa = projectPointOnSegment(a, w.start, w.end);
    const pb = projectPointOnSegment(b, w.start, w.end);
    if (pa.distance <= tol && pb.distance <= tol) return true;
  }
  return false;
}

/**
 * Adds a room (and, unless skipWalls, exterior walls along its edges that are not already
 * covered by existing walls on the floor). Returns the created ids.
 */
export function addRoomWithWalls(
  draft: BuildingModel,
  floorId: string,
  boundary: Point[],
  opts: { skipWalls?: boolean; wallHeight?: number; thickness?: number; name?: string } = {},
): string[] {
  const room = makeRoom(floorId, boundary, opts.name ?? nextRoomName(draft));
  draft.rooms.push(room);
  const ids = [room.id];
  if (!opts.skipWalls) {
    const floorWalls = draft.walls.filter((w) => w.floorId === floorId);
    const walls = autoWallsForRoom(boundary, floorId, {
      thickness: opts.thickness ?? 6,
      height: opts.wallHeight ?? 96,
      kind: "exterior",
    });
    for (const w of walls) {
      if (segmentCoveredByWall(w.start, w.end, floorWalls)) continue;
      draft.walls.push(w);
      ids.push(w.id);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/** Delete entities by id. Deleting a wall deletes its openings. Returns deleted ids. */
export function deleteEntities(draft: BuildingModel, ids: Iterable<string>): string[] {
  const del = new Set(ids);
  const wallIds = new Set(draft.walls.filter((w) => del.has(w.id)).map((w) => w.id));
  const removed: string[] = [];
  draft.walls = draft.walls.filter((w) => {
    if (wallIds.has(w.id)) {
      removed.push(w.id);
      return false;
    }
    return true;
  });
  draft.openings = draft.openings.filter((o) => {
    if (del.has(o.id) || wallIds.has(o.wallId)) {
      removed.push(o.id);
      return false;
    }
    return true;
  });
  draft.rooms = draft.rooms.filter((r) => {
    if (del.has(r.id)) {
      removed.push(r.id);
      return false;
    }
    return true;
  });
  return removed;
}

export function deleteFloor(draft: BuildingModel, floorId: string) {
  if (draft.floors.length <= 1) return;
  const wallIds = draft.walls.filter((w) => w.floorId === floorId).map((w) => w.id);
  const roomIds = draft.rooms.filter((r) => r.floorId === floorId).map((r) => r.id);
  deleteEntities(draft, [...wallIds, ...roomIds]);
  draft.floors = draft.floors.filter((f) => f.id !== floorId);
  normalizeFloorOrder(draft);
}

export function normalizeFloorOrder(draft: BuildingModel) {
  const sorted = [...draft.floors].sort((a, b) => a.order - b.order);
  sorted.forEach((f, i) => {
    const target = draft.floors.find((x) => x.id === f.id)!;
    target.order = i;
  });
}

export function addFloor(draft: BuildingModel): Floor {
  const sorted = [...draft.floors].sort((a, b) => a.order - b.order);
  const top = sorted[sorted.length - 1];
  const n = draft.floors.length + 1;
  const names = ["First Floor", "Second Floor", "Third Floor", "Fourth Floor"];
  const floor: Floor = {
    id: newId("floor"),
    name: names[n - 1] ?? `Floor ${n}`,
    elevation: top ? top.elevation + top.floorToFloorHeight : 0,
    floorToFloorHeight: top?.floorToFloorHeight ?? 120,
    defaultCeilingHeight: top?.defaultCeilingHeight ?? 96,
    order: (top?.order ?? -1) + 1,
  };
  draft.floors.push(floor);
  return floor;
}

export function moveFloor(draft: BuildingModel, floorId: string, dir: -1 | 1) {
  const sorted = [...draft.floors].sort((a, b) => a.order - b.order);
  const i = sorted.findIndex((f) => f.id === floorId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return;
  const a = draft.floors.find((f) => f.id === sorted[i]!.id)!;
  const b = draft.floors.find((f) => f.id === sorted[j]!.id)!;
  const t = a.order;
  a.order = b.order;
  b.order = t;
}

// ---------------------------------------------------------------------------
// Copy / paste
// ---------------------------------------------------------------------------

export interface Clipboard {
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
}

/** Snapshot the selection. Openings come along when their wall is copied. */
export function copyEntities(model: BuildingModel, ids: Iterable<string>): Clipboard {
  const sel = new Set(ids);
  const walls = model.walls.filter((w) => sel.has(w.id));
  const wallIds = new Set(walls.map((w) => w.id));
  const openings = model.openings.filter((o) => wallIds.has(o.wallId));
  const rooms = model.rooms.filter((r) => sel.has(r.id));
  return structuredClone({ walls, openings, rooms });
}

/**
 * Paste clipboard onto a floor, offset by `delta` inches. Every entity gets a fresh id and
 * opening.wallId is remapped to the new wall ids. Returns new ids (walls, openings, rooms).
 */
export function pasteEntities(draft: BuildingModel, clip: Clipboard, floorId: string, delta: Point): string[] {
  const wallMap = new Map<string, string>();
  const out: string[] = [];
  const mv = (p: Point) => ({ x: p.x + delta.x, y: p.y + delta.y });
  for (const w of clip.walls) {
    const id = newId("wall");
    wallMap.set(w.id, id);
    draft.walls.push({ ...structuredClone(w), id, floorId, start: mv(w.start), end: mv(w.end) });
    out.push(id);
  }
  for (const o of clip.openings) {
    const wallId = wallMap.get(o.wallId);
    if (!wallId) continue; // never paste an opening that would reference the original wall
    const id = newId(o.type === "window" ? "win" : "door");
    draft.openings.push({ ...structuredClone(o), id, wallId });
    out.push(id);
  }
  for (const r of clip.rooms) {
    const id = newId("room");
    draft.rooms.push({ ...structuredClone(r), id, floorId, zoneId: null, boundary: r.boundary.map(mv) });
    out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

/** Points of the selection (for bbox/rotation center). */
export function selectionPoints(model: BuildingModel, ids: Set<string>): Point[] {
  const pts: Point[] = [];
  for (const w of model.walls) if (ids.has(w.id)) pts.push(w.start, w.end);
  for (const r of model.rooms) if (ids.has(r.id)) pts.push(...r.boundary);
  for (const o of model.openings) {
    if (!ids.has(o.id)) continue;
    const w = model.walls.find((x) => x.id === o.wallId);
    if (w) pts.push(openingCenter(o, w));
  }
  return pts;
}

export function openingCenter(o: Opening, w: Wall): Point {
  const len = wallLength(w) || 1;
  const t = o.offset / len;
  return { x: w.start.x + (w.end.x - w.start.x) * t, y: w.start.y + (w.end.y - w.start.y) * t };
}

/**
 * Move walls/rooms in `ids` by delta, computed from `base` (so drags don't accumulate error).
 * Unselected walls whose endpoints coincide with a moved endpoint stretch to follow.
 */
export function moveEntities(draft: BuildingModel, base: BuildingModel, ids: Set<string>, delta: Point) {
  const moved: Point[] = [];
  const mv = (p: Point) => ({ x: p.x + delta.x, y: p.y + delta.y });
  for (const bw of base.walls) {
    if (!ids.has(bw.id)) continue;
    const w = draft.walls.find((x) => x.id === bw.id);
    if (!w) continue;
    w.start = mv(bw.start);
    w.end = mv(bw.end);
    moved.push(bw.start, bw.end);
  }
  for (const br of base.rooms) {
    if (!ids.has(br.id)) continue;
    const r = draft.rooms.find((x) => x.id === br.id);
    if (r) r.boundary = br.boundary.map(mv);
  }
  if (moved.length) {
    for (const bw of base.walls) {
      if (ids.has(bw.id)) continue;
      const w = draft.walls.find((x) => x.id === bw.id);
      if (!w) continue;
      if (moved.some((p) => pointsEqual(p, bw.start, JOIN_TOLERANCE_IN))) w.start = mv(bw.start);
      if (moved.some((p) => pointsEqual(p, bw.end, JOIN_TOLERANCE_IN))) w.end = mv(bw.end);
    }
  }
}

/**
 * Move one wall endpoint to `to`. Every other wall endpoint and room vertex on the same floor that
 * coincided with the original endpoint follows (keeps corners joined).
 */
export function moveWallEndpoint(draft: BuildingModel, base: BuildingModel, wallId: string, which: "start" | "end", to: Point) {
  const bw = base.walls.find((w) => w.id === wallId);
  if (!bw) return;
  const from = bw[which];
  for (const b of base.walls) {
    if (b.floorId !== bw.floorId) continue;
    const w = draft.walls.find((x) => x.id === b.id);
    if (!w) continue;
    if (b.id === wallId) {
      w[which] = { x: to.x, y: to.y };
      continue;
    }
    if (pointsEqual(b.start, from, JOIN_TOLERANCE_IN)) w.start = { x: to.x, y: to.y };
    if (pointsEqual(b.end, from, JOIN_TOLERANCE_IN)) w.end = { x: to.x, y: to.y };
  }
  for (const br of base.rooms) {
    if (br.floorId !== bw.floorId) continue;
    if (!br.boundary.some((p) => pointsEqual(p, from, JOIN_TOLERANCE_IN))) continue;
    const r = draft.rooms.find((x) => x.id === br.id)!;
    r.boundary = br.boundary.map((p) => (pointsEqual(p, from, JOIN_TOLERANCE_IN) ? { x: to.x, y: to.y } : p));
  }
}

/** Set a wall's length by moving its end point along its direction (joined walls follow). */
export function setWallLength(draft: BuildingModel, wallId: string, newLength: number) {
  const base = structuredClone(isDraft(draft) ? current(draft) : draft) as BuildingModel;
  const w = base.walls.find((x) => x.id === wallId);
  if (!w || !(newLength > 0)) return;
  const len = wallLength(w);
  const dir = len > 0 ? { x: (w.end.x - w.start.x) / len, y: (w.end.y - w.start.y) / len } : { x: 1, y: 0 };
  const to = { x: w.start.x + dir.x * newLength, y: w.start.y + dir.y * newLength };
  moveWallEndpoint(draft, base, wallId, "end", to);
  // Keep openings on the shortened wall.
  for (const o of draft.openings) {
    if (o.wallId === wallId) o.offset = clampOpeningOffset(o.offset, o.width, newLength);
  }
}

/** Rotate the selection 90° (counter-clockwise in plan) about its bounding-box center. */
export function rotateEntities(draft: BuildingModel, ids: Set<string>, deg = 90) {
  const pts = selectionPoints(draft, ids);
  if (!pts.length) return;
  const bb = boundingBox(pts);
  const c = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
  const rot = (p: Point) => {
    const q = rotatePoint(p, c, deg);
    // round to 1/1024" to avoid accumulating float noise on repeated rotations
    return { x: Math.round(q.x * 1024) / 1024 + 0, y: Math.round(q.y * 1024) / 1024 + 0 };
  };
  for (const w of draft.walls) {
    if (!ids.has(w.id)) continue;
    w.start = rot(w.start);
    w.end = rot(w.end);
  }
  for (const r of draft.rooms) if (ids.has(r.id)) r.boundary = r.boundary.map(rot);
}

/** Slide an opening along its wall so its center is nearest `p`. */
export function slideOpening(draft: BuildingModel, openingId: string, p: Point) {
  const o = draft.openings.find((x) => x.id === openingId);
  if (!o) return;
  const w = draft.walls.find((x) => x.id === o.wallId);
  if (!w) return;
  const proj = projectPointOnSegment(p, w.start, w.end);
  const len = wallLength(w);
  o.offset = clampOpeningOffset(proj.t * len, o.width, len);
}

/** Bounding box of everything on a floor (for zoom-to-fit). */
export function floorPoints(model: BuildingModel, floorId: string): Point[] {
  const pts: Point[] = [];
  for (const w of model.walls) if (w.floorId === floorId) pts.push(w.start, w.end);
  for (const r of model.rooms) if (r.floorId === floorId) pts.push(...r.boundary);
  return pts;
}

export function hasDistance(a: Point, b: Point, min = 0.01) {
  return dist(a, b) >= min;
}
