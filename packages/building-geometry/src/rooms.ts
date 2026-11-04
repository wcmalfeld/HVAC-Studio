import type { BuildingModel, Point, Wall } from "@hvac/shared-types";
import { boundingBox, normalizeCCW, pointInPolygon, polygonSignedArea } from "./polygon";
import { cross, dist, sub } from "./vec";
import { newId } from "./ids";

/** Vertices closer than this are merged when building the wall graph, inches. */
export const GRAPH_MERGE_TOLERANCE_IN = 0.5;
/** A wall endpoint this close to another wall's centerline forms a T-junction, inches. */
export const T_JUNCTION_TOLERANCE_IN = 1;

/**
 * Find the smallest closed loop of wall centerlines (on `floorId`) that encloses `seed`, for click-to-create
 * rooms. Walls are split at crossings and T-junctions (endpoint within 1" of another centerline), vertices
 * within 0.5" are merged, dead-end walls are pruned, and the planar faces are traced. Collinear vertices are
 * removed. Returns a CCW boundary (inches) or null when seed is not inside any closed loop.
 */
export function roomFromWalls(model: BuildingModel, floorId: string, seed: Point): Point[] | null {
  const walls = model.walls.filter((w) => w.floorId === floorId && dist(w.start, w.end) > GRAPH_MERGE_TOLERANCE_IN);
  if (walls.length < 3) return null;

  // 1. split parameters per wall
  const params: number[][] = walls.map(() => [0, 1]);
  const boxes = walls.map((w) => boundingBox([w.start, w.end]));
  const order = walls.map((_, i) => i).sort((a, b) => boxes[a]!.minX - boxes[b]!.minX);
  const tol = T_JUNCTION_TOLERANCE_IN;
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi]!;
    const bi = boxes[i]!;
    for (let oj = oi + 1; oj < order.length; oj++) {
      const j = order[oj]!;
      const bj = boxes[j]!;
      if (bj.minX > bi.maxX + tol) break;
      if (bj.minY > bi.maxY + tol || bi.minY > bj.maxY + tol) continue;
      splitPair(walls[i]!, walls[j]!, params[i]!, params[j]!);
    }
  }

  // 2. vertices (merged on a hash grid) and undirected edges
  const verts: Point[] = [];
  const grid = new Map<string, number[]>();
  const cell = GRAPH_MERGE_TOLERANCE_IN * 2;
  const vertexId = (p: Point): number => {
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const k of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (dist(verts[k]!, p) <= GRAPH_MERGE_TOLERANCE_IN) return k;
    verts.push({ x: p.x, y: p.y });
    const key = `${cx},${cy}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(verts.length - 1);
    return verts.length - 1;
  };
  const adj = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (a === b) return;
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  walls.forEach((w, i) => {
    const ts = [...new Set(params[i]!.map((t) => Math.min(1, Math.max(0, t))))].sort((a, b) => a - b);
    let prev = vertexId(w.start);
    for (let k = 1; k < ts.length; k++) {
      const t = ts[k]!;
      const v = vertexId({ x: w.start.x + (w.end.x - w.start.x) * t, y: w.start.y + (w.end.y - w.start.y) * t });
      link(prev, v);
      prev = v;
    }
  });

  // 3. prune dead ends
  const stack = [...adj.keys()].filter((k) => adj.get(k)!.size < 2);
  while (stack.length) {
    const v = stack.pop()!;
    const ns = adj.get(v);
    if (!ns) continue;
    for (const n of ns) {
      const nn = adj.get(n)!;
      nn.delete(v);
      if (nn.size < 2) stack.push(n);
    }
    adj.delete(v);
  }
  if (adj.size < 3) return null;

  // 4. sort neighbours CCW by angle; trace faces keeping each face on the left
  const sorted = new Map<number, number[]>();
  for (const [v, ns] of adj) {
    const p = verts[v]!;
    sorted.set(v, [...ns].sort((a, b) => Math.atan2(verts[a]!.y - p.y, verts[a]!.x - p.x) - Math.atan2(verts[b]!.y - p.y, verts[b]!.x - p.x)));
  }
  const used = new Set<string>();
  let best: Point[] | null = null;
  let bestArea = Infinity;
  for (const [u, ns] of sorted) {
    for (const v0 of ns) {
      if (used.has(`${u}>${v0}`)) continue;
      const face: number[] = [];
      let a = u, b = v0, guard = 0;
      while (!used.has(`${a}>${b}`) && guard++ < 100000) {
        used.add(`${a}>${b}`);
        face.push(a);
        // next edge: the one immediately clockwise from (b -> a) around b
        const around = sorted.get(b)!;
        const k = around.indexOf(a);
        const c = around[(k - 1 + around.length) % around.length]!;
        a = b;
        b = c;
      }
      const pts = face.map((i) => verts[i]!);
      const area = polygonSignedArea(pts);
      if (area > 1 && area < bestArea && pointInPolygon(seed, pts)) {
        bestArea = area;
        best = pts;
      }
    }
  }
  return best ? removeCollinear(normalizeCCW(best)) : null;
}

function splitPair(a: Wall, b: Wall, ta: number[], tb: number[]) {
  const r = sub(a.end, a.start);
  const s = sub(b.end, b.start);
  const la = Math.hypot(r.x, r.y), lb = Math.hypot(s.x, s.y);
  const denom = cross(r, s);
  if (Math.abs(denom) > 1e-9 * la * lb) {
    const qp = sub(b.start, a.start);
    const t = cross(qp, s) / denom;
    const u = cross(qp, r) / denom;
    const ea = T_JUNCTION_TOLERANCE_IN / la, eb = T_JUNCTION_TOLERANCE_IN / lb;
    if (t >= -ea && t <= 1 + ea && u >= -eb && u <= 1 + eb) {
      ta.push(t);
      tb.push(u);
    }
    return;
  }
  // parallel / collinear: endpoints lying on the other segment split it
  const onto = (p: Point, w: Wall, ts: number[], l: number, d: Point) => {
    const t = ((p.x - w.start.x) * d.x + (p.y - w.start.y) * d.y) / (l * l);
    if (t <= 0 || t >= 1) return;
    const q = { x: w.start.x + d.x * t, y: w.start.y + d.y * t };
    if (dist(p, q) <= T_JUNCTION_TOLERANCE_IN) ts.push(t);
  };
  onto(b.start, a, ta, la, r);
  onto(b.end, a, ta, la, r);
  onto(a.start, b, tb, lb, s);
  onto(a.end, b, tb, lb, s);
}

function removeCollinear(pts: Point[]): Point[] {
  const out = pts.filter((p, i) => {
    const prev = pts[(i - 1 + pts.length) % pts.length]!;
    const next = pts[(i + 1) % pts.length]!;
    const c = cross(sub(p, prev), sub(next, p));
    return Math.abs(c) > 1e-6 * dist(prev, p) * dist(p, next) + 1e-9;
  });
  return out.length >= 3 ? out : pts;
}

/**
 * One wall per boundary edge (centerline on the edge, boundary normalized CCW). provenance { source: "user" },
 * adjacentSpace "outdoors" for exterior / "conditioned" for interior, assembly values all null.
 */
export function autoWallsForRoom(
  boundary: Point[],
  floorId: string,
  defaults: { thickness: number; height: number; kind: "exterior" | "interior" },
): Wall[] {
  const pts = normalizeCCW(boundary);
  const walls: Wall[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    if (dist(a, b) < 1e-6) continue;
    walls.push({
      id: newId("wall"),
      floorId,
      start: { x: a.x, y: a.y },
      end: { x: b.x, y: b.y },
      thickness: defaults.thickness,
      height: defaults.height,
      kind: defaults.kind,
      adjacentSpace: defaults.kind === "exterior" ? "outdoors" : "conditioned",
      assembly: { constructionType: null, insulation: null, rValue: null, uFactor: null },
      provenance: { source: "user" },
    });
  }
  return walls;
}
