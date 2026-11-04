"use client";
/**
 * Property-panel fields. Inputs keep a local text buffer and commit on Enter/blur; Esc reverts.
 * Null engineering values render as an empty input with a "Not entered" hint — never a default.
 */
import * as React from "react";
import { formatLength, parseLength, type UnitSystem } from "@hvac/building-geometry";
import { cn } from "@/lib/utils";
import { inputClass } from "@/components/ui/input";

export function Row({ label, children, hint, className }: { label: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-[104px_minmax(0,1fr)] items-center gap-2 py-[3px]", className)}>
      <span className="truncate text-[12px] text-ink-3" title={typeof label === "string" ? label : undefined}>
        {label}
      </span>
      <div className="min-w-0">
        {children}
        {hint ? <p className="mt-0.5 text-[11px] text-ink-4">{hint}</p> : null}
      </div>
    </div>
  );
}

export function Section({ title, children, aside, defaultOpen = true }: { title: string; children: React.ReactNode; aside?: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className="border-b border-line px-3 py-2.5 last:border-b-0">
      <div className="mb-1 flex items-center gap-2">
        <button
          className="flex flex-1 items-center gap-1 text-left text-[12px] font-semibold text-ink"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <svg className={cn("size-3 text-ink-4 transition-transform", open ? "rotate-90" : "")} viewBox="0 0 12 12" fill="currentColor" aria-hidden>
            <path d="M4.5 3 8 6l-3.5 3z" />
          </svg>
          {title}
        </button>
        {aside}
      </div>
      {open ? <div className="pl-0">{children}</div> : null}
    </section>
  );
}

export function ReadOnly({ value, className, mono }: { value: React.ReactNode; className?: string; mono?: boolean }) {
  return <span className={cn("block truncate text-[12.5px] text-ink tnum", mono && "font-medium", className)}>{value}</span>;
}

const fieldCls = cn(inputClass, "h-7 rounded-[6px] px-2 text-[12.5px] tnum");

function useBuffered(display: string, onCommit: (text: string) => boolean) {
  const [text, setText] = React.useState(display);
  const [focused, setFocused] = React.useState(false);
  const [invalid, setInvalid] = React.useState(false);
  React.useEffect(() => {
    if (!focused) {
      setText(display);
      setInvalid(false);
    }
  }, [display, focused]);
  const commit = () => {
    if (text === display) return;
    const ok = onCommit(text);
    setInvalid(!ok);
    if (!ok) return;
  };
  return {
    value: text,
    "aria-invalid": invalid || undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setText(e.target.value);
      setInvalid(false);
    },
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      setFocused(true);
      e.currentTarget.select();
    },
    onBlur: () => {
      setFocused(false);
      commit();
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        commit();
        (e.target as HTMLInputElement).blur();
      } else if (e.key === "Escape") {
        setText(display);
        setInvalid(false);
        e.stopPropagation();
        (e.target as HTMLInputElement).blur();
      }
    },
  };
}

/** Length in inches, edited with parseLength (accepts 12' 6", 3.8m, …). */
export function LengthField({
  value,
  units,
  onChange,
  nullable,
  min = 0,
  "aria-label": ariaLabel,
}: {
  value: number | null;
  units: UnitSystem;
  onChange: (inches: number | null) => void;
  nullable?: boolean;
  min?: number;
  "aria-label"?: string;
}) {
  const display = value === null ? "" : formatLength(value, units);
  const props = useBuffered(display, (t) => {
    if (!t.trim()) {
      if (nullable) {
        onChange(null);
        return true;
      }
      return false;
    }
    const v = parseLength(t, units);
    if (v === null || v < min || (min === 0 && v === 0 && !nullable)) return false;
    onChange(v);
    return true;
  });
  return (
    <div className="relative">
      <input className={fieldCls} {...props} aria-label={ariaLabel} placeholder={nullable ? "" : undefined} spellCheck={false} />
      {value === null && nullable ? <NotEntered /> : null}
    </div>
  );
}

/** Plain number; null allowed when nullable (empty input → null). */
export function NumberField({
  value,
  onChange,
  nullable,
  min,
  max,
  step,
  integer,
  suffix,
  "aria-label": ariaLabel,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  nullable?: boolean;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  suffix?: string;
  "aria-label"?: string;
}) {
  const display = value === null ? "" : String(+value.toFixed(4));
  const props = useBuffered(display, (t) => {
    const s = t.trim();
    if (!s) {
      if (nullable) {
        onChange(null);
        return true;
      }
      return false;
    }
    const v = Number(s);
    if (!Number.isFinite(v)) return false;
    if (integer && !Number.isInteger(v)) return false;
    if (min !== undefined && v < min) return false;
    if (max !== undefined && v > max) return false;
    onChange(v);
    return true;
  });
  return (
    <div className="relative">
      <input className={cn(fieldCls, suffix && "pr-9")} inputMode="decimal" {...props} aria-label={ariaLabel} step={step} spellCheck={false} />
      {value === null && nullable ? <NotEntered /> : suffix ? <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ink-4">{suffix}</span> : null}
    </div>
  );
}

export function TextField({
  value,
  onChange,
  nullable,
  placeholder,
  "aria-label": ariaLabel,
  maxLength,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  nullable?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  maxLength?: number;
}) {
  const props = useBuffered(value ?? "", (t) => {
    const s = t.trim();
    if (!s) {
      if (nullable) {
        onChange(null);
        return true;
      }
      return false;
    }
    onChange(s.slice(0, maxLength ?? 120));
    return true;
  });
  return (
    <div className="relative">
      <input className={fieldCls} {...props} aria-label={ariaLabel} placeholder={placeholder} maxLength={maxLength} />
      {value === null && nullable && !placeholder ? <NotEntered /> : null}
    </div>
  );
}

export function SelectField<T extends string>({
  value,
  options,
  onChange,
  nullable,
  "aria-label": ariaLabel,
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T | null) => void;
  nullable?: boolean;
  "aria-label"?: string;
}) {
  return (
    <div className="relative">
      <select
        className={cn(
          fieldCls,
          "appearance-none pr-6",
          value === null && "text-transparent",
          "bg-[length:11px] bg-[right_7px_center] bg-no-repeat bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%239aa5ae' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")]",
        )}
        value={value ?? ""}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value === "" ? null : (e.target.value as T))}
      >
        {nullable || value === null ? <option value="">Not entered</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} className="text-ink">
            {o.label}
          </option>
        ))}
      </select>
      {value === null ? <NotEntered /> : null}
    </div>
  );
}

export function NotEntered() {
  return <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px] italic text-ink-4">Not entered</span>;
}

export function Segmented<T extends string>({ value, options, onChange, size = "sm" }: { value: T; options: { value: T; label: React.ReactNode; title?: string }[]; onChange: (v: T) => void; size?: "sm" | "xs" }) {
  return (
    <div className="inline-flex w-full rounded-[6px] bg-surface-2 p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded-[5px] px-2 text-[12px] font-medium text-ink-3 transition-colors hover:text-ink",
            size === "sm" ? "h-6" : "h-5",
            value === o.value && "bg-surface text-ink shadow-sm",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProvenanceBadge({ source, confidence }: { source: string; confidence?: number }) {
  const tone =
    source === "inferred"
      ? "bg-warn-soft text-warn"
      : source === "default"
        ? "bg-surface-2 text-ink-3"
        : source === "imported"
          ? "bg-cool-soft text-cool"
          : "bg-accent-soft text-accent-ink";
  const label = { user: "Entered", measured: "Measured", imported: "Imported", inferred: "Inferred", default: "Default" }[source] ?? source;
  return (
    <span className={cn("inline-flex h-[18px] items-center rounded px-1.5 text-[10.5px] font-medium", tone)} title={`Provenance: ${source}`}>
      {label}
      {source === "inferred" && confidence !== undefined ? ` · ${Math.round(confidence * 100)}%` : ""}
    </span>
  );
}

export function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "heat" | "cool" }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-[3px]">
      <span className="text-[12px] text-ink-3">{label}</span>
      <span className={cn("text-[12.5px] font-medium text-ink tnum", tone === "heat" && "text-heat", tone === "cool" && "text-cool")}>{value}</span>
    </div>
  );
}
