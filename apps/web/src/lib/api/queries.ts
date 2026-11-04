"use client";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import type { Project, ProjectUpdate } from "@hvac/shared-types";
import { auth, projects, type ProjectCreateInput, type ProjectQuery } from "./endpoints";
import { getActiveOrgId } from "./client";

export const qk = {
  me: ["me"] as const,
  projects: (org: string | null, q?: ProjectQuery) => ["projects", org, q ?? {}] as const,
  projectsAll: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  building: (id: string) => ["building", id] as const,
};

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: () => auth.me(), staleTime: 5 * 60_000, retry: false });
}

export function useProjects(q: ProjectQuery, opts?: { enabled?: boolean }) {
  const org = getActiveOrgId();
  return useQuery({
    queryKey: qk.projects(org, q),
    queryFn: () => projects.list(q),
    placeholderData: keepPreviousData,
    enabled: opts?.enabled ?? true,
  });
}

export function useProject(id: string) {
  return useQuery({ queryKey: qk.project(id), queryFn: () => projects.get(id) });
}

function useInvalidateProjects() {
  const qc = useQueryClient();
  return (p?: Project) => {
    qc.invalidateQueries({ queryKey: qk.projectsAll });
    if (p) qc.setQueryData(qk.project(p.id), p);
  };
}

export function useCreateProject() {
  const inv = useInvalidateProjects();
  return useMutation({ mutationFn: (input: ProjectCreateInput) => projects.create(input), onSuccess: (p) => inv(p) });
}

export function useUpdateProject(id: string) {
  const inv = useInvalidateProjects();
  return useMutation({ mutationFn: (patch: ProjectUpdate) => projects.update(id, patch), onSuccess: (p) => inv(p) });
}

export function useProjectActions() {
  const inv = useInvalidateProjects();
  const qc = useQueryClient();
  return {
    duplicate: useMutation({ mutationFn: projects.duplicate, onSuccess: (p) => inv(p) }),
    archive: useMutation({ mutationFn: projects.archive, onSuccess: (p) => inv(p) }),
    unarchive: useMutation({ mutationFn: projects.unarchive, onSuccess: (p) => inv(p) }),
    remove: useMutation({
      mutationFn: projects.remove,
      onSuccess: (_d, id) => {
        qc.removeQueries({ queryKey: qk.project(id) });
        inv();
      },
    }),
  };
}
