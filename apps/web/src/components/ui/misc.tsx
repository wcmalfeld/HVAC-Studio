import * as React from "react";
import { cn, initials } from "@/lib/utils";

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface px-1 font-sans text-[11px] font-medium text-ink-2 shadow-[0_1px_0_var(--line-strong)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

const AVATAR_TONES = ["#0b7a83", "#2b6cd4", "#7a5af5", "#b7791f", "#c4462a", "#2f8a4c", "#5b6b78"];
export function Avatar({ name, size = 24, className }: { name: string | null | undefined; size?: number; className?: string }) {
  let h = 0;
  for (const c of name ?? "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const bg = AVATAR_TONES[h % AVATAR_TONES.length];
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, background: name ? bg : "var(--ink-4)", fontSize: Math.round(size * 0.4) }}
      title={name ?? "Unassigned"}
      aria-label={name ?? "Unassigned"}
    >
      {name ? initials(name) : "–"}
    </span>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn("skeleton rounded-md", className)} style={style} aria-hidden />;
}

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div className={cn(vertical ? "w-px self-stretch bg-line" : "h-px w-full bg-line", className)} />;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon ? (
        <div className="mb-3 flex size-10 items-center justify-center rounded-lg border border-line bg-surface text-ink-3 shadow-sm [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-[13px] text-ink-3">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
