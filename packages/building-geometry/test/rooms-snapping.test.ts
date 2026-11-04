import { describe, expect, it } from "vitest";
import {
  autoWallsForRoom, collectSnapPoints, newId, polygonArea, polygonSignedArea, roomFromWalls, snapAngle,
  snapToGrid, snapToPoints, snapToWall, computeRoomMetrics, validateModel,
} from "../src";
import { mkModel, mkRoom, mkWall, rectWalls } from "./helpers";

const P = (x: number, y: number) => ({ x, y });
const sorted = (pts: { x: number; y: number }[]) => [...pts].map((p) => `${p.x},${p.y}`).sort();

describe("roomFromWalls", () => {
  // 20' x 10' rectangle split by an interior wall at x = 120 (T-junctions at both ends, wall not split in model)
  const split = mkModel({ walls: [...rectWalls("x", 0, 0, 240, 120), mkWall("i", [120, 0], [120, 120], { kind: "interior", adjacentSpace: "conditioned" })] });
  it("finds the left and right rooms of a split rectangle", () => {
    const left = roomFromWalls(split, "floor-1", P(60, 60))!;
    const right = roomFromWalls(split, "floor-1", P(180, 60))!;
    expect(sorted(left)).toEqual(sorted([P(0, 0), P(120, 0), P(120, 120), P(0, 120)]));
    expect(sorted(right)).toEqual(sorted([P(120, 0), P(240, 0), P(240, 120), P(120, 120)]));
    expect(polygonSignedArea(left)).toBe(14400); // CCW, 10'x10'
    expect(polygonSignedArea(right)).toBe(14400);
  });
  it("returns null outside / on other floors / without loops", () => {
    expect(roomFromWalls(split, "floor-1", P(300, 60))).toBeNull();
    expect(roomFromWalls(split, "floor-2", P(60, 60))).toBeNull();
    const open = mkModel({ walls: rectWalls("x", 0, 0, 240, 120).slice(0, 3) });
    expect(roomFromWalls(open, "floor-1", P(60, 60))).toBeNull();
  });
  it("L-shape drawn as 6 walls, plus a dangling stub that is pruned", () => {
    const L = [P(0, 0), P(240, 0), P(240, 120), P(120, 120), P(120, 240), P(0, 240)];
    const walls = L.map((a, i) => mkWall(`w${i}`, [a.x, a.y], [L[(i + 1) % 6]!.x, L[(i + 1) % 6]!.y]));
    walls.push(mkWall("stub", [60, 60], [60, 100])); // free-standing, ignored
    walls.push(mkWall("spur", [240, 60], [300, 60])); // dangling off the outside
    const r = roomFromWalls(mkModel({ walls }), "floor-1", P(30, 200))!;
    expect(r).toHaveLength(6);
    expect(polygonSignedArea(r)).toBe(43200); // 300 ft²
    expect(roomFromWalls(mkModel({ walls }), "floor-1", P(200, 200))).toBeNull(); // in the notch
  });
  it("handles crossing walls (+ shape) and walls whose ends overshoot slightly", () => {
    const walls = [
      ...rectWalls("x", 0, 0, 200, 200),
      mkWall("h", [-0.5, 100], [200.5, 100], { kind: "interior", adjacentSpace: "conditioned" }),
      mkWall("v", [100, 0], [100, 200], { kind: "interior", adjacentSpace: "conditioned" }),
    ];
    const r = roomFromWalls(mkModel({ walls }), "floor-1", P(150, 150))!;
    expect(polygonArea(r)).toBeCloseTo(10000, 6);
    expect(r).toHaveLength(4);
  });
});

describe("autoWallsForRoom", () => {
  it("creates a wall per edge with spec'd defaults, and a room+walls model validates & has exposure", () => {
    const b = [P(0, 120), P(120, 120), P(120, 0), P(0, 0)]; // CW input
    const walls = autoWallsForRoom(b, "floor-1", { thickness: 5.5, height: 96, kind: "exterior" });
    expect(walls).toHaveLength(4);
    expect(new Set(walls.map((w) => w.id)).size).toBe(4);
    for (const w of walls) {
      expect(w.id).toMatch(/^wall-[0-9a-z]{12}$/);
      expect(w).toMatchObject({ floorId: "floor-1", thickness: 5.5, height: 96, kind: "exterior", adjacentSpace: "outdoors", provenance: { source: "user" } });
      expect(w.assembly).toEqual({ constructionType: null, insulation: null, rValue: null, uFactor: null });
    }
    const m = mkModel({ walls, rooms: [mkRoom("r", b)] });
    expect(computeRoomMetrics(m, "r").exteriorWallLengthFt).toBe(40);
    expect(validateModel(m).every((i) => i.code === "EXTERIOR_WALL_MISSING_R_OR_U")).toBe(true);
    const interior = autoWallsForRoom(b, "floor-1", { thickness: 4.5, height: 96, kind: "interior" });
    expect(interior.every((w) => w.adjacentSpace === "conditioned" && w.kind === "interior")).toBe(true);
  });
});

describe("snapping", () => {
  it("snapToGrid", () => {
    expect(snapToGrid(P(13, -5), 6)).toEqual(P(12, -6));
    expect(snapToGrid(P(-1, 1), 12)).toEqual(P(0, 0));
    expect(snapToGrid(P(3.3, 4.4), 0)).toEqual(P(3.3, 4.4));
  });
  it("snapAngle keeps length, rounds direction", () => {
    expect(snapAngle(P(0, 0), P(100, 3))).toEqual(P(Math.hypot(100, 3), 0));
    const s = snapAngle(P(10, 10), P(20, 20.5));
    expect(s.x - 10).toBeCloseTo(s.y - 10, 9); // 45°
    expect(snapAngle(P(0, 0), P(-3, 100))).toEqual(P(0, Math.hypot(3, 100)));
    expect(snapAngle(P(0, 0), P(100, 30), 90)).toEqual(P(Math.hypot(100, 30), 0));
  });
  it("collectSnapPoints: endpoints, midpoints, room vertices, deduped, floor-filtered", () => {
    const m = mkModel({
      walls: [mkWall("a", [0, 0], [100, 0]), mkWall("b", [100, 0], [100, 100]), mkWall("z", [500, 500], [600, 500], { floorId: "floor-2" })],
      rooms: [mkRoom("r", [P(0, 0), P(100, 0), P(100, 100), P(0, 100)])],
    });
    expect(sorted(collectSnapPoints(m, "floor-1"))).toEqual(sorted([P(0, 0), P(100, 0), P(50, 0), P(100, 100), P(100, 50), P(0, 100)]));
  });
  it("snapToPoints picks nearest within tolerance", () => {
    const c = [P(0, 0), P(10, 0)];
    expect(snapToPoints(P(7, 1), c, 4)).toEqual({ point: P(10, 0), snapped: true });
    expect(snapToPoints(P(5, 5), c, 4)).toEqual({ point: P(5, 5), snapped: false });
  });
  it("snapToWall returns nearest wall and offset from wall.start", () => {
    const walls = [mkWall("a", [0, 0], [120, 0]), mkWall("b", [120, 120], [120, 0])];
    expect(snapToWall(P(30, 4), walls, 6)).toEqual({ wallId: "a", offset: 30, point: P(30, 0) });
    expect(snapToWall(P(117, 100), walls, 6)).toEqual({ wallId: "b", offset: 20, point: P(120, 100) });
    expect(snapToWall(P(60, 60), walls, 6)).toBeNull();
  });
});

describe("newId", () => {
  it("format and uniqueness", () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newId("room")));
    expect(ids.size).toBe(5000);
    for (const id of [...ids].slice(0, 50)) expect(id).toMatch(/^room-[0-9a-z]{12}$/);
  });
});
