/**
 * Model validation. Issues carry a stable id `${code}:${sortedOrOrderedEntityIds.join(",")}` so the UI can
 * key/dismiss them across re-validation.
 *
 * Thresholds:
 *   - WALL_ZERO_LENGTH: centerline length < 1/16".
 *   - ROOM_ZERO_AREA: |area| < 1 sq in.
 *   - ROOMS_OVERLAP: interior intersection > 1 sq in (shared edges / touching do not count).
 *   - OPENING_OUT_OF_WALL / OPENINGS_OVERLAP / OPENING_TALLER_THAN_WALL: 1e-6" tolerance.
 *   - EXTERIOR_WALL_MISSING_R_OR_U applies to every exposed wall (kind "exterior" OR adjacentSpace !== "conditioned").
 */
import type { BuildingModel, Provenance } from "@hvac/shared-types";
import { boundingBox, isSimplePolygon, polygonArea, polygonsOverlap, type BBox } from "./polygon";
import { EPS, cross, dist, pointsEqual, sub } from "./vec";
import { openingSpan, wallLength } from "./wall";
import { computeRoomMetrics, isExposedWall } from "./metrics";

export type Severity = "error" | "warning" | "info";
export interface ValidationIssue {
  id: string;
  severity: Severity;
  code: string;
  message: string;
  entityIds: string[];
}

export const MIN_WALL_LENGTH_IN = 1 / 16;
export const MIN_ROOM_AREA_SQ_IN = 1;

export function validateModel(model: BuildingModel): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  const push = (severity: Severity, code: string, entityIds: string[], message: string) => {
    const id = `${code}:${entityIds.join(",")}`;
    if (seen.has(id)) return;
    seen.add(id);
    issues.push({ id, severity, code, message, entityIds });
  };

  // ---- ids ----
  const idCounts = new Map<string, number>();
  const allEntities: { id: string; kind: string }[] = [
    ...model.floors.map((f) => ({ id: f.id, kind: "floor" })),
    ...model.walls.map((w) => ({ id: w.id, kind: "wall" })),
    ...model.openings.map((o) => ({ id: o.id, kind: o.type })),
    ...model.rooms.map((r) => ({ id: r.id, kind: "room" })),
  ];
  for (const e of allEntities) idCounts.set(e.id, (idCounts.get(e.id) ?? 0) + 1);
  for (const [id, n] of idCounts) if (n > 1) push("error", "DUPLICATE_ID", [id], `ID "${id}" is used by ${n} entities.`);

  const floorIds = new Set(model.floors.map((f) => f.id));
  const wallsById = new Map(model.walls.map((w) => [w.id, w] as const));

  const checkProvenance = (entityId: string, label: string, p: Provenance | undefined) => {
    if (p?.source !== "inferred") return;
    push("warning", "INFERRED_NEEDS_REVIEW", [entityId], `${label} was inferred automatically and needs review.`);
    if (p.confidence === undefined || p.confidence === null)
      push("error", "INFERRED_MISSING_CONFIDENCE", [entityId], `${label} is marked inferred but has no confidence value.`);
  };

  // ---- walls ----
  for (const w of model.walls) {
    const label = `Wall ${w.id}`;
    if (!floorIds.has(w.floorId)) push("error", "DANGLING_FLOOR_REF", [w.id, w.floorId], `${label} references missing floor "${w.floorId}".`);
    if (wallLength(w) < MIN_WALL_LENGTH_IN) push("error", "WALL_ZERO_LENGTH", [w.id], `${label} has zero length.`);
    if (isExposedWall(w) && w.assembly.rValue == null && w.assembly.uFactor == null)
      push("warning", "EXTERIOR_WALL_MISSING_R_OR_U", [w.id], `${label} is exposed (${w.adjacentSpace}) but has no R-value or U-factor.`);
    checkProvenance(w.id, label, w.provenance);
  }

  // ---- openings ----
  const openingsByWall = new Map<string, { id: string; s: number; e: number }[]>();
  for (const o of model.openings) {
    const label = `${o.type === "window" ? "Window" : "Door"} ${o.id}`;
    checkProvenance(o.id, label, o.provenance);
    if (o.type === "window") {
      if (o.props.uFactor == null) push("warning", "WINDOW_MISSING_U", [o.id], `${label} has no U-factor.`);
      if (o.props.shgc == null) push("warning", "WINDOW_MISSING_SHGC", [o.id], `${label} has no SHGC.`);
    } else if (o.props.uFactor == null) {
      push("info", "DOOR_MISSING_U", [o.id], `${label} has no U-factor.`);
    }
    const w = wallsById.get(o.wallId);
    if (!w) {
      push("error", "DANGLING_WALL_REF", [o.id, o.wallId], `${label} references missing wall "${o.wallId}".`);
      continue;
    }
    const span = openingSpan(o, w);
    if (span.startOffset < -EPS || span.endOffset > wallLength(w) + EPS)
      push("error", "OPENING_OUT_OF_WALL", [o.id, w.id], `${label} extends beyond the ends of wall ${w.id}.`);
    if (o.sillHeight + o.height > w.height + EPS)
      push("error", "OPENING_TALLER_THAN_WALL", [o.id, w.id], `${label} top (${o.sillHeight + o.height}") is above wall height (${w.height}").`);
    const list = openingsByWall.get(w.id) ?? [];
    list.push({ id: o.id, s: span.startOffset, e: span.endOffset });
    openingsByWall.set(w.id, list);
  }
  for (const [wallId, list] of openingsByWall) {
    list.sort((a, b) => a.s - b.s);
    // sweep: compare each with following openings whose start is before its end
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j]!.s < list[i]!.e - EPS; j++) {
        const ids = [list[i]!.id, list[j]!.id].sort();
        push("error", "OPENINGS_OVERLAP", [...ids, wallId], `Openings ${ids[0]} and ${ids[1]} overlap on wall ${wallId}.`);
      }
    }
  }

  // ---- rooms ----
  const validRooms: { id: string; floorId: string; pts: BuildingModel["rooms"][number]["boundary"]; bb: BBox }[] = [];
  for (const r of model.rooms) {
    const label = `Room "${r.name}"`;
    checkProvenance(r.id, label, r.provenance);
    if (!floorIds.has(r.floorId)) push("error", "DANGLING_FLOOR_REF", [r.id, r.floorId], `${label} references missing floor "${r.floorId}".`);
    const distinct = r.boundary.filter((p, i, arr) => arr.findIndex((q) => pointsEqual(p, q)) === i);
    if (distinct.length < 3) {
      push("error", "ROOM_TOO_FEW_POINTS", [r.id], `${label} needs at least 3 distinct boundary points.`);
      continue;
    }
    if (polygonArea(r.boundary) < MIN_ROOM_AREA_SQ_IN && allCollinear(distinct)) {
      push("error", "ROOM_ZERO_AREA", [r.id], `${label} has zero area.`);
      continue;
    }
    // (a symmetric bowtie also has ~zero signed area; it is reported as self-intersecting)
    if (!isSimplePolygon(r.boundary)) {
      push("error", "ROOM_SELF_INTERSECTING", [r.id], `${label} boundary crosses itself.`);
      continue;
    }
    validRooms.push({ id: r.id, floorId: r.floorId, pts: r.boundary, bb: boundingBox(r.boundary) });
    if (r.conditioned !== false && floorIds.has(r.floorId) && computeRoomMetrics(model, r.id).exposures.length === 0)
      push("info", "ROOM_NO_EXPOSURE", [r.id], `${label} has no exterior or unconditioned walls along its boundary.`);
  }
  // Overlap: sort-and-sweep on bbox minX, per floor.
  validRooms.sort((a, b) => a.bb.minX - b.bb.minX);
  for (let i = 0; i < validRooms.length; i++) {
    const a = validRooms[i]!;
    for (let j = i + 1; j < validRooms.length; j++) {
      const b = validRooms[j]!;
      if (b.bb.minX >= a.bb.maxX) break;
      if (a.floorId !== b.floorId || b.bb.minY >= a.bb.maxY || a.bb.minY >= b.bb.maxY) continue;
      if (polygonsOverlap(a.pts, b.pts)) {
        const ids = [a.id, b.id].sort();
        push("error", "ROOMS_OVERLAP", ids, `Rooms ${ids[0]} and ${ids[1]} overlap.`);
      }
    }
  }
  return issues;
}

export const hasErrors = (issues: ValidationIssue[]): boolean => issues.some((i) => i.severity === "error");

function allCollinear(pts: { x: number; y: number }[]): boolean {
  const a = pts[0]!;
  let far = pts[1]!;
  for (const p of pts) if (dist(a, p) > dist(a, far)) far = p;
  const l = dist(a, far);
  if (l < EPS) return true;
  // max perpendicular distance < 1/64" counts as a line
  return pts.every((p) => Math.abs(cross(sub(far, a), sub(p, a))) / l < 1 / 64);
}
