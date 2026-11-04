import type { Metadata } from "next";
import { ProjectsTable } from "./table";

export const metadata: Metadata = { title: "Projects" };

export default function Page() {
  return <ProjectsTable />;
}
