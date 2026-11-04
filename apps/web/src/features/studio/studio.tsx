"use client";
import * as React from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { BuildingDocument, Point } from "@hvac/shared-types";
import { building } from "@/lib/api/endpoints";
import { useProject } from "@/lib/api/queries";
import { ApiError, errorMessage } from "@/lib/api/client";
import { downloadJson, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/app/logo";
import { ErrorBoundary, ErrorPanel } from "@/components/app/error-boundary";
import { StudioProvider, useStudio } from "./context";
import { usePersistence, readDraft, draftIsRecoverable, clearDraft, type LocalDraft } from "./use-persistence";
import { StudioToolbar } from "./toolbar";
import { LeftSidebar } from "./panels/left-sidebar";
import { PropertiesPanel } from "./panels/properties";
import { BottomPanel } from "./panels/bottom-panel";
import { ImportDrawingDialog } from "./dialogs/import-drawing";
import { CalibrateDialog, ConflictDialog, RestoreDraftDialog, ShortcutsDialog } from "./dialogs/studio-dialogs";
import { addStressGrid } from "./stress";
import { fitPoints } from "./canvas/interactions";
import { deleteEntities } from "./model-ops";
import type { BuildingModel } from "@hvac/shared-types";
import { safeLocalStorage } from "@/lib/utils";

const PlanCanvas = dynamic(() => import("./canvas/plan-canvas"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[var(--plan-bg)]" />,
});

const PANELS_KEY = "hvac.studio.panels";

function StudioLoading() {
  return (
    <div className="flex h-dvh flex-col">
      <div className="h-12 border-b border-line bg-surface" />
      <div className="flex flex-1 items-center justify-center bg-[var(--plan-bg)]">
        <div className="flex flex-col items-center gap-3 text-[12.5px] text-ink-3">
          <LogoMark size={28} className="animate-pulse" />
          Loading building…
        </div>
      </div>
    </div>
  );
}

export function BuildingStudio({ projectId }: { projectId: string }) {
  const project = useProject(projectId);
  const doc = useQuery({
    queryKey: ["building", projectId],
    queryFn: ({ signal }) => building.get(projectId, signal),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (doc.isError) {
    const e = doc.error;
    return (
      <div className="flex h-dvh items-center justify-center">
        <ErrorPanel
          error={e as Error}
          title={e instanceof ApiError && e.status === 404 ? "Project not found" : "Couldn't load the building"}
          reset={() => doc.refetch()}
        />
      </div>
    );
  }
  if (!doc.data) return <StudioLoading />;
  return (
    <StudioProvider projectId={projectId} initial={doc.data.model}>
      <ErrorBoundary>
        <StudioInner doc={doc.data} projectName={project.data?.name ?? "Untitled project"} />
      </ErrorBoundary>
    </StudioProvider>
  );
}

function StudioInner({ doc, projectName }: { doc: BuildingDocument; projectName: string }) {
  const stores = useStudio();
  const { projectId, editor, overlay } = stores;
  const persistence = usePersistence(stores, doc);
  const { save } = persistence;

  const [panels, setPanels] = React.useState({ left: true, right: true, bottom: false });
  React.useEffect(() => {
    try {
      const raw = safeLocalStorage()?.getItem(PANELS_KEY);
      if (raw) setPanels((p) => ({ ...p, ...JSON.parse(raw) }));
    } catch {
      /* ignore */
    }
  }, []);
  const togglePanel = (k: keyof typeof panels) =>
    setPanels((p) => {
      const n = { ...p, [k]: !p[k] };
      safeLocalStorage()?.setItem(PANELS_KEY, JSON.stringify(n));
      return n;
    });

  const [importOpen, setImportOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [calPoints, setCalPoints] = React.useState<{ a: Point; b: Point } | null>(null);
  const [draft, setDraft] = React.useState<LocalDraft | null>(null);

  // Crash recovery: offer a local draft that differs from the server copy.
  React.useEffect(() => {
    const d = readDraft(projectId);
    if (draftIsRecoverable(d, doc)) setDraft(d);
    else if (d) clearDraft(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open the issues panel when the server rejects the model.
  React.useEffect(() => {
    if (save.status === "invalid") setPanels((p) => ({ ...p, bottom: true }));
  }, [save.status]);

  // "?" opens help
  React.useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void persistence.flush();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [persistence]);

  const exportJson = React.useCallback(() => {
    const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "building";
    downloadJson(`${slug}-building-r${save.revision}.json`, editor.getState().model);
  }, [editor, projectName, save.revision]);

  const callbacks = React.useMemo(
    () => ({
      notify: (msg: string, kind?: "info" | "error") => (kind === "error" ? toast.error(msg) : toast(msg)),
      onCalibratePoints: (a: Point, b: Point) => setCalPoints({ a, b }),
    }),
    [],
  );

  const startCalibrate = () => {
    editor.getState().setTool("calibrate");
    overlay.getState().resetTool();
    toast("Click two points on the drawing that are a known distance apart.", { duration: 6000 });
  };

  const onStress = (kind: "add" | "clear") => {
    const { floorId, model } = editor.getState();
    if (kind === "add") {
      const t0 = performance.now();
      editor.getState().commit((d) => addStressGrid(d as BuildingModel, floorId), { label: "Stress grid" });
      const m = editor.getState().model;
      toast(`Stress grid added in ${Math.round(performance.now() - t0)} ms — ${m.walls.length} walls, ${m.rooms.length} rooms`);
      stores.viewport.getState().fit(m.walls.filter((w) => w.floorId === floorId).flatMap((w) => [w.start, w.end]));
    } else {
      const ids = [...model.walls.filter((w) => w.floorId === floorId).map((w) => w.id), ...model.rooms.filter((r) => r.floorId === floorId).map((r) => r.id)];
      editor.getState().commit((d) => void deleteEntities(d as BuildingModel, ids), { label: "Clear floor", select: [] });
    }
  };

  return (
    <div className="flex h-dvh min-w-[1024px] flex-col overflow-hidden bg-bg" data-testid="studio">
      <StudioToolbar
        projectId={projectId}
        projectName={projectName}
        save={save}
        onRetrySave={() => void persistence.flush()}
        onExport={exportJson}
        onHelp={() => setHelpOpen(true)}
        onImport={() => setImportOpen(true)}
        left={panels.left}
        right={panels.right}
        onToggleLeft={() => togglePanel("left")}
        onToggleRight={() => togglePanel("right")}
        onStress={onStress}
      />
      <div className="flex min-h-0 flex-1">
        <aside className={cn("scrollbar-thin w-[232px] shrink-0 overflow-y-auto border-r border-line bg-surface", !panels.left && "hidden")} aria-label="Tools, floors, rooms and layers">
          <LeftSidebar onImport={() => setImportOpen(true)} onCalibrate={startCalibrate} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <PlanCanvas callbacks={callbacks} />
            <CanvasHud />
          </div>
          <div className={cn("shrink-0", panels.bottom ? "h-[200px]" : "h-8")}>
            <BottomPanel open={panels.bottom} onToggle={() => togglePanel("bottom")} serverIssues={save.serverIssues} />
          </div>
        </div>
        <aside className={cn("scrollbar-thin w-[300px] shrink-0 overflow-y-auto border-l border-line bg-surface", !panels.right && "hidden")} aria-label="Properties" data-testid="properties">
          <PropertiesPanel />
        </aside>
      </div>

      <ImportDrawingDialog open={importOpen} onOpenChange={setImportOpen} onPlaced={startCalibrate} />
      <CalibrateDialog
        points={calPoints}
        onCalibrated={() => requestAnimationFrame(() => stores.viewport.getState().fit(fitPoints(stores)))}
        onClose={() => {
          setCalPoints(null);
          overlay.getState().resetTool();
          editor.getState().setTool("select");
        }}
      />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <ConflictDialog
        open={save.status === "conflict"}
        currentRevision={save.conflict?.currentRevision ?? null}
        onReload={async () => {
          try {
            await persistence.reloadTheirs();
            toast.success("Loaded the latest saved version");
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
        onOverwrite={async () => {
          try {
            await persistence.overwriteMine();
            toast.success("Your version was saved");
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
        onDownload={exportJson}
      />
      {draft ? (
        <RestoreDraftDialog
          savedAt={draft.savedAt}
          onRestore={() => {
            persistence.restoreDraft(draft, doc.revision);
            setDraft(null);
            toast.success("Restored your unsaved changes");
          }}
          onDiscard={() => {
            persistence.discardDraft();
            setDraft(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** Small floating hints on the canvas: current floor + tool hint while drawing. */
function CanvasHud() {
  const stores = useStudio();
  const [state, setState] = React.useState(() => hudState(stores));
  React.useEffect(() => {
    const u1 = stores.editor.subscribe(() => setState(hudState(stores)));
    const u2 = stores.overlay.subscribe((s, p) => {
      if (s.chain.length !== p.chain.length || s.poly.length !== p.poly.length || !!s.calibrate.a !== !!p.calibrate.a) setState(hudState(stores));
    });
    return () => {
      u1();
      u2();
    };
  }, [stores]);
  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-md border border-line bg-surface/90 px-2 py-1 text-[12px] font-medium text-ink-2 shadow-sm backdrop-blur">
        {state.floorName}
      </div>
      {state.hint ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-ink/85 px-2.5 py-1 text-[12px] text-surface shadow-md">{state.hint}</div>
      ) : null}
    </>
  );
}

function hudState(stores: ReturnType<typeof useStudio>) {
  const e = stores.editor.getState();
  const o = stores.overlay.getState();
  const floorName = e.model.floors.find((f) => f.id === e.floorId)?.name ?? "";
  let hint = "";
  if (e.tool === "wall" && o.chain.length) hint = "Type a length and press Enter · Double-click or Esc to finish · Shift to free-draw";
  else if (e.tool === "poly-room" && o.poly.length) hint = "Click the first point or press Enter to close the room";
  else if (e.tool === "calibrate") hint = o.calibrate.a ? "Click the second point" : "Click the first of two points a known distance apart";
  return { floorName, hint };
}

export { Button };
