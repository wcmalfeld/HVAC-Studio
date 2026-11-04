"use client";
import Link from "next/link";
import { MapPin, User } from "lucide-react";
import type { Project } from "@hvac/shared-types";
import { Avatar } from "@/components/ui/misc";
import { TYPE_LABEL } from "@/lib/labels";
import { relativeTime } from "@/lib/utils";
import { StageStepper, StatusBadge } from "./status";
import { ProjectMenu } from "./project-actions";

export function ProjectCard({ project }: { project: Project }) {
  return (
    <article className="group relative flex flex-col rounded-lg border border-line bg-surface transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-md focus-within:border-line-strong">
      <div className="flex items-start gap-2 px-4 pt-3.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-semibold tracking-[-0.01em]">
            <Link href={`/projects/${project.id}`} className="outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-accent/50">
              {project.name}
            </Link>
          </h3>
          <p className="mt-0.5 text-[12px] text-ink-3">{TYPE_LABEL[project.projectType]}</p>
        </div>
        <div className="relative z-10 -mr-1.5 -mt-1">
          <ProjectMenu project={project} />
        </div>
      </div>
      <dl className="mt-3 flex flex-col gap-1.5 px-4 text-[12.5px] text-ink-2">
        <div className="flex items-center gap-2">
          <dt className="sr-only">Customer</dt>
          <User className="size-3.5 shrink-0 text-ink-4" aria-hidden />
          <dd className="truncate">{project.customer?.name ?? <span className="text-ink-4">No customer yet</span>}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="sr-only">Building address</dt>
          <MapPin className="size-3.5 shrink-0 text-ink-4" aria-hidden />
          <dd className="truncate">{project.address ?? <span className="text-ink-4">No address</span>}</dd>
        </div>
      </dl>
      <div className="mt-3.5 flex items-center justify-between gap-2 px-4">
        <StageStepper stage={project.workflowStage} />
        <StatusBadge status={project.status} />
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-line px-4 py-2.5 text-[12px] text-ink-3">
        <Avatar name={project.assignedTo?.name} size={20} />
        <span className="truncate">{project.assignedTo?.name ?? "Unassigned"}</span>
        <time className="ml-auto shrink-0 tnum" dateTime={project.updatedAt} title={new Date(project.updatedAt).toLocaleString()}>
          Edited {relativeTime(project.updatedAt)}
        </time>
      </div>
    </article>
  );
}

export function ProjectCardSkeleton() {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="skeleton h-4 w-2/3 rounded" />
      <div className="skeleton mt-2 h-3 w-1/4 rounded" />
      <div className="skeleton mt-4 h-3 w-1/2 rounded" />
      <div className="skeleton mt-2 h-3 w-3/5 rounded" />
      <div className="skeleton mt-5 h-5 w-full rounded" />
    </div>
  );
}
