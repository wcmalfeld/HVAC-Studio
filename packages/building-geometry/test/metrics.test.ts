import { describe, expect, it } from "vitest";
import { BuildingModel as BuildingModelSchema } from "@hvac/shared-types";
import {
  compassAzimuth, compassLabel, computeBuildingSummary, computeFloorSummary, computeRoomMetrics, openingSpan,
  validateModel, wallDirection, wallLength, type RoomMetrics,
} from "../src";
import { loadSample, mkModel, mkRoom, mkWall, mkWindow, rectWalls, SAMPLE_PATH } from "./helpers";
import { readFileSync } from "node:fs";

const byDir = (m: RoomMetrics) => {
  const out: Record<string, { len: number; gross: number; win: number; door: number }> = {};
  for (const e of m.exposures) {
    const o = (out[e.direction] ??= { len: 0, gross: 0, win: 0, door: 0 });
    o.len += e.lengthFt; o.gross += e.grossAreaSqFt; o.win += e.windowAreaSqFt; o.door += e.doorAreaSqFt;
  }
  return out;
};

describe("wall helpers", () => {
  it("length / direction / openingSpan", () => {
    const w = mkWall("w", [0, 0], [0, 120]);
    expect(wallLength(w)).toBe(120);
    expect(wallDirection(w)).toEqual({ x: 0, y: 1 });
    const s = openingSpan(mkWindow("o", "w", 60, 36, 48), w);
    expect(s).toEqual({ start: { x: 0, y: 42 }, end: { x: 0, y: 78 }, startOffset: 42, endOffset: 78 });
  });
});

describe("compass", () => {
  it("north angle 0: +y is N, +x is E", () => {
    expect(compassAzimuth({ x: 0, y: 1 }, 0)).toBe(0);
    expect(compassAzimuth({ x: 1, y: 0 }, 0)).toBe(90);
    expect(compassAzimuth({ x: 0, y: -1 }, 0)).toBe(180);
    expect(compassAzimuth({ x: -1, y: 0 }, 0)).toBe(270);
    expect(compassAzimuth({ x: 1, y: 1 }, 0)).toBeCloseTo(45, 9);
  });
  it("north angle 90 (true north = plan +x): +y -> W, +x -> N, -y -> E, -x -> S", () => {
    expect(compassAzimuth({ x: 0, y: 1 }, 90)).toBe(270);
    expect(compassAzimuth({ x: 1, y: 0 }, 90)).toBe(0);
    expect(compassAzimuth({ x: 0, y: -1 }, 90)).toBe(90);
    expect(compassAzimuth({ x: -1, y: 0 }, 90)).toBe(180);
  });
  it("north angle 30: plan +y is 330 (NW)", () => {
    expect(compassAzimuth({ x: 0, y: 1 }, 30)).toBeCloseTo(330, 9);
    expect(compassLabel(330)).toBe("NW");
  });
  it("labels", () => {
    expect([0, 22.4, 22.5, 90, 135, 180, 225, 270, 315, 337.5, 359.9, -45, 720].map(compassLabel)).toEqual(
      ["N", "N", "NE", "E", "SE", "S", "SW", "W", "NW", "N", "N", "NW", "N"],
    );
  });
});

describe("association rules", () => {
  const room = mkRoom("r", [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 120 }, { x: 0, y: 120 }]);
  it("boundary on inside face of wall still associates (distance <= t/2 + 1)", () => {
    // room edge y=0; wall centerline at y=-3.25 => 3.25 <= 2.25 + 1
    const m = computeRoomMetrics(mkModel({ rooms: [room], walls: [mkWall("w", [0, -3.25], [120, -3.25])] }), "r");
    expect(m.exposures).toHaveLength(1);
    const far = computeRoomMetrics(mkModel({ rooms: [room], walls: [mkWall("w", [0, -3.3], [120, -3.3])] }), "r");
    expect(far.exposures).toHaveLength(0);
  });
  it("angle tolerance 0.5°", () => {
    const d = (deg: number) => 120 * Math.tan((deg * Math.PI) / 180);
    const ok = computeRoomMetrics(mkModel({ rooms: [room], walls: [mkWall("w", [0, 0], [120, d(0.4)])] }), "r");
    expect(ok.exposures).toHaveLength(1);
    const bad = computeRoomMetrics(mkModel({ rooms: [room], walls: [mkWall("w", [0, 0], [120, d(0.6)])] }), "r");
    expect(bad.exposures).toHaveLength(0);
  });
  it("overlap must exceed 1 inch and length = overlap", () => {
    const touching = computeRoomMetrics(mkModel({ rooms: [room], walls: [mkWall("w", [119, 0], [300, 0])] }), "r");
    expect(touching.exposures).toHaveLength(0); // overlap exactly 1"
    const partial = computeRoomMetrics(mkModel({ rooms: [room], walls: [mkWall("w", [60, 0], [300, 0])] }), "r");
    expect(partial.exteriorWallLengthFt).toBe(5); // 60" overlap
    expect(partial.grossExteriorWallAreaSqFt).toBe(40); // 5' x 8'
  });
  it("interior conditioned walls are not exposures; interior wall to garage is", () => {
    const m = computeRoomMetrics(mkModel({ rooms: [room], walls: [
      mkWall("a", [0, 0], [120, 0], { kind: "interior", adjacentSpace: "conditioned" }),
      mkWall("b", [120, 0], [120, 120], { kind: "interior", adjacentSpace: "garage" }),
    ] }), "r");
    expect(m.exposures.map((e) => [e.wallId, e.direction, e.adjacentSpace])).toEqual([["b", "E", "garage"]]);
  });
  it("opening counts only for the overlapping portion; wall height caps gross area", () => {
    // wall spans x 0..240, room spans 0..120; window centred at 120, 48 wide => 24" inside the room
    const m = computeRoomMetrics(mkModel({
      rooms: [room], walls: [mkWall("w", [0, 0], [240, 0], { height: 84 })],
      openings: [mkWindow("o", "w", 120, 48, 36, 36)],
    }), "r");
    expect(m.windowAreaSqFt).toBe(6); // 24 * 36 / 144
    expect(m.grossExteriorWallAreaSqFt).toBe(70); // 120 * min(96,84) / 144
    expect(m.netExteriorWallAreaSqFt).toBe(64);
  });
  it("room.ceilingHeight overrides floor default; reversed wall direction and CW room still work", () => {
    const cw = mkRoom("r", [...room.boundary].reverse(), { ceilingHeight: 108 });
    const m = computeRoomMetrics(mkModel({ rooms: [cw], walls: [mkWall("w", [120, 0], [0, 0], { height: 120 })] }), "r");
    expect(m.ceilingHeightIn).toBe(108);
    expect(m.volumeCuFt).toBe(100 * 9);
    expect(m.exposures[0]!.direction).toBe("S");
    expect(m.grossExteriorWallAreaSqFt).toBe(90); // 10' x 9'
  });
  it("north rotation changes exposure direction", () => {
    const walls = rectWalls("x", 0, 0, 120, 120);
    const m = computeRoomMetrics(mkModel({ northAngleDeg: 90, rooms: [room], walls }), "r");
    const d = byDir(m);
    // edges: south(-y)->E, east(+x)->N, north(+y)->W, west(-x)->S
    expect(Object.keys(d).sort()).toEqual(["E", "N", "S", "W"]);
    const top = m.exposures.find((e) => e.wallId === "x-n")!;
    expect(top.azimuthDeg).toBe(270);
    expect(top.direction).toBe("W");
    const m45 = computeRoomMetrics(mkModel({ northAngleDeg: 45, rooms: [room], walls }), "r");
    expect(m45.exposures.find((e) => e.wallId === "x-n")!.direction).toBe("NW"); // 0 - 45 = 315
  });
  it("throws on unknown room", () => {
    expect(() => computeRoomMetrics(mkModel(), "nope")).toThrow();
  });
});

describe("sample house (hand-computed)", () => {
  const model = loadSample();
  it("parses with the Zod schema and has zero validation issues of any severity", () => {
    expect(() => BuildingModelSchema.parse(JSON.parse(readFileSync(SAMPLE_PATH, "utf8")))).not.toThrow();
    const issues = validateModel(model);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(issues).toEqual([]);
  });

  // [area ft², volume ft³, {dir: [len ft, gross ft², window ft², door ft²]}, net ft²]
  // All ceilings 96" (8'), wall heights 96". Window sizes: see fixture; e.g. 72x60 = 30 ft², 48x60 = 20, 48x36 = 12,
  // 36x36 = 9, 72x48 = 24, 48x48 = 16, 36x48 = 12, 24x36 = 6; doors 36x80 = 20 ft².
  const expected: Record<string, [number, number, Record<string, [number, number, number, number]>, number]> = {
    // First floor 40' x 35' (480" x 420"), north angle 0.
    // Living 0..240 x 180..420 = 20'x20' = 400 ft². W: 20' (living-w 20 ft²), N: 20' (living-n 30 ft²). net 320-50
    "f1-living": [400, 3200, { W: [20, 160, 20, 0], N: [20, 160, 30, 0] }, 270],
    // Kitchen 240..480 x 240..420 = 20'x15' = 300 ft². N 20' (kitchen-n 12, back door 20), E 15' (kitchen-e 9). 280-41
    "f1-kitchen": [300, 2400, { N: [20, 160, 12, 20], E: [15, 120, 9, 0] }, 239],
    // Dining 240..480 x 0..240 = 20'x20'. S 20' (dining-s 24), E 20' (dining-e 16). 320-40
    "f1-dining": [400, 3200, { S: [20, 160, 24, 0], E: [20, 160, 16, 0] }, 280],
    // Hall 0..180 x 0..180 = 15'x15' = 225. S 15' (front door 20), W 15' (hall-w 12). 240-32
    "f1-hall": [225, 1800, { S: [15, 120, 0, 20], W: [15, 120, 12, 0] }, 208],
    // Half bath 180..240 x 0..180 = 5'x15' = 75. S 5' (bath 6). 40-6
    "f1-halfbath": [75, 600, { S: [5, 40, 6, 0] }, 34],
    // Second floor 30' x 30' (360" x 360").
    "f2-bed1": [225, 1800, { N: [15, 120, 12, 0], W: [15, 120, 12, 0] }, 216],
    "f2-bed2": [225, 1800, { N: [15, 120, 12, 0], E: [15, 120, 12, 0] }, 216],
    "f2-bed3": [225, 1800, { S: [15, 120, 12, 0], W: [15, 120, 12, 0] }, 216],
    // Bath 180..360 x 0..90 = 15' x 7.5' = 112.5. S 15' (6), E 7.5' (0). 180-6
    "f2-bath": [112.5, 900, { S: [15, 120, 6, 0], E: [7.5, 60, 0, 0] }, 174],
    // Hall 180..360 x 90..180 = 112.5. E 7.5' (hall-e 6). 60-6
    "f2-hall": [112.5, 900, { E: [7.5, 60, 6, 0] }, 54],
  };
  it.each(Object.keys(expected))("room %s", (id) => {
    const [area, vol, dirs, net] = expected[id]!;
    const m = computeRoomMetrics(model, id);
    expect(m.areaSqFt).toBeCloseTo(area, 9);
    expect(m.volumeCuFt).toBeCloseTo(vol, 9);
    expect(m.ceilingHeightIn).toBe(96);
    const got = byDir(m);
    expect(Object.keys(got).sort()).toEqual(Object.keys(dirs).sort());
    for (const [d, [len, gross, win, door]] of Object.entries(dirs)) {
      expect(got[d]!.len).toBeCloseTo(len, 9);
      expect(got[d]!.gross).toBeCloseTo(gross, 9);
      expect(got[d]!.win).toBeCloseTo(win, 9);
      expect(got[d]!.door).toBeCloseTo(door, 9);
    }
    expect(m.netExteriorWallAreaSqFt).toBeCloseTo(net, 9);
    expect(m.grossExteriorWallAreaSqFt - m.windowAreaSqFt - m.doorAreaSqFt).toBeCloseTo(net, 9);
  });
  it("bounding dims", () => {
    const k = computeRoomMetrics(model, "f1-kitchen");
    expect([k.boundingLengthFt, k.boundingWidthFt, k.perimeterFt]).toEqual([20, 15, 70]);
  });
  it("floor + building summaries", () => {
    // F1: 400+300+400+225+75 = 1400 ft²; ×8 = 11200 ft³; ext = perimeter 2(40+35) = 150'; windows 50+21+40+12+6 = 129; doors 40
    const f1 = computeFloorSummary(model, "floor-1");
    expect(f1.roomCount).toBe(5);
    expect(f1.conditionedAreaSqFt).toBeCloseTo(1400, 9);
    expect(f1.conditionedVolumeCuFt).toBeCloseTo(11200, 9);
    expect(f1.exteriorWallLengthFt).toBeCloseTo(150, 9);
    expect(f1.windowAreaSqFt).toBeCloseTo(129, 9);
    expect(f1.doorAreaSqFt).toBeCloseTo(40, 9);
    expect(f1.windowToFloorRatio).toBeCloseTo(129 / 1400, 12);
    // F2: 900 ft², 7200 ft³, ext 120', windows 24*3 + 6 + 6 = 84, doors 0
    const f2 = computeFloorSummary(model, "floor-2");
    const f2v = [f2.roomCount, f2.conditionedAreaSqFt, f2.conditionedVolumeCuFt, f2.exteriorWallLengthFt, f2.windowAreaSqFt, f2.doorAreaSqFt];
    [5, 900, 7200, 120, 84, 0].forEach((v, i) => expect(f2v[i]).toBeCloseTo(v, 9));
    const b = computeBuildingSummary(model);
    expect(b.floorCount).toBe(2);
    expect(b.roomCount).toBe(10);
    expect(b.conditionedAreaSqFt).toBeCloseTo(2300, 9);
    expect(b.conditionedVolumeCuFt).toBeCloseTo(18400, 9);
    expect(b.exteriorWallLengthFt).toBeCloseTo(270, 9);
    expect(b.windowAreaSqFt).toBeCloseTo(213, 9);
    expect(b.doorAreaSqFt).toBeCloseTo(40, 9);
    expect(b.windowToFloorRatio).toBeCloseTo(213 / 2300, 12);
  });
  it("unconditioned rooms are excluded from conditioned totals but counted", () => {
    const m = { ...model, rooms: model.rooms.map((r) => (r.id === "f1-halfbath" ? { ...r, conditioned: false } : r)) };
    const f1 = computeFloorSummary(m, "floor-1");
    expect(f1.roomCount).toBe(5);
    expect(f1.conditionedAreaSqFt).toBeCloseTo(1325, 9);
  });
});
