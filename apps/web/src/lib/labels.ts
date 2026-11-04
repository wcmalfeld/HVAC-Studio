import type { ProjectStatus, ProjectType, WorkflowStage, Role } from "@hvac/shared-types";

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "Draft",
  in_progress: "In progress",
  awaiting_information: "Awaiting information",
  ready_for_review: "Ready for review",
  completed: "Completed",
  archived: "Archived",
};

export const STATUS_ORDER: ProjectStatus[] = [
  "draft",
  "in_progress",
  "awaiting_information",
  "ready_for_review",
  "completed",
  "archived",
];

export const TYPE_LABEL: Record<ProjectType, string> = {
  new_construction: "New construction",
  replacement: "Replacement",
  addition: "Addition",
  remodel: "Remodel",
  other: "Other",
};

export const STAGE_ORDER: WorkflowStage[] = ["building", "loads", "equipment", "ducts", "proposal", "done"];

export const STAGE_LABEL: Record<WorkflowStage, string> = {
  building: "Building",
  loads: "Loads",
  equipment: "Equipment",
  ducts: "Ducts",
  proposal: "Proposal",
  done: "Done",
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  designer: "Designer",
  sales: "Sales",
  viewer: "Viewer",
};
