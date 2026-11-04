"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Box } from "lucide-react";
import { moduleBySlug } from "./modules";
import { PageHeader } from "./shell";
import { buttonVariants } from "@/components/ui/button";

function Body({ phase, blurb, bullets, cta }: { phase: number; blurb: string; bullets: string[]; cta?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[640px] px-5 py-12 sm:px-8">
      <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 text-[12px] font-medium text-ink-2">Coming in Phase {phase}</span>
      <p className="mt-4 text-[17px] leading-relaxed tracking-[-0.01em] text-ink">{blurb}</p>
      <ul className="mt-6 flex flex-col gap-2.5 border-l-2 border-line pl-4">
        {bullets.map((b) => (
          <li key={b} className="text-[13.5px] text-ink-2">
            {b}
          </li>
        ))}
      </ul>
      {cta ? <div className="mt-8">{cta}</div> : null}
    </div>
  );
}

export function ComingSoon({ slug }: { slug: string }) {
  const params = useParams<{ projectId: string }>();
  const m = moduleBySlug(slug)!;
  return (
    <div>
      <PageHeader title={m.label} />
      <Body
        phase={m.phase!}
        blurb={m.blurb!}
        bullets={m.bullets!}
        cta={
          <div className="rounded-lg border border-line bg-surface-2/50 p-4">
            <p className="text-[13px] text-ink-2">Everything here starts from the building model. The more complete the walls, windows and room details are now, the less there is to fill in later.</p>
            <Link href={`/projects/${params.projectId}/studio`} className={buttonVariants({ variant: "secondary", size: "sm", className: "mt-3" })}>
              <Box />
              Open Building Studio
            </Link>
          </div>
        }
      />
    </div>
  );
}

export function GlobalComingSoon({ title, phase, blurb, bullets }: { title: string; phase: number; blurb: string; bullets: string[] }) {
  return (
    <div>
      <PageHeader title={title} />
      <Body phase={phase} blurb={blurb} bullets={bullets} />
    </div>
  );
}
