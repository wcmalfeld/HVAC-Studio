import { describe, expect, it } from "vitest";
import { formatArea, formatLength, formatVolume, parseLength, sqInToSqFt, cuInToCuFt, INCHES_PER_METER } from "../src";

describe("formatLength imperial", () => {
  it.each([
    [150.5, `12' 6 1/2"`],
    [8, `8"`],
    [144, `12'`],
    [0, `0"`],
    [0.5, `1/2"`],
    [12.0625, `1' 1/16"`],
    [150.03, `12' 6"`], // 0.03" rounds to 0/16
    [143.99, `12'`], // rounds up into the next foot (carry)
    [-18, `-1' 6"`],
    [6.75, `6 3/4"`],
  ])("%s in -> %s", (v, s) => expect(formatLength(v, "imperial")).toBe(s));
  it("honours fractionDenominator", () => {
    expect(formatLength(150.5625, "imperial", { fractionDenominator: 4 })).toBe(`12' 6 1/2"`); // 6.5625 -> nearest 1/4 = 6.5
    expect(formatLength(6.3, "imperial", { fractionDenominator: 2 })).toBe(`6 1/2"`);
  });
});

describe("formatLength metric", () => {
  it("metres with 3 decimals by default", () => {
    // 150.5 in * 0.0254 = 3.8227 m
    expect(formatLength(150.5, "metric")).toBe("3.823 m");
    expect(formatLength(150.5, "metric", { decimals: 1 })).toBe("3.8 m");
  });
  it("under 1 m in mm", () => {
    expect(formatLength(450 / 25.4, "metric")).toBe("450 mm");
    expect(formatLength(0, "metric")).toBe("0 mm");
    expect(formatLength(INCHES_PER_METER, "metric")).toBe("1.000 m");
  });
});

describe("parseLength", () => {
  it.each([
    [`12'`, 144], [`12'6"`, 150], [`12' 6"`, 150], [`12' 6 1/2"`, 150.5], [`12-6`, 150], [`12-6 1/2`, 150.5],
    [`150"`, 150], [`150 in`, 150], [`12.5 ft`, 150], [`12.5`, 150], [`6"`, 6], [`1/2"`, 0.5], [` 12 ft 6 in `, 150],
    [`12'6`, 150], [`0`, 0],
  ])("imperial %s -> %s in", (t, v) => expect(parseLength(t, "imperial")).toBeCloseTo(v, 9));
  it.each([
    [`3.8m`, 3.8 * INCHES_PER_METER], [`380cm`, 3.8 * INCHES_PER_METER], [`3800mm`, 3.8 * INCHES_PER_METER],
    [`3.8`, 3.8 * INCHES_PER_METER], [`150"`, 150],
  ])("metric %s", (t, v) => expect(parseLength(t, "metric")).toBeCloseTo(v, 9));
  it("metric suffixes work in imperial too", () => expect(parseLength("1 m", "imperial")).toBeCloseTo(39.37007874, 6));
  it.each(["", "abc", "-5", "-5'", "12'x", "1/0\"", "12 6", "'", "\""])("invalid %j -> null", (t) => expect(parseLength(t, "imperial")).toBeNull());
  it("round trips format -> parse at 1/16 resolution", () => {
    for (let sixteenths = 0; sixteenths < 16 * 12 * 50; sixteenths += 7) {
      const v = sixteenths / 16;
      expect(parseLength(formatLength(v, "imperial"), "imperial")).toBe(v);
    }
  });
  it("metric round trip within 0.5 mm", () => {
    for (const v of [10, 39.37, 100, 150.5, 1000]) {
      expect(Math.abs(parseLength(formatLength(v, "metric"), "metric")! - v)).toBeLessThan(0.5 / 25.4 + 1e-9);
    }
  });
});

describe("area / volume", () => {
  it("formats", () => {
    expect(formatArea(150 * 144, "imperial")).toBe("150.0 ft²");
    expect(formatArea(150 * 144, "metric")).toBe("13.94 m²"); // 150 ft² * 0.09290304 = 13.935
    expect(formatVolume(1200 * 1728, "imperial")).toBe("1200.0 ft³");
    expect(formatVolume(1200 * 1728, "metric")).toBe("33.98 m³"); // 1200 * 0.0283168 = 33.98
    expect(sqInToSqFt(288)).toBe(2);
    expect(cuInToCuFt(1728 * 3)).toBe(3);
  });
});
