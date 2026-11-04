import { Logo } from "@/components/app/logo";
import { AuthAside } from "./aside";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <main className="flex flex-col px-6 py-6 sm:px-10">
        <Logo />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[360px]">{children}</div>
        </div>
        <p className="text-[12px] text-ink-4">Load figures in HVAC Studio are preliminary engineering estimates.</p>
      </main>
      <AuthAside />
    </div>
  );
}
