"use client";
import { BuildingStudio } from "@/features/studio/studio";

export function StudioRoute({ projectId }: { projectId: string }) {
  return <BuildingStudio projectId={projectId} />;
}
