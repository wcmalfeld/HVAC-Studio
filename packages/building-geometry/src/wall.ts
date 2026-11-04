import type { Opening, Point, Wall } from "@hvac/shared-types";
import { dist, lerp, normalize, sub } from "./vec";

export type CompassLabel = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export const wallLength = (w: Wall): number => dist(w.start, w.end);

/** Unit vector start -> end ({0,0} for a zero-length wall). */
export const wallDirection = (w: Wall): Point => normalize(sub(w.end, w.start));

/**
 * Compass azimuth (0 = N, 90 = E, clockwise, in [0, 360)) of a plan direction.
 * `northAngleDeg` is the clockwise angle from plan +y ("up") to true north (BuildingModel.northAngleDeg).
 * The direction's clockwise bearing from plan +y is atan2(x, y); subtracting the north angle gives the
 * bearing from true north. E.g. north = 90 (north is plan +x): plan +y -> 270 (W), plan +x -> 0 (N).
 */
export function compassAzimuth(planDirection: Point, northAngleDeg: number): number {
  const bearingFromPlanUp = (Math.atan2(planDirection.x, planDirection.y) * 180) / Math.PI;
  let az = (bearingFromPlanUp - northAngleDeg) % 360;
  if (az < 0) az += 360;
  // Snap tiny float noise so e.g. 359.9999999999 reports as 0.
  if (Math.abs(az - Math.round(az)) < 1e-9) az = Math.round(az) % 360;
  return az;
}

const LABELS: CompassLabel[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** 8-point label; each sector is 45° wide centred on its direction (N = [337.5, 22.5)). */
export function compassLabel(azimuthDeg: number): CompassLabel {
  const a = ((azimuthDeg % 360) + 360) % 360;
  return LABELS[Math.floor((a + 22.5) / 45) % 8]!;
}

/**
 * Plan extent of an opening on its wall. `offset` is measured from wall.start to the opening centre;
 * startOffset/endOffset are offset ∓ width/2 (not clamped — validation reports out-of-wall openings).
 */
export function openingSpan(o: Opening, w: Wall): { start: Point; end: Point; startOffset: number; endOffset: number } {
  const len = wallLength(w);
  const startOffset = o.offset - o.width / 2;
  const endOffset = o.offset + o.width / 2;
  const at = (s: number) => (len > 0 ? lerp(w.start, w.end, s / len) : { ...w.start });
  return { start: at(startOffset), end: at(endOffset), startOffset, endOffset };
}
