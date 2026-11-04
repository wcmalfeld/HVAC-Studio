import Link from "next/link";
import { LogoMark } from "@/components/app/logo";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <LogoMark size={28} />
      <div>
        <h1 className="text-[18px] font-semibold">This page doesn&apos;t exist</h1>
        <p className="mt-1 text-[13px] text-ink-3">The link may be out of date, or the project was deleted.</p>
      </div>
      <Link href="/dashboard" className="text-[13px] font-medium text-accent-ink hover:underline">
        Go to dashboard
      </Link>
    </main>
  );
}
