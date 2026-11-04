/**
 * Unit conversion, formatting and parsing.
 * Canonical length unit is the inch; metric is a display concern only (ADR-001).
 */
export const INCHES_PER_FOOT = 12;
export const INCHES_PER_METER = 39.37007874015748; // 1 / 0.0254
export const SQ_IN_PER_SQ_FT = 144;
export const CU_IN_PER_CU_FT = 1728;
export type UnitSystem = "imperial" | "metric";

export const sqInToSqFt = (v: number): number => v / SQ_IN_PER_SQ_FT;
export const cuInToCuFt = (v: number): number => v / CU_IN_PER_CU_FT;
export const inToFt = (v: number): number => v / INCHES_PER_FOOT;
export const inToM = (v: number): number => v / INCHES_PER_METER;
export const mToIn = (v: number): number => v * INCHES_PER_METER;

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Format a length (inches).
 * imperial: `12' 6 1/2"`, rounded to 1/fractionDenominator inch (default 1/16). Zero parts are dropped:
 *   `8"` (not `0' 8"`), `12'` (not `12' 0"`), `0"` for zero.
 * metric: `3.823 m` (decimals default 3); lengths under 1 m are shown as whole millimetres (`450 mm`).
 * Negative values get a leading "-".
 */
export function formatLength(
  inches: number,
  units: UnitSystem,
  opts: { fractionDenominator?: 2 | 4 | 8 | 16; decimals?: number } = {},
): string {
  if (!Number.isFinite(inches)) return "—";
  const sign = inches < 0 ? "-" : "";
  const abs = Math.abs(inches);
  if (units === "metric") {
    const m = inToM(abs);
    const mmRounded = Math.round(m * 1000);
    if (mmRounded < 1000) return mmRounded === 0 ? "0 mm" : `${sign}${mmRounded} mm`;
    return `${sign}${m.toFixed(opts.decimals ?? 3)} m`;
  }
  const den = opts.fractionDenominator ?? 16;
  const units16 = Math.round(abs * den); // total length in 1/den inch
  if (units16 === 0) return `0"`;
  const perFoot = INCHES_PER_FOOT * den;
  const feet = Math.floor(units16 / perFoot);
  const remUnits = units16 - feet * perFoot;
  const wholeIn = Math.floor(remUnits / den);
  let num = remUnits - wholeIn * den;
  let d = den;
  if (num > 0) {
    const g = gcd(num, d);
    num /= g;
    d /= g;
  }
  let inchStr = "";
  if (remUnits > 0) {
    if (wholeIn > 0 && num > 0) inchStr = `${wholeIn} ${num}/${d}"`;
    else if (num > 0) inchStr = `${num}/${d}"`;
    else inchStr = `${wholeIn}"`;
  }
  if (feet === 0) return `${sign}${inchStr}`;
  if (!inchStr) return `${sign}${feet}'`;
  return `${sign}${feet}' ${inchStr}`;
}

const NUM = String.raw`(?:\d+(?:\.\d*)?|\.\d+)`;
const METRIC_RE = new RegExp(String.raw`^(${NUM})\s*(mm|cm|m)$`);
const DASH_RE = new RegExp(String.raw`^(\d+)\s*-\s*(${NUM})(?:\s+(\d+)\/(\d+))?\s*(?:"|in|in\.|inch|inches)?$`);
const FTIN_RE = new RegExp(
  String.raw`^(?:(${NUM})\s*(?:'|ft\.?|feet|foot)\s*)?` + // feet
    String.raw`(?:(${NUM})(?:\s+(\d+)\/(\d+))?|(\d+)\/(\d+))?` + // inches: whole [frac] | frac
    String.raw`\s*("|''|in\.?|inch|inches)?$`,
);

/**
 * Parse user-entered length text and return inches, or null if invalid/negative.
 * Accepts: 12' | 12'6" | 12' 6" | 12' 6 1/2" | 12-6 | 12-6 1/2 | 150" | 150 in | 12.5 ft | 6 1/2" |
 *          3.8m | 380cm | 3800mm (metric suffixes accepted in either unit system).
 * A bare number is feet in imperial and metres in metric.
 */
export function parseLength(text: string, units: UnitSystem): number | null {
  const s = text.trim().toLowerCase().replace(/[’′]/g, "'").replace(/[”″“]/g, '"').replace(/\s+/g, " ");
  if (!s || s.startsWith("-")) return null;
  let m = METRIC_RE.exec(s);
  if (m) {
    const v = Number(m[1]);
    const factor = m[2] === "mm" ? 0.001 : m[2] === "cm" ? 0.01 : 1;
    return finiteNonNeg(mToIn(v * factor));
  }
  m = DASH_RE.exec(s);
  if (m) {
    const frac = fraction(m[3], m[4]);
    if (frac === null) return null;
    return finiteNonNeg(Number(m[1]) * INCHES_PER_FOOT + Number(m[2]) + frac);
  }
  m = FTIN_RE.exec(s);
  if (m) {
    const [, ft, inWhole, fNum, fDen, onlyNum, onlyDen, inMark] = m;
    if (ft === undefined && inWhole === undefined && onlyNum === undefined) return null;
    let inches = 0;
    if (inWhole !== undefined) {
      const frac = fraction(fNum, fDen);
      if (frac === null) return null;
      inches = Number(inWhole) + frac;
    } else if (onlyNum !== undefined) {
      const frac = fraction(onlyNum, onlyDen);
      if (frac === null) return null;
      inches = frac;
    }
    // Bare number (no feet mark, no inch mark): feet (imperial) or metres (metric).
    if (ft === undefined && inMark === undefined) {
      // (a unitless "6 1/2" follows the same rule: 6.5 ft / 6.5 m)
      return finiteNonNeg(units === "metric" ? mToIn(inches) : inches * INCHES_PER_FOOT);
    }
    return finiteNonNeg((ft !== undefined ? Number(ft) * INCHES_PER_FOOT : 0) + inches);
  }
  return null;
}

function fraction(num: string | undefined, den: string | undefined): number | null {
  if (num === undefined || den === undefined) return 0;
  const d = Number(den);
  if (d === 0) return null;
  return Number(num) / d;
}

function finiteNonNeg(v: number): number | null {
  return Number.isFinite(v) && v >= 0 ? v : null;
}

/** "150.0 ft²" (imperial, default 1 decimal) | "13.94 m²" (metric, default 2 decimals). */
export function formatArea(squareInches: number, units: UnitSystem, decimals?: number): string {
  if (units === "metric") return `${(squareInches / INCHES_PER_METER ** 2).toFixed(decimals ?? 2)} m²`;
  return `${sqInToSqFt(squareInches).toFixed(decimals ?? 1)} ft²`;
}

/** "1200.0 ft³" (imperial, default 1 decimal) | "33.98 m³" (metric, default 2 decimals). */
export function formatVolume(cubicInches: number, units: UnitSystem, decimals?: number): string {
  if (units === "metric") return `${(cubicInches / INCHES_PER_METER ** 3).toFixed(decimals ?? 2)} m³`;
  return `${cuInToCuFt(cubicInches).toFixed(decimals ?? 1)} ft³`;
}
