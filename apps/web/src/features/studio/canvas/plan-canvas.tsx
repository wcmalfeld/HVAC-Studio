"use client";
/**
 * Plan canvas. Layer separation:
 *   grid layer        – background color + adaptive grid (redraws on viewport/theme change)
 *   drawing layer     – imported background drawing (Konva.Image; redraws on viewport/placement)
 *   model layer       – ghost floors + rooms/walls/openings/dimensions (redraws on model/selection/viewport)
 *   overlay layer     – tool previews, snapping, marquee (redraws on pointer moves)
 * Every layer is listening=false; picking is done geometrically in hit-test.ts. Layers are redrawn
 * imperatively from store subscriptions so React never re-renders on pointer moves.
 */
import * as React from "react";
import { Stage, Layer, Shape, Image as KImage } from "react-konva";
import type Konva from "konva";
import { useStudio } from "../context";
import { scaleOf } from "../viewport";
import { drawGhost, drawGrid, drawModel, drawOverlay } from "./render";
import { raw } from "./draw";
import { usePlanColors, type PlanColors } from "./theme";
import { attachInteractions, fitPoints, type InteractionCallbacks } from "./interactions";
import { getRaster } from "../background";

export default function PlanCanvas({ callbacks }: { callbacks: InteractionCallbacks }) {
  const stores = useStudio();
  const { editor, viewport, overlay, background } = stores;
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const gridLayer = React.useRef<Konva.Layer>(null);
  const bgLayer = React.useRef<Konva.Layer>(null);
  const bgImage = React.useRef<Konva.Image>(null);
  const modelLayer = React.useRef<Konva.Layer>(null);
  const overlayLayer = React.useRef<Konva.Layer>(null);
  const colors = usePlanColors();
  const colorsRef = React.useRef<PlanColors>(colors);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const cbRef = React.useRef(callbacks);
  React.useLayoutEffect(() => {
    colorsRef.current = colors;
    cbRef.current = callbacks;
  });

  // Size tracking
  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let first = true;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry!.contentRect.width);
      const h = Math.floor(entry!.contentRect.height);
      setSize({ w, h });
      viewport.getState().setSize(w, h);
      if (first && w > 0 && h > 0) {
        first = false;
        viewport.getState().fit(fitPoints(stores));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewport, stores]);

  // Interactions
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    return attachInteractions(el, stores, {
      notify: (m, k) => cbRef.current.notify(m, k),
      onCalibratePoints: (a, b) => cbRef.current.onCalibratePoints(a, b),
    });
  }, [stores]);

  // Background raster for the current floor
  const [raster, setRaster] = React.useState<(CanvasImageSource & { width: number; height: number }) | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    const load = () => {
      const { floorId } = editor.getState();
      background.getState().ensure(floorId);
      const p = background.getState().byFloor[floorId];
      if (!p) {
        setRaster(null);
        return;
      }
      getRaster(p)
        .then((r) => !cancelled && setRaster(r))
        .catch(() => {
          if (!cancelled) {
            setRaster(null);
            cbRef.current.notify("Couldn't load the background drawing for this floor.", "error");
          }
        });
    };
    load();
    let lastKey = "";
    const unsubA = editor.subscribe((s, p) => {
      if (s.floorId !== p.floorId) load();
    });
    const unsubB = background.subscribe((s) => {
      const p = s.byFloor[editor.getState().floorId];
      const key = p ? `${p.drawingId}:${p.page}:${p.renderScale}` : "";
      if (key !== lastKey) {
        lastKey = key;
        load();
      }
    });
    return () => {
      cancelled = true;
      unsubA();
      unsubB();
    };
  }, [editor, background]);

  // Imperative redraw wiring
  React.useEffect(() => {
    const drawGridL = () => gridLayer.current?.batchDraw();
    const drawModelL = () => modelLayer.current?.batchDraw();
    const drawOverlayL = () => overlayLayer.current?.batchDraw();
    const placeBg = () => {
      const img = bgImage.current;
      const { floorId, layers } = editor.getState();
      const p = background.getState().byFloor[floorId];
      if (!img) return;
      if (!p || !layers.background) {
        img.visible(false);
        bgLayer.current?.batchDraw();
        return;
      }
      const v = viewport.getState();
      const s = scaleOf(v) * p.inchesPerPixel;
      img.visible(true);
      img.x(v.ox + p.origin.x * scaleOf(v));
      img.y(v.oy - p.origin.y * scaleOf(v));
      img.scaleX(s);
      img.scaleY(s);
      img.opacity(p.opacity);
      bgLayer.current?.batchDraw();
    };
    const u1 = viewport.subscribe(() => {
      drawGridL();
      placeBg();
      drawModelL();
      drawOverlayL();
    });
    const u2 = editor.subscribe((s, p) => {
      if (s.model !== p.model || s.selection !== p.selection || s.floorId !== p.floorId || s.layers !== p.layers) drawModelL();
      if (s.gridVisible !== p.gridVisible) drawGridL();
      if (s.floorId !== p.floorId || s.layers !== p.layers) placeBg();
      if (s.tool !== p.tool || s.model !== p.model) drawOverlayL();
    });
    const u3 = overlay.subscribe((s, p) => {
      if (s.hoverId !== p.hoverId) drawModelL();
      drawOverlayL();
    });
    const u4 = background.subscribe(placeBg);
    placeBg();
    return () => {
      u1();
      u2();
      u3();
      u4();
    };
  }, [editor, viewport, overlay, background, raster]);

  // Theme change → redraw all
  React.useEffect(() => {
    gridLayer.current?.batchDraw();
    modelLayer.current?.batchDraw();
    overlayLayer.current?.batchDraw();
  }, [colors]);

  const gridScene = React.useCallback(
    (ctx: Konva.Context) => {
      drawGrid(raw(ctx), viewport.getState(), colorsRef.current, editor.getState().gridVisible);
    },
    [viewport, editor],
  );
  const modelScene = React.useCallback(
    (ctx: Konva.Context) => {
      const c = raw(ctx);
      const e = editor.getState();
      const v = viewport.getState();
      if (e.layers.ghost) drawGhost(c, e.model, e.floorId, v, colorsRef.current);
      drawModel(c, { model: e.model, floorId: e.floorId, selection: new Set(e.selection), hoverId: overlay.getState().hoverId, layers: e.layers }, v, colorsRef.current);
    },
    [editor, viewport, overlay],
  );
  const overlayScene = React.useCallback(
    (ctx: Konva.Context) => {
      const e = editor.getState();
      drawOverlay(raw(ctx), { o: overlay.getState(), tool: e.tool, units: e.model.displayUnits, model: e.model }, viewport.getState(), colorsRef.current);
    },
    [editor, viewport, overlay],
  );

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 touch-none select-none outline-none"
      tabIndex={0}
      role="application"
      aria-label="Floor plan canvas"
      data-testid="plan-canvas"
    >
      {size.w > 0 && size.h > 0 ? (
        <Stage width={size.w} height={size.h} listening={false}>
          <Layer ref={gridLayer} listening={false}>
            <Shape sceneFunc={gridScene} listening={false} perfectDrawEnabled={false} />
          </Layer>
          <Layer ref={bgLayer} listening={false}>
            {raster ? <KImage ref={bgImage} image={raster as CanvasImageSource} listening={false} perfectDrawEnabled={false} /> : null}
          </Layer>
          <Layer ref={modelLayer} listening={false}>
            <Shape sceneFunc={modelScene} listening={false} perfectDrawEnabled={false} />
          </Layer>
          <Layer ref={overlayLayer} listening={false}>
            <Shape sceneFunc={overlayScene} listening={false} perfectDrawEnabled={false} />
          </Layer>
        </Stage>
      ) : null}
    </div>
  );
}
