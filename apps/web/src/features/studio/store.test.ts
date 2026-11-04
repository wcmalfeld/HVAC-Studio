import { describe, expect, it } from "vitest";
import { emptyBuildingModel, type BuildingModel } from "@hvac/shared-types";
import { createEditorStore, HISTORY_LIMIT } from "./store";
import { addRoomWithWalls, makeOpening, makeWall, moveEntities, setWallLength, moveWallEndpoint } from "./model-ops";

function seeded() {
  const m = emptyBuildingModel("f1");
  const api = createEditorStore(m);
  return api;
}

function addBox(api: ReturnType<typeof seeded>) {
  let ids: string[] = [];
  api.getState().commit((d) => {
    ids = addRoomWithWalls(d as BuildingModel, "f1", [
      { x: 0, y: 0 },
      { x: 240, y: 0 },
      { x: 240, y: 144 },
      { x: 0, y: 144 },
    ]);
  });
  return ids;
}

describe("history", () => {
  it("undo/redo restores model and selection", () => {
    const api = seeded();
    const ids = addBox(api);
    expect(api.getState().model.rooms).toHaveLength(1);
    expect(api.getState().model.walls).toHaveLength(4);
    api.getState().setSelection([ids[0]!]);
    api.getState().deleteSelection();
    expect(api.getState().model.rooms).toHaveLength(0);
    api.getState().undo();
    expect(api.getState().model.rooms).toHaveLength(1);
    expect(api.getState().selection).toEqual([ids[0]]);
    api.getState().undo();
    expect(api.getState().model.walls).toHaveLength(0);
    api.getState().redo();
    api.getState().redo();
    expect(api.getState().model.rooms).toHaveLength(0);
    expect(api.getState().model.walls).toHaveLength(4);
  });

  it("new commit clears redo stack", () => {
    const api = seeded();
    addBox(api);
    api.getState().undo();
    expect(api.getState().future).toHaveLength(1);
    api.getState().commit((d) => void d.walls.push(makeWall("f1", { x: 0, y: 0 }, { x: 10, y: 0 })));
    expect(api.getState().future).toHaveLength(0);
  });

  it("coalesces a drag gesture into one undo step computed from the base", () => {
    const api = seeded();
    const ids = addBox(api);
    const roomId = ids[0]!;
    const before = structuredClone(api.getState().model);
    const st = api.getState();
    st.setSelection(ids);
    st.beginGesture("Move");
    for (let i = 1; i <= 50; i++) {
      api.getState().updateGesture((d, base) => moveEntities(d as BuildingModel, base, new Set(ids), { x: i, y: i * 0.5 }));
    }
    api.getState().endGesture();
    const s = api.getState();
    expect(s.past).toHaveLength(2); // add box + 1 move
    const r = s.model.rooms.find((x) => x.id === roomId)!;
    expect(r.boundary[0]).toEqual({ x: 50, y: 25 });
    s.undo();
    expect(api.getState().model).toEqual(before);
    api.getState().redo();
    expect(api.getState().model.rooms[0]!.boundary[0]).toEqual({ x: 50, y: 25 });
  });

  it("cancelGesture reverts without a history entry", () => {
    const api = seeded();
    const ids = addBox(api);
    api.getState().beginGesture();
    api.getState().updateGesture((d, base) => moveEntities(d as BuildingModel, base, new Set(ids), { x: 99, y: 0 }));
    api.getState().cancelGesture();
    expect(api.getState().past).toHaveLength(1);
    expect(api.getState().model.rooms[0]!.boundary[0]).toEqual({ x: 0, y: 0 });
  });

  it("empty gesture leaves no history entry", () => {
    const api = seeded();
    addBox(api);
    api.getState().beginGesture();
    api.getState().endGesture();
    expect(api.getState().past).toHaveLength(1);
  });

  it("coalesces consecutive edits with the same key (property typing)", () => {
    const api = seeded();
    const ids = addBox(api);
    const rid = ids[0]!;
    for (const name of ["K", "Ki", "Kit", "Kitchen"]) {
      api.getState().commit((d) => void (d.rooms.find((r) => r.id === rid)!.name = name), { coalesceKey: `${rid}:name` });
    }
    expect(api.getState().past).toHaveLength(2);
    api.getState().undo();
    expect(api.getState().model.rooms[0]!.name).toBe("Room 1");
  });

  it("keeps at least 200 steps and caps at the limit", () => {
    const api = seeded();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      api.getState().commit((d) => void (d.northAngleDeg = (i + 1) % 360));
    }
    expect(api.getState().past.length).toBe(HISTORY_LIMIT);
    expect(HISTORY_LIMIT).toBeGreaterThanOrEqual(200);
    for (let i = 0; i < 200; i++) api.getState().undo();
    expect(api.getState().past.length).toBe(HISTORY_LIMIT - 200);
  });
});

describe("delete cascades", () => {
  it("deleting a wall deletes its openings, not others", () => {
    const api = seeded();
    const ids = addBox(api);
    const [w1, w2] = [ids[1]!, ids[2]!];
    const o1 = makeOpening("window", w1, 60);
    const o2 = makeOpening("door", w2, 40);
    api.getState().commit((d) => {
      d.openings.push(o1, o2);
    });
    api.getState().setSelection([w1]);
    api.getState().deleteSelection();
    const m = api.getState().model;
    expect(m.walls.find((w) => w.id === w1)).toBeUndefined();
    expect(m.openings.map((o) => o.id)).toEqual([o2.id]);
    api.getState().undo();
    expect(api.getState().model.openings).toHaveLength(2);
  });

  it("deleting a room keeps its walls", () => {
    const api = seeded();
    const ids = addBox(api);
    api.getState().setSelection([ids[0]!]);
    api.getState().deleteSelection();
    expect(api.getState().model.walls).toHaveLength(4);
    expect(api.getState().selection).toEqual([]);
  });
});

describe("copy / paste", () => {
  it("remaps every id and opening.wallId, offsets geometry", () => {
    const api = seeded();
    const ids = addBox(api);
    const wallId = ids[1]!;
    const win = makeOpening("window", wallId, 60);
    api.getState().commit((d) => void d.openings.push(win));
    api.getState().setSelection(ids);
    api.getState().copySelection();
    api.getState().paste();
    const s = api.getState();
    expect(s.model.rooms).toHaveLength(2);
    expect(s.model.walls).toHaveLength(8);
    expect(s.model.openings).toHaveLength(2);
    const allIds = [...s.model.walls, ...s.model.openings, ...s.model.rooms].map((e) => e.id);
    expect(new Set(allIds).size).toBe(allIds.length);
    const pasted = new Set(s.selection);
    expect(pasted.size).toBe(4 + 1 + 1);
    const newOpening = s.model.openings.find((o) => pasted.has(o.id))!;
    expect(newOpening.wallId).not.toBe(wallId);
    expect(pasted.has(newOpening.wallId)).toBe(true);
    const newRoom = s.model.rooms.find((r) => pasted.has(r.id))!;
    expect(newRoom.boundary[0]).toEqual({ x: 24, y: -24 });
    // second paste offsets further, still unique
    api.getState().paste();
    const s2 = api.getState();
    expect(s2.model.rooms[2]!.boundary[0]).toEqual({ x: 48, y: -48 });
    // one undo step per paste
    s2.undo();
    expect(api.getState().model.rooms).toHaveLength(2);
  });

  it("does not paste openings whose wall was not copied", () => {
    const api = seeded();
    const ids = addBox(api);
    const win = makeOpening("window", ids[1]!, 60);
    api.getState().commit((d) => void d.openings.push(win));
    api.getState().setSelection([win.id, ids[0]!]);
    api.getState().copySelection();
    api.getState().paste();
    expect(api.getState().model.openings).toHaveLength(1);
    expect(api.getState().model.rooms).toHaveLength(2);
  });

  it("pastes onto the current floor", () => {
    const api = seeded();
    const ids = addBox(api);
    api.getState().commit((d) => void d.floors.push({ id: "f2", name: "Second", elevation: 120, floorToFloorHeight: 120, defaultCeilingHeight: 96, order: 1 }));
    api.getState().setSelection(ids);
    api.getState().copySelection();
    api.getState().setFloor("f2");
    api.getState().paste();
    const m = api.getState().model;
    expect(m.walls.filter((w) => w.floorId === "f2")).toHaveLength(4);
    expect(m.rooms.filter((r) => r.floorId === "f2")).toHaveLength(1);
  });
});

describe("geometry edits", () => {
  it("moving a wall endpoint drags connected endpoints and room vertices", () => {
    const api = seeded();
    const ids = addBox(api);
    const m = api.getState().model;
    const w = m.walls.find((x) => x.start.x === 240 && x.start.y === 0) ?? m.walls.find((x) => x.end.x === 240 && x.end.y === 0)!;
    const which = w.start.x === 240 && w.start.y === 0 ? "start" : "end";
    api.getState().beginGesture();
    api.getState().updateGesture((d, base) => moveWallEndpoint(d as BuildingModel, base, w.id, which, { x: 252, y: 0 }));
    api.getState().endGesture();
    const m2 = api.getState().model;
    const touching = m2.walls.filter((x) => (x.start.x === 252 && x.start.y === 0) || (x.end.x === 252 && x.end.y === 0));
    expect(touching).toHaveLength(2);
    expect(m2.rooms.find((r) => r.id === ids[0])!.boundary.some((p) => p.x === 252 && p.y === 0)).toBe(true);
  });

  it("setWallLength keeps openings on the wall", () => {
    const api = seeded();
    const ids = addBox(api);
    const wallId = ids[1]!;
    const win = makeOpening("window", wallId, 200);
    api.getState().commit((d) => void d.openings.push(win));
    api.getState().commit((d) => setWallLength(d as BuildingModel, wallId, 120));
    const o = api.getState().model.openings[0]!;
    expect(o.offset).toBeLessThanOrEqual(120 - 18);
  });

  it("rotate 90° twice returns a symmetric box to place", () => {
    const api = seeded();
    const ids = addBox(api);
    api.getState().setSelection(ids);
    api.getState().rotateSelection();
    const r1 = api.getState().model.rooms[0]!;
    const xs = r1.boundary.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(144);
    api.getState().rotateSelection();
    api.getState().rotateSelection();
    api.getState().rotateSelection();
    expect(api.getState().model.rooms[0]!.boundary).toEqual([
      { x: 0, y: 0 },
      { x: 240, y: 0 },
      { x: 240, y: 144 },
      { x: 0, y: 144 },
    ]);
  });

  it("new openings have null engineering properties", () => {
    const w = makeOpening("window", "w", 10);
    expect(w.type === "window" && w.props).toEqual({ windowType: null, uFactor: null, shgc: null, frameMaterial: null, panes: null, shading: null });
    expect([w.width, w.height, w.sillHeight]).toEqual([36, 48, 36]);
    const d = makeOpening("door", "w", 10);
    expect([d.width, d.height]).toEqual([36, 80]);
  });

  it("adding a room next to an existing one does not duplicate shared walls", () => {
    const api = seeded();
    addBox(api);
    api.getState().commit((d) => {
      addRoomWithWalls(d as BuildingModel, "f1", [
        { x: 240, y: 0 },
        { x: 360, y: 0 },
        { x: 360, y: 144 },
        { x: 240, y: 144 },
      ]);
    });
    expect(api.getState().model.walls).toHaveLength(7);
  });
});
