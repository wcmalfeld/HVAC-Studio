import type { Metadata } from "next";
import { StudioRoute } from "./route-client";

export const metadata: Metadata = { title: "Building Studio" };

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <StudioRoute projectId={projectId} />;
}
