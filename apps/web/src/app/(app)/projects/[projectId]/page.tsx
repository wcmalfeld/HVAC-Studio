import type { Metadata } from "next";
import { ProjectOverview } from "./overview";

export const metadata: Metadata = { title: "Project" };

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectOverview projectId={projectId} />;
}
