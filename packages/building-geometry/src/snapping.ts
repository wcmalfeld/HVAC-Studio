import type { BuildingModel, Point, Wall } from "@hvac/shared-types";
import { dist, pointsEqual, projectPointOnSegment } from "./vec";
import { wallLength } from "./wall";

/** Round to the nearest multiple of gridInches (no-op for gridInches <= 0). */
export function snapToGrid(p: Point, gridInches: number): Point {
  if (!(gridInches > 0)) return { x: p.x, y: p.y };
  const r = (v: number) => Math.round(v / gridInches) * gridInches + 0; // +0 normalizes -0
  return { x: r(p.x), y: r(p.y) };
}

/** Keep the distance from origin, round the direction to the nearest multiple of stepDeg (default 15°). */
export function snapAngle(origin: Point, p: Point, stepDeg = 15): Point {
  const d = dist(origin, p);
  if (d === 0 || !(stepDeg > 0)) return { x: p.x, y: p.y };
  const ang = Math.atan2(p.y - origin.y, p.x - origin.x);
  const step = (stepDeg * Math.PI) / 180;
  const snapped = Math.round(ang / step) * step;
  const clean = (v: number) => (Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : v) + 0;
  return { x: clean(origin.x + d * Math.cos(snapped)), y: clean(origin.y + d * Math.sin(snapped)) };
}

/** Wall endpoints, wall midpoints and room vertices on a floor, de-duplicated. */
export function collectSnapPoints(model: BuildingModel, floorId: string): Point[] {
  const out: Point[] = [];
  const seen = new Set<string>();
  const addP = (p: Point) => {
    const k = `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ x: p.x, y: p.y });
  };
  for (const w of model.walls) {
    if (w.floorId !== floorId) continue;
    addP(w.start);
    addP(w.end);
    addP({ x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 });
  }
  for (const r of model.rooms) if (r.floorId === floorId) r.boundary.forEach(addP);
  return out;
}

/** Nearest candidate within toleranceInches (inclusive); otherwise returns p unchanged. */
export function snapToPoints(p: Point, candidates: Point[], toleranceInches: number): { point: Point; snapped: boolean } {
  let best: Point | null = null;
  let bestD = toleranceInches;
  for (const c of candidates) {
    const d = dist(p, c);
    if (d <= bestD) { best = c; bestD = d; }
  }
  return best ? { point: { x: best.x, y: best.y }, snapped: true } : { point: { x: p.x, y: p.y }, snapped: false };
}

/**
 * Nearest wall whose centerline is within toleranceInches of p. `offset` is the distance from wall.start
 * to the projected point (i.e. directly usable as Opening.offset for the opening centre).
 */
export function snapToWall(p: Point, walls: Wall[], toleranceInches: number): { wallId: string; offset: number; point: Point } | null {
  let best: { wallId: string; offset: number; point: Point } | null = null;
  let bestD = toleranceInches;
  for (const w of walls) {
    const len = wallLength(w);
    if (len === 0 || pointsEqual(w.start, w.end)) continue;
    const pr = projectPointOnSegment(p, w.start, w.end);
    if (pr.distance <= bestD) {
      bestD = pr.distance;
      best = { wallId: w.id, offset: pr.t * len, point: pr.point };
    }
  }
  return best;
}
