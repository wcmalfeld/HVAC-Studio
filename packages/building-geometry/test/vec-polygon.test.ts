import { describe, expect, it } from "vitest";
import {
  add, sub, scale, dot, cross, length, dist, normalize, lerp, rotatePoint, pointsEqual, projectPointOnSegment,
  polygonSignedArea, polygonArea, polygonPerimeter, normalizeCCW, centroid, pointInPolygon, isSimplePolygon,
  polygonsOverlap, boundingBox, rectangleBoundary, intersectionArea,
} from "../src";

const P = (x: number, y: number) => ({ x, y });

describe("vec", () => {
  it("basics", () => {
    expect(add(P(1, 2), P(3, 4))).toEqual(P(4, 6));
    expect(sub(P(1, 2), P(3, 4))).toEqual(P(-2, -2));
    expect(scale(P(1, 2), 3)).toEqual(P(3, 6));
    expect(dot(P(1, 2), P(3, 4))).toBe(11);
    expect(cross(P(1, 0), P(0, 1))).toBe(1);
    expect(length(P(3, 4))).toBe(5);
    expect(dist(P(1, 1), P(4, 5))).toBe(5);
    expect(normalize(P(0, 5))).toEqual(P(0, 1));
    expect(normalize(P(0, 0))).toEqual(P(0, 0));
    expect(lerp(P(0, 0), P(10, 20), 0.25)).toEqual(P(2.5, 5));
  });
  it("rotatePoint is CCW positive", () => {
    const r = rotatePoint(P(2, 1), P(1, 1), 90);
    expect(pointsEqual(r, P(1, 2))).toBe(true);
    expect(pointsEqual(rotatePoint(P(2, 1), P(1, 1), -90), P(1, 0))).toBe(true);
  });
  it("pointsEqual tolerance", () => {
    expect(pointsEqual(P(0, 0), P(5e-7, 0))).toBe(true);
    expect(pointsEqual(P(0, 0), P(2e-6, 0))).toBe(false);
    expect(pointsEqual(P(0, 0), P(0.4, 0), 0.5)).toBe(true);
  });
  it("projectPointOnSegment clamps", () => {
    expect(projectPointOnSegment(P(5, 3), P(0, 0), P(10, 0))).toEqual({ point: P(5, 0), t: 0.5, distance: 3 });
    const r = projectPointOnSegment(P(-3, 4), P(0, 0), P(10, 0));
    expect(r.t).toBe(0);
    expect(r.distance).toBe(5);
  });
});

describe("polygon", () => {
  const rect = rectangleBoundary(P(0, 0), 120, 60); // 10' x 5' = 7200 sq in
  // L-shape: 20'x10' bottom + 10'x10' top-left => 200 + 100 = 300 ft² = 43200 sq in
  const L = [P(0, 0), P(240, 0), P(240, 120), P(120, 120), P(120, 240), P(0, 240)];
  it("rectangleBoundary is CCW from origin", () => {
    expect(rect).toEqual([P(0, 0), P(120, 0), P(120, 60), P(0, 60)]);
    expect(polygonSignedArea(rect)).toBe(7200);
  });
  it("shoelace sign: CW negative", () => {
    expect(polygonSignedArea([...rect].reverse())).toBe(-7200);
    expect(polygonArea([...rect].reverse())).toBe(7200);
  });
  it("L-shape area / perimeter / centroid", () => {
    expect(polygonArea(L)).toBe(43200);
    expect(polygonPerimeter(L)).toBe(960); // 240+120+120+120+120+240
    // centroid: bottom 240x120 (c=120,60, A=28800) + top 120x120 (c=60,180, A=14400) => (100, 100)
    const c = centroid(L);
    expect(c.x).toBeCloseTo(100, 9);
    expect(c.y).toBeCloseTo(100, 9);
  });
  it("normalizeCCW", () => {
    const cw = [...L].reverse();
    expect(polygonSignedArea(normalizeCCW(cw))).toBe(43200);
    expect(normalizeCCW(L)).toEqual(L);
  });
  it("pointInPolygon", () => {
    expect(pointInPolygon(P(60, 60), L)).toBe(true);
    expect(pointInPolygon(P(200, 200), L)).toBe(false); // notch of the L
    expect(pointInPolygon(P(-1, 5), L)).toBe(false);
  });
  it("isSimplePolygon", () => {
    expect(isSimplePolygon(L)).toBe(true);
    expect(isSimplePolygon([P(0, 0), P(10, 10), P(10, 0), P(0, 10)])).toBe(false); // bowtie
    expect(isSimplePolygon([P(0, 0), P(10, 0)])).toBe(false);
    expect(isSimplePolygon([P(0, 0), P(10, 0), P(20, 0)])).toBe(false); // zero area
    // vertex touching another edge
    expect(isSimplePolygon([P(0, 0), P(20, 0), P(20, 20), P(10, 0), P(0, 20)])).toBe(false);
    // collinear vertex mid-edge is fine
    expect(isSimplePolygon([P(0, 0), P(5, 0), P(10, 0), P(10, 10), P(0, 10)])).toBe(true);
    // spike folding back on itself
    expect(isSimplePolygon([P(0, 0), P(10, 0), P(10, 10), P(10, 5), P(0, 10)])).toBe(false);
  });
  it("polygonsOverlap: shared edge / touching corner do not count, true overlap does", () => {
    const a = rectangleBoundary(P(0, 0), 100, 100);
    expect(polygonsOverlap(a, rectangleBoundary(P(100, 0), 100, 100))).toBe(false);
    expect(polygonsOverlap(a, rectangleBoundary(P(100, 100), 50, 50))).toBe(false);
    expect(polygonsOverlap(a, rectangleBoundary(P(90, 10), 100, 50))).toBe(true);
    expect(intersectionArea(a, rectangleBoundary(P(90, 10), 100, 50))).toBeCloseTo(500, 6); // 10 x 50
    expect(polygonsOverlap(a, rectangleBoundary(P(20, 20), 10, 10))).toBe(true); // containment
    // concave: rect sitting in the notch of the L does not overlap
    expect(polygonsOverlap(L, rectangleBoundary(P(120, 120), 120, 120))).toBe(false);
    expect(intersectionArea(L, rectangleBoundary(P(100, 100), 40, 40))).toBeCloseTo(1600 - 400, 6);
  });
  it("boundingBox", () => {
    expect(boundingBox(L)).toEqual({ minX: 0, minY: 0, maxX: 240, maxY: 240, width: 240, height: 240 });
  });
});
