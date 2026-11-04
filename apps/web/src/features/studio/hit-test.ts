/** Geometric hit testing in plan inches. Shapes on the canvas are listening=false; this is the only picker. */
import type { BuildingModel, Point, Wall } from "@hvac/shared-types";
import { boundingBox, dist, pointInPolygon, polygonArea, projectPointOnSegment, wallLength } from "@hvac/building-geometry";
import { openingCenter } from "./model-ops";

export type Hit =
  | { kind: "handle"; wallId: string; which: "start" | "end"; point: Point }
  | { kind: "opening"; id: string }
  | { kind: "wall"; id: string }
  | { kind: "room"; id: string };

/**
 * @param tol tolerance in inches (already converted from screen px by the caller)
 */
export function hitTest(model: BuildingModel, floorId: string, p: Point, tol: number, selection: Set<string>, layers: { walls: boolean; openings: boolean; rooms: boolean }): Hit | null {
  // 1. endpoint handles of selected walls
  if (layers.walls) {
    for (const w of model.walls) {
      if (w.floorId !== floorId || !selection.has(w.id)) continue;
      if (dist(p, w.start) <= tol * 1.4) return { kind: "handle", wallId: w.id, which: "start", point: w.start };
      if (dist(p, w.end) <= tol * 1.4) return { kind: "handle", wallId: w.id, which: "end", point: w.end };
    }
  }
  const wallsById = new Map<string, Wall>();
  for (const w of model.walls) if (w.floorId === floorId) wallsById.set(w.id, w);
  // 2. openings
  if (layers.openings) {
    let best: { id: string; d: number } | null = null;
    for (const o of model.openings) {
      const w = wallsById.get(o.wallId);
      if (!w) continue;
      const c = openingCenter(o, w);
      const pr = projectPointOnSegment(p, w.start, w.end);
      const along = Math.abs(pr.t * wallLength(w) - o.offset);
      if (along <= o.width / 2 + tol * 0.25 && pr.distance <= w.thickness / 2 + tol) {
        const d = dist(p, c);
        if (!best || d < best.d) best = { id: o.id, d };
      }
    }
    if (best) return { kind: "opening", id: best.id };
  }
  // 3. walls
  if (layers.walls) {
    let best: { id: string; d: number } | null = null;
    for (const w of wallsById.values()) {
      const pr = projectPointOnSegment(p, w.start, w.end);
      if (pr.distance <= w.thickness / 2 + tol && (!best || pr.distance < best.d)) best = { id: w.id, d: pr.distance };
    }
    if (best) return { kind: "wall", id: best.id };
  }
  // 4. rooms (smallest containing room wins, so nested rooms are pickable)
  if (layers.rooms) {
    let best: { id: string; a: number } | null = null;
    for (const r of model.rooms) {
      if (r.floorId !== floorId) continue;
      if (pointInPolygon(p, r.boundary)) {
        const a = polygonArea(r.boundary);
        if (!best || a < best.a) best = { id: r.id, a };
      }
    }
    if (best) return { kind: "room", id: best.id };
  }
  return null;
}

/** Ids inside (contain=true) or touching (contain=false) a world-space rectangle. */
export function entitiesInRect(model: BuildingModel, floorId: string, a: Point, b: Point, contain: boolean, layers: { walls: boolean; openings: boolean; rooms: boolean }): string[] {
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
  const inside = (p: Point) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
  const overlaps = (pts: Point[]) => {
    const bb = boundingBox(pts);
    return bb.maxX >= minX && bb.minX <= maxX && bb.maxY >= minY && bb.minY <= maxY;
  };
  const ids: string[] = [];
  const walls = new Map<string, Wall>();
  if (layers.walls) {
    for (const w of model.walls) {
      if (w.floorId !== floorId) continue;
      walls.set(w.id, w);
      const pts = [w.start, w.end];
      if (contain ? pts.every(inside) : overlaps(pts)) ids.push(w.id);
    }
  }
  if (layers.openings) {
    for (const o of model.openings) {
      const w = walls.get(o.wallId);
      if (w && inside(openingCenter(o, w))) ids.push(o.id);
    }
  }
  if (layers.rooms) {
    for (const r of model.rooms) {
      if (r.floorId !== floorId) continue;
      if (contain ? r.boundary.every(inside) : overlaps(r.boundary)) ids.push(r.id);
    }
  }
  return ids;
}
