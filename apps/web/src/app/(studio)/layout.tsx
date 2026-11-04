import { SessionGate } from "@/components/app/session";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <SessionGate>{children}</SessionGate>;
}
