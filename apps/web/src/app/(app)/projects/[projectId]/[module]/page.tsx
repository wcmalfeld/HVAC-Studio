import { notFound } from "next/navigation";
import { moduleBySlug } from "@/components/app/modules";
import { ComingSoon } from "@/components/app/coming-soon";

export default async function Page({ params }: { params: Promise<{ projectId: string; module: string }> }) {
  const { module } = await params;
  const m = moduleBySlug(module);
  if (!m || !m.phase) notFound();
  return <ComingSoon slug={module} />;
}
