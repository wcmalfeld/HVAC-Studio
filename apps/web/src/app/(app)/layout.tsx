import { SessionGate } from "@/components/app/session";
import { AppShell } from "@/components/app/shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionGate>
      <AppShell>{children}</AppShell>
    </SessionGate>
  );
}
