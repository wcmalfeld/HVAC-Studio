"use client";
import * as React from "react";
import type { AdjacentSpace, BuildingModel, DoorOpening, Opening, Room, Wall, WindowOpening } from "@hvac/shared-types";
import { AdjacentSpace as AdjacentSpaceEnum, RoomType } from "@hvac/shared-types";
import { compassAzimuth, compassLabel, computeBuildingSummary, computeRoomMetrics, formatLength, wallLength, type UnitSystem } from "@hvac/building-geometry";
import { formatArea, formatVolume } from "@/lib/format";
import { BrickWall, DoorOpen, AppWindow, Square, Layers3, Building2 } from "lucide-react";
import { useEditor, useEditorShallow, useEditorApi } from "../store";
import { clampOpeningOffset, confirmDimensions, setWallLength } from "../model-ops";
import { LengthField, Metric, NumberField, ProvenanceBadge, ReadOnly, Row, Section, Segmented, SelectField, TextField } from "./fields";
import { CompassDial } from "./compass";
import { cn } from "@/lib/utils";

const ADJ_LABEL: Record<AdjacentSpace, string> = {
  outdoors: "Outdoors",
  conditioned: "Conditioned space",
  unconditioned: "Unconditioned space",
  garage: "Garage",
  attic: "Attic",
  crawlspace: "Crawlspace",
  basement_unconditioned: "Unconditioned basement",
  ground: "Ground",
};
const ADJ_OPTIONS = AdjacentSpaceEnum.options.map((v) => ({ value: v, label: ADJ_LABEL[v] }));
const ROOM_TYPE_LABEL: Record<string, string> = {
  living: "Living",
  family: "Family",
  kitchen: "Kitchen",
  dining: "Dining",
  bedroom: "Bedroom",
  bathroom: "Bathroom",
  laundry: "Laundry",
  office: "Office",
  hallway: "Hallway",
  closet: "Closet",
  utility: "Utility",
  mechanical: "Mechanical",
  garage: "Garage",
  basement: "Basement",
  bonus: "Bonus",
  other: "Other",
};
const FRAME_OPTIONS = (["vinyl", "wood", "aluminum", "fiberglass", "composite", "other"] as const).map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }));

const sqFt = (v: number, u: UnitSystem) => formatArea(v * 144, u);
const cuFt = (v: number, u: UnitSystem) => formatVolume(v * 1728, u);
const ft = (v: number, u: UnitSystem) => formatLength(v * 12, u, { fractionDenominator: 4 });

function useUpdate() {
  const api = useEditorApi();
  return React.useCallback(
    (key: string, recipe: (d: BuildingModel) => void) => api.getState().commit((d) => recipe(d as BuildingModel), { coalesceKey: key }),
    [api],
  );
}

function PanelHeader({ icon, title, subtitle, badge }: { icon: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-line px-3 py-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-2 [&_svg]:size-4">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold">{title}</p>
        {subtitle ? <p className="truncate text-[11.5px] text-ink-3">{subtitle}</p> : null}
      </div>
      {badge}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assembly editor (walls, floors, ceilings)
// ---------------------------------------------------------------------------
type AssemblyLike = { constructionType: string | null; insulation: string | null; rValue: number | null; uFactor: number | null };
function AssemblyFields({ value, onChange, keyPrefix }: { value: AssemblyLike; onChange: (k: string, patch: Partial<AssemblyLike>) => void; keyPrefix: string }) {
  return (
    <>
      <Row label="Construction">
        <TextField nullable value={value.constructionType} onChange={(v) => onChange(`${keyPrefix}.ct`, { constructionType: v })} aria-label="Construction type" />
      </Row>
      <Row label="Insulation">
        <TextField nullable value={value.insulation} onChange={(v) => onChange(`${keyPrefix}.ins`, { insulation: v })} aria-label="Insulation" />
      </Row>
      <Row label="R-value">
        <NumberField nullable value={value.rValue} min={0.01} onChange={(v) => onChange(`${keyPrefix}.r`, { rValue: v })} aria-label="R-value" suffix="h·ft²·°F/Btu" />
      </Row>
      <Row label="U-factor">
        <NumberField nullable value={value.uFactor} min={0.0001} onChange={(v) => onChange(`${keyPrefix}.u`, { uFactor: v })} aria-label="U-factor" suffix="Btu/h·ft²·°F" />
      </Row>
    </>
  );
}

// ---------------------------------------------------------------------------
// Wall
// ---------------------------------------------------------------------------
function WallPanel({ wall, model }: { wall: Wall; model: BuildingModel }) {
  const update = useUpdate();
  const u = model.displayUnits;
  const len = wallLength(wall);
  const openings = model.openings.filter((o) => o.wallId === wall.id);
  // Outward-facing direction: for exterior walls drawn CCW around rooms, the outward normal is to the right
  // of start→end. We show the direction the wall faces (right-hand normal) and its compass bearing.
  const dir = { x: wall.end.y - wall.start.y, y: -(wall.end.x - wall.start.x) };
  const az = compassAzimuth(dir, model.northAngleDeg);
  const set = (k: string, f: (w: Wall) => void) =>
    update(`${wall.id}:${k}`, (d) => {
      const w = d.walls.find((x) => x.id === wall.id);
      if (w) {
        f(w);
        if (k === "h" || k === "t") confirmDimensions(w);
      }
    });
  return (
    <>
      <PanelHeader
        icon={<BrickWall />}
        title={wall.kind === "exterior" ? "Exterior wall" : "Interior wall"}
        subtitle={`${formatLength(len, u)} · ${openings.length} ${openings.length === 1 ? "opening" : "openings"}`}
        badge={<ProvenanceBadge source={wall.provenance.source} confidence={wall.provenance.confidence} />}
      />
      <Section title="Geometry">
        <Row label="Length">
          <LengthField
            value={len}
            units={u}
            onChange={(v) => v && update(`${wall.id}:len`, (d) => setWallLength(d, wall.id, v))}
            aria-label="Wall length"
          />
        </Row>
        <Row label="Height">
          <LengthField value={wall.height} units={u} onChange={(v) => v && set("h", (w) => (w.height = v))} aria-label="Wall height" />
        </Row>
        <Row label="Thickness">
          <LengthField value={wall.thickness} units={u} onChange={(v) => v && set("t", (w) => (w.thickness = v))} aria-label="Wall thickness" />
        </Row>
        <Row label="Faces">
          <ReadOnly value={`${compassLabel(az)} · ${az.toFixed(0)}°`} />
        </Row>
      </Section>
      <Section title="Exposure">
        <Row label="Designation">
          <Segmented
            value={wall.kind}
            options={[
              { value: "exterior", label: "Exterior" },
              { value: "interior", label: "Interior" },
            ]}
            onChange={(v) => set("kind", (w) => (w.kind = v))}
          />
        </Row>
        <Row label="Adjacent space">
          <SelectField value={wall.adjacentSpace} options={ADJ_OPTIONS} onChange={(v) => v && set("adj", (w) => (w.adjacentSpace = v))} aria-label="Adjacent space" />
        </Row>
      </Section>
      <Section title="Assembly">
        <AssemblyFields value={wall.assembly} keyPrefix="asm" onChange={(k, patch) => set(k, (w) => Object.assign(w.assembly, patch))} />
        <p className="mt-1.5 text-[11.5px] leading-snug text-ink-4">Enter R-value or U-factor. Empty values stay flagged as missing for load calculations.</p>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------
function OpeningPanel({ opening, model }: { opening: Opening; model: BuildingModel }) {
  const update = useUpdate();
  const u = model.displayUnits;
  const wall = model.walls.find((w) => w.id === opening.wallId);
  const wl = wall ? wallLength(wall) : 0;
  const set = (k: string, f: (o: Opening) => void) =>
    update(`${opening.id}:${k}`, (d) => {
      const o = d.openings.find((x) => x.id === opening.id);
      if (o) {
        f(o);
        if (k === "w" || k === "h" || k === "sill") confirmDimensions(o);
      }
    });
  const az = wall ? compassAzimuth({ x: wall.end.y - wall.start.y, y: -(wall.end.x - wall.start.x) }, model.northAngleDeg) : 0;
  const isWin = opening.type === "window";
  return (
    <>
      <PanelHeader
        icon={isWin ? <AppWindow /> : <DoorOpen />}
        title={isWin ? "Window" : "Door"}
        subtitle={`${formatLength(opening.width, u)} × ${formatLength(opening.height, u)} on ${wall?.kind ?? "?"} wall`}
        badge={<ProvenanceBadge source={opening.provenance.source} confidence={opening.provenance.confidence} />}
      />
      <Section title="Size & position">
        <Row label="Width">
          <LengthField
            value={opening.width}
            units={u}
            onChange={(v) =>
              v &&
              set("w", (o) => {
                o.width = v;
                o.offset = clampOpeningOffset(o.offset, v, wl);
              })
            }
            aria-label="Opening width"
          />
        </Row>
        <Row label="Height">
          <LengthField value={opening.height} units={u} onChange={(v) => v && set("h", (o) => (o.height = v))} aria-label="Opening height" />
        </Row>
        <Row label={isWin ? "Sill height" : "Threshold"}>
          <LengthField value={opening.sillHeight} units={u} onChange={(v) => v !== null && set("sill", (o) => (o.sillHeight = v))} aria-label="Sill height" />
        </Row>
        <Row label="From wall start">
          <LengthField
            value={Math.max(0, opening.offset - opening.width / 2)}
            units={u}
            onChange={(v) => v !== null && set("off", (o) => (o.offset = clampOpeningOffset(v + o.width / 2, o.width, wl)))}
            aria-label="Distance from wall start"
          />
        </Row>
        <Row label="Area">
          <ReadOnly value={formatArea(opening.width * opening.height, u)} />
        </Row>
        <Row label="Orientation">
          <ReadOnly value={`${compassLabel(az)} · ${az.toFixed(0)}°`} />
        </Row>
      </Section>
      {isWin ? <WindowProps o={opening as WindowOpening} set={set} /> : <DoorProps o={opening as DoorOpening} set={set} wall={wall} />}
    </>
  );
}

function WindowProps({ o, set }: { o: WindowOpening; set: (k: string, f: (o: Opening) => void) => void }) {
  const p = o.props;
  const sp = (k: string, f: (p: WindowOpening["props"]) => void) => set(k, (x) => x.type === "window" && f(x.props));
  return (
    <Section title="Glazing">
      <Row label="Window type">
        <TextField nullable value={p.windowType} onChange={(v) => sp("wt", (q) => (q.windowType = v))} aria-label="Window type" />
      </Row>
      <Row label="U-factor">
        <NumberField nullable value={p.uFactor} min={0.0001} onChange={(v) => sp("u", (q) => (q.uFactor = v))} aria-label="Window U-factor" suffix="Btu/h·ft²·°F" />
      </Row>
      <Row label="SHGC">
        <NumberField nullable value={p.shgc} min={0} max={1} onChange={(v) => sp("shgc", (q) => (q.shgc = v))} aria-label="SHGC" />
      </Row>
      <Row label="Frame">
        <SelectField nullable value={p.frameMaterial} options={FRAME_OPTIONS} onChange={(v) => sp("fr", (q) => (q.frameMaterial = v))} aria-label="Frame material" />
      </Row>
      <Row label="Panes">
        <NumberField nullable integer min={1} max={4} value={p.panes} onChange={(v) => sp("panes", (q) => (q.panes = v))} aria-label="Number of panes" />
      </Row>
      <Row label="Shading">
        <TextField nullable value={p.shading} onChange={(v) => sp("sh", (q) => (q.shading = v))} aria-label="Shading" />
      </Row>
    </Section>
  );
}

function DoorProps({ o, set, wall }: { o: DoorOpening; set: (k: string, f: (o: Opening) => void) => void; wall?: Wall }) {
  const p = o.props;
  const sp = (k: string, f: (p: DoorOpening["props"]) => void) => set(k, (x) => x.type === "door" && f(x.props));
  return (
    <Section title="Construction">
      <Row label="Designation">
        <ReadOnly value={wall?.kind === "exterior" ? "Exterior door" : "Interior door"} />
      </Row>
      <Row label="Construction">
        <TextField nullable value={p.construction} onChange={(v) => sp("c", (q) => (q.construction = v))} aria-label="Door construction" />
      </Row>
      <Row label="U-factor">
        <NumberField nullable value={p.uFactor} min={0.0001} onChange={(v) => sp("u", (q) => (q.uFactor = v))} aria-label="Door U-factor" suffix="Btu/h·ft²·°F" />
      </Row>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------
function RoomPanel({ room, model }: { room: Room; model: BuildingModel }) {
  const update = useUpdate();
  const u = model.displayUnits;
  const floor = model.floors.find((f) => f.id === room.floorId);
  const m = React.useMemo(() => {
    try {
      return computeRoomMetrics(model, room.id);
    } catch {
      return null;
    }
  }, [model, room.id]);
  const set = (k: string, f: (r: Room) => void) =>
    update(`${room.id}:${k}`, (d) => {
      const r = d.rooms.find((x) => x.id === room.id);
      if (r) f(r);
    });
  const exposuresByDir = React.useMemo(() => {
    const map = new Map<string, { lengthFt: number; gross: number; win: number; door: number }>();
    for (const e of m?.exposures ?? []) {
      const cur = map.get(e.direction) ?? { lengthFt: 0, gross: 0, win: 0, door: 0 };
      cur.lengthFt += e.lengthFt;
      cur.gross += e.grossAreaSqFt;
      cur.win += e.windowAreaSqFt;
      cur.door += e.doorAreaSqFt;
      map.set(e.direction, cur);
    }
    const order = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return [...map.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [m]);

  return (
    <>
      <PanelHeader
        icon={<Square />}
        title={room.name}
        subtitle={`${ROOM_TYPE_LABEL[room.roomType]} · ${floor?.name ?? ""}`}
        badge={<ProvenanceBadge source={room.provenance.source} confidence={room.provenance.confidence} />}
      />
      {m ? (
        <div className="grid grid-cols-2 gap-px border-b border-line bg-line">
          <div className="bg-surface px-3 py-2.5">
            <p className="text-[11px] text-ink-3">Area</p>
            <p className="text-[17px] font-semibold tracking-[-0.01em] tnum">{sqFt(m.areaSqFt, u)}</p>
          </div>
          <div className="bg-surface px-3 py-2.5">
            <p className="text-[11px] text-ink-3">Volume</p>
            <p className="text-[17px] font-semibold tracking-[-0.01em] tnum">{cuFt(m.volumeCuFt, u)}</p>
          </div>
        </div>
      ) : null}
      <Section title="Room">
        <Row label="Name">
          <TextField value={room.name} maxLength={80} onChange={(v) => v && set("name", (r) => (r.name = v))} aria-label="Room name" />
        </Row>
        <Row label="Type">
          <SelectField
            value={room.roomType}
            options={RoomType.options.map((v) => ({ value: v, label: ROOM_TYPE_LABEL[v]! }))}
            onChange={(v) => v && set("type", (r) => (r.roomType = v))}
            aria-label="Room type"
          />
        </Row>
        <Row label="Ceiling height" hint={room.ceilingHeight === null && floor ? `Using floor default ${formatLength(floor.defaultCeilingHeight, u)}` : undefined}>
          <LengthField nullable value={room.ceilingHeight} units={u} onChange={(v) => set("ceil", (r) => (r.ceilingHeight = v))} aria-label="Ceiling height" />
        </Row>
        <Row label="Conditioned">
          <Segmented
            value={room.conditioned ? "yes" : "no"}
            options={[
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]}
            onChange={(v) => set("cond", (r) => (r.conditioned = v === "yes"))}
          />
        </Row>
        <Row label="Occupants">
          <NumberField nullable integer min={0} value={room.occupants} onChange={(v) => set("occ", (r) => (r.occupants = v))} aria-label="Occupants" />
        </Row>
        <Row label="HVAC zone">
          <ReadOnly value={<span className="text-ink-4">Assigned in Load Analysis</span>} />
        </Row>
      </Section>
      {m ? (
        <Section title="Measurements">
          <Metric label="Bounding L × W" value={`${ft(m.boundingLengthFt, u)} × ${ft(m.boundingWidthFt, u)}`} />
          <Metric label="Perimeter" value={ft(m.perimeterFt, u)} />
          <Metric label="Ceiling height" value={formatLength(m.ceilingHeightIn, u)} />
          <Metric label="Exposed wall length" value={ft(m.exteriorWallLengthFt, u)} />
          <Metric label="Gross exposed wall" value={sqFt(m.grossExteriorWallAreaSqFt, u)} />
          <Metric label="Window area" value={sqFt(m.windowAreaSqFt, u)} tone="cool" />
          <Metric label="Door area" value={sqFt(m.doorAreaSqFt, u)} />
          <Metric label="Net exposed wall" value={sqFt(m.netExteriorWallAreaSqFt, u)} />
        </Section>
      ) : null}
      <Section title="Exposures">
        {exposuresByDir.length ? (
          <table className="w-full text-[12px] tnum">
            <thead>
              <tr className="text-left text-[11px] text-ink-4">
                <th className="py-1 font-medium">Faces</th>
                <th className="py-1 text-right font-medium">Wall</th>
                <th className="py-1 text-right font-medium">Glass</th>
                <th className="py-1 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {exposuresByDir.map(([dir, e]) => (
                <tr key={dir} className="border-t border-line">
                  <td className="py-1 font-semibold">{dir}</td>
                  <td className="py-1 text-right">{sqFt(e.gross, u)}</td>
                  <td className="py-1 text-right text-cool">{sqFt(e.win, u)}</td>
                  <td className="py-1 text-right">{sqFt(Math.max(0, e.gross - e.win - e.door), u)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[12px] text-ink-3">No exterior walls along this room&apos;s boundary.</p>
        )}
      </Section>
      <Section title="Floor assembly" defaultOpen={false}>
        <Row label="Below">
          <SelectField nullable value={room.floorAssembly.adjacentSpace} options={ADJ_OPTIONS} onChange={(v) => set("fa.adj", (r) => (r.floorAssembly.adjacentSpace = v))} aria-label="Space below floor" />
        </Row>
        <AssemblyFields value={room.floorAssembly} keyPrefix="fa" onChange={(k, p) => set(k, (r) => Object.assign(r.floorAssembly, p))} />
        {m ? <Metric label="Area" value={sqFt(m.areaSqFt, u)} /> : null}
      </Section>
      <Section title="Ceiling assembly" defaultOpen={false}>
        <Row label="Above">
          <SelectField nullable value={room.ceilingAssembly.adjacentSpace} options={ADJ_OPTIONS} onChange={(v) => set("ca.adj", (r) => (r.ceilingAssembly.adjacentSpace = v))} aria-label="Space above ceiling" />
        </Row>
        <AssemblyFields value={room.ceilingAssembly} keyPrefix="ca" onChange={(k, p) => set(k, (r) => Object.assign(r.ceilingAssembly, p))} />
        {m ? <Metric label="Area" value={sqFt(m.areaSqFt, u)} /> : null}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Multi-selection / building
// ---------------------------------------------------------------------------
function MultiPanel({ ids, model }: { ids: string[]; model: BuildingModel }) {
  const set = new Set(ids);
  const walls = model.walls.filter((w) => set.has(w.id));
  const rooms = model.rooms.filter((r) => set.has(r.id));
  const openings = model.openings.filter((o) => set.has(o.id));
  const u = model.displayUnits;
  const area = rooms.reduce((s, r) => {
    try {
      return s + computeRoomMetrics(model, r.id).areaSqFt;
    } catch {
      return s;
    }
  }, 0);
  const update = useUpdate();
  return (
    <>
      <PanelHeader icon={<Layers3 />} title={`${ids.length} items selected`} subtitle="Press R to rotate, Delete to remove" />
      <Section title="Selection">
        <Metric label="Rooms" value={rooms.length} />
        <Metric label="Walls" value={walls.length} />
        <Metric label="Windows" value={openings.filter((o) => o.type === "window").length} />
        <Metric label="Doors" value={openings.filter((o) => o.type === "door").length} />
        {rooms.length ? <Metric label="Total room area" value={sqFt(area, u)} /> : null}
        {walls.length ? <Metric label="Total wall length" value={formatLength(walls.reduce((s, w) => s + wallLength(w), 0), u)} /> : null}
      </Section>
      {walls.length > 1 ? (
        <Section title="Set on all walls">
          <Row label="Height">
            <LengthField
              value={walls.every((w) => w.height === walls[0]!.height) ? walls[0]!.height : null}
              nullable
              units={u}
              onChange={(v) => v && update(`multi:h`, (d) => d.walls.forEach((w) => set.has(w.id) && (w.height = v)))}
              aria-label="Height for all selected walls"
            />
          </Row>
          <Row label="Designation">
            <Segmented
              value={walls.every((w) => w.kind === "exterior") ? "exterior" : walls.every((w) => w.kind === "interior") ? "interior" : ("mixed" as "exterior")}
              options={[
                { value: "exterior", label: "Exterior" },
                { value: "interior", label: "Interior" },
              ]}
              onChange={(v) =>
                update(`multi:kind`, (d) =>
                  d.walls.forEach((w) => {
                    if (!set.has(w.id)) return;
                    w.kind = v;
                    w.adjacentSpace = v === "exterior" ? "outdoors" : "conditioned";
                  }),
                )
              }
            />
          </Row>
        </Section>
      ) : null}
    </>
  );
}

function BuildingPanel({ model }: { model: BuildingModel }) {
  const update = useUpdate();
  const u = model.displayUnits;
  const summary = React.useMemo(() => computeBuildingSummary(model), [model]);
  return (
    <>
      <PanelHeader icon={<Building2 />} title="Building" subtitle="Nothing selected" />
      <Section title="Orientation">
        <div className="flex items-center gap-3 py-1">
          <CompassDial value={model.northAngleDeg} onChange={(v) => update("north", (d) => void (d.northAngleDeg = v))} />
          <div className="min-w-0 flex-1">
            <Row label="North angle" className="grid-cols-[72px_minmax(0,1fr)]">
              <NumberField value={model.northAngleDeg} min={0} max={359.99} suffix="°" onChange={(v) => v !== null && update("north", (d) => void (d.northAngleDeg = ((v % 360) + 360) % 360))} aria-label="North angle" />
            </Row>
            <p className="mt-1 text-[11.5px] leading-snug text-ink-4">Clockwise from plan up to true north. Drag the dial or type an angle.</p>
          </div>
        </div>
      </Section>
      <Section title="Display units">
        <Segmented
          value={u}
          options={[
            { value: "imperial", label: "Imperial (ft-in)" },
            { value: "metric", label: "Metric (m)" },
          ]}
          onChange={(v) => update("units", (d) => void (d.displayUnits = v))}
        />
        <p className="mt-1.5 text-[11.5px] text-ink-4">Dimensions are stored to 1/16&quot; regardless of display units.</p>
      </Section>
      <Section title="Summary">
        <Metric label="Floors" value={summary.floorCount} />
        <Metric label="Rooms" value={summary.roomCount} />
        <Metric label="Conditioned area" value={sqFt(summary.conditionedAreaSqFt, u)} />
        <Metric label="Conditioned volume" value={cuFt(summary.conditionedVolumeCuFt, u)} />
        <Metric label="Exposed wall length" value={ft(summary.exteriorWallLengthFt, u)} />
        <Metric label="Window area" value={sqFt(summary.windowAreaSqFt, u)} tone="cool" />
        <Metric label="Door area" value={sqFt(summary.doorAreaSqFt, u)} />
        <Metric label="Window-to-floor" value={`${(summary.windowToFloorRatio * 100).toFixed(1)}%`} />
      </Section>
    </>
  );
}

export function PropertiesPanel() {
  const { model, selection } = useEditorShallow((s) => ({ model: s.model, selection: s.selection }));
  let content: React.ReactNode;
  if (selection.length === 0) content = <BuildingPanel model={model} />;
  else if (selection.length > 1) content = <MultiPanel ids={selection} model={model} />;
  else {
    const id = selection[0]!;
    const w = model.walls.find((x) => x.id === id);
    const o = !w ? model.openings.find((x) => x.id === id) : undefined;
    const r = !w && !o ? model.rooms.find((x) => x.id === id) : undefined;
    content = w ? <WallPanel key={id} wall={w} model={model} /> : o ? <OpeningPanel key={id} opening={o} model={model} /> : r ? <RoomPanel key={id} room={r} model={model} /> : <BuildingPanel model={model} />;
  }
  return <div className={cn("flex flex-col")}>{content}</div>;
}

export { useEditor };
