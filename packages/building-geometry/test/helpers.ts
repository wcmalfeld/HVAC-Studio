import type { BuildingModel, DoorOpening, Point, Room, Wall, WindowOpening } from "@hvac/shared-types";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BuildingModel as BuildingModelSchema } from "@hvac/shared-types";

export const NULL_ASM = { constructionType: null, insulation: null, rValue: null, uFactor: null };

export function mkWall(id: string, start: [number, number], end: [number, number], over: Partial<Wall> = {}): Wall {
  return {
    id, floorId: "floor-1", start: { x: start[0], y: start[1] }, end: { x: end[0], y: end[1] },
    thickness: 4.5, height: 96, kind: "exterior", adjacentSpace: "outdoors",
    assembly: { ...NULL_ASM, rValue: 13 }, provenance: { source: "user" }, ...over,
  };
}
export function mkRoom(id: string, boundary: Point[], over: Partial<Room> = {}): Room {
  return {
    id, floorId: "floor-1", name: id, roomType: "other", boundary, ceilingHeight: null, conditioned: true,
    occupants: null, zoneId: null, floorAssembly: { ...NULL_ASM, adjacentSpace: null },
    ceilingAssembly: { ...NULL_ASM, adjacentSpace: null }, provenance: { source: "user" }, ...over,
  };
}
export function mkWindow(id: string, wallId: string, offset: number, width: number, height: number, sillHeight = 36): WindowOpening {
  return { id, wallId, type: "window", offset, width, height, sillHeight, provenance: { source: "user" },
    props: { windowType: null, uFactor: 0.3, shgc: 0.25, frameMaterial: null, panes: null, shading: null } };
}
export function mkDoor(id: string, wallId: string, offset: number, width = 36, height = 80): DoorOpening {
  return { id, wallId, type: "door", offset, width, height, sillHeight: 0, provenance: { source: "user" }, props: { construction: null, uFactor: 0.2 } };
}
export function mkModel(over: Partial<BuildingModel> = {}): BuildingModel {
  return {
    schemaVersion: 1, northAngleDeg: 0, displayUnits: "imperial",
    floors: [{ id: "floor-1", name: "First", elevation: 0, floorToFloorHeight: 108, defaultCeilingHeight: 96, order: 0 }],
    walls: [], openings: [], rooms: [], ...over,
  };
}
export const rectWalls = (prefix: string, x0: number, y0: number, x1: number, y1: number, over: Partial<Wall> = {}): Wall[] => [
  mkWall(`${prefix}-s`, [x0, y0], [x1, y0], over),
  mkWall(`${prefix}-e`, [x1, y0], [x1, y1], over),
  mkWall(`${prefix}-n`, [x1, y1], [x0, y1], over),
  mkWall(`${prefix}-w`, [x0, y1], [x0, y0], over),
];

export const SAMPLE_PATH = fileURLToPath(new URL("../../shared-types/fixtures/sample-house.json", import.meta.url));
export function loadSample(): BuildingModel {
  return BuildingModelSchema.parse(JSON.parse(readFileSync(SAMPLE_PATH, "utf8")));
}
