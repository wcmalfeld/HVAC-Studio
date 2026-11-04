/**
 * Raw 2D-canvas drawing helpers used inside Konva sceneFuncs.
 * World-space helpers draw in plan inches (the Konva group applies the inch→px transform);
 * screen-space helpers draw in CSS pixels.
 */
import type { BuildingModel, Opening, Point, Room, Wall } from "@hvac/shared-types";
import { centroid, dist, polygonArea, pointInPolygon, boundingBox } from "@hvac/building-geometry";
import type Konva from "konva";

export const raw = (ctx: Konva.Context) => (ctx as unknown as { _context: CanvasRenderingContext2D })._context;

export const FONT = '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif';

export function alpha(color: string, a: number): string {
  // Accept #rrggbb only (our tokens); fall back to color-mix for anything else.
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const n = Math.round(Math.max(0, Math.min(1, a)) * 255)
      .toString(16)
      .padStart(2, "0");
    return color + n;
  }
  return `color-mix(in srgb, ${color} ${Math.round(a * 100)}%, transparent)`;
}

/** Polygon outline of a wall with thickness, extended by t/2 at joined ends for clean corners. */
export function wallPolygon(w: Wall, extendStart: boolean, extendEnd: boolean): Point[] {
  const dx = w.end.x - w.start.x;
  const dy = w.end.y - w.start.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const nx = -uy * (w.thickness / 2), ny = ux * (w.thickness / 2);
  const es = extendStart ? w.thickness / 2 : 0;
  const ee = extendEnd ? w.thickness / 2 : 0;
  const s = { x: w.start.x - ux * es, y: w.start.y - uy * es };
  const e = { x: w.end.x + ux * ee, y: w.end.y + uy * ee };
  return [
    { x: s.x + nx, y: s.y + ny },
    { x: e.x + nx, y: e.y + ny },
    { x: e.x - nx, y: e.y - ny },
    { x: s.x - nx, y: s.y - ny },
  ];
}

export function pathPoly(c: CanvasRenderingContext2D, pts: Point[]) {
  c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  c.closePath();
}

/** Endpoint join map: "x,y" → count of wall endpoints there (rounded to 1/4"). */
export function endpointKey(p: Point) {
  return `${Math.round(p.x * 4)},${Math.round(p.y * 4)}`;
}
export function joinCounts(walls: Wall[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of walls) {
    m.set(endpointKey(w.start), (m.get(endpointKey(w.start)) ?? 0) + 1);
    m.set(endpointKey(w.end), (m.get(endpointKey(w.end)) ?? 0) + 1);
  }
  return m;
}

export function openingGeom(o: Opening, w: Wall) {
  const len = dist(w.start, w.end) || 1;
  const ux = (w.end.x - w.start.x) / len, uy = (w.end.y - w.start.y) / len;
  const nx = -uy, ny = ux;
  const a = o.offset - o.width / 2;
  const b = o.offset + o.width / 2;
  const p0 = { x: w.start.x + ux * a, y: w.start.y + uy * a };
  const p1 = { x: w.start.x + ux * b, y: w.start.y + uy * b };
  return { p0, p1, ux, uy, nx, ny, t: w.thickness };
}

/** Room label cache keyed on room object identity (immer keeps identity for unchanged rooms). */
const labelCache = new WeakMap<Room, { c: Point; areaSqIn: number; bbW: number; bbH: number }>();
export function roomLabelInfo(r: Room) {
  let v = labelCache.get(r);
  if (!v) {
    let c = centroid(r.boundary);
    if (!pointInPolygon(c, r.boundary)) {
      // concave room: fall back to the bbox center of the boundary's first triangle-ish area
      const bb = boundingBox(r.boundary);
      c = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
    }
    const bb = boundingBox(r.boundary);
    v = { c, areaSqIn: polygonArea(r.boundary), bbW: bb.width, bbH: bb.height };
    labelCache.set(r, v);
  }
  return v;
}

/** Draw a dimension line between two screen points with a centered label. */
export function drawDimension(
  c: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  label: string,
  opts: { color: string; bg: string; offset?: number; strong?: boolean },
) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 8) return;
  const ux = dx / len, uy = dy / len;
  // offset perpendicular (screen space); keep labels readable
  const off = opts.offset ?? 0;
  const nx = -uy * off, ny = ux * off;
  const A = { x: a.x + nx, y: a.y + ny }, B = { x: b.x + nx, y: b.y + ny };
  c.save();
  c.strokeStyle = opts.color;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(A.x, A.y);
  c.lineTo(B.x, B.y);
  if (off) {
    c.moveTo(a.x + nx * 0.25, a.y + ny * 0.25);
    c.lineTo(A.x + nx * 0.25, A.y + ny * 0.25);
    c.moveTo(b.x + nx * 0.25, b.y + ny * 0.25);
    c.lineTo(B.x + nx * 0.25, B.y + ny * 0.25);
  }
  // ticks
  const tk = 4;
  for (const P of [A, B]) {
    c.moveTo(P.x - (ux - uy) * tk, P.y - (uy + ux) * tk);
    c.lineTo(P.x + (ux - uy) * tk, P.y + (uy + ux) * tk);
  }
  c.stroke();
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  let ang = Math.atan2(dy, dx);
  if (ang > Math.PI / 2) ang -= Math.PI;
  if (ang < -Math.PI / 2) ang += Math.PI;
  c.translate(mid.x, mid.y);
  c.rotate(ang);
  c.font = `${opts.strong ? 600 : 500} 11px ${FONT}`;
  const tw = c.measureText(label).width;
  if (tw + 8 < len || opts.strong) {
    c.fillStyle = opts.bg;
    roundRect(c, -tw / 2 - 4, -8, tw + 8, 16, 4);
    c.fill();
    c.fillStyle = opts.color;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(label, 0, 0.5);
  }
  c.restore();
}

export function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export function pill(c: CanvasRenderingContext2D, x: number, y: number, text: string, fg: string, bg: string, border?: string) {
  c.save();
  c.font = `600 11px ${FONT}`;
  const tw = c.measureText(text).width;
  c.fillStyle = bg;
  roundRect(c, x, y, tw + 12, 20, 5);
  c.fill();
  if (border) {
    c.strokeStyle = border;
    c.lineWidth = 1;
    c.stroke();
  }
  c.fillStyle = fg;
  c.textBaseline = "middle";
  c.fillText(text, x + 6, y + 10.5);
  c.restore();
}

export type { BuildingModel };
