/**
 * Background drawing (PRD §7 import foundation).
 *
 * TODO(schema): background placement is NOT part of the BuildingModel contract yet. It is stored in
 * the browser (localStorage, keyed by project + floor) until a `floors[].background` field (drawingId,
 * page, origin, inchesPerPixel, opacity, locked) is added to @hvac/shared-types with a schemaVersion bump
 * and Pydantic mirror. Until then, backgrounds do not sync across devices.
 */
import { createStore } from "zustand/vanilla";
import type { Point } from "@hvac/shared-types";
import { drawings } from "@/lib/api/endpoints";
import { safeLocalStorage } from "@/lib/utils";

export interface BackgroundPlacement {
  drawingId: string;
  filename: string;
  contentType: string;
  /** 1-based PDF page; 1 for images. */
  page: number;
  /** PDF render scale used to rasterize (image pixels per PDF point). 1 for images. */
  renderScale: number;
  /** Raster size in image pixels. */
  pixelWidth: number;
  pixelHeight: number;
  /** Plan position (inches) of the image's top-left corner. */
  origin: Point;
  /** Scale: plan inches per image pixel. */
  inchesPerPixel: number;
  calibrated: boolean;
  /** Real distance entered during calibration and the pixel span it was measured over. */
  calibration: { realInches: number; pixelDistance: number } | null;
  opacity: number;
  locked: boolean;
}

const key = (projectId: string, floorId: string) => `hvac.bg.${projectId}.${floorId}`;

export function loadPlacement(projectId: string, floorId: string): BackgroundPlacement | null {
  try {
    const raw = safeLocalStorage()?.getItem(key(projectId, floorId));
    return raw ? (JSON.parse(raw) as BackgroundPlacement) : null;
  } catch {
    return null;
  }
}

export function savePlacement(projectId: string, floorId: string, p: BackgroundPlacement | null) {
  const ls = safeLocalStorage();
  if (!ls) return;
  if (p) ls.setItem(key(projectId, floorId), JSON.stringify(p));
  else ls.removeItem(key(projectId, floorId));
}

/** Calibration result: the scale and whether the source has enough resolution. */
export function calibrationQuality(inchesPerPixel: number) {
  // At this scale one image pixel covers `inchesPerPixel` inches of the real building.
  // Above 1"/px, traced dimensions can't be trusted to the inch.
  return {
    inchesPerPixel,
    pixelsPerFoot: 12 / inchesPerPixel,
    insufficient: inchesPerPixel > 1,
  };
}

// ---------------------------------------------------------------------------
// Raster cache: drawingId+page → canvas/image element
// ---------------------------------------------------------------------------
const cache = new Map<string, Promise<CanvasImageSource & { width: number; height: number }>>();

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((m) => {
      // The worker is copied to /public by scripts/copy-pdf-worker.mjs (predev/prebuild), so it is
      // served as a static module instead of going through the bundler.
      m.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return m;
    });
  }
  return pdfjsPromise;
}

export async function openPdf(data: ArrayBuffer) {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
}

export type PdfDoc = Awaited<ReturnType<typeof openPdf>>;

export async function renderPdfPage(doc: PdfDoc, pageNum: number, scale: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas;
}

export function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't decode the image."));
    img.src = url;
  });
}

export function getRaster(p: Pick<BackgroundPlacement, "drawingId" | "page" | "contentType" | "renderScale">) {
  const k = `${p.drawingId}:${p.page}:${p.renderScale}`;
  let pr = cache.get(k);
  if (!pr) {
    pr = (async () => {
      const blob = await drawings.fetchFile(p.drawingId);
      if (p.contentType === "application/pdf") {
        const doc = await openPdf(await blob.arrayBuffer());
        return renderPdfPage(doc, p.page, p.renderScale);
      }
      return blobToImage(blob);
    })();
    pr.catch(() => cache.delete(k));
    cache.set(k, pr);
  }
  return pr;
}

/** Seed the cache with an already-rendered raster (right after import). */
export function primeRaster(p: Pick<BackgroundPlacement, "drawingId" | "page" | "renderScale">, src: CanvasImageSource & { width: number; height: number }) {
  cache.set(`${p.drawingId}:${p.page}:${p.renderScale}`, Promise.resolve(src));
}

// ---------------------------------------------------------------------------
// Store (per mounted studio)
// ---------------------------------------------------------------------------
export function createBackgroundStore(projectId: string) {
  return createStore<{
    byFloor: Record<string, BackgroundPlacement | null>;
    ensure: (floorId: string) => void;
    set: (floorId: string, p: BackgroundPlacement | null) => void;
    update: (floorId: string, patch: Partial<BackgroundPlacement>) => void;
  }>()((set, get) => ({
    byFloor: {},
    ensure: (floorId) => {
      if (floorId in get().byFloor) return;
      set({ byFloor: { ...get().byFloor, [floorId]: loadPlacement(projectId, floorId) } });
    },
    set: (floorId, p) => {
      savePlacement(projectId, floorId, p);
      set({ byFloor: { ...get().byFloor, [floorId]: p } });
    },
    update: (floorId, patch) => {
      const cur = get().byFloor[floorId];
      if (!cur) return;
      const next = { ...cur, ...patch };
      savePlacement(projectId, floorId, next);
      set({ byFloor: { ...get().byFloor, [floorId]: next } });
    },
  }));
}
export type BackgroundStore = ReturnType<typeof createBackgroundStore>;
