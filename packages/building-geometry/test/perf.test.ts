import { describe, expect, it } from "vitest";
import { computeBuildingSummary, validateModel, polygonArea } from "../src";
import { mkModel, mkRoom, mkWall, mkWindow } from "./helpers";
import type { Opening, Room, Wall } from "@hvac/shared-types";

/** Grid of 10 x 15 rooms (150 rooms), 12' cells; one wall per cell edge => 10*16 + 15*11 = 325, plus 75 extra stubs = 400 walls. */
function generate() {
  const C = 144, NX = 10, NY = 15;
  const walls: Wall[] = [];
  const rooms: Room[] = [];
  const openings: Opening[] = [];
  for (let j = 0; j <= NY; j++) for (let i = 0; i < NX; i++) {
    const ext = j === 0 || j === NY;
    walls.push(mkWall(`h-${i}-${j}`, [i * C, j * C], [(i + 1) * C, j * C], ext ? {} : { kind: "interior", adjacentSpace: "conditioned" }));
    if (ext) openings.push(mkWindow(`o-h-${i}-${j}`, `h-${i}-${j}`, 72, 36, 48));
  }
  for (let i = 0; i <= NX; i++) for (let j = 0; j < NY; j++) {
    const ext = i === 0 || i === NX;
    walls.push(mkWall(`v-${i}-${j}`, [i * C, j * C], [i * C, (j + 1) * C], ext ? {} : { kind: "interior", adjacentSpace: "conditioned" }));
  }
  for (let k = 0; walls.length < 400; k++) walls.push(mkWall(`stub-${k}`, [k * 10 + 5, 5], [k * 10 + 5, 20], { kind: "interior", adjacentSpace: "conditioned" }));
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++)
    rooms.push(mkRoom(`r-${i}-${j}`, [{ x: i * C, y: j * C }, { x: (i + 1) * C, y: j * C }, { x: (i + 1) * C, y: (j + 1) * C }, { x: i * C, y: (j + 1) * C }]));
  return mkModel({ walls, rooms, openings });
}

describe("performance", () => {
  it("summary + validation on 400 walls / 150 rooms < 250 ms", () => {
    const model = generate();
    expect(model.walls).toHaveLength(400);
    expect(model.rooms).toHaveLength(150);
    const t0 = performance.now();
    const s = computeBuildingSummary(model);
    const issues = validateModel(model);
    const ms = performance.now() - t0;
    expect(s.conditionedAreaSqFt).toBeCloseTo((150 * polygonArea(model.rooms[0]!.boundary)) / 144, 6);
    expect(s.exteriorWallLengthFt).toBeCloseTo(2 * (10 + 15) * 12, 6);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(ms).toBeLessThan(250);
  });
});
