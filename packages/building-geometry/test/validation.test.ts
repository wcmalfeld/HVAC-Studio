import { describe, expect, it } from "vitest";
import { validateModel, hasErrors } from "../src";
import { mkDoor, mkModel, mkRoom, mkWall, mkWindow, rectWalls, loadSample, NULL_ASM } from "./helpers";
import type { BuildingModel } from "@hvac/shared-types";

const P = (x: number, y: number) => ({ x, y });
const sq = (x0: number, y0: number, s: number) => [P(x0, y0), P(x0 + s, y0), P(x0 + s, y0 + s), P(x0, y0 + s)];
const codes = (m: BuildingModel) => validateModel(m).map((i) => i.code);

describe("validateModel", () => {
  it("clean model -> zero errors", () => {
    const m = mkModel({ walls: rectWalls("x", 0, 0, 120, 120), rooms: [mkRoom("r", sq(0, 0, 120))], openings: [mkWindow("o", "x-s", 60, 36, 48)] });
    expect(validateModel(m)).toEqual([]);
    expect(hasErrors(validateModel(loadSample()))).toBe(false);
  });

  const cases: [string, "error" | "warning" | "info", BuildingModel][] = [
    ["WALL_ZERO_LENGTH", "error", mkModel({ walls: [mkWall("w", [5, 5], [5, 5])] })],
    ["ROOM_TOO_FEW_POINTS", "error", mkModel({ rooms: [mkRoom("r", [P(0, 0), P(10, 0), P(10, 0)])] })],
    ["ROOM_SELF_INTERSECTING", "error", mkModel({ rooms: [mkRoom("r", [P(0, 0), P(100, 100), P(100, 0), P(0, 100)])] })],
    ["ROOM_SELF_INTERSECTING", "error", mkModel({ rooms: [mkRoom("r", [P(0, 0), P(200, 100), P(200, 0), P(0, 100)])] })],
    ["ROOM_ZERO_AREA", "error", mkModel({ rooms: [mkRoom("r", [P(0, 0), P(50, 0), P(100, 0)])] })],
    ["ROOMS_OVERLAP", "error", mkModel({ rooms: [mkRoom("a", sq(0, 0, 100)), mkRoom("b", sq(50, 50, 100))] })],
    ["DANGLING_FLOOR_REF", "error", mkModel({ walls: [mkWall("w", [0, 0], [10, 0], { floorId: "ghost" })] })],
    ["DANGLING_WALL_REF", "error", mkModel({ openings: [mkWindow("o", "ghost", 10, 10, 10)] })],
    ["DUPLICATE_ID", "error", mkModel({ walls: [mkWall("dup", [0, 0], [10, 0]), mkWall("dup", [0, 10], [10, 10])] })],
    ["OPENING_OUT_OF_WALL", "error", mkModel({ walls: [mkWall("w", [0, 0], [100, 0])], openings: [mkWindow("o", "w", 90, 36, 36)] })],
    ["OPENINGS_OVERLAP", "error", mkModel({ walls: [mkWall("w", [0, 0], [200, 0])], openings: [mkWindow("a", "w", 50, 36, 36), mkDoor("b", "w", 80)] })],
    ["OPENING_TALLER_THAN_WALL", "error", mkModel({ walls: [mkWall("w", [0, 0], [200, 0])], openings: [mkWindow("o", "w", 50, 36, 60, 40)] })],
    ["EXTERIOR_WALL_MISSING_R_OR_U", "warning", mkModel({ walls: [mkWall("w", [0, 0], [100, 0], { assembly: NULL_ASM })] })],
    ["WINDOW_MISSING_U", "warning", mkModel({ walls: [mkWall("w", [0, 0], [100, 0])], openings: [{ ...mkWindow("o", "w", 50, 20, 20), props: { windowType: null, uFactor: null, shgc: 0.3, frameMaterial: null, panes: null, shading: null } }] })],
    ["WINDOW_MISSING_SHGC", "warning", mkModel({ walls: [mkWall("w", [0, 0], [100, 0])], openings: [{ ...mkWindow("o", "w", 50, 20, 20), props: { windowType: null, uFactor: 0.3, shgc: null, frameMaterial: null, panes: null, shading: null } }] })],
    ["DOOR_MISSING_U", "info", mkModel({ walls: [mkWall("w", [0, 0], [100, 0])], openings: [{ ...mkDoor("d", "w", 50), props: { construction: null, uFactor: null } }] })],
    ["ROOM_NO_EXPOSURE", "info", mkModel({ rooms: [mkRoom("r", sq(0, 0, 100))] })],
    ["INFERRED_NEEDS_REVIEW", "warning", mkModel({ walls: [mkWall("w", [0, 0], [100, 0], { provenance: { source: "inferred", confidence: 0.8 } })] })],
    ["INFERRED_MISSING_CONFIDENCE", "error", mkModel({ rooms: [mkRoom("r", sq(0, 0, 100), { provenance: { source: "inferred" } })], walls: rectWalls("x", 0, 0, 100, 100) })],
  ];
  it.each(cases)("%s (%s)", (code, severity, m) => {
    const issues = validateModel(m).filter((i) => i.code === code);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.severity).toBe(severity);
    expect(issues[0]!.id.startsWith(`${code}:`)).toBe(true);
    expect(issues[0]!.entityIds.length).toBeGreaterThan(0);
  });

  it("issue ids are stable across runs and orderings", () => {
    const a = mkModel({ rooms: [mkRoom("a", sq(0, 0, 100)), mkRoom("b", sq(50, 50, 100))] });
    const b = mkModel({ rooms: [mkRoom("b", sq(50, 50, 100)), mkRoom("a", sq(0, 0, 100))] });
    const id = (m: BuildingModel) => validateModel(m).find((i) => i.code === "ROOMS_OVERLAP")!.id;
    expect(id(a)).toBe("ROOMS_OVERLAP:a,b");
    expect(id(b)).toBe(id(a));
  });

  it("negative cases: shared edges, other floors, adjacent openings, exact-fit opening", () => {
    const twoFloors = mkModel({
      floors: [
        { id: "floor-1", name: "1", elevation: 0, floorToFloorHeight: 108, defaultCeilingHeight: 96, order: 0 },
        { id: "floor-2", name: "2", elevation: 108, floorToFloorHeight: 108, defaultCeilingHeight: 96, order: 1 },
      ],
      rooms: [mkRoom("a", sq(0, 0, 100)), mkRoom("b", sq(100, 0, 100)), mkRoom("c", sq(0, 0, 100), { floorId: "floor-2" })],
      walls: [mkWall("w", [0, 0], [100, 0])],
      openings: [mkWindow("o1", "w", 18, 36, 36), mkWindow("o2", "w", 54, 36, 60, 36)], // 0..36, 36..72; top 96 == wall height
    });
    const c = codes(twoFloors);
    expect(c).not.toContain("ROOMS_OVERLAP");
    expect(c).not.toContain("OPENINGS_OVERLAP");
    expect(c).not.toContain("OPENING_OUT_OF_WALL");
    expect(c).not.toContain("OPENING_TALLER_THAN_WALL");
  });

  it("interior conditioned wall without R is fine; interior wall to garage without R warns", () => {
    expect(codes(mkModel({ walls: [mkWall("w", [0, 0], [100, 0], { kind: "interior", adjacentSpace: "conditioned", assembly: NULL_ASM })] }))).toEqual([]);
    expect(codes(mkModel({ walls: [mkWall("w", [0, 0], [100, 0], { kind: "interior", adjacentSpace: "garage", assembly: NULL_ASM })] }))).toEqual(["EXTERIOR_WALL_MISSING_R_OR_U"]);
  });

  it("u-factor alone satisfies the R/U check; inferred with confidence is warning only", () => {
    const m = mkModel({ walls: [mkWall("w", [0, 0], [100, 0], { assembly: { ...NULL_ASM, uFactor: 0.08 }, provenance: { source: "inferred", confidence: 0.5 } })] });
    expect(validateModel(m).map((i) => [i.code, i.severity])).toEqual([["INFERRED_NEEDS_REVIEW", "warning"]]);
  });
});
