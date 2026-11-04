"use client";
import * as React from "react";

/**
 * North-angle dial. The plan's "up" is the top of the dial; the needle points to true north,
 * clockwise from up (BuildingModel.northAngleDeg). Drag to set (snaps to 5°, Shift for 1°).
 */
export function CompassDial({ value, onChange, size = 76 }: { value: number; onChange: (deg: number) => void; size?: number }) {
  const ref = React.useRef<SVGSVGElement>(null);
  const [drag, setDrag] = React.useState<number | null>(null);
  const shown = drag ?? value;
  const r = size / 2;

  const angleFrom = (e: React.PointerEvent) => {
    const b = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (b.left + b.width / 2);
    const dy = e.clientY - (b.top + b.height / 2);
    let a = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (a < 0) a += 360;
    const step = e.shiftKey ? 1 : 5;
    return (Math.round(a / step) * step) % 360;
  };

  const ticks = Array.from({ length: 24 }, (_, i) => i * 15);
  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
      role="slider"
      aria-label="North angle"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 15 : 1;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange((value + step) % 360);
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange((value - step + 360) % 360);
      }}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture(e.pointerId);
        setDrag(angleFrom(e));
      }}
      onPointerMove={(e) => drag !== null && setDrag(angleFrom(e))}
      onPointerUp={() => {
        if (drag !== null) onChange(drag);
        setDrag(null);
      }}
    >
      <circle cx={r} cy={r} r={r - 1} fill="var(--surface)" stroke="var(--line-strong)" />
      {ticks.map((t) => {
        const major = t % 90 === 0;
        const a = (t * Math.PI) / 180;
        const r1 = r - 2, r2 = r - (major ? 8 : 5);
        return (
          <line
            key={t}
            x1={r + Math.sin(a) * r1}
            y1={r - Math.cos(a) * r1}
            x2={r + Math.sin(a) * r2}
            y2={r - Math.cos(a) * r2}
            stroke={major ? "var(--ink-3)" : "var(--line-strong)"}
            strokeWidth={major ? 1.4 : 1}
          />
        );
      })}
      {/* plan "up" marker */}
      <path d={`M${r - 4} 1.5 L${r + 4} 1.5 L${r} 6 Z`} fill="var(--ink-3)" />
      <g transform={`rotate(${shown} ${r} ${r})`}>
        <path d={`M${r} ${11} L${r + 4.5} ${r} L${r - 4.5} ${r} Z`} fill="var(--heat)" />
        <path d={`M${r} ${size - 11} L${r + 4.5} ${r} L${r - 4.5} ${r} Z`} fill="var(--ink-4)" opacity="0.45" />
      </g>
      <text
        x={r + Math.sin((shown * Math.PI) / 180) * (r - 4) * 0.42 + Math.cos((shown * Math.PI) / 180) * 10}
        y={r - Math.cos((shown * Math.PI) / 180) * (r - 4) * 0.42 + Math.sin((shown * Math.PI) / 180) * 10 + 3}
        textAnchor="middle"
        fontSize="9.5"
        fontWeight={700}
        fill="var(--heat)"
      >
        N
      </text>
      <circle cx={r} cy={r} r={2.5} fill="var(--ink)" />
    </svg>
  );
}
