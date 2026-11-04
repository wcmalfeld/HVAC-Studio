import type { Metadata } from "next";
import { Suspense } from "react";
import { Dashboard } from "./dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default function Page() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}
