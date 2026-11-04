import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyBuildingModel, type BuildingDocument } from "@hvac/shared-types";
import { ApiError, NetworkError } from "@/lib/api/client";
import { AutosaveController, saveReducer, initialSaveState, entityIdForLoc, type SaveState } from "./autosave";

const model = emptyBuildingModel();
const doc = (revision: number): BuildingDocument => ({ projectId: "p", revision, model, updatedAt: new Date().toISOString() });

describe("saveReducer", () => {
  it("edit → unsaved, success → saved", () => {
    let s = initialSaveState(3);
    s = saveReducer(s, { type: "edit" });
    expect(s.status).toBe("unsaved");
    s = saveReducer(s, { type: "start" });
    expect(s.status).toBe("saving");
    s = saveReducer(s, { type: "success", revision: 4, version: 1, at: 1 });
    expect(s).toMatchObject({ status: "saved", revision: 4, savedVersion: 1 });
  });
  it("edit during save leaves it unsaved after success", () => {
    let s = initialSaveState(0);
    s = saveReducer(s, { type: "edit" });
    s = saveReducer(s, { type: "start" });
    s = saveReducer(s, { type: "edit" });
    s = saveReducer(s, { type: "success", revision: 1, version: 1, at: 1 });
    expect(s.status).toBe("unsaved");
  });
  it("conflict is sticky", () => {
    let s = initialSaveState(0);
    s = saveReducer(s, { type: "conflict", currentRevision: 7 });
    s = saveReducer(s, { type: "edit" });
    s = saveReducer(s, { type: "start" });
    expect(s.status).toBe("conflict");
    expect(s.conflict?.currentRevision).toBe(7);
  });
});

describe("AutosaveController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(put: (rev: number) => Promise<BuildingDocument>) {
    const states: SaveState[] = [];
    const putSpy = vi.fn((rev: number) => put(rev));
    const c = new AutosaveController({ put: (rev) => putSpy(rev), getModel: () => model, onChange: (s) => states.push(s), debounceMs: 1500 }, 5);
    return { c, putSpy, states };
  }

  it("debounces edits into one PUT with the base revision, then adopts the new revision", async () => {
    const { c, putSpy } = setup(async (rev) => doc(rev + 1));
    c.edit();
    await vi.advanceTimersByTimeAsync(1000);
    c.edit();
    await vi.advanceTimersByTimeAsync(1000);
    expect(putSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith(5);
    expect(c.state).toMatchObject({ status: "saved", revision: 6 });
    c.edit();
    await vi.advanceTimersByTimeAsync(1600);
    expect(putSpy).toHaveBeenLastCalledWith(6);
  });

  it("survives a StrictMode dispose → activate cycle (dev effects run twice) and still saves", async () => {
    const { c, putSpy } = setup(async (rev) => doc(rev + 1));
    c.activate();
    c.dispose();
    c.activate();
    c.edit();
    await vi.advanceTimersByTimeAsync(1600);
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(c.state.status).toBe("saved");
  });

  it("re-schedules a pending save when re-activated after dispose", async () => {
    const { c, putSpy } = setup(async (rev) => doc(rev + 1));
    c.edit();
    c.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(putSpy).not.toHaveBeenCalled();
    c.activate();
    await vi.advanceTimersByTimeAsync(1600);
    expect(putSpy).toHaveBeenCalledTimes(1);
  });

  it("409 → conflict, stops autosaving; overwrite re-saves on the server revision", async () => {
    let fail = true;
    const { c, putSpy } = setup(async (rev) => {
      if (fail) throw new ApiError(409, "revision_conflict", "Conflict", { currentRevision: 9 });
      return doc(rev + 1);
    });
    c.edit();
    await vi.advanceTimersByTimeAsync(1600);
    expect(c.state.status).toBe("conflict");
    expect(c.state.conflict?.currentRevision).toBe(9);
    c.edit();
    await vi.advanceTimersByTimeAsync(5000);
    expect(putSpy).toHaveBeenCalledTimes(1);
    fail = false;
    await c.overwrite(9);
    expect(putSpy).toHaveBeenLastCalledWith(9);
    expect(c.state).toMatchObject({ status: "saved", revision: 10, conflict: null });
  });

  it("network error → offline, retries and recovers", async () => {
    let n = 0;
    const { c } = setup(async (rev) => {
      n++;
      if (n === 1) throw new NetworkError();
      return doc(rev + 1);
    });
    c.edit();
    await vi.advanceTimersByTimeAsync(1600);
    expect(c.state.status).toBe("offline");
    await vi.advanceTimersByTimeAsync(2100);
    expect(c.state.status).toBe("saved");
  });

  it("422 invalid_building_model → invalid with issues, no retry until next edit", async () => {
    let fail = true;
    const { c, putSpy } = setup(async (rev) => {
      if (fail)
        throw new ApiError(422, "invalid_building_model", "Invalid building model", [
          { loc: ["model", "walls", 0, "thickness"], msg: "Input should be greater than 0" },
        ]);
      return doc(rev + 1);
    });
    c.edit();
    await vi.advanceTimersByTimeAsync(1600);
    expect(c.state.status).toBe("invalid");
    expect(c.state.serverIssues).toEqual([{ loc: ["model", "walls", 0, "thickness"], message: "Input should be greater than 0" }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(putSpy).toHaveBeenCalledTimes(1);
    fail = false;
    c.edit();
    await vi.advanceTimersByTimeAsync(1600);
    expect(putSpy).toHaveBeenCalledTimes(2);
    expect(c.state).toMatchObject({ status: "saved", serverIssues: [] });
  });

  it("reset after reload clears dirty state", () => {
    const { c } = setup(async (rev) => doc(rev + 1));
    c.edit();
    c.reset(12);
    expect(c.state).toMatchObject({ status: "saved", revision: 12, localVersion: 0 });
    c.dispose();
  });

  it("edits made while saving are saved in a follow-up PUT", async () => {
    let resolve!: (d: BuildingDocument) => void;
    let calls = 0;
    const { c, putSpy } = setup(
      (rev) =>
        new Promise<BuildingDocument>((r) => {
          calls++;
          if (calls === 1) resolve = () => r(doc(rev + 1));
          else r(doc(rev + 1));
        }),
    );
    c.edit();
    await vi.advanceTimersByTimeAsync(1600);
    expect(c.state.status).toBe("saving");
    c.edit();
    resolve(doc(0));
    await vi.advanceTimersByTimeAsync(0);
    expect(c.state.status).toBe("unsaved");
    await vi.advanceTimersByTimeAsync(1600);
    expect(putSpy).toHaveBeenCalledTimes(2);
    expect(putSpy).toHaveBeenLastCalledWith(6);
    expect(c.state.status).toBe("saved");
  });
});

describe("entityIdForLoc", () => {
  it("maps model paths to entity ids", () => {
    const m = { ...model, walls: [{ id: "wall-a" }] } as unknown as typeof model;
    expect(entityIdForLoc(m, ["model", "walls", 0, "thickness"])).toBe("wall-a");
    expect(entityIdForLoc(m, ["model", "northAngleDeg"])).toBeNull();
  });
});
