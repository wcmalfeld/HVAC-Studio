import type { Point } from "@hvac/shared-types";
import { EPS, cross, dist, pointsEqual, sub } from "./vec";

export interface BBox { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number }

/** Shoelace signed area in square inches; counter-clockwise (y-up) is positive. */
export function polygonSignedArea(pts: Point[]): number {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}
export const polygonArea = (pts: Point[]): number => Math.abs(polygonSignedArea(pts));

export function polygonPerimeter(pts: Point[]): number {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) s += dist(pts[i]!, pts[(i + 1) % n]!);
  return s;
}

/** Returns a copy wound counter-clockwise. */
export function normalizeCCW(pts: Point[]): Point[] {
  const c = pts.map((p) => ({ x: p.x, y: p.y }));
  return polygonSignedArea(c) < 0 ? c.reverse() : c;
}

/** Area centroid; falls back to vertex average for degenerate polygons. */
export function centroid(pts: Point[]): Point {
  const a = polygonSignedArea(pts);
  if (Math.abs(a) < EPS) {
    const n = pts.length || 1;
    return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % n]!;
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Even-odd ray cast. Points exactly on the boundary may return either value. */
export function pointInPolygon(p: Point, pts: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Orientation of c relative to ab: 1 CCW, -1 CW, 0 collinear (within EPS·|ab|). */
function orient(a: Point, b: Point, c: Point): number {
  const v = cross(sub(b, a), sub(c, a));
  const tol = EPS * Math.max(1, dist(a, b));
  return v > tol ? 1 : v < -tol ? -1 : 0;
}
function onSeg(a: Point, b: Point, p: Point): boolean {
  return Math.min(a.x, b.x) - EPS <= p.x && p.x <= Math.max(a.x, b.x) + EPS && Math.min(a.y, b.y) - EPS <= p.y && p.y <= Math.max(a.y, b.y) + EPS;
}
/** Closed-segment intersection test (touching counts). */
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0) return true;
  if (o1 === 0 && onSeg(a, b, c)) return true;
  if (o2 === 0 && onSeg(a, b, d)) return true;
  if (o3 === 0 && onSeg(c, d, a)) return true;
  if (o4 === 0 && onSeg(c, d, b)) return true;
  return false;
}

/**
 * True when the polygon has >= 3 vertices, non-zero area, no repeated consecutive vertices,
 * and no two non-adjacent edges touch/cross (adjacent edges may only share their common vertex
 * and must not fold back over each other).
 */
export function isSimplePolygon(pts: Point[]): boolean {
  const n = pts.length;
  if (n < 3) return false;
  if (polygonArea(pts) < EPS) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    if (dist(a, b) < EPS) return false;
    for (let j = i + 1; j < n; j++) {
      const c = pts[j]!;
      const d = pts[(j + 1) % n]!;
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        // Adjacent edges share one vertex; they must not overlap collinearly (fold-back).
        const shared = j === i + 1 ? b : a;
        const otherA = j === i + 1 ? a : b;
        const otherB = j === i + 1 ? d : c;
        if (orient(otherA, shared, otherB) === 0) {
          const v1 = sub(otherA, shared);
          const v2 = sub(otherB, shared);
          if (v1.x * v2.x + v1.y * v2.y > 0) return false;
        }
        continue;
      }
      if (segmentsIntersect(a, b, c, d)) return false;
    }
  }
  return true;
}

export function boundingBox(pts: Point[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!pts.length) minX = minY = maxX = maxY = 0;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function bboxesOverlap(a: BBox, b: BBox, tol = 0): boolean {
  return a.minX < b.maxX + tol && b.minX < a.maxX + tol && a.minY < b.maxY + tol && b.minY < a.maxY + tol;
}

/** Sutherland–Hodgman clip of `subject` against convex CCW `clip`. */
function clipConvex(subject: Point[], clip: Point[]): Point[] {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i]!;
    const b = clip[(i + 1) % clip.length]!;
    const input = out;
    out = [];
    const side = (p: Point) => cross(sub(b, a), sub(p, a));
    for (let k = 0; k < input.length; k++) {
      const p = input[k]!;
      const q = input[(k + 1) % input.length]!;
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
  }
  return out;
}

/** Ear-clipping triangulation of a simple polygon (any winding). Returns CCW triangles. */
export function triangulate(pts: Point[]): Point[][] {
  const poly = normalizeCCW(pts);
  const idx = poly.map((_, i) => i);
  const tris: Point[][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = poly[idx[(i + idx.length - 1) % idx.length]!]!;
      const b = poly[idx[i]!]!;
      const c = poly[idx[(i + 1) % idx.length]!]!;
      const cr = cross(sub(b, a), sub(c, b));
      if (cr <= EPS) {
        if (Math.abs(cr) <= EPS) { idx.splice(i, 1); clipped = true; break; } // collinear vertex
        continue;
      }
      let ear = true;
      for (const k of idx) {
        const p = poly[k]!;
        if (pointsEqual(p, a) || pointsEqual(p, b) || pointsEqual(p, c)) continue;
        // A vertex inside OR on the boundary of the candidate ear blocks it (a reflex vertex lying on the
        // diagonal would otherwise let the ear cut outside the polygon).
        if (cross(sub(b, a), sub(p, a)) >= -EPS && cross(sub(c, b), sub(p, b)) >= -EPS && cross(sub(a, c), sub(p, c)) >= -EPS) { ear = false; break; }
      }
      if (ear) { tris.push([a, b, c]); idx.splice(i, 1); clipped = true; break; }
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push(idx.map((k) => poly[k]!));
  return tris.filter((t) => polygonArea(t) > EPS);
}

/** Area (sq in) of the intersection of two simple polygons. */
export function intersectionArea(a: Point[], b: Point[]): number {
  if (!bboxesOverlap(boundingBox(a), boundingBox(b))) return 0;
  const ta = triangulate(a);
  const tb = triangulate(b);
  let s = 0;
  for (const t1 of ta) {
    const bb1 = boundingBox(t1);
    for (const t2 of tb) {
      if (!bboxesOverlap(bb1, boundingBox(t2))) continue;
      const c = clipConvex(t1, t2);
      if (c.length >= 3) s += polygonArea(c);
    }
  }
  return s;
}

/**
 * True when the interiors overlap by more than `minAreaSqIn` (default 1 sq in, i.e. well above float
 * noise but far below any meaningful room). Shared edges and touching vertices do NOT count.
 */
export function polygonsOverlap(a: Point[], b: Point[], minAreaSqIn = 1): boolean {
  return intersectionArea(a, b) > minAreaSqIn;
}

/** Axis-aligned rectangle, CCW starting at origin (bottom-left). */
export function rectangleBoundary(origin: Point, width: number, depth: number): Point[] {
  return [
    { x: origin.x, y: origin.y },
    { x: origin.x + width, y: origin.y },
    { x: origin.x + width, y: origin.y + depth },
    { x: origin.x, y: origin.y + depth },
  ];
}
