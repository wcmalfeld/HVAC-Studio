import type { Point } from "@hvac/shared-types";

/** Floating tolerance for coordinate equality, inches. */
export const EPS = 1e-6;

export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
/** z component of the 3D cross product of two plan vectors (positive => b is CCW from a). */
export const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
export const length = (a: Point): number => Math.hypot(a.x, a.y);
export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export function normalize(a: Point): Point {
  const l = length(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}
export const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
/** Rotate p about center by deg degrees, counter-clockwise positive (y-up plan). */
export function rotatePoint(p: Point, center: Point, deg: number): Point {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
}
export const pointsEqual = (a: Point, b: Point, eps = EPS): boolean => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

/** Closest point on segment ab to p. t is clamped to [0,1]; distance is |p - point|. */
export function projectPointOnSegment(p: Point, a: Point, b: Point): { point: Point; t: number; distance: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < EPS * EPS ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2));
  const point = lerp(a, b, t);
  return { point, t, distance: dist(p, point) };
}
