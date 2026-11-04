"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Box, Mail, MapPin, Phone, User, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { ProjectStatus, WorkflowStage, type Project } from "@hvac/shared-types";
import { computeBuildingSummary, formatLength, validateModel } from "@hvac/building-geometry";
import { formatArea, formatVolume } from "@/lib/format";
import { PageHeader } from "@/components/app/shell";
import { ErrorPanel } from "@/components/app/error-boundary";
import { ProjectMenu } from "@/components/projects/project-actions";
import { StageStepper, StatusBadge } from "@/components/projects/status";
import { Avatar, Skeleton } from "@/components/ui/misc";
import { Select } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { building } from "@/lib/api/endpoints";
import { useProject, useUpdateProject } from "@/lib/api/queries";
import { STAGE_LABEL, STAGE_ORDER, STATUS_LABEL, TYPE_LABEL } from "@/lib/labels";
import { errorMessage } from "@/lib/api/client";
import { relativeTime } from "@/lib/utils";

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="px-4 py-3.5">
      <p className="text-[12px] text-ink-3">{label}</p>
      <p className="mt-1 text-[20px] font-semibold leading-none tracking-[-0.02em] tnum">{value}</p>
      {sub ? <p className="mt-1 text-[11.5px] text-ink-4">{sub}</p> : null}
    </div>
  );
}

function BuildingCard({ projectId }: { projectId: string }) {
  const doc = useQuery({ queryKey: ["building-summary", projectId], queryFn: () => building.get(projectId) });
  const data = React.useMemo(() => {
    if (!doc.data) return null;
    const m = doc.data.model;
    return { m, s: computeBuildingSummary(m), issues: validateModel(m) };
  }, [doc.data]);
  const studio = `/projects/${projectId}/studio`;
  return (
    <section className="rounded-xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold">Building</h2>
          <p className="text-[12px] text-ink-3">
            {doc.data ? `Revision ${doc.data.revision} · saved ${relativeTime(doc.data.updatedAt)}` : "Loading model…"}
          </p>
        </div>
        <Link href={studio} className={buttonVariants({ variant: "primary", size: "md" })}>
          <Box />
          Open Building Studio
        </Link>
      </div>
      {doc.isError ? (
        <ErrorPanel error={doc.error as Error} reset={() => doc.refetch()} title="Couldn't load the building" />
      ) : !data ? (
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-surface px-4 py-3.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-5 w-20" />
            </div>
          ))}
        </div>
      ) : data.s.roomCount === 0 ? (
        <div className="flex flex-col items-start gap-2 px-4 py-6">
          <p className="text-[13.5px] font-medium">No rooms drawn yet</p>
          <p className="max-w-md text-[13px] text-ink-3">
            Draw the floor plan in Building Studio, or import a PDF or image of an existing plan and trace over it. Areas, volumes and exposures calculate as you draw.
          </p>
          <Link href={studio} className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-accent-ink hover:underline">
            Start drawing
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">
            <Stat label="Conditioned area" value={formatArea(data.s.conditionedAreaSqFt * 144, data.m.displayUnits)} sub={`${data.s.roomCount} rooms on ${data.s.floorCount} ${data.s.floorCount === 1 ? "floor" : "floors"}`} />
            <Stat label="Conditioned volume" value={formatVolume(data.s.conditionedVolumeCuFt * 1728, data.m.displayUnits)} />
            <Stat label="Window area" value={formatArea(data.s.windowAreaSqFt * 144, data.m.displayUnits)} sub={`${(data.s.windowToFloorRatio * 100).toFixed(1)}% of floor area`} />
            <Stat label="Exposed wall" value={formatLength(data.s.exteriorWallLengthFt * 12, data.m.displayUnits, { fractionDenominator: 2 })} sub={`${data.m.walls.length} walls · ${data.m.openings.length} openings`} />
          </div>
          {data.issues.length ? (
            <Link href={studio} className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-[12.5px] text-warn hover:bg-surface-2">
              <AlertCircle className="size-3.5" />
              {data.issues.filter((i) => i.severity === "error").length} errors and {data.issues.filter((i) => i.severity !== "error").length} warnings in the model
              <ArrowRight className="ml-auto size-3.5" />
            </Link>
          ) : null}
        </>
      )}
    </section>
  );
}

function StatusEditor({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  const change = (patch: Parameters<typeof update.mutate>[0], msg: string) =>
    update.mutate(patch, { onSuccess: () => toast.success(msg), onError: (e) => toast.error(errorMessage(e)) });
  return (
    <section className="rounded-xl border border-line bg-surface">
      <h2 className="border-b border-line px-4 py-3 text-[14px] font-semibold">Status</h2>
      <div className="flex flex-col gap-3 px-4 py-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink-2">Project status</span>
          <Select
            value={project.status}
            disabled={update.isPending}
            onChange={(e) => change({ status: e.target.value as Project["status"] }, `Status set to ${STATUS_LABEL[e.target.value as Project["status"]]}`)}
          >
            {ProjectStatus.options.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink-2">Workflow stage</span>
          <Select
            value={project.workflowStage}
            disabled={update.isPending}
            onChange={(e) => change({ workflowStage: e.target.value as Project["workflowStage"] }, `Stage set to ${STAGE_LABEL[e.target.value as Project["workflowStage"]]}`)}
          >
            {WorkflowStage.options.map((s) => (
              <option key={s} value={s}>
                {STAGE_ORDER.indexOf(s) + 1}. {STAGE_LABEL[s]}
              </option>
            ))}
          </Select>
        </label>
        <div className="pt-1">
          <StageStepper stage={project.workflowStage} />
        </div>
      </div>
    </section>
  );
}

function DetailRow({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-[13px]">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-ink-4" />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export function ProjectOverview({ projectId }: { projectId: string }) {
  const q = useProject(projectId);
  if (q.isError) return <ErrorPanel error={q.error as Error} title="Couldn't load this project" reset={() => q.refetch()} />;
  const p = q.data;
  return (
    <div>
      <PageHeader
        title={p ? p.name : <Skeleton className="h-6 w-64" />}
        description={p ? `${TYPE_LABEL[p.projectType]} · edited ${relativeTime(p.updatedAt)}` : undefined}
        actions={
          p ? (
            <>
              <StatusBadge status={p.status} />
              <ProjectMenu project={p} />
            </>
          ) : null
        }
      />
      {p ? (
        <div className="mx-auto grid max-w-[1180px] gap-5 px-5 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-5">
            <BuildingCard projectId={projectId} />
            <section className="rounded-xl border border-line bg-surface px-4 py-4">
              <h2 className="text-[14px] font-semibold">Next steps</h2>
              <ol className="mt-3 flex flex-col gap-2 text-[13px] text-ink-2">
                <li>
                  <span className="mr-2 text-ink-4 tnum">1</span>Model every conditioned room with its walls, windows and doors.
                </li>
                <li>
                  <span className="mr-2 text-ink-4 tnum">2</span>Enter wall, window and ceiling construction values — empty fields stay flagged.
                </li>
                <li className="text-ink-3">
                  <span className="mr-2 text-ink-4 tnum">3</span>Run preliminary loads (Load Analysis, Phase 2).
                </li>
              </ol>
            </section>
          </div>
          <div className="flex flex-col gap-5">
            <StatusEditor project={p} />
            <section className="rounded-xl border border-line bg-surface">
              <h2 className="border-b border-line px-4 py-3 text-[14px] font-semibold">Details</h2>
              <div className="flex flex-col gap-2.5 px-4 py-4">
                <DetailRow icon={MapPin}>{p.address ?? <span className="text-ink-4">No building address</span>}</DetailRow>
                <DetailRow icon={User}>{p.customer?.name ?? <span className="text-ink-4">No customer</span>}</DetailRow>
                {p.customer?.email ? (
                  <DetailRow icon={Mail}>
                    <a href={`mailto:${p.customer.email}`} className="text-accent-ink hover:underline">
                      {p.customer.email}
                    </a>
                  </DetailRow>
                ) : null}
                {p.customer?.phone ? <DetailRow icon={Phone}>{p.customer.phone}</DetailRow> : null}
                <div className="mt-1 flex items-center gap-2 border-t border-line pt-3 text-[13px]">
                  <Avatar name={p.assignedTo?.name} size={22} />
                  <span>{p.assignedTo?.name ?? <span className="text-ink-3">Unassigned</span>}</span>
                </div>
              </div>
            </section>
          </div>
        </div>
      ) : (
        <div className="px-8 py-6">
          <Skeleton className="h-40 w-full" />
        </div>
      )}
    </div>
  );
}
