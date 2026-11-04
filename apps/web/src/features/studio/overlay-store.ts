/**
 * Transient interaction state (cursor, previews, marquee, snapping feedback). Kept out of the
 * editor store so pointer moves only re-render the overlay layer, never the model layer.
 */
import { createStore } from "zustand/vanilla";
import type { Point } from "@hvac/shared-types";

export interface SnapHint {
  point: Point;
  kind: "point" | "grid" | "angle" | "wall";
}

export interface OverlayState {
  cursor: Point | null; // inches
  snap: SnapHint | null;
  hoverId: string | null;
  /** Wall tool: committed chain points (last one is the live origin). */
  chain: Point[];
  /** Polygon room points. */
  poly: Point[];
  /** Live preview end point for wall/poly/measure. */
  preview: Point | null;
  rect: { a: Point; b: Point } | null;
  marquee: { a: Point; b: Point } | null; // screen px
  measure: { a: Point; b: Point } | null;
  calibrate: { a: Point | null; b: Point | null };
  opening: { wallId: string; offset: number; type: "window" | "door"; width: number } | null;
  typed: string;
  panning: boolean;
  spaceDown: boolean;
}

export const initialOverlay: OverlayState = {
  cursor: null,
  snap: null,
  hoverId: null,
  chain: [],
  poly: [],
  preview: null,
  rect: null,
  marquee: null,
  measure: null,
  calibrate: { a: null, b: null },
  opening: null,
  typed: "",
  panning: false,
  spaceDown: false,
};

export function createOverlayStore() {
  return createStore<OverlayState & { patch: (p: Partial<OverlayState>) => void; resetTool: () => void }>()((set) => ({
    ...initialOverlay,
    patch: (p) => set(p),
    resetTool: () =>
      set({ chain: [], poly: [], preview: null, rect: null, marquee: null, measure: null, opening: null, typed: "", snap: null, calibrate: { a: null, b: null } }),
  }));
}
export type OverlayStore = ReturnType<typeof createOverlayStore>;
