"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// design/tats's careers chart (its app.js lineChart): one point per day (per
// week for a quarter) as a smooth line over a soft area, or as columns, with
// the period before drawn faint behind it. Client only for the crosshair and
// its tooltip: the value for the nearest point, and the same point the
// period before. The page computes every number (props only).

export type ChartPoint = { label: string; current: number | null; previous: number | null };

const fmt = (v: number | null, share: boolean) => (v === null ? "None" : share ? `${v.toFixed(1)}%` : Math.round(v).toLocaleString("en-US"));
const short = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}K` : String(Math.round(v * 10) / 10));

/** A monotone cubic through the points, so the curve never overshoots a day (the prototype's smoothPath). */
function smoothPath(pts: [number, number][]): string {
  const n = pts.length;
  if (n < 2) return "";
  const m: number[] = [];
  const t: number[] = [];
  for (let i = 0; i < n - 1; i++) m.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i + 1][0] - pts[i][0]) / 3;
    d += `C${pts[i][0] + dx},${pts[i][1] + t[i] * dx} ${pts[i + 1][0] - dx},${pts[i + 1][1] - t[i + 1] * dx} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

/**
 * Each unbroken stretch of a series, as the indices of its points. Null is a day
 * nothing was counted or there was nothing to take a share of, which is not
 * zero, so the line stops there rather than diving to the axis.
 */
export function chartRuns(values: (number | null)[]): number[][] {
  const runs: number[][] = [];
  values.forEach((v, i) => {
    if (v === null) return;
    if (i > 0 && values[i - 1] !== null) runs.at(-1)!.push(i);
    else runs.push([i]);
  });
  return runs;
}

export function CareersChart({ points, top, share, compare, bars, step }: {
  points: ChartPoint[];
  /** The axis' top, rounded by the page. */
  top: number;
  share: boolean;
  compare: boolean;
  bars: boolean;
  /** Days per point: 7 labels a point "Week of". */
  step: number;
}) {
  const [hot, setHot] = React.useState<number | null>(null);
  const n = points.length;
  const xAt = (i: number) => (bars ? ((i + 0.5) / n) * 1000 : n === 1 ? 500 : (i / (n - 1)) * 1000);
  const yAt = (v: number | null) => 300 - ((v ?? 0) / top) * 300;
  const lines = (key: "current" | "previous") => chartRuns(points.map((p) => p[key])).map((run) => run.map((i): [number, number] => [xAt(i), yAt(points[i][key])]));
  const line = (key: "current" | "previous") => lines(key).map(smoothPath).join("");
  // A point alone has no line, and its dot below shows it. Each stretch closes down to the axis, so a gap stays empty.
  const area = lines("current")
    .filter((run) => run.length > 1)
    .map((run) => `${smoothPath(run)}L${run.at(-1)![0]},300L${run[0][0]},300Z`)
    .join("");
  const every = Math.ceil(n / 7);
  const id = React.useId().replace(/:/g, "");

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setHot(bars ? Math.min(n - 1, Math.floor(f * n)) : Math.round(f * (n - 1)));
  };
  const hx = hot === null ? 0 : xAt(hot) / 10;
  const p = hot === null ? null : points[hot];

  return (
    <div
      className="grid grid-cols-[44px_minmax(0,1fr)] grid-rows-[220px_30px] px-3 pt-3.5 pb-1 min-[768px]:grid-rows-[260px_30px] min-[768px]:pr-6"
      role="img"
      aria-label={points.map((x) => `${x.label}: ${fmt(x.current, share)}`).join(", ")}
    >
      <div className="relative">
        {[1, 0.75, 0.5, 0.25, 0].map((f) => (
          <span key={f} className="absolute right-2.5 -translate-y-1/2 text-[11.5px] text-faint tabular-nums" style={{ top: `${(1 - f) * 100}%` }}>
            {share ? `${short(top * f)}%` : short(top * f)}
          </span>
        ))}
      </div>
      <div className="relative border-b border-[color:var(--line-strong)]" onPointerMove={move} onPointerLeave={() => setHot(null)}>
        {[0, 0.25, 0.5, 0.75].map((f) => (
          <i key={f} className="absolute inset-x-0 h-px bg-[color:var(--line)]" style={{ top: `${f * 100}%` }} />
        ))}
        {bars ? (
          <div className="absolute inset-0 grid auto-cols-fr grid-flow-col">
            {points.map((x, i) => (
              <div key={i} className="flex items-end justify-center gap-0.5 px-[18%]">
                {compare ? <i className="max-w-[22px] flex-1 bg-[color:var(--soft-strong)]" style={{ height: `${((x.previous ?? 0) / top) * 100}%` }} /> : null}
                <i className={cn("max-w-[22px] flex-1 bg-[color:var(--accent)]", hot === i && "opacity-80")} style={{ height: `${((x.current ?? 0) / top) * 100}%` }} />
              </div>
            ))}
          </div>
        ) : (
          <>
            <svg viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden className="absolute inset-0 size-full overflow-visible">
              <defs>
                <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="var(--accent)" stopOpacity={0.16} />
                  <stop offset="1" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <path d={area} fill={`url(#${id})`} />
              {compare ? <path d={line("previous")} fill="none" stroke="var(--faint)" strokeWidth={1.5} opacity={0.7} vectorEffect="non-scaling-stroke" /> : null}
              <path d={line("current")} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            {n <= 31
              ? points.map((x, i) =>
                  x.current === null ? null : (
                    <i
                      key={i}
                      className="pointer-events-none absolute -mt-1 -ml-1 size-2 rounded-full bg-[color:var(--paper)] shadow-[0_0_0_1.5px_var(--accent)]"
                      style={{ left: `${xAt(i) / 10}%`, top: `${yAt(x.current) / 3}%` }}
                    />
                  ),
                )
              : null}
          </>
        )}
        {p ? (
          <>
            <i className="pointer-events-none absolute inset-y-0 w-px bg-[color:var(--line-strong)]" style={{ left: `${hx}%` }} />
            {bars || p.current === null ? null : (
              <i
                className="pointer-events-none absolute z-[2] -mt-[5px] -ml-[5px] size-2.5 rounded-full bg-[color:var(--accent)] shadow-[0_0_0_2px_var(--paper)]"
                style={{ left: `${hx}%`, top: `${yAt(p.current) / 3}%` }}
              />
            )}
            <div
              className={cn(
                "pointer-events-none absolute top-1 z-[3] grid gap-px bg-raised px-2.5 py-2 text-[12px] whitespace-nowrap shadow-[var(--pop-shadow)]",
                hx > 70 ? "-translate-x-[calc(100%+12px)]" : "translate-x-3",
              )}
              style={{ left: `${hx}%` }}
            >
              <span className="text-muted-foreground">{step > 1 ? `Week of ${p.label}` : p.label}</span>
              <b className="text-[14px] font-medium tabular-nums">{fmt(p.current, share)}</b>
              {compare ? <small className="text-muted-foreground">{fmt(p.previous, share)} the period before</small> : null}
            </div>
          </>
        ) : null}
      </div>
      <div className="relative col-start-2">
        {points.map((x, i) =>
          i % every === 0 ? (
            <span
              key={i}
              className={cn("absolute top-[9px] text-[11.5px] whitespace-nowrap text-faint", i === 0 ? "" : xAt(i) > 940 ? "-translate-x-full" : "-translate-x-1/2")}
              style={{ left: `${xAt(i) / 10}%` }}
            >
              {x.label}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}
