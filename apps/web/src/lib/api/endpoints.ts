import {
  BuildingDocument,
  Me,
  Project,
  ProjectList,
  type BuildingModel,
  type ProjectCreate,
  type ProjectStatus,
  type ProjectUpdate,
  type WorkflowStage,
} from "@hvac/shared-types";
import { z } from "zod";
import { apiRequest } from "./client";

// ---- Auth -----------------------------------------------------------------
export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  organizationName: string;
}

export const auth = {
  register: (input: RegisterInput) => apiRequest("/auth/register", { method: "POST", body: input, tenant: false, noRedirect: true }),
  login: (input: { email: string; password: string }) =>
    apiRequest("/auth/login", { method: "POST", body: input, tenant: false, noRedirect: true }),
  logout: () => apiRequest("/auth/logout", { method: "POST", tenant: false, noRedirect: true }),
  me: (opts?: { noRedirect?: boolean }) =>
    apiRequest<Me>("/users/me", { schema: Me, tenant: false, noRedirect: opts?.noRedirect }),
};

// ---- Projects -------------------------------------------------------------
export interface ProjectQuery {
  q?: string;
  status?: ProjectStatus | "";
  stage?: WorkflowStage | "";
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

export type ProjectCreateInput = z.input<typeof import("@hvac/shared-types").ProjectCreate> & { sample?: boolean };

export const projects = {
  list: (q: ProjectQuery = {}) =>
    apiRequest<ProjectList>("/projects", {
      schema: ProjectList,
      query: { ...q, includeArchived: q.includeArchived ? true : undefined },
    }),
  get: (id: string) => apiRequest<Project>(`/projects/${id}`, { schema: Project }),
  create: (input: ProjectCreateInput) => apiRequest<Project>("/projects", { method: "POST", body: input, schema: Project }),
  update: (id: string, patch: ProjectUpdate) =>
    apiRequest<Project>(`/projects/${id}`, { method: "PATCH", body: patch, schema: Project }),
  remove: (id: string) => apiRequest<void>(`/projects/${id}`, { method: "DELETE" }),
  duplicate: (id: string) => apiRequest<Project>(`/projects/${id}/duplicate`, { method: "POST", schema: Project }),
  archive: (id: string) => apiRequest<Project>(`/projects/${id}/archive`, { method: "POST", schema: Project }),
  unarchive: (id: string) => apiRequest<Project>(`/projects/${id}/unarchive`, { method: "POST", schema: Project }),
};
export type { ProjectCreate };

// ---- Building -------------------------------------------------------------
export const BuildingRevision = z.object({
  revision: z.number().int(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  createdBy: z.unknown().optional(),
});
export type BuildingRevision = z.infer<typeof BuildingRevision>;

export const building = {
  get: (projectId: string, signal?: AbortSignal) =>
    apiRequest<BuildingDocument>(`/projects/${projectId}/building`, { schema: BuildingDocument, signal }),
  put: (projectId: string, revision: number, model: BuildingModel) =>
    apiRequest<BuildingDocument>(`/projects/${projectId}/building`, {
      method: "PUT",
      body: { revision, model },
      schema: BuildingDocument,
    }),
  revisions: (projectId: string) => apiRequest<unknown>(`/projects/${projectId}/building/revisions`),
  restore: (projectId: string, rev: number) =>
    apiRequest<BuildingDocument>(`/projects/${projectId}/building/revisions/${rev}/restore`, {
      method: "POST",
      schema: BuildingDocument,
    }),
};

// ---- Drawings -------------------------------------------------------------
export const Drawing = z
  .object({
    id: z.string(),
    filename: z.string(),
    contentType: z.string(),
    sizeBytes: z.number().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();
export type Drawing = z.infer<typeof Drawing>;

export const DRAWING_MAX_BYTES = 25 * 1024 * 1024;
export const DRAWING_TYPES = ["application/pdf", "image/png", "image/jpeg"];

export const drawings = {
  upload: (projectId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return apiRequest<Drawing>(`/projects/${projectId}/drawings`, { method: "POST", body: fd, schema: Drawing });
  },
  list: (projectId: string) => apiRequest<unknown>(`/projects/${projectId}/drawings`),
  fileUrl: (drawingId: string) => `/api/v1/drawings/${drawingId}/file`,
  fetchFile: async (drawingId: string): Promise<Blob> => {
    const res = await apiRequest<Response>(`/drawings/${drawingId}/file`, { raw: true });
    return res.blob();
  },
};

/** Lists may come back as a bare array or {items}. */
export function asItems<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: T[] }).items;
  }
  return [];
}
