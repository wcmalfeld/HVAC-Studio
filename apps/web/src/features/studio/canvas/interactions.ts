/**
 * Pointer + keyboard interaction controller for the plan canvas. Framework-free: attaches DOM
 * listeners to the canvas container and talks to the stores directly, so pointer moves never go
 * through React rendering. Every pointer position is converted to plan inches immediately.
 */
import type { BuildingModel, Point, Wall } from "@hvac/shared-types";
import {
  collectSnapPoints,
  dist,
  isSimplePolygon,
  parseLength,
  pointInPolygon,
  polygonArea,
  roomFromWalls,
  snapAngle,
  snapToGrid,
  snapToPoints,
  snapToWall,
  wallLength,
  pointsEqual,
} from "@hvac/building-geometry";
import type { StudioStores } from "../context";
import { gridLevel, pxToIn, toWorld, toScreen } from "../viewport";
import { entitiesInRect, hitTest } from "../hit-test";
import {
  addRoomWithWalls,
  clampOpeningOffset,
  makeOpening,
  makeRoom,
  makeWall,
  moveEntities,
  moveWallEndpoint,
  nextRoomName,
  slideOpening,
  OPENING_DEFAULTS,
} from "../model-ops";
import type { ToolId } from "../store";

export interface InteractionCallbacks {
  notify: (msg: string, kind?: "info" | "error") => void;
  onCalibratePoints: (a: Point, b: Point) => void;
}

const SNAP_PX = 9;
const HIT_PX = 6;
const DRAG_THRESHOLD_PX = 3;
const round16 = (p: Point): Point => ({ x: Math.round(p.x * 16) / 16 + 0, y: Math.round(p.y * 16) / 16 + 0 });

type Drag =
  | { kind: "pan"; last: Point }
  | { kind: "marquee"; start: Point; additive: boolean }
  | { kind: "move"; startWorld: Point; anchor: Point; ids: Set<string>; started: boolean; startScreen: Point }
  | { kind: "slide"; openingId: string; started: boolean; startScreen: Point }
  | { kind: "endpoint"; wallId: string; which: "start" | "end"; started: boolean; startScreen: Point; from: Point }
  | { kind: "rect"; a: Point; startScreen: Point }
  | { kind: "measure"; a: Point }
  | { kind: "background"; startWorld: Point; origin: Point };

export function attachInteractions(el: HTMLElement, stores: StudioStores, cb: InteractionCallbacks) {
  const { editor, viewport, overlay, background } = stores;
  const E = () => editor.getState();
  const V = () => viewport.getState();
  const O = () => overlay.getState();

  let drag: Drag | null = null;
  let shift = false;
  let snapCache: { model: BuildingModel; floorId: string; pts: Point[] } | null = null;

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const world = (s: Point) => toWorld(V(), s);
  const tolIn = (px: number) => pxToIn(V(), px);
  const floorWalls = (): Wall[] => E().model.walls.filter((w) => w.floorId === E().floorId);
  const layersHit = () => {
    const l = E().layers;
    return { walls: l.walls, openings: l.openings, rooms: l.rooms };
  };

  function snapPoints(): Point[] {
    const { model, floorId } = E();
    if (!snapCache || snapCache.model !== model || snapCache.floorId !== floorId) {
      snapCache = { model, floorId, pts: collectSnapPoints(model, floorId) };
    }
    return snapCache.pts;
  }

  /** Snap a world point: endpoints/midpoints → angle (from origin) → grid. Shift disables angle+grid. */
  function snap(p: Point, origin?: Point | null, exclude?: Point[]): { point: Point; kind: "point" | "grid" | "angle" | null } {
    const { snapEnabled } = E();
    if (!snapEnabled) return { point: round16(p), kind: null };
    let cands = snapPoints();
    if (exclude?.length) cands = cands.filter((c) => !exclude.some((x) => pointsEqual(x, c, 0.01)));
    const pt = snapToPoints(p, cands, tolIn(SNAP_PX));
    if (pt.snapped) return { point: pt.point, kind: "point" };
    if (shift) return { point: round16(p), kind: null };
    const step = gridLevel(V().zoom).minor;
    if (origin) {
      const a = snapAngle(origin, p, 15);
      const len = dist(origin, a);
      const snappedLen = Math.max(step, Math.round(len / step) * step);
      const k = len > 0 ? snappedLen / len : 0;
      return { point: round16({ x: origin.x + (a.x - origin.x) * k, y: origin.y + (a.y - origin.y) * k }), kind: "angle" };
    }
    return { point: snapToGrid(p, step), kind: "grid" };
  }

  function setCursorStyle() {
    const tool = E().tool;
    const o = O();
    let c = "default";
    if (o.panning) c = "grabbing";
    else if (o.spaceDown || tool === "pan") c = "grab";
    else if (tool === "select") c = o.hoverId ? "pointer" : "default";
    else c = "crosshair";
    if (el.style.cursor !== c) el.style.cursor = c;
  }

  // ---------------------------------------------------------------------------
  // Finishers
  // ---------------------------------------------------------------------------
  function finishWallChain() {
    overlay.getState().patch({ chain: [], preview: null, typed: "" });
  }

  function addWallSegment(to: Point) {
    const o = O();
    const last = o.chain[o.chain.length - 1];
    if (!last) {
      overlay.getState().patch({ chain: [to] });
      return;
    }
    if (dist(last, to) < 0.5) {
      // click on the same point (double click) → finish
      finishWallChain();
      return;
    }
    const w = makeWall(E().floorId, last, to, { height: currentFloor()?.defaultCeilingHeight ?? 96 });
    E().commit((d) => void d.walls.push(w), { label: "Draw wall" });
    const closes = o.chain.length >= 2 && dist(o.chain[0]!, to) < 0.5;
    if (closes) finishWallChain();
    else overlay.getState().patch({ chain: [...o.chain, to], typed: "" });
  }

  function currentFloor() {
    const { model, floorId } = E();
    return model.floors.find((f) => f.id === floorId);
  }

  function finishPoly() {
    const pts = O().poly;
    overlay.getState().patch({ poly: [], preview: null });
    if (pts.length < 3) return;
    if (!isSimplePolygon(pts)) {
      cb.notify("That outline crosses itself. Draw the room without overlapping edges.", "error");
      return;
    }
    if (polygonArea(pts) < 144) {
      cb.notify("Rooms must be at least 1 ft².", "error");
      return;
    }
    let ids: string[] = [];
    const skip = !E().rectRoomWalls;
    E().commit((d) => {
      ids = addRoomWithWalls(d as BuildingModel, E().floorId, pts, { skipWalls: skip, wallHeight: currentFloor()?.defaultCeilingHeight });
    }, { label: "Draw room" });
    E().setSelection(ids.slice(0, 1));
  }

  function applyTyped() {
    const o = O();
    const tool = E().tool;
    const len = parseLength(o.typed, E().model.displayUnits);
    if (len === null || len <= 0) {
      cb.notify(`"${o.typed}" isn't a length. Try 12' 6" or 3.8m.`, "error");
      overlay.getState().patch({ typed: "" });
      return;
    }
    const chain = tool === "wall" ? o.chain : o.poly;
    const last = chain[chain.length - 1];
    if (!last) return;
    const target = o.preview ?? { x: last.x + 1, y: last.y };
    const d = dist(last, target);
    const dir = d > 0 ? { x: (target.x - last.x) / d, y: (target.y - last.y) / d } : { x: 1, y: 0 };
    const p = round16({ x: last.x + dir.x * len, y: last.y + dir.y * len });
    overlay.getState().patch({ typed: "" });
    if (tool === "wall") addWallSegment(p);
    else overlay.getState().patch({ poly: [...o.poly, p] });
  }

  // ---------------------------------------------------------------------------
  // Pointer
  // ---------------------------------------------------------------------------
  function onPointerDown(e: PointerEvent) {
    if (e.button === 2) return;
    el.focus({ preventScroll: true });
    shift = e.shiftKey;
    const s = local(e);
    const w = world(s);
    const tool = E().tool;
    const o = O();

    if (e.button === 1 || o.spaceDown || tool === "pan") {
      e.preventDefault();
      drag = { kind: "pan", last: s };
      overlay.getState().patch({ panning: true });
      el.setPointerCapture(e.pointerId);
      setCursorStyle();
      return;
    }
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId);

    switch (tool) {
      case "select": {
        const hit = hitTest(E().model, E().floorId, w, tolIn(HIT_PX), new Set(E().selection), layersHit());
        if (!hit) {
          // background drag (unlocked) or marquee
          const bg = background.getState().byFloor[E().floorId];
          if (bg && !bg.locked && E().layers.background && pointInBg(w, bg)) {
            drag = { kind: "background", startWorld: w, origin: bg.origin };
            return;
          }
          if (!e.shiftKey) E().setSelection([]);
          drag = { kind: "marquee", start: s, additive: e.shiftKey };
          return;
        }
        if (hit.kind === "handle") {
          drag = { kind: "endpoint", wallId: hit.wallId, which: hit.which, started: false, startScreen: s, from: hit.point };
          return;
        }
        const id = hit.id;
        if (e.shiftKey) {
          E().toggleSelection(id);
          return; // no drag on shift-click
        }
        if (!E().selection.includes(id)) E().setSelection([id]);
        if (hit.kind === "opening" && E().selection.length === 1) {
          drag = { kind: "slide", openingId: id, started: false, startScreen: s };
          return;
        }
        const ids = new Set(E().selection);
        drag = { kind: "move", startWorld: w, anchor: anchorFor(E().model, id, w), ids, started: false, startScreen: s };
        return;
      }
      case "wall": {
        const last = o.chain[o.chain.length - 1];
        const p = snap(w, last).point;
        addWallSegment(p);
        return;
      }
      case "rect-room": {
        const p = snap(w).point;
        drag = { kind: "rect", a: p, startScreen: s };
        overlay.getState().patch({ rect: { a: p, b: p } });
        return;
      }
      case "poly-room": {
        const last = o.poly[o.poly.length - 1];
        const p = snap(w, last).point;
        if (o.poly.length >= 3 && dist(p, o.poly[0]!) <= tolIn(SNAP_PX)) return finishPoly();
        if (last && dist(last, p) < 0.5) return finishPoly();
        overlay.getState().patch({ poly: [...o.poly, p] });
        return;
      }
      case "fill-room": {
        const existing = E().model.rooms
          .filter((r) => r.floorId === E().floorId && pointInPolygon(w, r.boundary))
          .sort((a, b) => polygonArea(a.boundary) - polygonArea(b.boundary))[0];
        const boundary = roomFromWalls(E().model, E().floorId, w);
        if (!boundary) {
          cb.notify("No closed set of walls around that point. Close the walls first, or draw the room with the rectangle or polygon tool.", "error");
          return;
        }
        if (existing && Math.abs(polygonArea(existing.boundary) - polygonArea(boundary)) < 1) {
          E().setSelection([existing.id]);
          cb.notify(`${existing.name} already fills that space.`);
          return;
        }
        const room = makeRoom(E().floorId, boundary, nextRoomName(E().model));
        E().commit((d) => void d.rooms.push(room), { label: "Create room", select: [room.id] });
        return;
      }
      case "window":
      case "door": {
        const op = O().opening;
        if (!op) {
          cb.notify(`Hover a wall to place a ${tool}.`);
          return;
        }
        const wall = E().model.walls.find((x) => x.id === op.wallId);
        if (!wall) return;
        if (wallLength(wall) < op.width) {
          cb.notify(`That wall is shorter than a ${op.width}" ${tool}.`, "error");
          return;
        }
        const opening = makeOpening(tool, op.wallId, op.offset);
        E().commit((d) => void d.openings.push(opening), { label: tool === "window" ? "Add window" : "Add door", select: [opening.id] });
        return;
      }
      case "measure": {
        const p = snap(w).point;
        drag = { kind: "measure", a: p };
        overlay.getState().patch({ measure: { a: p, b: p } });
        return;
      }
      case "calibrate": {
        const c = O().calibrate;
        if (!c.a || (c.a && c.b)) {
          overlay.getState().patch({ calibrate: { a: w, b: null } });
        } else {
          overlay.getState().patch({ calibrate: { a: c.a, b: w } });
          cb.onCalibratePoints(c.a, w);
        }
        return;
      }
    }
  }

  function onPointerMove(e: PointerEvent) {
    shift = e.shiftKey;
    const s = local(e);
    const w = world(s);
    const tool = E().tool;
    const o = O();
    const patch: Partial<ReturnType<typeof O>> = { cursor: w };

    if (drag) {
      switch (drag.kind) {
        case "pan": {
          viewport.getState().panBy(s.x - drag.last.x, s.y - drag.last.y);
          drag.last = s;
          break;
        }
        case "marquee":
          patch.marquee = { a: drag.start, b: s };
          break;
        case "move": {
          if (!drag.started) {
            if (dist(s, drag.startScreen) < DRAG_THRESHOLD_PX) break;
            drag.started = true;
            E().beginGesture("Move");
          }
          const raw = { x: drag.anchor.x + (w.x - drag.startWorld.x), y: drag.anchor.y + (w.y - drag.startWorld.y) };
          const movedPts = selectionPoints(E().gesture?.base ?? E().model, drag.ids);
          const sp = snap(raw, null, movedPts);
          const delta = { x: sp.point.x - drag.anchor.x, y: sp.point.y - drag.anchor.y };
          const ids = drag.ids;
          E().updateGesture((d, base) => moveEntities(d as BuildingModel, base, ids, delta));
          patch.snap = sp.kind === "point" ? { point: sp.point, kind: "point" } : null;
          break;
        }
        case "slide": {
          if (!drag.started) {
            if (dist(s, drag.startScreen) < DRAG_THRESHOLD_PX) break;
            drag.started = true;
            E().beginGesture("Move opening");
          }
          const id = drag.openingId;
          const step = E().snapEnabled && !shift ? Math.min(gridLevel(V().zoom).minor, 6) : 0;
          E().updateGesture((d) => {
            slideOpening(d as BuildingModel, id, w);
            if (step) {
              const op = d.openings.find((x) => x.id === id)!;
              const wall = d.walls.find((x) => x.id === op.wallId)!;
              op.offset = clampOpeningOffset(Math.round(op.offset / step) * step, op.width, wallLength(wall as Wall));
            }
          });
          break;
        }
        case "endpoint": {
          if (!drag.started) {
            if (dist(s, drag.startScreen) < DRAG_THRESHOLD_PX) break;
            drag.started = true;
            E().beginGesture("Move wall end");
          }
          const base = E().gesture?.base ?? E().model;
          const bw = base.walls.find((x) => x.id === (drag as { wallId: string }).wallId);
          const other = bw ? (drag.which === "start" ? bw.end : bw.start) : null;
          const sp = snap(w, other, [drag.from]);
          const { wallId, which } = drag;
          E().updateGesture((d, b) => moveWallEndpoint(d as BuildingModel, b, wallId, which, sp.point));
          patch.snap = sp.kind ? { point: sp.point, kind: sp.kind === "point" ? "point" : "grid" } : null;
          break;
        }
        case "rect": {
          const b = snap(w).point;
          patch.rect = { a: drag.a, b };
          patch.snap = { point: b, kind: "grid" };
          break;
        }
        case "measure": {
          const b = snap(w, drag.a).point;
          patch.measure = { a: drag.a, b };
          patch.snap = { point: b, kind: "grid" };
          break;
        }
        case "background": {
          const bgDrag = drag;
          background.getState().update(E().floorId, {
            origin: round16({ x: bgDrag.origin.x + (w.x - bgDrag.startWorld.x), y: bgDrag.origin.y + (w.y - bgDrag.startWorld.y) }),
          });
          break;
        }
      }
      overlay.getState().patch(patch);
      return;
    }

    // Hover / previews
    switch (tool) {
      case "select": {
        const hit = hitTest(E().model, E().floorId, w, tolIn(HIT_PX), new Set(E().selection), layersHit());
        patch.hoverId = hit && hit.kind !== "handle" ? hit.id : null;
        break;
      }
      case "wall": {
        const last = o.chain[o.chain.length - 1];
        const sp = snap(w, last);
        patch.preview = sp.point;
        patch.snap = sp.kind ? { point: sp.point, kind: sp.kind } : null;
        break;
      }
      case "poly-room": {
        const last = o.poly[o.poly.length - 1];
        const sp = snap(w, last);
        patch.preview = sp.point;
        patch.snap = sp.kind ? { point: sp.point, kind: sp.kind } : null;
        break;
      }
      case "rect-room":
      case "measure": {
        const sp = snap(w);
        patch.snap = sp.kind ? { point: sp.point, kind: sp.kind } : null;
        break;
      }
      case "fill-room": {
        const hit = hitTest(E().model, E().floorId, w, 0, new Set(), { walls: false, openings: false, rooms: true });
        patch.hoverId = hit && hit.kind === "room" ? hit.id : null;
        break;
      }
      case "window":
      case "door": {
        const hit = snapToWall(w, floorWalls(), tolIn(14));
        if (!hit) {
          patch.opening = null;
          patch.snap = null;
          break;
        }
        const wall = E().model.walls.find((x) => x.id === hit.wallId)!;
        const width = OPENING_DEFAULTS[tool].width;
        const len = wallLength(wall);
        const step = E().snapEnabled && !shift ? Math.min(gridLevel(V().zoom).minor, 6) : 1 / 16;
        const offset = clampOpeningOffset(Math.round(hit.offset / step) * step, width, len);
        patch.opening = { wallId: wall.id, offset, type: tool, width };
        patch.snap = null;
        break;
      }
      case "calibrate": {
        if (o.calibrate.a && !o.calibrate.b) patch.preview = w;
        break;
      }
    }
    overlay.getState().patch(patch);
    setCursorStyle();
  }

  function onPointerUp(e: PointerEvent) {
    const s = local(e);
    const w = world(s);
    const d = drag;
    drag = null;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (!d) return;
    switch (d.kind) {
      case "pan":
        overlay.getState().patch({ panning: false });
        break;
      case "marquee": {
        const a = world(d.start);
        if (dist(d.start, s) > DRAG_THRESHOLD_PX) {
          const contain = s.x >= d.start.x; // left→right: window select; right→left: crossing
          const ids = entitiesInRect(E().model, E().floorId, a, w, contain, layersHit());
          E().setSelection(d.additive ? [...E().selection, ...ids] : ids);
        }
        overlay.getState().patch({ marquee: null });
        break;
      }
      case "move":
      case "slide":
      case "endpoint":
        if (d.started) E().endGesture();
        overlay.getState().patch({ snap: null });
        break;
      case "rect": {
        const rect = O().rect;
        overlay.getState().patch({ rect: null });
        if (!rect) break;
        const width = Math.abs(rect.b.x - rect.a.x), depth = Math.abs(rect.b.y - rect.a.y);
        if (width < 12 || depth < 12) {
          if (dist(d.startScreen, s) > DRAG_THRESHOLD_PX) cb.notify("Rooms need to be at least 1' on each side.");
          break;
        }
        const minX = Math.min(rect.a.x, rect.b.x), minY = Math.min(rect.a.y, rect.b.y);
        const boundary = [
          { x: minX, y: minY },
          { x: minX + width, y: minY },
          { x: minX + width, y: minY + depth },
          { x: minX, y: minY + depth },
        ];
        let ids: string[] = [];
        const skip = !E().rectRoomWalls;
        E().commit((dr) => {
          ids = addRoomWithWalls(dr as BuildingModel, E().floorId, boundary, { skipWalls: skip, wallHeight: currentFloor()?.defaultCeilingHeight });
        }, { label: "Draw room" });
        E().setSelection(ids.slice(0, 1));
        break;
      }
      case "measure":
        // keep the tape visible until the next measure / Esc
        break;
      case "background":
        break;
    }
    setCursorStyle();
  }

  function onDblClick() {
    const tool = E().tool;
    if (tool === "wall") finishWallChain();
    if (tool === "poly-room") finishPoly();
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const s = local(e);
    // Trackpad two-finger scroll (no ctrl, has horizontal component or small deltas in pixel mode) pans;
    // mouse wheel and pinch (ctrlKey) zoom around the cursor.
    const isPinch = e.ctrlKey;
    const looksLikeTrackpadPan = !isPinch && e.deltaMode === 0 && Math.abs(e.deltaX) > 0.5;
    if (looksLikeTrackpadPan) {
      viewport.getState().panBy(-e.deltaX, -e.deltaY);
      return;
    }
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const factor = Math.exp(-dy * (isPinch ? 0.01 : 0.0015));
    viewport.getState().zoomAt(s, factor);
  }

  function onPointerLeave() {
    if (!drag) overlay.getState().patch({ cursor: null, hoverId: null, snap: null, opening: null });
  }

  // ---------------------------------------------------------------------------
  // Keyboard (only when focus isn't in a form field)
  // ---------------------------------------------------------------------------
  function isTyping(t: EventTarget | null) {
    const el2 = t as HTMLElement | null;
    if (!el2) return false;
    const tag = el2.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el2.isContentEditable;
  }

  function onKeyDown(e: KeyboardEvent) {
    shift = e.shiftKey;
    if (isTyping(e.target)) return;
    if (document.querySelector("[role=dialog],[role=alertdialog]")) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    const tool = E().tool;
    const o = O();

    if (k === " " && !o.spaceDown) {
      e.preventDefault();
      overlay.getState().patch({ spaceDown: true });
      setCursorStyle();
      return;
    }

    // Typed length while drawing a wall / polygon
    const drawing = (tool === "wall" && o.chain.length > 0) || (tool === "poly-room" && o.poly.length > 0);
    if (drawing && !mod && /^[0-9.'"\-\/ ]$|^[a-z]$/i.test(k) && (o.typed || /[0-9.]/.test(k))) {
      e.preventDefault();
      overlay.getState().patch({ typed: o.typed + k });
      return;
    }
    if (drawing && o.typed && k === "Backspace") {
      e.preventDefault();
      overlay.getState().patch({ typed: o.typed.slice(0, -1) });
      return;
    }

    if (k === "Enter") {
      if (o.typed) return applyTyped();
      if (tool === "wall") return finishWallChain();
      if (tool === "poly-room") return finishPoly();
    }
    if (k === "Escape") {
      if (E().gesture) {
        E().cancelGesture();
        drag = null;
        overlay.getState().patch({ marquee: null, snap: null });
        return;
      }
      if (o.typed) return overlay.getState().patch({ typed: "" });
      if (o.chain.length || o.poly.length || o.measure || o.rect || o.calibrate.a) {
        overlay.getState().resetTool();
        return;
      }
      if (tool !== "select") return E().setTool("select");
      E().setSelection([]);
      return;
    }

    if (mod) {
      const key = k.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (tool === "wall" && o.chain.length > 1) overlay.getState().patch({ chain: o.chain.slice(0, -1) });
        else if (tool === "wall" && o.chain.length === 1) {
          overlay.getState().patch({ chain: [] });
          return;
        }
        E().undo();
        return;
      }
      if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        E().redo();
        return;
      }
      if (key === "c") {
        if (!E().selection.length) return;
        e.preventDefault();
        E().copySelection();
        cb.notify(`Copied ${E().selection.length} ${E().selection.length === 1 ? "item" : "items"}`);
        return;
      }
      if (key === "x") {
        if (!E().selection.length) return;
        e.preventDefault();
        E().copySelection();
        E().deleteSelection();
        return;
      }
      if (key === "v") {
        e.preventDefault();
        E().paste();
        return;
      }
      if (key === "a") {
        e.preventDefault();
        const { model, floorId } = E();
        E().setSelection([
          ...model.rooms.filter((r) => r.floorId === floorId).map((r) => r.id),
          ...model.walls.filter((w) => w.floorId === floorId).map((w) => w.id),
        ]);
        return;
      }
      if (key === "0") {
        e.preventDefault();
        stores.viewport.getState().setZoom(1);
        return;
      }
      if (key === "=" || key === "+") {
        e.preventDefault();
        zoomStep(1.25);
        return;
      }
      if (key === "-") {
        e.preventDefault();
        zoomStep(0.8);
        return;
      }
      return;
    }

    if (k === "Delete" || k === "Backspace") {
      e.preventDefault();
      E().deleteSelection();
      return;
    }
    if (e.altKey) return;
    const tools: Record<string, ToolId> = { v: "select", w: "wall", b: "rect-room", f: "fill-room", p: "poly-room", n: "window", d: "door", m: "measure", h: "pan" };
    const lk = k.toLowerCase();
    if (tools[lk] && !e.shiftKey) {
      e.preventDefault();
      setTool(tools[lk]!);
      return;
    }
    if (lk === "r" && !e.shiftKey) {
      e.preventDefault();
      E().rotateSelection(90);
      return;
    }
    if (lk === "g") return E().set({ gridVisible: !E().gridVisible });
    if (lk === "s" && !e.shiftKey) return E().set({ snapEnabled: !E().snapEnabled });
    if (k === "!" || (e.shiftKey && k === "1")) return zoomToFit();
    if (k === "+" || k === "=") return zoomStep(1.25);
    if (k === "-") return zoomStep(0.8);
    // Arrow keys nudge the selection (1", Shift = 1')
    if (k.startsWith("Arrow") && E().selection.length) {
      e.preventDefault();
      const step = e.shiftKey ? 12 : 1;
      const delta = { x: k === "ArrowLeft" ? -step : k === "ArrowRight" ? step : 0, y: k === "ArrowDown" ? -step : k === "ArrowUp" ? step : 0 };
      const ids = new Set(E().selection);
      const base = E().model;
      E().commit((dr) => moveEntities(dr as BuildingModel, base, ids, delta), { coalesceKey: "nudge", label: "Nudge" });
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    shift = e.shiftKey;
    if (e.key === " ") {
      overlay.getState().patch({ spaceDown: false });
      setCursorStyle();
    }
  }

  function zoomStep(f: number) {
    const v = V();
    viewport.getState().zoomAt({ x: v.width / 2, y: v.height / 2 }, f);
  }

  function zoomToFit() {
    stores.viewport.getState().fit(fitPoints(stores));
  }

  function setTool(t: ToolId) {
    overlay.getState().resetTool();
    E().setTool(t);
  }

  const onContext = (e: Event) => e.preventDefault();
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
  el.addEventListener("pointerleave", onPointerLeave);
  el.addEventListener("dblclick", onDblClick);
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("contextmenu", onContext);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  const unsubTool = editor.subscribe((s, prev) => {
    if (s.tool !== prev.tool) {
      overlay.getState().resetTool();
      overlay.getState().patch({ hoverId: null });
      setCursorStyle();
    }
  });
  const unsubSpace = overlay.subscribe((s, p) => {
    if (s.spaceDown !== p.spaceDown || s.hoverId !== p.hoverId) setCursorStyle();
  });

  return () => {
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerUp);
    el.removeEventListener("pointerleave", onPointerLeave);
    el.removeEventListener("dblclick", onDblClick);
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("contextmenu", onContext);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    unsubTool();
    unsubSpace();
  };
}

function anchorFor(model: BuildingModel, id: string, fallback: Point): Point {
  const w = model.walls.find((x) => x.id === id);
  if (w) return dist(fallback, w.start) <= dist(fallback, w.end) ? w.start : w.end;
  const r = model.rooms.find((x) => x.id === id);
  if (r) {
    let best = r.boundary[0]!;
    for (const p of r.boundary) if (dist(p, fallback) < dist(best, fallback)) best = p;
    return best;
  }
  return fallback;
}

function selectionPoints(model: BuildingModel, ids: Set<string>): Point[] {
  const pts: Point[] = [];
  for (const w of model.walls) if (ids.has(w.id)) pts.push(w.start, w.end);
  for (const r of model.rooms) if (ids.has(r.id)) pts.push(...r.boundary);
  // connected walls' endpoints move too; exclude them from snap candidates via proximity
  return pts;
}

function pointInBg(p: Point, bg: { origin: Point; pixelWidth: number; pixelHeight: number; inchesPerPixel: number }) {
  const w = bg.pixelWidth * bg.inchesPerPixel, h = bg.pixelHeight * bg.inchesPerPixel;
  return p.x >= bg.origin.x && p.x <= bg.origin.x + w && p.y <= bg.origin.y && p.y >= bg.origin.y - h;
}

/** Points to frame for zoom-to-fit: current floor geometry plus its background drawing. */
export function fitPoints(stores: StudioStores): Point[] {
  const { model, floorId } = stores.editor.getState();
  const pts: Point[] = [];
  for (const w of model.walls) if (w.floorId === floorId) pts.push(w.start, w.end);
  for (const r of model.rooms) if (r.floorId === floorId) pts.push(...r.boundary);
  const bg = stores.background.getState().byFloor[floorId];
  if (bg && stores.editor.getState().layers.background) {
    pts.push(bg.origin, { x: bg.origin.x + bg.pixelWidth * bg.inchesPerPixel, y: bg.origin.y - bg.pixelHeight * bg.inchesPerPixel });
  }
  return pts;
}

export { toScreen };
