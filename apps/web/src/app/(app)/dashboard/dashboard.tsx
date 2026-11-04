"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FileText, FolderPlus, Plus, SearchX } from "lucide-react";
import type { Project } from "@hvac/shared-types";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { useSession } from "@/components/app/session";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { ProjectCard, ProjectCardSkeleton } from "@/components/projects/project-card";
import { ProjectFilters, useDebounced, type FilterState } from "@/components/projects/project-filters";
import { useProjects } from "@/lib/api/queries";
import { cn } from "@/lib/utils";

const ATTENTION = new Set(["awaiting_information", "ready_for_review"]);
const ACTIVE = new Set(["draft", "in_progress"]);

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Section({
  title,
  hint,
  items,
  loading,
  empty,
  max = 6,
  id,
}: {
  title: string;
  hint?: string;
  items: Project[];
  loading: boolean;
  empty: string;
  max?: number;
  id: string;
}) {
  return (
    <section aria-labelledby={id} className="mt-9">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 id={id} className="text-[14px] font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        {!loading ? <span className="text-[12px] text-ink-4 tnum">{items.length}</span> : null}
        {hint ? <span className="text-[12px] text-ink-3">· {hint}</span> : null}
        {items.length > max ? (
          <Link href="/projects" className="ml-auto text-[12px] font-medium text-accent-ink hover:underline">
            View all
          </Link>
        ) : null}
      </div>
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <ProjectCardSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-5 text-[13px] text-ink-3">{empty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.slice(0, max).map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, tone, loading }: { label: string; value: number; tone?: string; loading: boolean }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-3.5 first:pl-0">
      <span className="text-[12px] text-ink-3">{label}</span>
      {loading ? (
        <span className="skeleton h-6 w-8 rounded" />
      ) : (
        <span className={cn("text-[22px] font-semibold leading-none tracking-[-0.02em] tnum", tone)}>{value}</span>
      )}
    </div>
  );
}

export function Dashboard() {
  const { me } = useSession();
  const router = useRouter();
  const sp = useSearchParams();
  const [newOpen, setNewOpen] = React.useState(sp.get("new") === "1");
  const [filters, setFilters] = React.useState<FilterState>({ q: "", status: "", stage: "" });
  const dq = useDebounced(filters.q);
  const filtering = !!(dq || filters.status || filters.stage);

  const all = useProjects({ limit: 200 });
  const filtered = useProjects(
    { q: dq, status: filters.status, stage: filters.stage, includeArchived: filters.status === "archived", limit: 60 },
    { enabled: filtering },
  );

  const items = React.useMemo(() => all.data?.items ?? [], [all.data]);
  const byRecent = React.useMemo(() => [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [items]);
  const active = byRecent.filter((p) => ACTIVE.has(p.status));
  const attention = byRecent.filter((p) => ATTENTION.has(p.status));
  const completed = byRecent.filter((p) => p.status === "completed");
  const loading = all.isPending;
  const firstName = me.user.name.split(" ")[0];

  const openNew = () => setNewOpen(true);
  React.useEffect(() => {
    if (sp.get("new") === "1") router.replace("/dashboard");
  }, [sp, router]);

  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-16 pt-6 sm:px-8 sm:pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-0.025em]">
            {greeting()}, {firstName}
          </h1>
          <p className="mt-1 text-[13px] text-ink-3">
            {loading
              ? "Loading your projects…"
              : attention.length
                ? `${attention.length} ${attention.length === 1 ? "project needs" : "projects need"} your attention.`
                : items.length
                  ? "Nothing is waiting on you right now."
                  : "Start by creating your first project."}
          </p>
        </div>
        <Button variant="primary" size="lg" onClick={openNew}>
          <Plus />
          New project
        </Button>
      </div>

      <div className="mt-6 flex flex-wrap divide-x divide-line border-y border-line">
        <Stat label="Active" value={active.length} loading={loading} />
        <Stat label="Needs attention" value={attention.length} tone={attention.length ? "text-warn" : undefined} loading={loading} />
        <Stat label="Completed" value={completed.length} tone="text-ok" loading={loading} />
        <Stat label="All projects" value={all.data?.total ?? 0} loading={loading} />
      </div>

      <div className="mt-6">
        <ProjectFilters value={filters} onChange={setFilters} />
      </div>

      {filtering ? (
        <section className="mt-6" aria-live="polite">
          <p className="mb-3 text-[12px] text-ink-3 tnum">
            {filtered.isPending ? "Searching…" : `${filtered.data?.total ?? 0} matching projects`}
          </p>
          {filtered.isPending ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <ProjectCardSkeleton key={i} />
              ))}
            </div>
          ) : filtered.data?.items.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.data.items.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          ) : (
            <EmptyState icon={<SearchX />} title="No projects match" body="Try a different search, or clear the filters." />
          )}
        </section>
      ) : !loading && items.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-line-strong">
          <EmptyState
            icon={<FolderPlus />}
            title="No projects yet"
            body="A project holds one building: its floor plan, loads, equipment, ducts and proposal. Start from a sample house if you want to look around first."
            action={
              <Button variant="primary" onClick={openNew}>
                <Plus />
                New project
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <Section id="s-recent" title="Recent" items={byRecent} loading={loading} empty="" max={3} />
          <Section
            id="s-attention"
            title="Requiring attention"
            hint="awaiting information or ready for review"
            items={attention}
            loading={loading}
            empty="Nothing is blocked or waiting for review."
          />
          <Section id="s-active" title="Active" items={active} loading={loading} empty="No drafts or in-progress projects." />
          <Section id="s-done" title="Completed" items={completed} loading={loading} empty="Completed projects will show up here." max={3} />
          <section className="mt-9" aria-labelledby="s-reports">
            <h2 id="s-reports" className="mb-3 text-[14px] font-semibold tracking-[-0.01em]">
              Recently generated reports
            </h2>
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-line px-4 py-4 text-[13px] text-ink-3">
              <FileText className="size-4 text-ink-4" />
              Load, equipment and duct reports arrive with Load Analysis in Phase 2. Generated reports will be listed here.
            </div>
          </section>
        </>
      )}

      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
