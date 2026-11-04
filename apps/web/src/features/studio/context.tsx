"use client";
import * as React from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { StoreApi } from "zustand";
import type { BuildingModel } from "@hvac/shared-types";
import { createEditorStore, EditorContext, type EditorStore } from "./store";
import { createViewportStore, type ViewportStore } from "./viewport";
import { createOverlayStore, type OverlayStore } from "./overlay-store";
import { createBackgroundStore, type BackgroundStore } from "./background";

export interface StudioStores {
  projectId: string;
  editor: StoreApi<EditorStore>;
  viewport: ViewportStore;
  overlay: OverlayStore;
  background: BackgroundStore;
}

const Ctx = React.createContext<StudioStores | null>(null);

export function StudioProvider({ projectId, initial, children }: { projectId: string; initial: BuildingModel; children: React.ReactNode }) {
  const [stores] = React.useState<StudioStores>(() => ({
    projectId,
    editor: createEditorStore(initial),
    viewport: createViewportStore(),
    overlay: createOverlayStore(),
    background: createBackgroundStore(projectId),
  }));
  return (
    <Ctx.Provider value={stores}>
      <EditorContext.Provider value={stores.editor}>{children}</EditorContext.Provider>
    </Ctx.Provider>
  );
}

export function useStudio(): StudioStores {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("StudioProvider missing");
  return v;
}

export function useViewport<T>(sel: (s: ReturnType<ViewportStore["getState"]>) => T): T {
  return useStore(useStudio().viewport, useShallow(sel));
}
export function useOverlay<T>(sel: (s: ReturnType<OverlayStore["getState"]>) => T): T {
  return useStore(useStudio().overlay, useShallow(sel));
}
export function useBackground<T>(sel: (s: ReturnType<BackgroundStore["getState"]>) => T): T {
  return useStore(useStudio().background, useShallow(sel));
}
