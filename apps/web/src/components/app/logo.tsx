import { cn } from "@/lib/utils";

/** Mark: a plan-view room corner with a supply register — two walls meeting, three airflow vanes. */
export function LogoMark({ className, size = 22 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={cn("shrink-0", className)} aria-hidden>
      <rect x="0.75" y="0.75" width="22.5" height="22.5" rx="6" fill="var(--accent)" />
      <path d="M6 18V6h12" stroke="var(--on-accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.5 10.5h6.5M10.5 13.5h4.5M10.5 16.5h2.5" stroke="var(--on-accent)" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-[14px] font-semibold tracking-[-0.015em] text-ink">HVAC Studio</span>
    </span>
  );
}
