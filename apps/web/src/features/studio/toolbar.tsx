"use client";
import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Undo2,
  Redo2,
  Maximize,
  Minus,
  Plus,
  Grid3x3,
  Magnet,
  Download,
  HelpCircle,
  PanelLeft,
  PanelRight,
  Check,
  CloudOff,
  AlertTriangle,
  Loader2,
  Circle,
  Bug,
  RotateCw,
  Copy,
  ClipboardPaste,
  Trash2,
  ImagePlus,
  CircleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { cn, isMac, relativeTime } from "@/lib/utils";
import type { SaveState } from "./autosave";
import { useEditorShallow, useEditorApi } from "./store";
import { useStudio, useViewport } from "./context";
import { fitPoints } from "./canvas/interactions";
import { Segmented } from "./panels/fields";
import type { BuildingModel } from "@hvac/shared-types";

function SavePill({ save, onRetry }: { save: SaveState; onRetry: () => void }) {
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const map: Record<SaveState["status"], { label: string; icon: React.ReactNode; cls: string; title: string }> = {
    saved: {
      label: "Saved",
      icon: <Check className="size-3.5" />,
      cls: "text-ok",
      title: save.lastSavedAt ? `Saved ${relativeTime(new Date(save.lastSavedAt))} · revision ${save.revision}` : `Revision ${save.revision}`,
    },
    unsaved: { label: "Unsaved", icon: <Circle className="size-2.5 fill-current" />, cls: "text-ink-3", title: "Changes will save automatically" },
    saving: { label: "Saving…", icon: <Loader2 className="size-3.5 animate-spin" />, cls: "text-ink-3", title: "Saving" },
    offline: { label: "Offline", icon: <CloudOff className="size-3.5" />, cls: "text-warn", title: "Changes are kept on this device and will save when you're back online" },
    conflict: { label: "Conflict", icon: <AlertTriangle className="size-3.5" />, cls: "text-danger", title: "A newer version was saved elsewhere" },
    invalid: { label: "Not saved", icon: <CircleAlert className="size-3.5" />, cls: "text-danger", title: "The server rejected the model. See Issues below." },
    error: { label: "Save failed", icon: <AlertTriangle className="size-3.5" />, cls: "text-danger", title: save.error ?? "Save failed — retrying" },
  };
  const m = map[save.status];
  const clickable = save.status === "error" || save.status === "offline";
  return (
    <button
      onClick={clickable ? onRetry : undefined}
      title={m.title}
      data-testid="save-status"
      data-status={save.status}
      className={cn("flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-[12px] font-medium", m.cls, clickable && "hover:bg-surface-2")}
      aria-live="polite"
    >
      {m.icon}
      {m.label}
    </button>
  );
}

function ZoomControl() {
  const { viewport } = useStudio();
  const stores = useStudio();
  const zoom = useViewport((s) => s.zoom);
  const v = viewport.getState();
  const step = (f: number) => v.zoomAt({ x: v.width / 2, y: v.height / 2 }, f);
  return (
    <div className="flex items-center rounded-md border border-line">
      <Tooltip content="Zoom out" shortcut="−">
        <button className="flex size-7 items-center justify-center text-ink-3 hover:text-ink" onClick={() => step(0.8)} aria-label="Zoom out">
          <Minus className="size-3.5" />
        </button>
      </Tooltip>
      <Dropdown>
        <DropdownTrigger className="h-7 w-12 text-center text-[12px] font-medium tnum text-ink-2 hover:text-ink" aria-label="Zoom level">
          {Math.round(zoom * 100)}%
        </DropdownTrigger>
        <DropdownContent align="center" className="min-w-[140px]">
          {[0.25, 0.5, 1, 2, 4].map((z) => (
            <DropdownItem key={z} onSelect={() => viewport.getState().setZoom(z)}>
              {z * 100}%
            </DropdownItem>
          ))}
          <DropdownSeparator />
          <DropdownItem onSelect={() => viewport.getState().fit(fitPoints(stores))} shortcut="⇧1">
            Zoom to fit
          </DropdownItem>
        </DropdownContent>
      </Dropdown>
      <Tooltip content="Zoom in" shortcut="+">
        <button className="flex size-7 items-center justify-center text-ink-3 hover:text-ink" onClick={() => step(1.25)} aria-label="Zoom in">
          <Plus className="size-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}

function ToggleIcon({ on, onClick, label, shortcut, children }: { on: boolean; onClick: () => void; label: string; shortcut?: string; children: React.ReactNode }) {
  return (
    <Tooltip content={label} shortcut={shortcut}>
      <button
        onClick={onClick}
        aria-pressed={on}
        aria-label={label}
        className={cn("flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink [&_svg]:size-4", on && "bg-surface-2 text-ink")}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function StudioToolbar({
  projectId,
  projectName,
  save,
  onRetrySave,
  onExport,
  onHelp,
  onImport,
  left,
  right,
  onToggleLeft,
  onToggleRight,
  onStress,
}: {
  projectId: string;
  projectName: string;
  save: SaveState;
  onRetrySave: () => void;
  onExport: () => void;
  onHelp: () => void;
  onImport: () => void;
  left: boolean;
  right: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onStress: (kind: "add" | "clear") => void;
}) {
  const api = useEditorApi();
  const stores = useStudio();
  const { canUndo, canRedo, grid, snap, units, hasSel, hasClip, undoLabel, redoLabel } = useEditorShallow((s) => ({
    canUndo: s.past.length > 0,
    canRedo: s.future.length > 0,
    grid: s.gridVisible,
    snap: s.snapEnabled,
    units: s.model.displayUnits,
    hasSel: s.selection.length > 0,
    hasClip: !!s.clipboard,
    undoLabel: s.past[s.past.length - 1]?.label,
    redoLabel: s.future[s.future.length - 1]?.label,
  }));
  const m = isMac() ? "⌘" : "Ctrl+";
  // Debug menu: always in development; in production builds only with ?debug=1.
  const [debug, setDebug] = React.useState(process.env.NODE_ENV !== "production");
  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get("debug") === "1") setDebug(true);
  }, []);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-2">
      <Tooltip content="Back to project overview">
        <Link href={`/projects/${projectId}`} className="flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label="Back to project">
          <ArrowLeft className="size-4" />
        </Link>
      </Tooltip>
      <div className="min-w-0 max-w-[260px]">
        <p className="truncate text-[13px] font-semibold leading-tight">{projectName}</p>
        <p className="text-[11px] leading-tight text-ink-3">Building Studio</p>
      </div>
      <SavePill save={save} onRetry={onRetrySave} />

      <div className="mx-1 h-5 w-px bg-line" />
      <ToggleIcon on={left} onClick={onToggleLeft} label={left ? "Hide left panel" : "Show left panel"}>
        <PanelLeft />
      </ToggleIcon>
      <Tooltip content={undoLabel ? `Undo ${undoLabel.toLowerCase()}` : "Undo"} shortcut={`${m}Z`}>
        <Button variant="ghost" size="icon-sm" disabled={!canUndo} onClick={() => api.getState().undo()} aria-label="Undo">
          <Undo2 />
        </Button>
      </Tooltip>
      <Tooltip content={redoLabel ? `Redo ${redoLabel.toLowerCase()}` : "Redo"} shortcut={`${m}⇧Z`}>
        <Button variant="ghost" size="icon-sm" disabled={!canRedo} onClick={() => api.getState().redo()} aria-label="Redo">
          <Redo2 />
        </Button>
      </Tooltip>
      <div className="mx-1 h-5 w-px bg-line" />
      <Tooltip content="Rotate 90°" shortcut="R">
        <Button variant="ghost" size="icon-sm" disabled={!hasSel} onClick={() => api.getState().rotateSelection(90)} aria-label="Rotate selection">
          <RotateCw />
        </Button>
      </Tooltip>
      <Tooltip content="Copy" shortcut={`${m}C`}>
        <Button variant="ghost" size="icon-sm" disabled={!hasSel} onClick={() => api.getState().copySelection()} aria-label="Copy">
          <Copy />
        </Button>
      </Tooltip>
      <Tooltip content="Paste" shortcut={`${m}V`}>
        <Button variant="ghost" size="icon-sm" disabled={!hasClip} onClick={() => api.getState().paste()} aria-label="Paste">
          <ClipboardPaste />
        </Button>
      </Tooltip>
      <Tooltip content="Delete" shortcut="Del">
        <Button variant="ghost" size="icon-sm" disabled={!hasSel} onClick={() => api.getState().deleteSelection()} aria-label="Delete selection">
          <Trash2 />
        </Button>
      </Tooltip>

      <div className="ml-auto flex items-center gap-1.5">
        <ToggleIcon on={grid} onClick={() => api.getState().set({ gridVisible: !grid })} label="Grid" shortcut="G">
          <Grid3x3 />
        </ToggleIcon>
        <ToggleIcon on={snap} onClick={() => api.getState().set({ snapEnabled: !snap })} label="Snapping" shortcut="S">
          <Magnet />
        </ToggleIcon>
        <div className="w-[118px]">
          <Segmented
            value={units}
            options={[
              { value: "imperial", label: "ft-in", title: "Imperial" },
              { value: "metric", label: "m", title: "Metric" },
            ]}
            onChange={(v) => api.getState().commit((d) => void ((d as BuildingModel).displayUnits = v), { label: "Change units" })}
          />
        </div>
        <ZoomControl />
        <Tooltip content="Zoom to fit" shortcut="⇧1">
          <Button variant="ghost" size="icon-sm" onClick={() => stores.viewport.getState().fit(fitPoints(stores))} aria-label="Zoom to fit">
            <Maximize />
          </Button>
        </Tooltip>
        <div className="mx-0.5 h-5 w-px bg-line" />
        <Tooltip content="Import drawing">
          <Button variant="ghost" size="icon-sm" onClick={onImport} aria-label="Import drawing">
            <ImagePlus />
          </Button>
        </Tooltip>
        <Tooltip content="Export model JSON">
          <Button variant="ghost" size="icon-sm" onClick={onExport} aria-label="Export JSON">
            <Download />
          </Button>
        </Tooltip>
        <Tooltip content="Keyboard shortcuts" shortcut="?">
          <Button variant="ghost" size="icon-sm" onClick={onHelp} aria-label="Keyboard shortcuts">
            <HelpCircle />
          </Button>
        </Tooltip>
        {debug ? (
          <Dropdown>
            <DropdownTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Debug menu">
                <Bug />
              </Button>
            </DropdownTrigger>
            <DropdownContent align="end">
              <DropdownLabel>Debug</DropdownLabel>
              <DropdownItem onSelect={() => onStress("add")}>Add stress grid (150 rooms)</DropdownItem>
              <DropdownItem onSelect={() => onStress("clear")}>Clear current floor</DropdownItem>
            </DropdownContent>
          </Dropdown>
        ) : null}
        <ToggleIcon on={right} onClick={onToggleRight} label={right ? "Hide properties" : "Show properties"}>
          <PanelRight />
        </ToggleIcon>
      </div>
    </header>
  );
}
