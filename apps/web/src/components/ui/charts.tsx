"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/* -------------------------------- AreaChart -------------------------------- */

export interface Point {
  date: string;
  value: number;
}

export function AreaChart({
  points,
  height = 200,
  color = "var(--accent)",
  formatValue = (n) => n.toLocaleString(),
  className,
}: {
  points: Point[];
  height?: number;
  color?: string;
  formatValue?: (n: number) => string;
  className?: string;
}) {
  const gradId = useId();
  const w = 720;
  const h = height;
  const padY = 18;
  const values = points.map((p) => p.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * w;
  const y = (v: number) => padY + (1 - (v - min) / range) * (h - padY * 2);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h - padY} L0,${h - padY} Z`;

  return (
    <div className={cn("relative", className)}>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} preserveAspectRatio="none" role="img" aria-label="Time series chart">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={w} y1={padY + f * (h - padY * 2)} y2={padY + f * (h - padY * 2)} stroke="var(--line)" strokeDasharray="3 5" />
        ))}
        <path d={area} fill={`url(#${gradId})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(points.length - 1)} cy={y(values[values.length - 1])} r="3.5" fill={color} />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-ink-3">
        <span>{points[0]?.date.slice(5)}</span>
        <span>{points[Math.floor(points.length / 2)]?.date.slice(5)}</span>
        <span>{points[points.length - 1]?.date.slice(5)}</span>
      </div>
      <div className="pointer-events-none absolute right-0 top-0 text-[11px] text-ink-3">{formatValue(max)}</div>
    </div>
  );
}

/* -------------------------------- Sparkline -------------------------------- */

export function Sparkline({ values, color = "var(--accent)", className }: { values: number[]; color?: string; className?: string }) {
  const w = 100;
  const h = 28;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${((i / Math.max(1, values.length - 1)) * w).toFixed(1)},${(h - 3 - ((v - min) / range) * (h - 6)).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-7 w-24", className)} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* --------------------------------- BarList --------------------------------- */

export function BarList({
  rows,
  className,
}: {
  rows: { label: React.ReactNode; icon?: React.ReactNode; value: number | null; display: string; color?: string }[];
  className?: string;
}) {
  const max = Math.max(...rows.map((r) => r.value ?? 0), 1);
  return (
    <div className={cn("flex flex-col", className)}>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto] items-center gap-x-4 border-b py-2.5 last:border-b-0">
          <div className="relative h-6 min-w-0 overflow-hidden rounded-md">
            <div
              className="absolute inset-y-0 left-0 rounded-md opacity-[0.14]"
              style={{ width: `${((r.value ?? 0) / max) * 100}%`, backgroundColor: r.color ?? "var(--accent)" }}
            />
            <div className="relative flex h-full items-center gap-2 px-2 text-[13px] font-medium">
              {r.icon}
              <span className="truncate">{r.label}</span>
            </div>
          </div>
          <span className="tnum text-[13px] font-semibold">{r.display}</span>
        </div>
      ))}
    </div>
  );
}
