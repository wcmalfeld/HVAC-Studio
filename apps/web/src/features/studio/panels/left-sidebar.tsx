"use client";
import * as React from "react";
import {
  MousePointer2,
  PenLine,
  SquareDashed,
  PaintBucket,
  Pentagon,
  AppWindow,
  DoorOpen,
  Ruler,
  Hand,
  Plus,
  ChevronUp,
  ChevronDown,
  Trash2,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  ImagePlus,
  Crosshair,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import { formatLength, polygonArea, centroid } from "@hvac/building-geometry";
import { formatArea } from "@/lib/format";
import type { BuildingModel, Floor } from "@hvac/shared-types";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { AlertDialog, AlertDialogContent } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useEditorShallow, useEditorApi, type LayerId, type ToolId } from "../store";
import { useStudio, useBackground } from "../context";
import { addFloor, deleteFloor, moveFloor } from "../model-ops";
import { calibrationQuality } from "../background";
import { LengthField, Row } from "./fields";

export const TOOLS: { id: ToolId; label: string; key: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { id: "select", label: "Select", key: "V", icon: MousePointer2, hint: "Click, Shift-click or drag a box. Drag to move." },
  { id: "wall", label: "Wall", key: "W", icon: PenLine, hint: "Click to chain walls. Type a length + Enter. Double-click or Esc to finish." },
  { id: "rect-room", label: "Rectangle room", key: "B", icon: SquareDashed, hint: "Drag a rectangle. Creates the room and its walls." },
  { id: "fill-room", label: "Room from walls", key: "F", icon: PaintBucket, hint: "Click inside a closed set of walls." },
  { id: "poly-room", label: "Polygon room", key: "P", icon: Pentagon, hint: "Click each corner; click the first point or press Enter to close." },
  { id: "window", label: "Window", key: "N", icon: AppWindow, hint: "Hover a wall and click to place a 3' × 4' window." },
  { id: "door", label: "Door", key: "D", icon: DoorOpen, hint: "Hover a wall and click to place a 3' × 6' 8\" door." },
  { id: "measure", label: "Measure", key: "M", icon: Ruler, hint: "Drag to measure. Nothing is stored." },
  { id: "pan", label: "Pan", key: "H", icon: Hand, hint: "Drag to pan. Hold Space with any tool." },
];

function PanelTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between px-3">
      <h3 className="text-[11.5px] font-semibold text-ink-3">{children}</h3>
      {action}
    </div>
  );
}

function ToolsGrid() {
  const api = useEditorApi();
  const { tool, rectRoomWalls } = useEditorShallow((s) => ({ tool: s.tool, rectRoomWalls: s.rectRoomWalls }));
  const active = TOOLS.find((t) => t.id === tool);
  return (
    <div className="border-b border-line pb-2.5">
      <PanelTitle>Tools</PanelTitle>
      <div className="grid grid-cols-5 gap-1 px-2.5" role="toolbar" aria-label="Drawing tools">
        {TOOLS.map((t) => (
          <Tooltip key={t.id} content={t.label} shortcut={t.key} side="right">
            <button
              onClick={() => api.getState().setTool(t.id)}
              aria-pressed={tool === t.id}
              aria-label={t.label}
              data-tool={t.id}
              className={cn(
                "flex h-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink",
                tool === t.id && "bg-accent-soft text-accent-ink ring-1 ring-accent/30 hover:bg-accent-soft hover:text-accent-ink",
              )}
            >
              <t.icon className="size-4" />
            </button>
          </Tooltip>
        ))}
      </div>
      {active ? (
        <p className="mx-3 mt-2 text-[11.5px] leading-snug text-ink-3">
          <span className="font-medium text-ink-2">{active.label}.</span> {active.hint}
        </p>
      ) : null}
      {tool === "rect-room" || tool === "poly-room" ? (
        <label className="mx-3 mt-2 flex items-center gap-2 text-[12px] text-ink-2">
          <Switch checked={rectRoomWalls} onCheckedChange={(v) => api.getState().set({ rectRoomWalls: v })} aria-label="Create walls with room" />
          Create exterior walls
        </label>
      ) : null}
    </div>
  );
}

function FloorEditor({ floor, units, onDone }: { floor: Floor; units: BuildingModel["displayUnits"]; onDone: () => void }) {
  const api = useEditorApi();
  const set = (k: string, f: (fl: Floor) => void) =>
    api.getState().commit((d) => {
      const x = d.floors.find((y) => y.id === floor.id);
      if (x) f(x);
    }, { coalesceKey: `${floor.id}:${k}` });
  return (
    <div className="mx-2 mb-1.5 rounded-md border border-line bg-surface-2/60 px-2.5 py-1.5">
      <Row label="Elevation" className="grid-cols-[86px_minmax(0,1fr)]">
        <LengthField value={floor.elevation} units={units} min={-10000} onChange={(v) => v !== null && set("el", (f) => (f.elevation = v))} aria-label="Floor elevation" />
      </Row>
      <Row label="Floor to floor" className="grid-cols-[86px_minmax(0,1fr)]">
        <LengthField value={floor.floorToFloorHeight} units={units} onChange={(v) => v && set("ftf", (f) => (f.floorToFloorHeight = v))} aria-label="Floor-to-floor height" />
      </Row>
      <Row label="Ceiling" className="grid-cols-[86px_minmax(0,1fr)]">
        <LengthField value={floor.defaultCeilingHeight} units={units} onChange={(v) => v && set("ceil", (f) => (f.defaultCeilingHeight = v))} aria-label="Default ceiling height" />
      </Row>
      <div className="flex justify-end pt-1">
        <Button size="xs" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function FloorsList() {
  const api = useEditorApi();
  const { floors, floorId, units, rooms } = useEditorShallow((s) => ({ floors: s.model.floors, floorId: s.floorId, units: s.model.displayUnits, rooms: s.model.rooms }));
  const sorted = React.useMemo(() => [...floors].sort((a, b) => b.order - a.order), [floors]);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [confirmDel, setConfirmDel] = React.useState<Floor | null>(null);

  return (
    <div className="border-b border-line pb-2">
      <PanelTitle
        action={
          <Tooltip content="Add floor above" side="right">
            <button
              className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
              aria-label="Add floor"
              onClick={() => {
                let id = "";
                api.getState().commit((d) => void (id = addFloor(d as BuildingModel).id), { label: "Add floor" });
                api.getState().setFloor(id);
              }}
            >
              <Plus className="size-3.5" />
            </button>
          </Tooltip>
        }
      >
        Floors
      </PanelTitle>
      <ul className="px-1.5">
        {sorted.map((f) => {
          const n = rooms.filter((r) => r.floorId === f.id).length;
          const active = f.id === floorId;
          return (
            <li key={f.id}>
              <div
                className={cn(
                  "group flex h-8 items-center gap-2 rounded-md px-1.5 text-[12.5px]",
                  active ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2/60",
                )}
              >
                <span className={cn("ml-0.5 size-1.5 shrink-0 rounded-full", active ? "bg-accent" : "bg-transparent")} />
                {renaming === f.id ? (
                  <input
                    autoFocus
                    defaultValue={f.name}
                    maxLength={80}
                    aria-label="Floor name"
                    className="h-6 min-w-0 flex-1 rounded border border-accent bg-surface px-1.5 text-[12.5px] outline-none"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== f.name) api.getState().commit((d) => void (d.floors.find((x) => x.id === f.id)!.name = v), { label: "Rename floor" });
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <button className="min-w-0 flex-1 truncate text-left" onClick={() => api.getState().setFloor(f.id)} onDoubleClick={() => setRenaming(f.id)}>
                    {f.name}
                  </button>
                )}
                <span className="text-[11px] text-ink-4 tnum">{formatLength(f.elevation, units, { fractionDenominator: 2 })}</span>
                <Dropdown modal={false}>
                  <DropdownTrigger className="rounded p-0.5 text-ink-4 opacity-0 hover:bg-surface-3 hover:text-ink group-hover:opacity-100 data-[state=open]:opacity-100" aria-label={`${f.name} options`}>
                    <MoreHorizontal className="size-3.5" />
                  </DropdownTrigger>
                  <DropdownContent align="end">
                    <DropdownItem onSelect={() => setRenaming(f.id)}>
                      <Pencil />
                      Rename
                    </DropdownItem>
                    <DropdownItem onSelect={() => setEditing(f.id)}>
                      <Ruler />
                      Heights & elevation
                    </DropdownItem>
                    <DropdownSeparator />
                    <DropdownItem onSelect={() => api.getState().commit((d) => moveFloor(d as BuildingModel, f.id, 1), { label: "Move floor" })}>
                      <ChevronUp />
                      Move up
                    </DropdownItem>
                    <DropdownItem onSelect={() => api.getState().commit((d) => moveFloor(d as BuildingModel, f.id, -1), { label: "Move floor" })}>
                      <ChevronDown />
                      Move down
                    </DropdownItem>
                    <DropdownSeparator />
                    <DropdownItem danger disabled={floors.length <= 1} onSelect={() => (n ? setConfirmDel(f) : api.getState().commit((d) => deleteFloor(d as BuildingModel, f.id), { label: "Delete floor" }))}>
                      <Trash2 />
                      Delete floor
                    </DropdownItem>
                  </DropdownContent>
                </Dropdown>
              </div>
              {editing === f.id ? <FloorEditor floor={f} units={units} onDone={() => setEditing(null)} /> : null}
            </li>
          );
        })}
      </ul>
      {confirmDel ? (
        <AlertDialog open onOpenChange={(o) => !o && setConfirmDel(null)}>
          <AlertDialogContent title={`Delete ${confirmDel.name}?`} description="Its rooms, walls, windows and doors are deleted too. You can undo this.">
            <div className="flex justify-end gap-2 px-5 py-4">
              <Button variant="ghost" onClick={() => setConfirmDel(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const id = confirmDel.id;
                  api.getState().commit((d) => deleteFloor(d as BuildingModel, id), { label: "Delete floor" });
                  if (api.getState().floorId === id) api.getState().setFloor(api.getState().model.floors[0]!.id);
                  setConfirmDel(null);
                }}
              >
                Delete floor
              </Button>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}

function RoomsList() {
  const api = useEditorApi();
  const { viewport } = useStudio();
  const { rooms, floorId, selection, units } = useEditorShallow((s) => ({ rooms: s.model.rooms, floorId: s.floorId, selection: s.selection, units: s.model.displayUnits }));
  const list = React.useMemo(() => rooms.filter((r) => r.floorId === floorId).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [rooms, floorId]);
  const sel = new Set(selection);
  return (
    <div className="flex min-h-0 flex-1 flex-col border-b border-line">
      <PanelTitle action={<span className="text-[11px] text-ink-4 tnum">{list.length}</span>}>Rooms</PanelTitle>
      <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-2" aria-label="Rooms on this floor">
        {list.length === 0 ? (
          <li className="px-2 py-2 text-[12px] leading-snug text-ink-4">No rooms on this floor yet. Use the rectangle tool (B) to draw one.</li>
        ) : (
          list.map((r) => (
            <li key={r.id}>
              <button
                onClick={(e) => {
                  if (e.shiftKey) api.getState().toggleSelection(r.id);
                  else api.getState().setSelection([r.id]);
                  viewport.getState().centerOn(centroid(r.boundary));
                }}
                className={cn(
                  "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] text-ink-2 hover:bg-surface-2/70",
                  sel.has(r.id) && "bg-accent-soft text-accent-ink hover:bg-accent-soft",
                )}
              >
                <span className={cn("size-2 shrink-0 rounded-[2px] border", r.conditioned ? "border-accent/50 bg-accent/15" : "border-ink-4/50 bg-ink-4/10")} />
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="text-[11px] text-ink-4 tnum">{formatArea(polygonArea(r.boundary), units, 0)}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

const LAYERS: { id: LayerId; label: string }[] = [
  { id: "rooms", label: "Rooms" },
  { id: "walls", label: "Walls" },
  { id: "openings", label: "Windows & doors" },
  { id: "dimensions", label: "Dimensions" },
  { id: "labels", label: "Labels" },
  { id: "ghost", label: "Adjacent floors" },
];

function LayersPanel({ onImport, onCalibrate }: { onImport: () => void; onCalibrate: () => void }) {
  const api = useEditorApi();
  const { background } = useStudio();
  const { layers, locked, floorId } = useEditorShallow((s) => ({ layers: s.layers, locked: s.backgroundLocked, floorId: s.floorId }));
  const bg = useBackground((s) => s.byFloor[floorId] ?? null);
  const q = bg ? calibrationQuality(bg.inchesPerPixel) : null;
  return (
    <div className="pb-2">
      <PanelTitle>Layers</PanelTitle>
      <ul className="px-1.5">
        {LAYERS.map((l) => (
          <li key={l.id}>
            <button
              className="group flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] text-ink-2 hover:bg-surface-2/70"
              onClick={() => api.getState().setLayer(l.id, !layers[l.id])}
              aria-pressed={layers[l.id]}
            >
              <span className={cn("flex-1", !layers[l.id] && "text-ink-4")}>{l.label}</span>
              {layers[l.id] ? <Eye className="size-3.5 text-ink-3" /> : <EyeOff className="size-3.5 text-ink-4" />}
            </button>
          </li>
        ))}
        <li className="mt-1 border-t border-line pt-1">
          <div className="flex h-7 items-center gap-2 rounded-md px-2 text-[12.5px] text-ink-2">
            <span className={cn("flex-1", !bg && "text-ink-4")}>Background drawing</span>
            {bg ? (
              <>
                <Tooltip content={bg.locked ? "Unlock to move it with the Select tool" : "Lock in place"}>
                  <button
                    className="rounded p-0.5 hover:bg-surface-2"
                    aria-label={bg.locked ? "Unlock background" : "Lock background"}
                    onClick={() => {
                      background.getState().update(floorId, { locked: !bg.locked });
                      api.getState().set({ backgroundLocked: !locked });
                    }}
                  >
                    {bg.locked ? <Lock className="size-3.5 text-ink-3" /> : <LockOpen className="size-3.5 text-warn" />}
                  </button>
                </Tooltip>
                <button className="rounded p-0.5 hover:bg-surface-2" aria-label="Toggle background" onClick={() => api.getState().setLayer("background", !layers.background)}>
                  {layers.background ? <Eye className="size-3.5 text-ink-3" /> : <EyeOff className="size-3.5 text-ink-4" />}
                </button>
              </>
            ) : null}
          </div>
          {bg ? (
            <div className="px-2 pb-1">
              <p className="truncate text-[11.5px] text-ink-3" title={bg.filename}>
                {bg.filename}
                {bg.contentType === "application/pdf" ? ` · p. ${bg.page}` : ""}
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-[11px] text-ink-4">Opacity</span>
                <Slider value={[Math.round(bg.opacity * 100)]} min={5} max={100} step={5} onValueChange={([v]) => background.getState().update(floorId, { opacity: (v ?? 50) / 100 })} aria-label="Background opacity" />
              </div>
              <p className={cn("mt-1.5 text-[11.5px]", !bg.calibrated ? "text-warn" : q?.insufficient ? "text-danger" : "text-ink-3")}>
                {!bg.calibrated
                  ? "Not calibrated — scale is a guess."
                  : q?.insufficient
                    ? `1 px = ${q.inchesPerPixel.toFixed(2)}" — too coarse to trace accurately.`
                    : `Calibrated · 1 px = ${q!.inchesPerPixel.toFixed(3)}"`}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <Button size="xs" variant="secondary" onClick={onCalibrate}>
                  <Crosshair />
                  Calibrate
                </Button>
                <Button size="xs" variant="ghost" onClick={onImport}>
                  Replace
                </Button>
                <Button size="xs" variant="danger-ghost" onClick={() => background.getState().set(floorId, null)}>
                  Remove
                </Button>
              </div>
            </div>
          ) : (
            <div className="px-2 pb-1">
              <Button size="xs" variant="secondary" onClick={onImport} className="w-full">
                <ImagePlus />
                Import drawing
              </Button>
            </div>
          )}
        </li>
      </ul>
    </div>
  );
}

export function LeftSidebar({ onImport, onCalibrate }: { onImport: () => void; onCalibrate: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ToolsGrid />
      <FloorsList />
      <RoomsList />
      <LayersPanel onImport={onImport} onCalibrate={onCalibrate} />
    </div>
  );
}
