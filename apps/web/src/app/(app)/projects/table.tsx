"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, LayoutGrid, List, Plus, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, EmptyState } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/app/shell";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { ProjectCard, ProjectCardSkeleton } from "@/components/projects/project-card";
import { ProjectFilters, useDebounced, type FilterState } from "@/components/projects/project-filters";
import { ProjectMenu } from "@/components/projects/project-actions";
import { StageStepper, StatusBadge } from "@/components/projects/status";
import { useProjects } from "@/lib/api/queries";
import { TYPE_LABEL } from "@/lib/labels";
import { cn, relativeTime, safeLocalStorage } from "@/lib/utils";

const PAGE = 50;

export function ProjectsTable() {
  const router = useRouter();
  const [filters, setFilters] = React.useState<FilterState>({ q: "", status: "", stage: "" });
  const [archived, setArchived] = React.useState(false);
  const [view, setView] = React.useState<"table" | "grid">("table");
  const [page, setPage] = React.useState(0);
  const [newOpen, setNewOpen] = React.useState(false);
  const dq = useDebounced(filters.q);
  React.useEffect(() => {
    const v = safeLocalStorage()?.getItem("hvac.projectsView");
    if (v === "grid" || v === "table") setView(v);
  }, []);
  React.useEffect(() => setPage(0), [dq, filters.status, filters.stage, archived]);

  const q = useProjects({
    q: dq,
    status: filters.status,
    stage: filters.stage,
    includeArchived: archived || filters.status === "archived",
    limit: PAGE,
    offset: page * PAGE,
  });
  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const filtering = !!(dq || filters.status || filters.stage);

  const setV = (v: "table" | "grid") => {
    setView(v);
    safeLocalStorage()?.setItem("hvac.projectsView", v);
  };

  return (
    <div>
      <PageHeader
        title="Projects"
        description={q.isPending ? "Loading…" : `${total} ${total === 1 ? "project" : "projects"}`}
        actions={
          <Button variant="primary" onClick={() => setNewOpen(true)}>
            <Plus />
            New project
          </Button>
        }
      >
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <ProjectFilters value={filters} onChange={setFilters} />
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <Switch checked={archived} onCheckedChange={setArchived} aria-label="Show archived" />
            Show archived
          </label>
          <div className="flex rounded-md border border-line p-0.5" role="group" aria-label="View">
            <button className={cn("rounded p-1 text-ink-3 hover:text-ink", view === "table" && "bg-surface-2 text-ink")} onClick={() => setV("table")} aria-label="Table view" aria-pressed={view === "table"}>
              <List className="size-4" />
            </button>
            <button className={cn("rounded p-1 text-ink-3 hover:text-ink", view === "grid" && "bg-surface-2 text-ink")} onClick={() => setV("grid")} aria-label="Card view" aria-pressed={view === "grid"}>
              <LayoutGrid className="size-4" />
            </button>
          </div>
        </div>
      </PageHeader>

      {!q.isPending && items.length === 0 ? (
        filtering ? (
          <EmptyState icon={<SearchX />} title="No projects match" body="Try a different search, or clear the filters." />
        ) : (
          <EmptyState
            icon={<FolderPlus />}
            title="No projects yet"
            body="Create a project to start modeling a building."
            action={
              <Button variant="primary" onClick={() => setNewOpen(true)}>
                <Plus />
                New project
              </Button>
            }
          />
        )
      ) : view === "grid" ? (
        <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-8 xl:grid-cols-3">
          {q.isPending ? Array.from({ length: 6 }).map((_, i) => <ProjectCardSkeleton key={i} />) : items.map((p) => <ProjectCard key={p.id} project={p} />)}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] table-fixed border-collapse text-left text-[13px]">
            <colgroup>
              <col />
              <col className="w-[15%]" />
              <col className="w-[120px]" />
              <col className="w-[150px]" />
              <col className="w-[170px]" />
              <col className="w-[150px]" />
              <col className="w-[120px]" />
              <col className="w-[56px]" />
            </colgroup>
            <thead>
              <tr className="border-b border-line text-[12px] text-ink-3">
                <th className="py-2 pl-8 pr-3 font-medium">Project</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Stage</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Assignee</th>
                <th className="px-3 py-2 font-medium">Last modified</th>
                <th className="w-12 py-2 pr-6" />
              </tr>
            </thead>
            <tbody>
              {q.isPending
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-line">
                      <td colSpan={8} className="px-8 py-3">
                        <div className="skeleton h-4 w-full rounded" />
                      </td>
                    </tr>
                  ))
                : items.map((p) => (
                    <tr
                      key={p.id}
                      className="group cursor-pointer border-b border-line hover:bg-surface-2/60"
                      onClick={() => router.push(`/projects/${p.id}`)}
                    >
                      <td className="py-2.5 pl-8 pr-3">
                        <a
                          href={`/projects/${p.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            router.push(`/projects/${p.id}`);
                          }}
                          className="block truncate font-medium text-ink"
                        >
                          {p.name}
                        </a>
                        <span className="block truncate text-[12px] text-ink-3">{p.address ?? "No address"}</span>
                      </td>
                      <td className="truncate px-3 text-ink-2">{p.customer?.name ?? <span className="text-ink-4">—</span>}</td>
                      <td className="truncate px-3 text-ink-2">{TYPE_LABEL[p.projectType]}</td>
                      <td className="px-3">
                        <StageStepper stage={p.workflowStage} />
                      </td>
                      <td className="px-3">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="px-3">
                        <span className="flex min-w-0 items-center gap-2 text-ink-2">
                          <Avatar name={p.assignedTo?.name} size={20} />
                          <span className="truncate">{p.assignedTo?.name ?? "Unassigned"}</span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 text-ink-3 tnum" title={new Date(p.updatedAt).toLocaleString()}>
                        {relativeTime(p.updatedAt)}
                      </td>
                      <td className="pr-4 text-right">
                        <ProjectMenu project={p} />
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
      {total > PAGE ? (
        <div className="flex items-center justify-end gap-2 px-8 py-4 text-[12px] text-ink-3 tnum">
          {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}
          <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      ) : null}
      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
