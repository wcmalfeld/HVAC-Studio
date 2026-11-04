/**
 * Scene renderers. Each takes a raw 2D context already scaled for devicePixelRatio by Konva,
 * plus the current state, and draws one layer. World geometry is drawn by applying the single
 * viewport transform (inches → px, y flipped); text and handles are drawn in screen space.
 */
import type { BuildingModel, Point, Wall } from "@hvac/shared-types";
import { dist, formatLength, wallLength, centroid, boundingBox } from "@hvac/building-geometry";
import { formatArea } from "@/lib/format";
import { gridLevel, scaleOf, toScreen, type Viewport } from "../viewport";
import type { EditorState } from "../store";
import type { OverlayState } from "../overlay-store";
import type { PlanColors } from "./theme";
import { roomTint } from "./theme";
import { alpha, drawDimension, FONT, joinCounts, endpointKey, openingGeom, pathPoly, pill, roomLabelInfo, wallPolygon, roundRect } from "./draw";

type Units = BuildingModel["displayUnits"];

function applyWorld(c: CanvasRenderingContext2D, v: Viewport) {
  const s = scaleOf(v);
  c.transform(s, 0, 0, -s, v.ox, v.oy);
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------
export function drawGrid(c: CanvasRenderingContext2D, v: Viewport, col: PlanColors, visible: boolean) {
  c.fillStyle = col.bg;
  c.fillRect(0, 0, v.width, v.height);
  if (!visible) return;
  const { minor, major } = gridLevel(v.zoom);
  const s = scaleOf(v);
  const x0 = (0 - v.ox) / s, x1 = (v.width - v.ox) / s;
  const y0 = (v.oy - v.height) / s, y1 = v.oy / s;
  const line = (step: number, color: string, w: number) => {
    c.beginPath();
    c.strokeStyle = color;
    c.lineWidth = w;
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      const sx = Math.round(v.ox + x * s) + 0.5;
      c.moveTo(sx, 0);
      c.lineTo(sx, v.height);
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      const sy = Math.round(v.oy - y * s) + 0.5;
      c.moveTo(0, sy);
      c.lineTo(v.width, sy);
    }
    c.stroke();
  };
  if (minor * s >= 6) line(minor, col.gridMinor, 1);
  line(major, col.gridMajor, 1);
  // origin cross
  const o = toScreen(v, { x: 0, y: 0 });
  c.strokeStyle = col.axis;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(o.x - 8, o.y + 0.5);
  c.lineTo(o.x + 8, o.y + 0.5);
  c.moveTo(o.x + 0.5, o.y - 8);
  c.lineTo(o.x + 0.5, o.y + 8);
  c.stroke();
}

// ---------------------------------------------------------------------------
// Ghost (other floors)
// ---------------------------------------------------------------------------
export function drawGhost(c: CanvasRenderingContext2D, m: BuildingModel, floorId: string, v: Viewport, col: PlanColors) {
  const floors = [...m.floors].sort((a, b) => a.order - b.order);
  const idx = floors.findIndex((f) => f.id === floorId);
  const neighbors = new Set([floors[idx - 1]?.id, floors[idx + 1]?.id].filter(Boolean) as string[]);
  if (!neighbors.size) return;
  c.save();
  applyWorld(c, v);
  c.strokeStyle = alpha(col.wall, 0.09);
  c.lineWidth = 1 / scaleOf(v);
  c.setLineDash([3 / scaleOf(v), 5 / scaleOf(v)]);
  c.beginPath();
  for (const w of m.walls) {
    if (!neighbors.has(w.floorId)) continue;
    c.moveTo(w.start.x, w.start.y);
    c.lineTo(w.end.x, w.end.y);
  }
  c.stroke();
  c.restore();
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
export interface ModelDrawState {
  model: BuildingModel;
  floorId: string;
  selection: Set<string>;
  hoverId: string | null;
  layers: EditorState["layers"];
}

export function drawModel(c: CanvasRenderingContext2D, st: ModelDrawState, v: Viewport, col: PlanColors) {
  const { model, floorId, selection, layers } = st;
  const units: Units = model.displayUnits;
  const s = scaleOf(v);
  const px = 1 / s; // one screen pixel in inches
  const walls = model.walls.filter((w) => w.floorId === floorId);
  const rooms = model.rooms.filter((r) => r.floorId === floorId);
  const wallById = new Map(walls.map((w) => [w.id, w]));

  // view culling bounds in inches (with margin)
  const vx0 = -v.ox / s - 200, vx1 = (v.width - v.ox) / s + 200;
  const vy0 = (v.oy - v.height) / s - 200, vy1 = v.oy / s + 200;
  const visibleSeg = (a: Point, b: Point) =>
    !(Math.max(a.x, b.x) < vx0 || Math.min(a.x, b.x) > vx1 || Math.max(a.y, b.y) < vy0 || Math.min(a.y, b.y) > vy1);

  c.save();
  applyWorld(c, v);

  // Rooms: fills
  if (layers.rooms) {
    for (const r of rooms) {
      const sel = selection.has(r.id);
      const hov = st.hoverId === r.id;
      const tint = roomTint(r.roomType, r.conditioned, col);
      pathPoly(c, r.boundary);
      c.fillStyle = alpha(tint, sel ? 0.2 : hov ? 0.13 : 0.08);
      c.fill();
      if (sel || hov) {
        c.lineWidth = (sel ? 1.5 : 1) * px;
        c.strokeStyle = alpha(col.select, sel ? 1 : 0.5);
        c.setLineDash(sel ? [5 * px, 3 * px] : []);
        c.stroke();
        c.setLineDash([]);
      }
    }
  }

  // Walls
  if (layers.walls) {
    const joins = joinCounts(walls);
    const ext = new Path2D();
    const int = new Path2D();
    for (const w of walls) {
      if (!visibleSeg(w.start, w.end)) continue;
      const poly = wallPolygon(w, (joins.get(endpointKey(w.start)) ?? 0) > 1, (joins.get(endpointKey(w.end)) ?? 0) > 1);
      const p = w.kind === "exterior" ? ext : int;
      p.moveTo(poly[0]!.x, poly[0]!.y);
      for (let i = 1; i < poly.length; i++) p.lineTo(poly[i]!.x, poly[i]!.y);
      p.closePath();
    }
    c.fillStyle = col.wallInterior;
    c.fill(int, "nonzero");
    c.fillStyle = col.wall;
    c.fill(ext, "nonzero");
    // very thin walls still need to read at low zoom
    if (s < 0.6) {
      c.strokeStyle = col.wall;
      c.lineWidth = 1.2 * px;
      c.stroke(ext);
    }
  }

  // Openings
  if (layers.openings) {
    for (const o of model.openings) {
      const w = wallById.get(o.wallId);
      if (!w || !visibleSeg(w.start, w.end)) continue;
      const g = openingGeom(o, w);
      const ht = g.t / 2 + 0.6 * px;
      // cut the wall
      c.fillStyle = col.bg;
      pathPoly(c, [
        { x: g.p0.x + g.nx * ht, y: g.p0.y + g.ny * ht },
        { x: g.p1.x + g.nx * ht, y: g.p1.y + g.ny * ht },
        { x: g.p1.x - g.nx * ht, y: g.p1.y - g.ny * ht },
        { x: g.p0.x - g.nx * ht, y: g.p0.y - g.ny * ht },
      ]);
      c.fill();
      const sel = selection.has(o.id);
      const hov = st.hoverId === o.id;
      c.lineWidth = 1.25 * px;
      if (o.type === "window") {
        c.strokeStyle = col.window;
        c.fillStyle = alpha(col.window, 0.12);
        pathPoly(c, [
          { x: g.p0.x + g.nx * (g.t / 2), y: g.p0.y + g.ny * (g.t / 2) },
          { x: g.p1.x + g.nx * (g.t / 2), y: g.p1.y + g.ny * (g.t / 2) },
          { x: g.p1.x - g.nx * (g.t / 2), y: g.p1.y - g.ny * (g.t / 2) },
          { x: g.p0.x - g.nx * (g.t / 2), y: g.p0.y - g.ny * (g.t / 2) },
        ]);
        c.fill();
        c.stroke();
        c.beginPath();
        c.moveTo(g.p0.x, g.p0.y);
        c.lineTo(g.p1.x, g.p1.y);
        c.stroke();
        // jambs
        c.lineWidth = 2 * px;
        c.strokeStyle = col.wall;
        c.beginPath();
        for (const p of [g.p0, g.p1]) {
          c.moveTo(p.x + g.nx * (g.t / 2), p.y + g.ny * (g.t / 2));
          c.lineTo(p.x - g.nx * (g.t / 2), p.y - g.ny * (g.t / 2));
        }
        c.stroke();
      } else {
        // door: leaf hinged at p0, swinging to the +normal side, 90° open, with swing arc
        const wdt = o.width;
        const hinge = { x: g.p0.x + g.nx * (g.t / 2), y: g.p0.y + g.ny * (g.t / 2) };
        const leafEnd = { x: hinge.x + g.nx * wdt, y: hinge.y + g.ny * wdt };
        const closed = { x: g.p1.x + g.nx * (g.t / 2), y: g.p1.y + g.ny * (g.t / 2) };
        c.strokeStyle = alpha(col.door, 0.55);
        c.lineWidth = 1 * px;
        c.setLineDash([4 * px, 3 * px]);
        c.beginPath();
        const a0 = Math.atan2(closed.y - hinge.y, closed.x - hinge.x);
        const a1 = Math.atan2(leafEnd.y - hinge.y, leafEnd.x - hinge.x);
        let da = a1 - a0;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        c.arc(hinge.x, hinge.y, wdt, a0, a1, da < 0);
        c.stroke();
        c.setLineDash([]);
        c.strokeStyle = col.door;
        c.lineWidth = 2 * px;
        c.beginPath();
        c.moveTo(hinge.x, hinge.y);
        c.lineTo(leafEnd.x, leafEnd.y);
        c.stroke();
        c.lineWidth = 2 * px;
        c.strokeStyle = col.wall;
        c.beginPath();
        for (const p of [g.p0, g.p1]) {
          c.moveTo(p.x + g.nx * (g.t / 2), p.y + g.ny * (g.t / 2));
          c.lineTo(p.x - g.nx * (g.t / 2), p.y - g.ny * (g.t / 2));
        }
        c.stroke();
      }
      if (sel || hov) {
        const m = g.t / 2 + 3 * px;
        pathPoly(c, [
          { x: g.p0.x + g.nx * m, y: g.p0.y + g.ny * m },
          { x: g.p1.x + g.nx * m, y: g.p1.y + g.ny * m },
          { x: g.p1.x - g.nx * m, y: g.p1.y - g.ny * m },
          { x: g.p0.x - g.nx * m, y: g.p0.y - g.ny * m },
        ]);
        c.strokeStyle = alpha(col.select, sel ? 1 : 0.55);
        c.lineWidth = 1.5 * px;
        c.stroke();
      }
    }
  }

  // Selected / hovered walls outline
  if (layers.walls) {
    for (const w of walls) {
      const sel = selection.has(w.id);
      if (!sel && st.hoverId !== w.id) continue;
      const poly = wallPolygon(w, false, false);
      pathPoly(c, poly);
      c.strokeStyle = alpha(col.select, sel ? 1 : 0.6);
      c.lineWidth = (sel ? 2 : 1.5) * px;
      c.stroke();
      if (sel) {
        c.fillStyle = alpha(col.select, 0.25);
        c.fill();
      }
    }
  }
  c.restore();

  // ---------------- screen-space annotations ----------------
  const sel = selection;

  // Room labels
  if (layers.rooms && layers.labels) {
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (const r of rooms) {
      const info = roomLabelInfo(r);
      const w = info.bbW * s, h = info.bbH * s;
      if (w < 44 || h < 26) continue;
      const p = toScreen(v, info.c);
      if (p.x < -100 || p.x > v.width + 100 || p.y < -50 || p.y > v.height + 50) continue;
      const name = r.name;
      const area = formatArea(info.areaSqIn, units);
      const big = w > 110 && h > 46;
      c.font = `600 ${big ? 12.5 : 11}px ${FONT}`;
      c.fillStyle = sel.has(r.id) ? col.select : col.ink;
      let label = name;
      const maxW = w - 10;
      if (c.measureText(label).width > maxW) {
        while (label.length > 1 && c.measureText(label + "…").width > maxW) label = label.slice(0, -1);
        label += "…";
      }
      c.fillText(label, p.x, p.y - (big ? 8 : 6));
      c.font = `500 ${big ? 11.5 : 10.5}px ${FONT}`;
      c.fillStyle = col.ink3;
      c.fillText(area, p.x, p.y + (big ? 9 : 7));
    }
  }

  // Dimensions on selected walls (and exterior walls when the dimensions layer is on and zoomed in)
  if (layers.dimensions && layers.walls) {
    const fc = floorCenter(walls);
    for (const w of walls) {
      const isSel = sel.has(w.id);
      const len = wallLength(w);
      if (!isSel && (w.kind !== "exterior" || len * s < 70)) continue;
      const a = toScreen(v, w.start), b = toScreen(v, w.end);
      // offset away from floor center
      const mid = { x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 };
      const dx = b.x - a.x, dy = b.y - a.y;
      const L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L;
      const cS = toScreen(v, fc), mS = toScreen(v, mid);
      const sign = (mS.x - cS.x) * nx + (mS.y - cS.y) * ny >= 0 ? 1 : -1;
      const off = sign * ((w.thickness / 2) * s + (isSel ? 22 : 16));
      drawDimension(c, a, b, formatLength(len, units, { fractionDenominator: 16 }), {
        color: isSel ? col.select : alpha(col.dim, 0.85),
        bg: col.bg,
        offset: off,
        strong: isSel,
      });
    }
  }

  // Handles: selected wall endpoints, selected room vertices
  c.lineWidth = 1.5;
  for (const w of walls) {
    if (!sel.has(w.id)) continue;
    for (const p of [w.start, w.end]) handle(c, toScreen(v, p), col);
  }
  for (const r of rooms) {
    if (!sel.has(r.id)) continue;
    for (const p of r.boundary) handle(c, toScreen(v, p), col, true);
  }
}

function floorCenter(walls: Wall[]): Point {
  if (!walls.length) return { x: 0, y: 0 };
  const bb = boundingBox(walls.flatMap((w) => [w.start, w.end]));
  return { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
}

function handle(c: CanvasRenderingContext2D, p: Point, col: PlanColors, small = false) {
  const r = small ? 3 : 4.5;
  c.fillStyle = col.surface;
  c.strokeStyle = col.select;
  c.beginPath();
  c.rect(Math.round(p.x) - r + 0.5, Math.round(p.y) - r + 0.5, r * 2, r * 2);
  c.fill();
  c.stroke();
}

// ---------------------------------------------------------------------------
// Overlay (tool previews)
// ---------------------------------------------------------------------------
export interface OverlayDrawState {
  o: OverlayState;
  tool: EditorState["tool"];
  units: Units;
  model: BuildingModel;
}

export function drawOverlay(c: CanvasRenderingContext2D, st: OverlayDrawState, v: Viewport, col: PlanColors) {
  const { o, units } = st;
  const S = (p: Point) => toScreen(v, p);
  const fmt = (n: number) => formatLength(n, units, { fractionDenominator: 16 });
  const s = scaleOf(v);

  // Wall chain
  if (st.tool === "wall" && o.chain.length) {
    c.save();
    c.strokeStyle = col.select;
    c.lineCap = "round";
    const last = o.chain[o.chain.length - 1]!;
    if (o.preview) {
      const a = S(last), b = S(o.preview);
      c.lineWidth = Math.max(2, 6 * s);
      c.strokeStyle = alpha(col.select, 0.55);
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
      const len = dist(last, o.preview);
      drawDimension(c, a, b, fmt(len), { color: col.select, bg: col.bg, offset: -18, strong: true });
      // angle readout
      const ang = (Math.atan2(o.preview.y - last.y, o.preview.x - last.x) * 180) / Math.PI;
      pill(c, b.x + 14, b.y + 10, `${((ang + 360) % 360).toFixed(1)}°`, col.ink3, alpha(col.surface, 0.92), alpha(col.ink3, 0.25));
    }
    for (const p of o.chain) dot(c, S(p), col.select, 3.5);
    c.restore();
  }

  // Rect room
  if (o.rect) {
    const a = o.rect.a, b = o.rect.b;
    const pts = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }].map(S);
    c.save();
    c.fillStyle = alpha(col.room, 0.1);
    c.strokeStyle = col.select;
    c.lineWidth = 1.5;
    c.setLineDash([6, 4]);
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath();
    c.fill();
    c.stroke();
    c.setLineDash([]);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    const top = Math.max(a.y, b.y), left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), bottom = Math.min(a.y, b.y);
    drawDimension(c, S({ x: left, y: top }), S({ x: right, y: top }), fmt(w), { color: col.select, bg: col.bg, offset: -18, strong: true });
    drawDimension(c, S({ x: right, y: top }), S({ x: right, y: bottom }), fmt(h), { color: col.select, bg: col.bg, offset: -18, strong: true });
    const cc = S({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    c.font = `600 12px ${FONT}`;
    c.textAlign = "center";
    c.fillStyle = col.select;
    if (w * s > 60 && h * s > 30) c.fillText(formatArea(w * h, units), cc.x, cc.y + 4);
    c.restore();
  }

  // Polygon room
  if (o.poly.length) {
    c.save();
    const pts = [...o.poly, ...(o.preview ? [o.preview] : [])].map(S);
    c.strokeStyle = col.select;
    c.fillStyle = alpha(col.room, 0.08);
    c.lineWidth = 1.5;
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    if (pts.length > 2) c.fill();
    c.stroke();
    if (o.preview && o.poly.length) {
      const last = o.poly[o.poly.length - 1]!;
      drawDimension(c, S(last), S(o.preview), fmt(dist(last, o.preview)), { color: col.select, bg: col.bg, offset: -16, strong: true });
    }
    o.poly.forEach((p, i) => dot(c, S(p), col.select, i === 0 ? 5 : 3.5));
    c.restore();
  }

  // Opening preview
  if (o.opening) {
    const w = st.model.walls.find((x) => x.id === o.opening!.wallId);
    if (w) {
      const len = wallLength(w);
      const ux = (w.end.x - w.start.x) / len, uy = (w.end.y - w.start.y) / len;
      const a = o.opening.offset - o.opening.width / 2, b = o.opening.offset + o.opening.width / 2;
      const nx = -uy * (w.thickness / 2 + 2), ny = ux * (w.thickness / 2 + 2);
      const p0 = { x: w.start.x + ux * a, y: w.start.y + uy * a };
      const p1 = { x: w.start.x + ux * b, y: w.start.y + uy * b };
      const pts = [
        { x: p0.x + nx, y: p0.y + ny },
        { x: p1.x + nx, y: p1.y + ny },
        { x: p1.x - nx, y: p1.y - ny },
        { x: p0.x - nx, y: p0.y - ny },
      ].map(S);
      const color = o.opening.type === "window" ? col.window : col.door;
      c.save();
      c.fillStyle = alpha(color, 0.25);
      c.strokeStyle = color;
      c.lineWidth = 1.5;
      c.beginPath();
      pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      c.closePath();
      c.fill();
      c.stroke();
      // distances to wall ends
      drawDimension(c, S(w.start), S(p0), fmt(Math.max(0, a)), { color: alpha(color, 0.9), bg: col.bg, offset: -(w.thickness / 2) * s - 16 });
      drawDimension(c, S(p1), S(w.end), fmt(Math.max(0, len - b)), { color: alpha(color, 0.9), bg: col.bg, offset: -(w.thickness / 2) * s - 16 });
      c.restore();
    }
  }

  // Measure tape
  if (o.measure) {
    const a = S(o.measure.a), b = S(o.measure.b);
    c.save();
    c.strokeStyle = col.heat;
    c.lineWidth = 1.5;
    c.setLineDash([2, 3]);
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
    c.setLineDash([]);
    dot(c, a, col.heat, 3.5);
    dot(c, b, col.heat, 3.5);
    const d = dist(o.measure.a, o.measure.b);
    const dx = Math.abs(o.measure.b.x - o.measure.a.x), dy = Math.abs(o.measure.b.y - o.measure.a.y);
    const text = `${fmt(d)}   Δx ${fmt(dx)}   Δy ${fmt(dy)}`;
    pill(c, b.x + 12, b.y - 28, text, "#ffffff", col.heat);
    c.restore();
  }

  // Calibration points
  if (o.calibrate.a) {
    const a = S(o.calibrate.a);
    c.save();
    c.strokeStyle = col.warn;
    c.fillStyle = col.warn;
    crosshair(c, a, col.warn);
    const b = o.calibrate.b ?? o.preview;
    if (b) {
      const B = S(b);
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(B.x, B.y);
      c.stroke();
      crosshair(c, B, col.warn);
    }
    c.restore();
  }

  // Marquee (screen space)
  if (o.marquee) {
    const { a, b } = o.marquee;
    const crossing = b.x < a.x;
    c.save();
    c.fillStyle = alpha(col.select, 0.07);
    c.strokeStyle = col.select;
    c.lineWidth = 1;
    if (crossing) c.setLineDash([4, 3]);
    c.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    c.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    c.restore();
  }

  // Snap indicator
  if (o.snap && st.tool !== "select" && st.tool !== "pan") {
    const p = S(o.snap.point);
    c.save();
    c.strokeStyle = o.snap.kind === "point" ? col.heat : col.select;
    c.lineWidth = 1.5;
    if (o.snap.kind === "point") {
      c.beginPath();
      c.rect(p.x - 5.5, p.y - 5.5, 11, 11);
      c.stroke();
    } else if (o.snap.kind === "wall") {
      c.beginPath();
      c.arc(p.x, p.y, 5, 0, Math.PI * 2);
      c.stroke();
    } else {
      crosshair(c, p, alpha(col.select, 0.8), 6);
    }
    c.restore();
  }

  // Typed length entry
  if (o.typed && o.preview) {
    const p = S(o.preview);
    c.save();
    c.font = `600 12px ${FONT}`;
    const text = `${o.typed}`;
    const tw = c.measureText(text).width;
    c.fillStyle = col.surface;
    c.strokeStyle = col.select;
    c.lineWidth = 1.5;
    roundRect(c, p.x + 14, p.y - 34, tw + 18, 22, 5);
    c.fill();
    c.stroke();
    c.fillStyle = col.ink;
    c.textBaseline = "middle";
    c.fillText(text, p.x + 23, p.y - 22.5);
    c.restore();
  }
}

function dot(c: CanvasRenderingContext2D, p: Point, color: string, r: number) {
  c.fillStyle = "#ffffff";
  c.strokeStyle = color;
  c.lineWidth = 1.5;
  c.beginPath();
  c.arc(p.x, p.y, r, 0, Math.PI * 2);
  c.fill();
  c.stroke();
}

function crosshair(c: CanvasRenderingContext2D, p: Point, color: string, r = 9) {
  c.strokeStyle = color;
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(p.x - r, p.y);
  c.lineTo(p.x + r, p.y);
  c.moveTo(p.x, p.y - r);
  c.lineTo(p.x, p.y + r);
  c.stroke();
  c.beginPath();
  c.arc(p.x, p.y, r * 0.45, 0, Math.PI * 2);
  c.stroke();
}

export { centroid };
