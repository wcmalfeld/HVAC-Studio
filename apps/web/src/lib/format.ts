/**
 * Display helpers on top of @hvac/building-geometry formatters: adds digit grouping
 * ("2,300.0 ft²") so large areas/volumes are readable. Values are unchanged.
 */
import { formatArea as gArea, formatVolume as gVolume, type UnitSystem } from "@hvac/building-geometry";

export function groupDigits(s: string): string {
  return s.replace(/\d{4,}(?=(\.\d+)?\b)/g, (m) => Number(m).toLocaleString("en-US"));
}
export const formatArea = (sqIn: number, units: UnitSystem, decimals?: number) => groupDigits(gArea(sqIn, units, decimals));
export const formatVolume = (cuIn: number, units: UnitSystem, decimals?: number) => groupDigits(gVolume(cuIn, units, decimals));
