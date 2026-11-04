"use client";
import * as React from "react";
import { useTheme } from "@/components/app/theme";

export interface PlanColors {
  bg: string;
  gridMinor: string;
  gridMajor: string;
  axis: string;
  wall: string;
  wallInterior: string;
  room: string;
  select: string;
  dim: string;
  window: string;
  door: string;
  ink: string;
  ink3: string;
  surface: string;
  heat: string;
  cool: string;
  warn: string;
  danger: string;
}

function read(): PlanColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    bg: v("--plan-bg"),
    gridMinor: v("--plan-grid-minor"),
    gridMajor: v("--plan-grid-major"),
    axis: v("--line-strong"),
    wall: v("--plan-wall"),
    wallInterior: v("--plan-wall-interior"),
    room: v("--plan-room"),
    select: v("--plan-select"),
    dim: v("--plan-dim"),
    window: v("--plan-window"),
    door: v("--plan-door"),
    ink: v("--ink"),
    ink3: v("--ink-3"),
    surface: v("--surface"),
    heat: v("--heat"),
    cool: v("--cool"),
    warn: v("--warn"),
    danger: v("--danger"),
  };
}

const FALLBACK: PlanColors = {
  bg: "#fbfcfc",
  gridMinor: "#eef1f3",
  gridMajor: "#dce2e6",
  axis: "#c6cfd6",
  wall: "#1d2b36",
  wallInterior: "#4b5964",
  room: "#0b7a83",
  select: "#0b7a83",
  dim: "#44535f",
  window: "#2b6cd4",
  door: "#8a5a2b",
  ink: "#12202b",
  ink3: "#6f7c87",
  surface: "#ffffff",
  heat: "#c4462a",
  cool: "#2b6cd4",
  warn: "#b7791f",
  danger: "#c53030",
};

/** Canvas colors resolved from CSS tokens, re-read when the theme flips. */
export function usePlanColors(): PlanColors {
  const { resolved } = useTheme();
  const [c, setC] = React.useState<PlanColors>(FALLBACK);
  React.useEffect(() => {
    // Re-read tokens whenever data-theme changes on <html> (theme menu, system change, or tests).
    let raf = requestAnimationFrame(() => setC(read()));
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setC(read()));
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
    };
  }, [resolved]);
  return c;
}

export const PlanColorsContext = React.createContext<PlanColors>(FALLBACK);
export const usePlan = () => React.useContext(PlanColorsContext);

/** Room fill tint by room type family (subtle; labels carry the meaning). */
export function roomTint(roomType: string, conditioned: boolean, c: PlanColors): string {
  if (!conditioned) return c.ink3;
  switch (roomType) {
    case "garage":
    case "utility":
    case "mechanical":
    case "basement":
      return c.ink3;
    case "bathroom":
    case "laundry":
      return c.cool;
    case "kitchen":
      return c.heat;
    default:
      return c.room;
  }
}
