import type { ProjectStatus, WorkflowStage } from "@hvac/shared-types";
import { STAGE_LABEL, STAGE_ORDER, STATUS_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<ProjectStatus, string> = {
  draft: "bg-surface-2 text-ink-2 [--dot:var(--ink-4)]",
  in_progress: "bg-accent-soft text-accent-ink [--dot:var(--accent)]",
  awaiting_information: "bg-warn-soft text-warn [--dot:var(--warn)]",
  ready_for_review: "bg-cool-soft text-cool [--dot:var(--cool)]",
  completed: "bg-ok-soft text-ok [--dot:var(--ok)]",
  archived: "bg-surface-2 text-ink-3 [--dot:var(--ink-4)]",
};

export function StatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11.5px] font-medium",
        STATUS_TONE[status],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-[var(--dot)]" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Compact workflow stepper: one tick per stage, filled up to the current stage. */
export function StageStepper({ stage, className, showLabel = true }: { stage: WorkflowStage; className?: string; showLabel?: boolean }) {
  const idx = STAGE_ORDER.indexOf(stage);
  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      title={`Workflow stage: ${STAGE_LABEL[stage]} (${idx + 1} of ${STAGE_ORDER.length})`}
    >
      <span className="flex items-center gap-[3px]" aria-hidden>
        {STAGE_ORDER.map((s, i) => (
          <span
            key={s}
            className={cn(
              "h-[5px] rounded-full transition-colors",
              i === idx ? "w-3.5 bg-accent" : "w-[7px]",
              i < idx ? "bg-accent/45" : i > idx ? "bg-line-strong" : "",
            )}
          />
        ))}
      </span>
      {showLabel ? <span className="text-[12px] font-medium text-ink-2">{STAGE_LABEL[stage]}</span> : null}
      <span className="sr-only">
        Stage {idx + 1} of {STAGE_ORDER.length}
      </span>
    </span>
  );
}
