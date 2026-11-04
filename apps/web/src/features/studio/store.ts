/**
 * Building Studio editor store.
 *
 * - `model` is the canonical BuildingModel (inches, y-up) — the only thing that is persisted.
 * - History is patch based (immer patches): each entry stores forward + inverse patches plus the
 *   selection before/after. Gestures (drags) are coalesced into a single entry; consecutive edits
 *   with the same `coalesceKey` (e.g. typing in one property field) merge as well.
 * - Pointer/preview state lives in a separate store (overlay-store.ts) so pointer moves never
 *   re-render the model layer.
 */
import * as React from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { applyPatches, enablePatches, produce, produceWithPatches, type Patch, type Draft } from "immer";
import type { BuildingModel, Point } from "@hvac/shared-types";
import {
  copyEntities,
  deleteEntities,
  existingIds,
  pasteEntities,
  rotateEntities,
  type Clipboard,
} from "./model-ops";

enablePatches();

export const HISTORY_LIMIT = 300;
export const PASTE_OFFSET_IN = 24;

export type ToolId =
  | "select"
  | "wall"
  | "rect-room"
  | "fill-room"
  | "poly-room"
  | "window"
  | "door"
  | "measure"
  | "pan"
  | "calibrate";

export type LayerId = "walls" | "openings" | "rooms" | "dimensions" | "labels" | "background" | "ghost";

export interface HistoryEntry {
  patches: Patch[];
  inverse: Patch[];
  selBefore: string[];
  selAfter: string[];
  key?: string;
  at: number;
  label?: string;
}

export interface EditorState {
  model: BuildingModel;
  floorId: string;
  selection: string[];
  tool: ToolId;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Incremented on every committed model change (including undo/redo). */
  version: number;
  clipboard: Clipboard | null;
  pasteCount: number;
  layers: Record<LayerId, boolean>;
  backgroundLocked: boolean;
  gridVisible: boolean;
  snapEnabled: boolean;
  rectRoomWalls: boolean;
  /** Active gesture: base model snapshot + the latest recipe. */
  gesture: { base: BuildingModel; selBefore: string[]; recipe: ((d: Draft<BuildingModel>) => void) | null; label?: string } | null;
}

export interface EditorActions {
  commit: (recipe: (d: Draft<BuildingModel>) => void, opts?: { coalesceKey?: string; select?: string[]; label?: string }) => void;
  beginGesture: (label?: string) => void;
  updateGesture: (recipe: (draft: Draft<BuildingModel>, base: BuildingModel) => void) => void;
  endGesture: () => void;
  cancelGesture: () => void;
  undo: () => void;
  redo: () => void;
  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string) => void;
  setTool: (t: ToolId) => void;
  setFloor: (id: string) => void;
  deleteSelection: () => void;
  copySelection: () => void;
  paste: () => void;
  rotateSelection: (deg?: number) => void;
  setLayer: (id: LayerId, on: boolean) => void;
  set: (p: Partial<Pick<EditorState, "gridVisible" | "snapEnabled" | "backgroundLocked" | "rectRoomWalls">>) => void;
  /** Replace the whole model (load / reload / restore). Clears history. */
  load: (model: BuildingModel, opts?: { keepSelection?: boolean }) => void;
}

export type EditorStore = EditorState & EditorActions;

function firstFloorId(m: BuildingModel) {
  return [...m.floors].sort((a, b) => a.order - b.order)[0]?.id ?? m.floors[0]!.id;
}

function pruneSelection(model: BuildingModel, sel: string[]) {
  const ids = existingIds(model);
  return sel.filter((id) => ids.has(id));
}

export function createEditorStore(initial: BuildingModel): StoreApi<EditorStore> {
  return createStore<EditorStore>()((set, get) => {
    const pushEntry = (entry: HistoryEntry) => {
      const { past } = get();
      const last = past[past.length - 1];
      let next: HistoryEntry[];
      if (entry.key && last?.key === entry.key && entry.at - last.at < 1500) {
        // Coalesce: apply last then new; undo applies new inverse then last inverse.
        const merged: HistoryEntry = {
          patches: [...last.patches, ...entry.patches],
          inverse: [...entry.inverse, ...last.inverse],
          selBefore: last.selBefore,
          selAfter: entry.selAfter,
          key: entry.key,
          at: entry.at,
          label: entry.label ?? last.label,
        };
        next = [...past.slice(0, -1), merged];
      } else {
        next = [...past, entry];
        if (next.length > HISTORY_LIMIT) next = next.slice(next.length - HISTORY_LIMIT);
      }
      return next;
    };

    return {
      model: initial,
      floorId: firstFloorId(initial),
      selection: [],
      tool: "select",
      past: [],
      future: [],
      version: 0,
      clipboard: null,
      pasteCount: 0,
      layers: { walls: true, openings: true, rooms: true, dimensions: true, labels: true, background: true, ghost: true },
      backgroundLocked: true,
      gridVisible: true,
      snapEnabled: true,
      rectRoomWalls: true,
      gesture: null,

      commit: (recipe, opts) => {
        const s = get();
        if (s.gesture) return; // commits during a gesture are folded into the gesture
        const [next, patches, inverse] = produceWithPatches(s.model, recipe);
        if (!patches.length) {
          if (opts?.select) set({ selection: opts.select });
          return;
        }
        const selAfter = opts?.select ?? pruneSelection(next, s.selection);
        const past = pushEntry({ patches, inverse, selBefore: s.selection, selAfter, key: opts?.coalesceKey, at: Date.now(), label: opts?.label });
        set({ model: next, past, future: [], selection: selAfter, version: s.version + 1 });
      },

      beginGesture: (label) => {
        const s = get();
        set({ gesture: { base: s.model, selBefore: s.selection, recipe: null, label } });
      },

      updateGesture: (recipe) => {
        const s = get();
        if (!s.gesture) return;
        const base = s.gesture.base;
        const r = (d: Draft<BuildingModel>) => recipe(d, base);
        // Always recompute from the base so float error can't accumulate across pointer moves.
        const next = produce(base, r);
        set({ model: next, gesture: { ...s.gesture, recipe: r } });
      },

      endGesture: () => {
        const s = get();
        const g = s.gesture;
        if (!g) return;
        if (!g.recipe) {
          set({ gesture: null, model: g.base });
          return;
        }
        const [next, patches, inverse] = produceWithPatches(g.base, g.recipe);
        if (!patches.length) {
          set({ gesture: null, model: g.base });
          return;
        }
        const past = pushEntry({ patches, inverse, selBefore: g.selBefore, selAfter: s.selection, at: Date.now(), label: g.label });
        set({ gesture: null, model: next, past, future: [], version: s.version + 1 });
      },

      cancelGesture: () => {
        const g = get().gesture;
        if (!g) return;
        set({ gesture: null, model: g.base, selection: g.selBefore });
      },

      undo: () => {
        const s = get();
        if (s.gesture) return get().cancelGesture();
        const entry = s.past[s.past.length - 1];
        if (!entry) return;
        const model = applyPatches(s.model, entry.inverse);
        set({
          model,
          past: s.past.slice(0, -1),
          future: [...s.future, entry],
          selection: pruneSelection(model, entry.selBefore),
          version: s.version + 1,
        });
      },

      redo: () => {
        const s = get();
        const entry = s.future[s.future.length - 1];
        if (!entry || s.gesture) return;
        const model = applyPatches(s.model, entry.patches);
        set({
          model,
          past: [...s.past, entry],
          future: s.future.slice(0, -1),
          selection: pruneSelection(model, entry.selAfter),
          version: s.version + 1,
        });
      },

      setSelection: (ids) => set({ selection: Array.from(new Set(ids)) }),
      toggleSelection: (id) => {
        const sel = get().selection;
        set({ selection: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id] });
      },
      setTool: (tool) => set({ tool }),
      setFloor: (floorId) => set({ floorId, selection: [] }),

      deleteSelection: () => {
        const sel = get().selection;
        if (!sel.length) return;
        get().commit((d) => void deleteEntities(d as BuildingModel, sel), { select: [], label: "Delete" });
      },

      copySelection: () => {
        const s = get();
        if (!s.selection.length) return;
        set({ clipboard: copyEntities(s.model, s.selection), pasteCount: 0 });
      },

      paste: () => {
        const s = get();
        if (!s.clipboard) return;
        const n = s.pasteCount + 1;
        let ids: string[] = [];
        const delta: Point = { x: PASTE_OFFSET_IN * n, y: -PASTE_OFFSET_IN * n };
        const [next, patches, inverse] = produceWithPatches(s.model, (d) => {
          ids = pasteEntities(d as BuildingModel, s.clipboard!, s.floorId, delta);
        });
        if (!patches.length) return;
        const past = pushEntry({ patches, inverse, selBefore: s.selection, selAfter: ids, at: Date.now(), label: "Paste" });
        set({ model: next, past, future: [], selection: ids, version: s.version + 1, pasteCount: n });
      },

      rotateSelection: (deg = 90) => {
        const sel = new Set(get().selection);
        if (!sel.size) return;
        get().commit((d) => rotateEntities(d as BuildingModel, sel, deg), { label: "Rotate" });
      },

      setLayer: (id, on) => set({ layers: { ...get().layers, [id]: on } }),
      set: (p) => set(p),

      load: (model, opts) => {
        const s = get();
        const floorId = model.floors.some((f) => f.id === s.floorId) ? s.floorId : firstFloorId(model);
        set({
          model,
          floorId,
          past: [],
          future: [],
          gesture: null,
          selection: opts?.keepSelection ? pruneSelection(model, s.selection) : [],
        });
      },
    };
  });
}

// ---------------------------------------------------------------------------
// React binding: one store instance per mounted studio, held in context.
// ---------------------------------------------------------------------------
export const EditorContext = React.createContext<StoreApi<EditorStore> | null>(null);

export function useEditorApi(): StoreApi<EditorStore> {
  const api = React.useContext(EditorContext);
  if (!api) throw new Error("EditorContext missing");
  return api;
}

export function useEditor<T>(selector: (s: EditorStore) => T): T {
  return useStore(useEditorApi(), selector);
}

export function useEditorShallow<T>(selector: (s: EditorStore) => T): T {
  return useStore(useEditorApi(), useShallow(selector));
}
