/**
 * Viewport: the ONE place where plan inches become screen pixels (ADR-001).
 *   screenX = ox + x · scale
 *   screenY = oy − y · scale        (plan is y-up, screen is y-down)
 * where scale = PIXELS_PER_INCH · zoom. Nothing reads pixel values back as dimensions; tools
 * convert pointer positions to inches with toWorld() before doing anything else.
 */
import { createStore } from "zustand/vanilla";
import type { Point } from "@hvac/shared-types";
import { boundingBox } from "@hvac/building-geometry";

export const PIXELS_PER_INCH = 1;
export const MIN_ZOOM = 0.03;
export const MAX_ZOOM = 24;

export interface Viewport {
  zoom: number;
  ox: number;
  oy: number;
  width: number;
  height: number;
}

export const scaleOf = (v: Viewport) => PIXELS_PER_INCH * v.zoom;
export const toScreen = (v: Viewport, p: Point): Point => ({ x: v.ox + p.x * scaleOf(v), y: v.oy - p.y * scaleOf(v) });
export const toWorld = (v: Viewport, s: Point): Point => ({ x: (s.x - v.ox) / scaleOf(v), y: (v.oy - s.y) / scaleOf(v) });
/** Convert a screen-pixel tolerance into inches at the current zoom (for hit testing only). */
export const pxToIn = (v: Viewport, px: number) => px / scaleOf(v);

export function createViewportStore() {
  return createStore<Viewport & {
    setSize: (w: number, h: number) => void;
    zoomAt: (screen: Point, factor: number) => void;
    setZoom: (zoom: number) => void;
    panBy: (dx: number, dy: number) => void;
    fit: (pts: Point[], padding?: number) => void;
    centerOn: (p: Point) => void;
  }>()((set, get) => ({
    zoom: 1.2,
    ox: 120,
    oy: 600,
    width: 800,
    height: 600,
    setSize: (width, height) => set({ width, height }),
    zoomAt: (s, factor) => {
      const v = get();
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const w = toWorld(v, s);
      const sc = PIXELS_PER_INCH * zoom;
      set({ zoom, ox: s.x - w.x * sc, oy: s.y + w.y * sc });
    },
    setZoom: (zoom) => {
      const v = get();
      get().zoomAt({ x: v.width / 2, y: v.height / 2 }, zoom / v.zoom);
    },
    panBy: (dx, dy) => set((v) => ({ ox: v.ox + dx, oy: v.oy + dy })),
    fit: (pts, padding = 64) => {
      const v = get();
      if (!pts.length) {
        // Empty floor: show ~40' x 30' around the origin.
        pts = [{ x: -60, y: -60 }, { x: 480, y: 360 }];
      }
      const bb = boundingBox(pts);
      const w = Math.max(bb.width, 24);
      const h = Math.max(bb.height, 24);
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((v.width - padding * 2) / w, (v.height - padding * 2) / h) / PIXELS_PER_INCH));
      const sc = PIXELS_PER_INCH * zoom;
      const cx = (bb.minX + bb.maxX) / 2;
      const cy = (bb.minY + bb.maxY) / 2;
      set({ zoom, ox: v.width / 2 - cx * sc, oy: v.height / 2 + cy * sc });
    },
    centerOn: (p) => {
      const v = get();
      const sc = scaleOf(v);
      set({ ox: v.width / 2 - p.x * sc, oy: v.height / 2 + p.y * sc });
    },
  }));
}
export type ViewportStore = ReturnType<typeof createViewportStore>;

/** Adaptive grid: smallest minor spacing that is at least ~10px on screen. Inches. */
const GRID_LEVELS: { minor: number; major: number }[] = [
  { minor: 1, major: 12 },
  { minor: 3, major: 12 },
  { minor: 6, major: 48 },
  { minor: 12, major: 48 },
  { minor: 24, major: 120 },
  { minor: 60, major: 240 },
  { minor: 120, major: 600 },
  { minor: 600, major: 2400 },
];

export function gridLevel(zoom: number): { minor: number; major: number } {
  const sc = PIXELS_PER_INCH * zoom;
  for (const l of GRID_LEVELS) if (l.minor * sc >= 10) return l;
  return GRID_LEVELS[GRID_LEVELS.length - 1]!;
}
