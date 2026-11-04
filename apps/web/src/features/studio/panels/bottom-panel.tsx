"use client";
import * as React from "react";
import { AlertCircle, AlertTriangle, Info, ChevronDown, ChevronUp, CheckCircle2, ServerCrash } from "lucide-react";
import { validateModel, formatLength, type ValidationIssue } from "@hvac/building-geometry";
import { cn } from "@/lib/utils";
import { useEditorShallow, useEditorApi } from "../store";
import { useOverlay, useViewport } from "../context";
import { entityIdForLoc, type ServerIssue } from "../autosave";

const SEV = {
  error: { icon: AlertCircle, cls: "text-danger", label: "Errors" },
  warning: { icon: AlertTriangle, cls: "text-warn", label: "Warnings" },
  info: { icon: Info, cls: "text-cool", label: "Notes" },
} as const;

function useDeferredValidation() {
  const { model } = useEditorShallow((s) => ({ model: s.model }));
  const deferred = React.useDeferredValue(model);
  return React.useMemo(() => {
    try {
      return validateModel(deferred);
    } catch (e) {
      console.error("validateModel failed", e);
      return [] as ValidationIssue[];
    }
  }, [deferred]);
}

function Readout() {
  const units = useEditorShallow((s) => s.model.displayUnits);
  const { cursor, measure } = useOverlay((s) => ({ cursor: s.cursor, measure: s.measure }));
  const zoom = useViewport((s) => s.zoom);
  const f = (v: number) => formatLength(v, units, { fractionDenominator: 16 });
  return (
    <div className="flex items-center gap-4 text-[11.5px] text-ink-3 tnum" aria-live="off">
      {measure ? (
        <span className="text-heat">
          Measure {f(Math.hypot(measure.b.x - measure.a.x, measure.b.y - measure.a.y))}
        </span>
      ) : null}
      <span className="w-[200px] text-right">{cursor ? `x ${f(cursor.x)}   y ${f(cursor.y)}` : "—"}</span>
      <span className="w-[44px] text-right">{Math.round(zoom * 100)}%</span>
    </div>
  );
}

export function BottomPanel({ open, onToggle, serverIssues }: { open: boolean; onToggle: () => void; serverIssues: ServerIssue[] }) {
  const issues = useDeferredValidation();
  const api = useEditorApi();
  const model = useEditorShallow((s) => s.model);
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  const total = issues.length + serverIssues.length;

  const select = (ids: string[]) => {
    const st = api.getState();
    const known = ids.filter((id) => st.model.walls.some((w) => w.id === id) || st.model.rooms.some((r) => r.id === id) || st.model.openings.some((o) => o.id === id));
    // jump to the floor of the first entity
    const first = known[0];
    if (first) {
      const fl = st.model.walls.find((w) => w.id === first)?.floorId ?? st.model.rooms.find((r) => r.id === first)?.floorId;
      const op = st.model.openings.find((o) => o.id === first);
      const fl2 = fl ?? (op ? st.model.walls.find((w) => w.id === op.wallId)?.floorId : undefined);
      if (fl2 && fl2 !== st.floorId) st.setFloor(fl2);
    }
    st.setSelection(known);
  };

  return (
    <div className="flex h-full flex-col border-t border-line bg-surface">
      <div className="flex h-8 shrink-0 items-center gap-3 px-3">
        <button onClick={onToggle} className="flex items-center gap-2 rounded px-1 text-[12px] font-medium text-ink-2 hover:text-ink" aria-expanded={open} data-testid="issues-toggle">
          {open ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
          Issues
        </button>
        <div className="flex items-center gap-3 text-[11.5px] tnum">
          {serverIssues.length ? (
            <span className="flex items-center gap-1 text-danger">
              <ServerCrash className="size-3.5" />
              {serverIssues.length} rejected by server
            </span>
          ) : null}
          {total === 0 ? (
            <span className="flex items-center gap-1 text-ok">
              <CheckCircle2 className="size-3.5" />
              No issues
            </span>
          ) : (
            (Object.keys(SEV) as (keyof typeof SEV)[]).map((k) =>
              counts[k] ? (
                <span key={k} className={cn("flex items-center gap-1", SEV[k].cls)}>
                  {React.createElement(SEV[k].icon, { className: "size-3.5" })}
                  {counts[k]}
                </span>
              ) : null,
            )
          )}
        </div>
        <div className="ml-auto">
          <Readout />
        </div>
      </div>
      {open ? (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto border-t border-line">
          {total === 0 ? (
            <p className="px-4 py-3 text-[12px] text-ink-3">The model passes all geometry checks.</p>
          ) : (
            <ul className="divide-y divide-line">
              {serverIssues.map((si, i) => {
                const id = entityIdForLoc(model, si.loc);
                return (
                  <li key={`srv-${i}`}>
                    <button className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-surface-2" onClick={() => id && select([id])}>
                      <ServerCrash className="mt-0.5 size-3.5 shrink-0 text-danger" />
                      <span className="flex-1 text-[12px] text-ink">
                        {si.message}
                        <span className="ml-2 text-[11px] text-ink-4">{si.loc.join(" › ")}</span>
                      </span>
                      <span className="text-[11px] text-danger">Not saved</span>
                    </button>
                  </li>
                );
              })}
              {(["error", "warning", "info"] as const).flatMap((sev) =>
                issues
                  .filter((i) => i.severity === sev)
                  .map((i) => {
                    const S = SEV[sev];
                    return (
                      <li key={i.id}>
                        <button className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-surface-2" onClick={() => select(i.entityIds)}>
                          <S.icon className={cn("mt-0.5 size-3.5 shrink-0", S.cls)} />
                          <span className="flex-1 text-[12px] text-ink">{i.message}</span>
                          <span className="text-[11px] text-ink-4">{i.code.toLowerCase().replaceAll("_", " ")}</span>
                        </button>
                      </li>
                    );
                  }),
              )}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
