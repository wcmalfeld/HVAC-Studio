/**
 * API contract types (camelCase over the wire). The API uses Pydantic aliases to emit camelCase.
 * Auth: httpOnly session cookie `hvac_session` set by POST /api/v1/auth/login|register.
 * Tenant: every tenant-scoped request sends header `X-Organization-Id`.
 * CSRF: every non-GET request sends header `X-Requested-With: hvac-studio`.
 * Errors: { error: { code: string, message: string, details?: unknown } }
 */
import { z } from "zod";

export const Role = z.enum(["owner", "admin", "designer", "sales", "viewer"]);
export type Role = z.infer<typeof Role>;

export const User = z.object({ id: z.string(), name: z.string(), email: z.string().email(), createdAt: z.string() });
export type User = z.infer<typeof User>;

export const Organization = z.object({ id: z.string(), name: z.string(), role: Role, createdAt: z.string() });
export type Organization = z.infer<typeof Organization>;

export const Me = z.object({ user: User, organizations: z.array(Organization) });
export type Me = z.infer<typeof Me>;

export const ProjectStatus = z.enum(["draft", "in_progress", "awaiting_information", "ready_for_review", "completed", "archived"]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const ProjectType = z.enum(["new_construction", "replacement", "addition", "remodel", "other"]);
export type ProjectType = z.infer<typeof ProjectType>;

export const WorkflowStage = z.enum(["building", "loads", "equipment", "ducts", "proposal", "done"]);
export type WorkflowStage = z.infer<typeof WorkflowStage>;

export const Customer = z.object({
  id: z.string(), name: z.string(), email: z.string().nullable(), phone: z.string().nullable(), address: z.string().nullable(),
});
export type Customer = z.infer<typeof Customer>;

export const Project = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  status: ProjectStatus,
  projectType: ProjectType,
  workflowStage: WorkflowStage,
  customer: Customer.nullable(),
  assignedTo: z.object({ id: z.string(), name: z.string() }).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof Project>;

export const ProjectCreate = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(400).nullable().optional(),
  projectType: ProjectType.default("replacement"),
  customer: z.object({
    name: z.string().min(1).max(200), email: z.string().email().nullable().optional(),
    phone: z.string().max(40).nullable().optional(), address: z.string().max(400).nullable().optional(),
  }).nullable().optional(),
});
export type ProjectCreate = z.infer<typeof ProjectCreate>;

export const ProjectUpdate = z.object({
  name: z.string().min(1).max(200).optional(),
  address: z.string().max(400).nullable().optional(),
  status: ProjectStatus.optional(),
  projectType: ProjectType.optional(),
  workflowStage: WorkflowStage.optional(),
  assignedToUserId: z.string().nullable().optional(),
});
export type ProjectUpdate = z.infer<typeof ProjectUpdate>;

export const ProjectList = z.object({ items: z.array(Project), total: z.number().int() });
export type ProjectList = z.infer<typeof ProjectList>;

export const ApiError = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }) });
export type ApiError = z.infer<typeof ApiError>;
