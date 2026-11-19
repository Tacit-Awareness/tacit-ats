"use client";

import { useState } from "react"

/*
 * design/tacit-tickets/src/views/funnel.tsx, as it came; only the colour tokens are this app's.
 *
 * The funnel, drawn in hairline's manner: thin strokes, a few tones, solid faces that hide what is
 * behind them. Its front tapers from the top left to the right. Each stage is its own block, a dot
 * a person; the block you point at lifts, and the one you pick keeps a dark edge.
 */

/* A dot is a person: their name, and two short lines to show when you point at them */
export type FunnelStage = { name: string; tone?: string; dots: { id: string; name: string; sub?: string; note?: string; tone?: string }[] }

/* The front face, and how far depth carries a point up and to the right */
const [W, H, TAPER, PAD, X0, GAP, DEPTH] = [1000, 200, 56, 16, 4, 12, 0.45]
const [DX, DY] = [60, 40]
/* The labels under the drawing line up with the front face, which stops short of the right edge */
export const FUNNEL_INSET = `${((DX / (W + DX)) * 100).toFixed(2)}%`
const top = (x: number) => DY + 6 + ((x - X0) / (W - X0 * 2)) * TAPER
const bottom = (x: number) => DY + H - (top(x) - DY)
/* A point on the front face, pushed back by t (0 at the front, 1 at full depth) */
const at = (x: number, y: number, t = 0) => `${(x + t * DX).toFixed(1)},${(y - t * DY).toFixed(1)}`
const poly = (...pts: string[]) => pts.join(" ")
/* A face of a block: the panel, tinted a little by the block's colour, or by ink when it has none */
const tint = (pct: number, tone = "var(--ink)") => `color-mix(in oklab, ${tone} ${pct}%, var(--paper))`
const line = { strokeWidth: 0.9, vectorEffect: "non-scaling-stroke" as const, strokeLinejoin: "round" as const }

export function Funnel({ stages, picked, hot, setHot, onStage, onDot }: { stages: FunnelStage[]; picked: number | null; hot: number | null; setHot: (i: number | null) => void; onStage: (i: number) => void; onDot: (stage: number, id: string) => void }) {
  const SW = (W - X0 * 2) / stages.length
  /* The person under the pointer, and where their dot is */
  const [tip, setTip] = useState<{ x: number; y: number; name: string; sub?: string; note?: string } | null>(null)
  return (
    <div className="relative">
    <svg viewBox={`0 0 ${W + DX} ${H + DY}`} className="block w-full overflow-visible" role="img" aria-label={`People in process by stage: ${stages.map((f) => `${f.name} ${f.dots.length}`).join(", ")}`}>
      {stages.map((s, i) => {
        const [x0, x1] = [X0 + i * SW + GAP / 2, X0 + (i + 1) * SW - GAP / 2]
        const on = hot === i || picked === i
        return (
          <g key={s.name} style={{ transform: hot === i ? "translateY(-8px)" : undefined, transition: "transform 260ms cubic-bezier(.23,1,.32,1)" }} onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)}>
            <polygon points={poly(at(x0, top(x0)), at(x1, top(x1)), at(x1, top(x1), DEPTH), at(x0, top(x0), DEPTH))} fill={s.tone ? tint(on ? 30 : 20, s.tone) : tint(on ? 7 : 3)} stroke="var(--faint)" {...line} className="transition-[fill] duration-150" />
            <polygon points={poly(at(x1, top(x1)), at(x1, top(x1), DEPTH), at(x1, bottom(x1), DEPTH), at(x1, bottom(x1)))} fill={s.tone ? tint(on ? 42 : 32, s.tone) : tint(on ? 12 : 8)} stroke="var(--faint)" {...line} className="transition-[fill] duration-150" />
            <polygon
              points={poly(at(x0, top(x0)), at(x1, top(x1)), at(x1, bottom(x1)), at(x0, bottom(x0)))}
              fill={s.tone ? tint(on ? 14 : 9, s.tone) : "var(--paper)"}
              stroke={on ? "var(--ink)" : "var(--muted-text)"}
              {...line}
              strokeWidth={picked === i ? 1.6 : on ? 1.3 : 0.9}
              className="cursor-pointer transition-[stroke] duration-150"
              onClick={() => onStage(i)}
            />
            {/* Dots are spread by a low-discrepancy sequence, so they sit evenly without a grid and never move between renders */}
            {s.dots.map((d, k) => {
              const [u, v] = [((k + 1) * 0.7548776662) % 1, ((k + 1) * 0.569840291) % 1]
              const x = x0 + PAD + u * (x1 - x0 - PAD * 2)
              const y = top(x) + PAD + v * (bottom(x) - top(x) - PAD * 2)
              /* The dot sits in a wider, unseen target, so the block lifting under the pointer does not drop the hover */
              return (
                <g key={d.id} className="cursor-pointer" onMouseEnter={() => setTip({ x, y, name: d.name, sub: d.sub, note: d.note })} onMouseLeave={() => setTip(null)} onClick={() => onDot(i, d.id)}>
                  <circle cx={x} cy={y} r="13" fill="transparent" />
                  <circle cx={x} cy={y} r={tip?.name === d.name ? 6.5 : 4.5} fill={d.tone ?? "var(--ink)"} opacity={hot === null || hot === i ? 1 : 0.4} className="transition-[opacity,r] duration-150" pointerEvents="none" />
                </g>
              )
            })}
          </g>
        )
      })}
    </svg>
      {tip && (
        <div
          role="tooltip"
          className="anim-rise pointer-events-none absolute z-20 w-max max-w-[240px] -translate-x-1/2 -translate-y-full rounded-lg border border-line-strong bg-panel px-3 py-2 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.35)]"
          style={{ left: `${(tip.x / (W + DX)) * 100}%`, top: `calc(${(tip.y / (H + DY)) * 100}% - 18px)` }}
        >
          <div className="truncate font-medium text-ink">{tip.name}</div>
          {tip.sub && <div className="truncate text-mute">{tip.sub}</div>}
          {tip.note && <div className="mt-1 truncate text-xs text-faint">{tip.note}</div>}
        </div>
      )}
    </div>
  )
}
