import { useEffect, useState, type ReactNode } from "react"
import { ArrowDown, ArrowUp, Check, ClipboardList, Code2, Copy, FileCheck, GitBranch, Maximize, Minus, Phone, Plus, Trash2, Users, X } from "lucide-react"
import { TEAMS } from "../data"
import { CONNECTOR_URL, ROUND_KINDS, ROUND_PRESETS, newRound, type RoundBy, type RoundDef, type RoundKind } from "../org"
import { Bone, Btn, IconButton, Loading, Menu, Segmented, TeamTile, teamOf } from "../kit"
import { BotMark } from "../ui"
import { useStore } from "../store"

/*
 * The rounds builder: the interview process as a flow you put together. Rounds are on the left to
 * add, the flow is in the middle, and the round you pick is edited on the right. One process for
 * the company, and a branch for any team that runs it differently. The same thing can be done by
 * asking Claude or the company's bot, which hold the connector (set_interview_plan).
 */

const ICON: Record<RoundKind, ReactNode> = {
  screen: <Phone size={15} />,
  interview: <Users size={15} />,
  takehome: <Code2 size={15} />,
  onsite: <ClipboardList size={15} />,
  reference: <Check size={15} />,
}
const LENGTHS = [15, 30, 45, 60, 90, 120, 180]
const length = (r: RoundDef) => (r.kind === "takehome" ? "In their own time" : r.minutes >= 60 ? `${r.minutes / 60} hr` : `${r.minutes} min`)
const who = (r: RoundDef) => (r.kind === "takehome" ? "Sent through Testbench" : r.by === "Team" ? `${r.people} ${r.people === 1 ? "interviewer" : "interviewers"} from the team` : `With the ${r.by.toLowerCase()}`)
const chip = "inline-flex h-5 items-center rounded px-1.5 text-[11px] tracking-[0.04em]"

/* A step of the flow, in the style of a node: what it is above it, then a card */
function Node({ tag, tone, icon, title, right, line, foot, on, onClick, children }: { tag: string; tone: string; icon: ReactNode; title: string; right?: string; line: string; foot?: string; on?: boolean; onClick?: () => void; children?: ReactNode }) {
  return (
    <div className="relative w-[320px]">
      <span className={`${chip} ${tone}`}>{tag}</span>
      <div
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick}
        onKeyDown={(e) => onClick && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick())}
        className={`group/node mt-1.5 rounded-xl border bg-panel p-1.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors ${on ? "border-ink" : "border-line-strong"} ${onClick ? "cursor-pointer hover:border-mute" : ""}`}
      >
        <div className="flex items-center gap-2.5 px-1.5 pt-1.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-raised text-mute">{icon}</span>
          <span className={`min-w-0 flex-1 truncate font-medium ${title ? "text-ink" : "text-faint"}`}>{title || "Untitled round"}</span>
          {right && <span className="shrink-0 rounded-md bg-raised px-1.5 py-0.5 text-xs text-mute">{right}</span>}
        </div>
        <div className="truncate px-1.5 pt-1.5 pb-2 pl-[46px] text-mute">{line}</div>
        {foot && <div className="truncate rounded-lg bg-hover px-2.5 py-1.5 font-mono text-xs text-mute">{foot}</div>}
        {children}
      </div>
    </div>
  )
}

/* The line between two steps, with a place to add one */
function Link({ onAdd }: { onAdd?: () => void }) {
  return (
    <div className="group/link relative flex h-9 w-[320px] justify-center">
      <span className="w-px bg-line-strong" />
      {onAdd && (
        <button aria-label="Add a round here" title="Add a round here" onClick={onAdd} className="absolute top-1/2 left-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-well opacity-0 transition-opacity group-hover/link:opacity-100 focus-visible:opacity-100">
          <Plus size={12} />
        </button>
      )}
    </div>
  )
}

export function RoundsBuilder() {
  const s = useStore()
  const ask = s.sheet?.kind === "rounds" && s.sheet.ask
  const [mode, setMode] = useState<"build" | "ask">(ask ? "ask" : "build")
  const [scope, setScope] = useState("company")
  const [sel, setSel] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [copied, setCopied] = useState(false)
  /* The flow is read when the builder opens; a skeleton of it stands in for that moment */
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), 450)
    return () => window.clearTimeout(t)
  }, [])

  const own = s.process[scope]
  const inherits = scope !== "company" && !own
  const rounds = own ?? s.process.company
  const picked = inherits ? null : (rounds.find((r) => r.id === sel) ?? null)
  const set = (next: RoundDef[]) => s.setProcess((p) => ({ ...p, [scope]: next }))
  const patch = (id: string, change: Partial<RoundDef>) => set(rounds.map((r) => (r.id === id ? { ...r, ...change } : r)))
  const add = (name: string, at = rounds.length) => {
    const r = newRound(name)
    set([...rounds.slice(0, at), r, ...rounds.slice(at)])
    setSel(r.id)
  }
  const move = (id: string, by: number) => {
    const i = rounds.findIndex((r) => r.id === id)
    const j = i + by
    if (j < 0 || j >= rounds.length) return
    const next = [...rounds]
    ;[next[i], next[j]] = [next[j], next[i]]
    set(next)
  }
  const close = () => {
    s.setRoundsBuilt(true)
    s.setSheet(null)
  }
  const scopeName = scope === "company" ? "Company" : teamOf(scope).name
  const prompt = `Set up our interview process in Tacit. ${scope === "company" ? "For the whole company" : `For the ${scopeName} team`}, use these rounds in order:\n1. Recruiter screen, 30 minutes, with the recruiter\n2. Technical interview, 60 minutes, two interviewers from the team\n3. Take-home through Testbench\n4. Onsite, 3 hours, three interviewers\nThen show me the plan before you save it.`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Interview rounds">
      <div className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[2px]" onClick={close} />
      <div className="anim-rise relative flex h-[min(860px,calc(100vh-32px))] w-full max-w-[1240px] flex-col overflow-hidden rounded-xl border border-line-strong bg-panel shadow-[0_24px_80px_-12px_rgba(0,0,0,0.6)]">
        {/* Which process this is, and the two ways to build it */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line pr-2 pl-4">
          <span className="font-medium text-ink">Interview Rounds</span>
          <span className="text-faint">/</span>
          <Menu
            width={220}
            items={[
              { label: "Company", on: scope === "company", onPick: () => { setScope("company"); setSel(null) } },
              "sep",
              { heading: "A Team's Own Rounds" },
              ...TEAMS.map((t) => ({ label: `${t.name}${s.process[t.id] ? ", its own" : ""}`, on: scope === t.id, onPick: () => { setScope(t.id); setSel(null) } })),
            ]}
            trigger={() => (
              <button className="flex h-7 items-center gap-1.5 -ml-1.5 rounded-md px-1.5 text-ink transition-colors hover:bg-hover">
                {scope !== "company" && <TeamTile id={scope} size={14} />}
                {scopeName}
                <span className="text-xs text-faint">{rounds.length} rounds</span>
              </button>
            )}
          />
          <span className="ml-auto">
            <Segmented label="How to build" value={mode} onChange={setMode} options={[{ key: "build", label: "Build" }, { key: "ask", label: "Ask Claude" }]} />
          </span>
          <Btn solid onClick={close} className="ml-1">
            Done
          </Btn>
          <IconButton label="Close" onClick={close}>
            <X size={16} />
          </IconButton>
        </header>

        {mode === "ask" ? (
          <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[620px] px-6 py-12">
              <div className="flex items-center gap-2.5 text-ink">
                <span className="flex size-9 items-center justify-center rounded-xl bg-raised text-mute">
                  <BotMark size={16} />
                </span>
                <span className="text-[17px] font-semibold tracking-[-0.015em]">Have Claude or your bot build it</span>
              </div>
              <p className="mt-3 leading-[1.6] text-body">Anything connected to Tacit can set up the rounds for you. Say what your process is in your own words; it writes the rounds, and they appear here to review.</p>
              <div className="mt-6 rounded-xl border border-line-strong">
                <div className="flex items-center gap-2 border-b border-line px-3.5 py-2 text-mute">
                  <span className="flex-1">What to say</span>
                  <button
                    onClick={() => {
                      void navigator.clipboard?.writeText(prompt).catch(() => {})
                      setCopied(true)
                      window.setTimeout(() => setCopied(false), 1400)
                    }}
                    className="flex items-center gap-1.5 rounded text-mute transition-colors hover:text-ink"
                  >
                    <Copy size={13} /> {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="px-3.5 py-3 leading-[1.6] whitespace-pre-wrap text-ink">{prompt}</p>
              </div>
              <ol className="mt-6 flex flex-col gap-2.5 text-body">
                {[
                  `Open Claude, or message your bot, where the Tacit connector is on.`,
                  "Paste the text above and change the rounds to yours.",
                  "Come back here. The rounds it saved are on the Build tab to adjust.",
                ].map((line, i) => (
                  <li key={line} className="flex gap-3">
                    <span className="w-4 shrink-0 text-right text-faint tabular-nums">{i + 1}</span>
                    {line}
                  </li>
                ))}
              </ol>
              <div className="mt-6 flex items-center gap-2 rounded-lg bg-hover px-3 py-2.5 text-mute">
                <span className="size-2 shrink-0 rounded-full bg-s-scheduled" />
                <span className="min-w-0 flex-1 truncate">
                  Connector <span className="font-mono text-xs text-body">{CONNECTOR_URL}</span>
                </span>
                <button onClick={() => { s.setSettings("Connector"); s.setSheet(null); s.go("settings", null) }} className="shrink-0 rounded underline decoration-faint underline-offset-2 hover:text-ink">
                  Settings
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1">
            {/* The palette: rounds to add */}
            <aside className="scroll-quiet m-3 mr-0 flex w-[232px] shrink-0 flex-col overflow-y-auto rounded-xl border border-line-strong bg-panel p-1.5 max-md:hidden">
              <div className="px-2.5 pt-2 pb-1 text-xs text-faint">
                Rounds <span className="tabular-nums">{ROUND_PRESETS.length + 1}</span>
              </div>
              {[...ROUND_PRESETS.map((r) => ({ name: r.name, kind: r.kind })), { name: "Custom Round", kind: "interview" as RoundKind }].map((r) => (
                <button key={r.name} disabled={inherits} onClick={() => add(r.name === "Custom Round" ? "" : r.name)} className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left text-body transition-colors enabled:hover:bg-hover disabled:opacity-40">
                  <span className="text-mute">{ICON[r.kind]}</span>
                  {r.name}
                </button>
              ))}
              <div className="mx-2.5 my-1.5 h-px bg-line" />
              <div className="px-2.5 pt-1 pb-1 text-xs text-faint">Always At The End</div>
              <div className="flex h-9 items-center gap-2.5 px-2.5 text-mute">
                <GitBranch size={15} /> Decision
              </div>
              <div className="flex h-9 items-center gap-2.5 px-2.5 text-mute">
                <FileCheck size={15} /> Offer
              </div>
            </aside>

            {/* The flow */}
            <div className="scroll-quiet relative min-w-0 flex-1 overflow-auto" style={{ backgroundImage: "radial-gradient(var(--color-line-strong) 1px, transparent 1px)", backgroundSize: "22px 22px" }} onClick={() => setSel(null)}>
              {loading ? (
                <Loading label="Loading the interview rounds" className="flex flex-col items-center py-10">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex flex-col items-center">
                      {i > 0 && <span className="h-9 w-px bg-line-strong" />}
                      <div className="w-[320px]">
                        <Bone className="h-2 w-14" />
                        <div className="mt-2 rounded-xl border border-line-strong bg-panel p-3">
                          <div className="flex items-center gap-2.5">
                            <Bone className="size-7 !rounded-lg" />
                            <Bone className="h-2.5 w-28" />
                            <Bone className="ml-auto h-5 w-12 !rounded-md" />
                          </div>
                          <Bone className="mt-3 ml-[38px] h-2 w-40" />
                          <Bone className="mt-3 h-7 w-full !rounded-lg" />
                        </div>
                      </div>
                    </div>
                  ))}
                </Loading>
              ) : !rounds.length ? (
                <div className="flex h-full flex-col items-center justify-center px-8 text-center" onClick={(e) => e.stopPropagation()}>
                  <span className="flex size-11 items-center justify-center rounded-xl bg-raised text-mute">
                    <Phone size={18} />
                  </span>
                  <div className="mt-4 font-medium text-ink">Add a first round</div>
                  <p className="mt-1.5 max-w-[320px] text-mute">Every process starts with one. Pick it from the list on the left, or add it here.</p>
                  <Btn className="mt-4" onClick={() => add("Recruiter Screen")}>
                    <Plus size={14} /> Add Recruiter Screen
                  </Btn>
                </div>
              ) : (
                <div className="flex min-h-full flex-col items-center px-8 py-10 transition-transform duration-200" style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }} onClick={(e) => e.stopPropagation()}>
                  {inherits && (
                    <div className="mb-6 flex items-center gap-3 rounded-lg border border-line-strong bg-panel px-3.5 py-2.5 text-body">
                      {scopeName} uses the company's rounds.
                      <Btn solid onClick={() => set(s.process.company.map((r) => ({ ...r, id: newRound(r.name).id })))}>
                        Give It Its Own
                      </Btn>
                    </div>
                  )}
                  <div className={inherits ? "pointer-events-none flex flex-col items-center opacity-55" : "flex flex-col items-center"}>
                    {rounds.map((r, i) => (
                      <div key={r.id} className="flex flex-col items-center">
                        {i > 0 && <Link onAdd={() => add("", i)} />}
                        <Node
                          tag={`Round ${i + 1}`}
                          tone="bg-s-routing/15 text-s-routing"
                          icon={ICON[r.kind]}
                          title={r.name}
                          right={ROUND_KINDS[r.kind]}
                          line={who(r)}
                          foot={length(r)}
                          on={picked?.id === r.id}
                          onClick={() => setSel(r.id)}
                        />
                      </div>
                    ))}
                    <Link onAdd={() => add("")} />
                    <Node tag="Decision" tone="bg-s-needs/15 text-s-needs" icon={<GitBranch size={15} />} title="Hire Or Pass" right="2 paths" line="The hiring manager decides, from the feedback" foot="Yes goes to an offer, no declines" />
                    {/* The two ways out, each on its own branch */}
                    <svg width="680" height="56" viewBox="0 0 680 56" fill="none" className="-my-px" aria-hidden="true">
                      <path d="M300 0C300 34 170 20 170 56" stroke="var(--color-line-strong)" strokeWidth="1.25" />
                      <path d="M380 0C380 34 510 20 510 56" stroke="var(--color-line-strong)" strokeWidth="1.25" />
                    </svg>
                    <div className="flex w-[680px] justify-between gap-5">
                      <Node tag="Yes" tone="bg-s-scheduled/15 text-s-scheduled" icon={<FileCheck size={15} />} title="Offer" right="Offers" line="Drafted, signed off, sent for signature" />
                      <Node tag="No" tone="bg-raised text-mute" icon={<X size={15} />} title="Decline" right="Revisit" line="Kept with your grade, to look at again" />
                    </div>
                  </div>
                </div>
              )}

              {/* The toolbar: add, fit, zoom */}
              <div className="sticky bottom-4 z-10 mx-auto mt-auto flex w-max items-center gap-1 rounded-xl border border-line-strong bg-panel p-1 shadow-[0_8px_24px_-10px_rgba(0,0,0,0.35)]" onClick={(e) => e.stopPropagation()}>
                <button aria-label="Add a round" title="Add a round" disabled={inherits} onClick={() => add("")} className="flex size-8 items-center justify-center rounded-lg bg-s-routing/15 text-s-routing transition-colors enabled:hover:bg-s-routing/25 disabled:opacity-40">
                  <Plus size={16} />
                </button>
                <span className="mx-1 h-5 w-px bg-line" />
                <IconButton label="Fit" onClick={() => setZoom(1)}>
                  <Maximize size={14} />
                </IconButton>
                <IconButton label="Zoom out" onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.1) * 10) / 10))}>
                  <Minus size={14} />
                </IconButton>
                <span className="w-10 text-center text-xs text-mute tabular-nums">{Math.round(zoom * 100)}%</span>
                <IconButton label="Zoom in" onClick={() => setZoom((z) => Math.min(1.4, Math.round((z + 0.1) * 10) / 10))}>
                  <Plus size={14} />
                </IconButton>
              </div>
            </div>

            {/* The round you picked, to change */}
            {picked && (
              <aside className="anim-slide scroll-quiet m-3 ml-0 flex w-[272px] shrink-0 flex-col overflow-y-auto rounded-xl border border-line-strong bg-panel p-4 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:shadow-2xl">
                <div className="flex items-center">
                  <span className="flex-1 text-xs text-faint">Round {rounds.indexOf(picked) + 1}</span>
                  <IconButton label="Close" onClick={() => setSel(null)}>
                    <X size={14} />
                  </IconButton>
                </div>
                <input value={picked.name} autoFocus={!picked.name} onChange={(e) => patch(picked.id, { name: e.target.value })} placeholder="Name this round" aria-label="Round name" className="mt-1 w-full bg-transparent text-[15px] font-semibold tracking-[-0.01em] text-ink outline-none placeholder:text-faint" />
                <dl className="mt-4 flex flex-col gap-1">
                  {(
                    [
                      ["Kind", <Menu key="k" width={170} items={(Object.keys(ROUND_KINDS) as RoundKind[]).map((k) => ({ label: ROUND_KINDS[k], on: picked.kind === k, onPick: () => patch(picked.id, { kind: k }) }))} trigger={() => <button className="-mx-1.5 rounded px-1.5 text-ink hover:bg-hover">{ROUND_KINDS[picked.kind]}</button>} />],
                      ...(picked.kind === "takehome"
                        ? []
                        : ([
                            ["Length", <Menu key="l" width={150} items={LENGTHS.map((m) => ({ label: m >= 60 ? `${m / 60} hr` : `${m} min`, on: picked.minutes === m, onPick: () => patch(picked.id, { minutes: m }) }))} trigger={() => <button className="-mx-1.5 rounded px-1.5 text-ink hover:bg-hover">{length(picked)}</button>} />],
                            ["Run By", <Menu key="b" width={170} items={(["Recruiter", "Hiring Manager", "Team"] as RoundBy[]).map((b) => ({ label: b, on: picked.by === b, onPick: () => patch(picked.id, { by: b }) }))} trigger={() => <button className="-mx-1.5 rounded px-1.5 text-ink hover:bg-hover">{picked.by}</button>} />],
                            ...(picked.by === "Team"
                              ? ([
                                  [
                                    "People",
                                    <span key="p" className="flex items-center gap-1.5">
                                      <button aria-label="Fewer interviewers" disabled={picked.people <= 1} onClick={() => patch(picked.id, { people: picked.people - 1 })} className="flex size-6 items-center justify-center rounded-md border border-line-strong text-mute enabled:hover:text-ink disabled:opacity-30">
                                        <Minus size={12} />
                                      </button>
                                      <span className="w-4 text-center text-ink tabular-nums">{picked.people}</span>
                                      <button aria-label="More interviewers" disabled={picked.people >= 6} onClick={() => patch(picked.id, { people: picked.people + 1 })} className="flex size-6 items-center justify-center rounded-md border border-line-strong text-mute enabled:hover:text-ink disabled:opacity-30">
                                        <Plus size={12} />
                                      </button>
                                    </span>,
                                  ],
                                ] as [string, ReactNode][])
                              : []),
                          ] as [string, ReactNode][])),
                    ] as [string, ReactNode][]
                  ).map(([k, v]) => (
                    <div key={k} className="flex h-9 items-center gap-3">
                      <dt className="w-16 shrink-0 text-mute">{k}</dt>
                      <dd className="min-w-0 flex-1">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-4 flex gap-1.5 border-t border-line pt-4">
                  <Btn disabled={rounds.indexOf(picked) === 0} onClick={() => move(picked.id, -1)} title="Earlier">
                    <ArrowUp size={13} /> Earlier
                  </Btn>
                  <Btn disabled={rounds.indexOf(picked) === rounds.length - 1} onClick={() => move(picked.id, 1)} title="Later">
                    <ArrowDown size={13} /> Later
                  </Btn>
                  <Btn
                    className="ml-auto text-bad"
                    title="Remove this round"
                    onClick={() => {
                      set(rounds.filter((r) => r.id !== picked.id))
                      setSel(null)
                    }}
                  >
                    <Trash2 size={13} />
                  </Btn>
                </div>
                {scope !== "company" && (
                  <button onClick={() => { s.setProcess((p) => { const next = { ...p }; delete next[scope]; return next }); setSel(null) }} className="mt-4 rounded text-left text-xs text-mute underline decoration-faint underline-offset-2 hover:text-ink">
                    Go back to the company's rounds
                  </button>
                )}
              </aside>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
