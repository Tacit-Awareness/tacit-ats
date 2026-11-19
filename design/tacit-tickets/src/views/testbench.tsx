import { useState, type ReactNode } from "react"
import { Check, ChevronRight, FileText, Play, X } from "lucide-react"
import type { PathKind, Shape, Testbench } from "../data"
import { Btn, Empty, Segmented, heading } from "../kit"

/*
 * One Testbench attempt, as its staff dashboard shows it after the test: Tests against the
 * company's bar, the three readings as a triangle beside a comparison, what is behind each
 * reading, the path through the session, then recordings and activity. Read only here; the
 * grade itself is the row in the reply card.
 */

const AXES: { key: keyof Shape; label: string; angle: number }[] = [
  { key: "understanding", label: "Understanding", angle: -90 },
  { key: "quality", label: "Quality", angle: 30 },
  { key: "time", label: "Time to score", angle: 150 },
]
const at = (cx: number, cy: number, r: number, deg: number): [number, number] => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)]
const points = (cx: number, cy: number, r: number, s: Shape | number) => AXES.map((a) => at(cx, cy, (r * (typeof s === "number" ? s : s[a.key])) / 10, a.angle).map((n) => n.toFixed(1)).join(",")).join(" ")

/* The person's shape, solid, over the comparison's, dashed. Out of 10 on every axis. */
function Triangle({ shape, other, name, otherName, hot }: { shape: Shape; other: Shape; name: string; otherName: string; hot: keyof Shape | null }) {
  const [w, h, cx, cy, r] = [340, 262, 170, 150, 104]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-[340px]" role="img" aria-label={`${name}: understanding ${shape.understanding}, time to score ${shape.time}, quality ${shape.quality}, out of 10. ${otherName}: ${other.understanding}, ${other.time}, ${other.quality}.`}>
      {[2.5, 5, 7.5, 10].map((l) => (
        <polygon key={l} points={points(cx, cy, r, l)} fill="none" stroke="var(--color-line-strong)" strokeWidth="1" strokeLinejoin="round" />
      ))}
      {AXES.map((a) => {
        const [x, y] = at(cx, cy, r, a.angle)
        return <line key={a.key} x1={cx} y1={cy} x2={x} y2={y} stroke={hot === a.key ? "var(--color-mute)" : "var(--color-line-strong)"} strokeWidth="1" />
      })}
      <polygon points={points(cx, cy, r, other)} fill="none" stroke="var(--color-mute)" strokeWidth="1.5" strokeDasharray="4 4" strokeLinejoin="round" className="transition-all duration-300" />
      <polygon points={points(cx, cy, r, shape)} fill="color-mix(in oklab, var(--color-ink) 9%, transparent)" stroke="var(--color-ink)" strokeWidth="2" strokeLinejoin="round" />
      {AXES.map((a) => {
        const [px, py] = at(cx, cy, (r * shape[a.key]) / 10, a.angle)
        const [x, y] = at(cx, cy, r, a.angle)
        return (
          <g key={a.key}>
            <circle cx={px} cy={py} r={hot === a.key ? 4.5 : 3} fill="var(--color-ink)" />
            <text x={x} y={a.angle === -90 ? y - 14 : y + 24} textAnchor="middle" fontSize="12" fill={hot === a.key ? "var(--color-ink)" : "var(--color-mute)"}>
              {a.label}
              <tspan dx="6" fontWeight="600" fill="var(--color-ink)">
                {shape[a.key]}
              </tspan>
              <tspan fill="var(--color-faint)">/10</tspan>
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/* Cases passing through the session as steps, against the company's pace as a dashed line */
function PaceChart({ tb, total }: { tb: Testbench; total: number }) {
  const steps = tb.steps ?? []
  const limit = tb.minutes ?? 120
  const [w, h] = [300, 44]
  const X = (min: number) => (min / limit) * w
  const Y = (cases: number) => h - 2 - (cases / Math.max(total, 1)) * (h - 4)
  const end = steps[steps.length - 1]
  const line = steps.map((s, i) => (i ? `H${X(s.min).toFixed(1)}V${Y(s.passing).toFixed(1)}` : `M${X(s.min).toFixed(1)},${Y(s.passing).toFixed(1)}`)).join("") + (end ? `H${X(Math.min(limit, end.min + 8)).toFixed(1)}` : "")
  const pace = [{ min: 0, cases: 0 }, ...(tb.pace ?? [])].map((p, i) => `${i ? "L" : "M"}${X(p.min).toFixed(1)},${Y(p.cases).toFixed(1)}`).join("")
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-11 w-full" role="img" aria-label={`Cases passing over ${limit} minutes, against your pace`}>
      <line x1="0" y1={h - 1} x2={w} y2={h - 1} stroke="var(--color-line-strong)" vectorEffect="non-scaling-stroke" />
      <path d={pace} fill="none" stroke="var(--color-faint)" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <path d={line} fill="none" stroke="var(--color-ink)" strokeWidth="1.75" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

const KINDS: PathKind[] = ["ask", "do", "limit", "check"]
const card = "rounded-xl border border-line-strong bg-panel"
const h3 = heading

export function TestbenchReport({ tb, name, peers, onSend }: { tb?: Testbench; name: string; peers: { name: string; shape: Shape }[]; onSend: () => void }) {
  const [openPart, setOpenPart] = useState<string | null>(null)
  const [cmp, setCmp] = useState("team")
  const [hot, setHot] = useState<keyof Shape | null>(null)
  const [filter, setFilter] = useState<PathKind | null>(null)

  if (!tb) {
    return (
      <Empty icon={<FileText size={18} />} title="No Testbench yet" action={<Btn onClick={onSend}>Send One</Btn>}>
        Their tests, readings and session show here once they take it.
      </Empty>
    )
  }
  if (tb.status !== "submitted" || !tb.parts || !tb.shape) {
    return (
      <Empty icon={<FileText size={18} />} title="Invited, not taken yet">
        {tb.task}, sent {tb.when}. Results show here when they submit.
      </Empty>
    )
  }

  const parts = tb.parts
  const total = parts.reduce((n, p) => n + p.cases.length, 0)
  const got = (p: (typeof parts)[number]) => p.cases.filter((c) => c.pass).length
  const passed = parts.reduce((n, p) => n + got(p), 0)
  const cleared = parts.every((p) => got(p) >= p.bar)
  const options = [{ key: "team", label: "Team Median", shape: tb.team ?? { understanding: 6, time: 6, quality: 6 } }, ...peers.slice(0, 2).map((p) => ({ key: p.name, label: p.name, shape: p.shape }))]
  const other = options.find((o) => o.key === cmp) ?? options[0]
  const path = tb.path ?? []
  const prompts = path.filter((r) => r.kind !== "end").length
  const first = name.split(" ")[0]

  const readings: { key: keyof Shape; name: string; note: string; chart: ReactNode }[] = [
    {
      key: "understanding",
      name: "Understanding",
      note: tb.claims ? `${tb.claims.matched} of ${tb.claims.of} claims match the code` : "",
      chart: tb.claims && (
        <span className="flex h-2 gap-0.5">
          {Array.from({ length: tb.claims.of }, (_, i) => (
            <span key={i} className={`flex-1 rounded-[2px] ${i < tb.claims!.matched ? "bg-ink/70" : "bg-raised"}`} />
          ))}
        </span>
      ),
    },
    { key: "time", name: "Time to score", note: `${tb.took} of ${Math.round((tb.minutes ?? 120) / 60)}h, dashed is your pace`, chart: <PaceChart tb={tb} total={total} /> },
    {
      key: "quality",
      name: "Quality",
      note: (tb.quality ?? []).map((q) => `${q.name} ${q.got} of ${q.of}`).join(", "),
      chart: (
        <span className="flex h-2 gap-0.5">
          {(tb.quality ?? []).map((q) => (
            <span key={q.name} title={`${q.name}: ${q.got} of ${q.of}`} className="overflow-hidden rounded-[2px] bg-raised" style={{ flex: q.of }}>
              <span className="block h-full bg-ink/70" style={{ width: `${(q.got / q.of) * 100}%` }} />
            </span>
          ))}
        </span>
      ),
    },
  ]

  return (
    <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto bg-well px-6 py-5 @max-2xl:px-3">
      <div className="@container anim-rise mx-auto flex max-w-[760px] flex-col gap-3">
        {/* Tests: the count, whether it clears the bar, and each part against its own bar */}
        <section className={`${card} px-5 py-4`}>
          <div className="flex items-center gap-2.5">
            <h3 className={h3}>Tests</h3>
            <span className={`inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs ${cleared ? "bg-s-scheduled/15 text-s-scheduled" : "bg-bad/15 text-bad"}`}>
              {cleared ? <Check size={12} /> : <X size={12} />}
              {cleared ? "Cleared the bar" : "Below the bar"}
            </span>
            <span className="ml-auto truncate text-mute">{tb.task}</span>
          </div>
          <div className={`mt-3 ${heading} tabular-nums`}>
            {passed} of {total} passed
          </div>
          <div className="mt-4 flex gap-1">
            {parts.map((p) => (
              <span key={p.key} className="relative h-2 rounded-full bg-raised" style={{ flex: p.cases.length }}>
                <span className={`block h-full rounded-full ${got(p) >= p.bar ? "bg-ink/70" : "bg-bad/70"}`} style={{ width: `${(got(p) / p.cases.length) * 100}%` }} />
                <span title={`Your bar: ${p.bar} of ${p.cases.length}`} className="absolute -top-1 h-4 w-0.5 rounded-full bg-ink" style={{ left: `${(p.bar / p.cases.length) * 100}%` }} />
              </span>
            ))}
          </div>
          <div className="mt-3">
            {parts.map((p) => (
              <div key={p.key}>
                <button onClick={() => setOpenPart(openPart === p.key ? null : p.key)} aria-expanded={openPart === p.key} className="-mx-2 flex h-9 w-[calc(100%+16px)] items-center gap-3 rounded-md px-2 text-left transition-colors hover:bg-hover">
                  <span className="font-medium text-ink">Part {p.key}</span>
                  <span className="min-w-0 flex-1 truncate text-mute">{p.name}</span>
                  <span className={`tabular-nums ${got(p) >= p.bar ? "text-ink" : "text-bad"}`}>
                    {got(p)}/{p.cases.length}
                  </span>
                  <span className="w-[72px] text-right text-faint">
                    Your bar <span className="text-body tabular-nums">{p.bar}</span>
                  </span>
                  <ChevronRight size={14} className={`text-faint transition-transform ${openPart === p.key ? "rotate-90" : ""}`} />
                </button>
                {openPart === p.key && (
                  <ul className="anim-rise mb-2 border-l border-line pl-3">
                    {p.cases.map((c) => (
                      <li key={c.name} className="flex h-7 items-center gap-2.5">
                        {c.pass ? <Check size={13} className="shrink-0 text-s-scheduled" /> : <X size={13} className="shrink-0 text-bad" />}
                        <span className={`min-w-0 flex-1 truncate ${c.pass ? "text-body" : "text-ink"}`}>{c.name}</span>
                        <span className="text-xs text-faint">{c.hidden ? "Hidden" : "Public"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Shape: the three readings as a triangle, beside a comparison */}
        <section className={`${card} px-5 py-4`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h3 className={h3}>
              <span className="underline decoration-ink decoration-2 underline-offset-4">{first}</span> <span className="font-normal text-mute">compared with</span>
            </h3>
            <span className="ml-auto">
              <Segmented label="Compare with" value={other.key} onChange={setCmp} options={options.map((o) => ({ key: o.key, label: o.label }))} />
            </span>
          </div>
          <div className="mt-2 grid items-center gap-x-6 gap-y-2 @xl:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
            <div className="flex justify-center">
              <Triangle shape={tb.shape} other={other.shape} name={name} otherName={other.label} hot={hot} />
            </div>
            <div className="flex flex-col">
              {readings.map((r) => (
                <div key={r.key} onMouseEnter={() => setHot(r.key)} onMouseLeave={() => setHot(null)} className={`-mx-2 rounded-lg px-2 py-2.5 transition-colors ${hot === r.key ? "bg-hover" : ""}`}>
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium text-ink">{r.name}</span>
                    <span className="ml-auto text-ink tabular-nums">
                      <span className="font-semibold">{tb.shape![r.key]}</span>
                      <span className="text-faint">/10</span>
                    </span>
                    <span className="w-16 text-right text-xs text-faint tabular-nums" title={`${other.label}: ${other.shape[r.key]} of 10`}>
                      vs {other.shape[r.key]}
                    </span>
                  </div>
                  <div className="mt-2">{r.chart}</div>
                  {r.note && <div className="mt-1.5 truncate text-xs text-faint" title={r.note}>{r.note}</div>}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* The path: one line per prompt, by what it asks for */}
        {path.length > 0 && (
          <section className={`${card} px-5 py-4`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className={`${h3} mr-1.5`}>Path Through The Session</h3>
              {[tb.agent, `Iterated, ${prompts} prompts`, `${tb.took} of ${Math.round((tb.minutes ?? 120) / 60)}h`].map((c) => c && (
                <span key={c} className="inline-flex h-6 items-center rounded-md bg-raised px-1.5 text-xs text-body">{c}</span>
              ))}
            </div>
            <div className="mt-3 flex gap-1">
              {KINDS.map((k) => (
                <button key={k} aria-pressed={filter === k} onClick={() => setFilter(filter === k ? null : k)} className={`flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors ${filter === k ? "bg-raised text-ink" : "text-mute hover:text-ink"}`}>
                  {k} <span className="text-faint tabular-nums">{path.filter((r) => r.kind === k).length}</span>
                </button>
              ))}
            </div>
            <ol className="relative mt-2">
              <span className="absolute top-3 bottom-3 left-[5px] w-px bg-line" aria-hidden="true" />
              {path.map((r, i) => (
                <li key={i} className={`relative flex min-h-9 items-baseline gap-3 py-1.5 transition-opacity ${filter && r.kind !== filter ? "opacity-30" : ""}`}>
                  <span className={`relative z-10 mt-1 size-[11px] shrink-0 self-start rounded-full border-2 ${r.kind === "end" ? "border-ink bg-ink" : "border-mute bg-panel"}`} />
                  <span className="w-10 shrink-0 text-xs text-faint">{r.kind === "end" ? "" : r.kind}</span>
                  <span className={`min-w-0 flex-1 ${r.kind === "end" ? "font-medium text-ink" : "text-body"}`}>{r.text}</span>
                  {r.test && <span className={`shrink-0 text-xs tabular-nums ${r.testOn ? "text-s-scheduled" : "text-mute"}`}>{r.test}</span>}
                  <span className="w-12 shrink-0 text-right text-xs text-faint tabular-nums">{r.at}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <div className="grid gap-3 @xl:grid-cols-2">
          {tb.recordings && (
            <section className={`${card} px-5 py-4`}>
              <h3 className={h3}>Recordings</h3>
              <ul className="mt-2">
                {tb.recordings.map((r) => (
                  <li key={r.name} className="flex h-9 items-center gap-2.5 text-body" title="Plays in Testbench">
                    <Play size={13} className="shrink-0 text-faint" />
                    <span className="flex-1">{r.name}</span>
                    <span className="text-faint tabular-nums">{r.length}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {tb.activity && (
            <section className={`${card} px-5 py-4`}>
              <h3 className={h3}>Activity</h3>
              <ul className="mt-2">
                {tb.activity.map((x) => (
                  <li key={x.text} className="flex min-h-9 items-center gap-3 text-body">
                    <span className="flex-1">{x.text}</span>
                    <span className="shrink-0 text-xs text-faint tabular-nums">{x.at}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
