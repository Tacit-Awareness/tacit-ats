import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight, CircleUser, Plus } from "lucide-react"
import { STAGES, statusOf, type Person, type Status, type Task } from "../data"
import { Avatar, Person as Member, StagePips, StatusIcon } from "../ui"
import { Btn, Empty, Header, Menu, heading, standing, teamOf, title, TONE_COLOR, worst, ToneLegend } from "../kit"
import { useStore } from "../store"
import { CheckIns } from "./checkin"
import { FUNNEL_INSET, Funnel } from "./funnel"

/* ---------------- People: applications ---------------- */

/* The groups of the list, in the order they matter. The same four meanings as everywhere else, then the closed. */
const GROUPS: { key: Status; name: string; means: string }[] = [
  { key: "needs", name: "Needs You", means: "Waiting on you to act" },
  { key: "failed", name: "Overdue", means: "Past its date or failed, needs a look" },
  { key: "waiting", name: "Waiting", means: "Someone else has not replied" },
  { key: "running", name: "Moving", means: "Nothing for you to do" },
  { key: "done", name: "Closed", means: "Hired, rejected or withdrawn" },
]

export function People({ scope, people, tickets, openId, onOpen, onProfile }: { scope?: ReactNode; people: Person[]; tickets: Task[]; openId: string | null; onOpen: (id: string) => void; onProfile: (id: string) => void }) {
  const s = useStore()
  const [tab, setTab] = useState("Active")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [shut, setShut] = useState<Status[]>([])
  const groupOf = (p: Person): Status => (p.closed ? "done" : s.toneFor(p))
  /* On a team, the blocks at the top are that team's people by stage; picking one shows only that stage */
  const [stage, setStage] = useState<number | null>(null)
  const [hot, setHot] = useState<number | null>(null)
  const teamOpen = people.filter((p) => !p.closed)
  const waiting = s.triage.filter((a) => s.team && s.roleOf(a.role).team === s.team)
  const blocks = [
    { name: "New", tone: waiting.length ? TONE_COLOR.needs : undefined, dots: waiting.map((a) => ({ id: a.id, name: a.name, sub: s.roleOf(a.role).title, note: "Waiting to be routed", tone: TONE_COLOR.needs })) },
    ...STAGES.map((name, i) => {
      const here = teamOpen.filter((p) => p.stage === i)
      const tone = worst(here.map(s.toneFor))
      return { name, tone: tone && TONE_COLOR[tone], dots: here.map((p) => ({ id: p.id, name: p.name, sub: s.roleOf(p.role).title, note: p.next ?? undefined, tone: TONE_COLOR[s.toneFor(p)] })) }
    }),
  ]
  const shown = people.filter((p) => (tab === "All" ? true : tab === "Referred" ? p.source.startsWith("Referr") && !p.closed : !p.closed)).filter((p) => stage === null || !s.team || p.stage === stage - 1)
  const open = s.roles.filter((r) => !r.closed && (!s.team || r.team === s.team))
  /* convert_prospect: a prospect becomes a candidate on a job, and lands in Triage */
  const convert = (id: string, roleId: string) => {
    const p = s.prospects.find((x) => x.id === id)!
    s.setProspects((all) => all.filter((x) => x.id !== id))
    s.addCandidate(p.name, "No email yet", roleId)
  }
  if (tab === "Check In") {
    return (
      <>
        <Header scope={scope} title="People" tabs={["Active", "Referred", "Prospects", "Check In", "All"]} tab={tab} setTab={setTab} />
        <CheckIns />
      </>
    )
  }
  if (tab === "Prospects") {
    return (
      <>
        <Header
          scope={scope}
          title="People"
          tabs={["Active", "Referred", "Prospects", "Check In", "All"]}
          tab={tab}
          setTab={setTab}
          right={
            <Btn onClick={() => s.setSheet({ kind: "candidate" })}>
              <Plus size={14} /> New
            </Btn>
          }
        />
        <div className="scroll-quiet flex-1 overflow-y-auto">
          {s.pools.map((pool) => {
            const rows = s.prospects.filter((p) => p.pool === pool)
            if (!rows.length) return null
            return (
              <section key={pool}>
                <div className="sticky top-0 z-10 flex h-9 items-center gap-2.5 bg-panel pt-1 pr-3 pl-5">
                  <span className="font-medium text-ink">{pool}</span>
                  <span className="text-faint tabular-nums">{rows.length}</span>
                </div>
                {rows.map((p) => (
                  <div key={p.id} className="anim-rise group flex h-12 items-center gap-2.5 pr-4 pl-5 transition-colors hover:bg-hover">
                    <Avatar name={p.name} size={22} />
                    <span className="shrink-0 font-medium text-ink">{p.name}</span>
                    <span className="min-w-0 flex-1 truncate text-mute">{p.headline}</span>
                    <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <Menu align="right" width={260} items={[{ heading: "Make A Candidate For" }, ...open.map((r) => ({ label: r.title, onPick: () => convert(p.id, r.id) })), "sep", { label: "Remove From Pool", danger: true, onPick: () => s.setProspects((all) => all.filter((x) => x.id !== p.id)) }]} trigger={() => <Btn>Convert</Btn>} />
                    </span>
                  </div>
                ))}
              </section>
            )
          })}
          {!s.prospects.length && (
            <Empty icon={<CircleUser size={18} />} title="No prospects">
              People you are keeping warm show up here, by pool.
            </Empty>
          )}
        </div>
      </>
    )
  }
  return (
    <>
      <Header
        scope={scope}
        title="People"
        tabs={["Active", "Referred", "Prospects", "Check In", "All"]}
        tab={tab}
        setTab={setTab}
        right={
          <Btn onClick={() => s.setSheet({ kind: "candidate" })}>
            <Plus size={14} /> New
          </Btn>
        }
      />
      {s.team && tab === "Active" && (
        <div className="shrink-0 border-b border-line px-5 pt-4 pb-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <h2 className={`${heading} tabular-nums`}>{teamOpen.length + waiting.length} in process now</h2>
          <ToneLegend className="ml-auto" />
            {stage !== null && (
              <button onClick={() => setStage(null)} className="ml-1 rounded text-mute underline decoration-faint underline-offset-2 hover:text-ink">
                Show All Stages
              </button>
            )}
          </div>
          <div className="scroll-quiet mt-3 overflow-x-auto">
            <div className="mx-auto max-w-[920px] min-w-[520px]">
              <Funnel stages={blocks} picked={stage} hot={hot} setHot={setHot} onStage={(i) => (i === 0 ? s.go("triage") : setStage(stage === i ? null : i))} onDot={(i, id) => (i === 0 ? s.go("triage") : onProfile(id))} />
              <div className="mt-3.5 grid" style={{ gridTemplateColumns: `repeat(${blocks.length}, minmax(0, 1fr))`, marginRight: FUNNEL_INSET }}>
                {blocks.map((b, i) => (
                  <button key={b.name} onClick={() => (i === 0 ? s.go("triage") : setStage(stage === i ? null : i))} aria-pressed={stage === i} onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)} className="flex min-w-0 flex-col items-center gap-1 px-1.5 text-center">
                    <span className="text-[15px] leading-none font-semibold text-ink tabular-nums">{b.dots.length}</span>
                    <span className={`max-w-full truncate leading-tight transition-colors ${hot === i || stage === i ? "text-ink" : "text-mute"}`}>{b.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="scroll-quiet flex-1 overflow-y-auto">
        {!shown.length && (
          <Empty
            icon={<CircleUser size={18} />}
            title={tab === "Referred" ? "No referrals" : "No candidates"}
            action={
              <Btn solid onClick={() => s.setSheet({ kind: "candidate" })}>
                <Plus size={14} /> New Candidate
              </Btn>
            }
          >
            {tab === "Referred" ? "People your team refers show up here." : "People you route from Triage show up here, with where they stand."}
          </Empty>
        )}
        {/* Grouped the way Tickets is: by what has to happen, most pressing first */}
        {GROUPS.map((g) => {
          const rows = shown.filter((p) => groupOf(p) === g.key)
          if (!rows.length) return null
          const folded = shut.includes(g.key)
          return (
            <section key={g.key}>
              <button onClick={() => setShut(folded ? shut.filter((x) => x !== g.key) : [...shut, g.key])} aria-expanded={!folded} className="sticky top-0 z-10 flex h-9 w-full items-center gap-2.5 bg-panel pt-1 pr-3 pl-5 text-left">
                <StatusIcon status={g.key} label={g.means} />
                <span className="font-medium text-ink">{g.name}</span>
                <span className="text-faint tabular-nums">{rows.length}</span>
                <ChevronDown size={13} className={`text-faint transition-transform ${folded ? "-rotate-90" : ""}`} />
              </button>
              {!folded &&
                rows.map((p) => {
                  const kids = tickets.filter((t) => t.person === p.id)
                  /* The ticket that put them in this group says what has to happen; without one, their own next step does */
                  const lead = kids.find((t) => statusOf(t) === g.key)
                  const isOpen = !!expanded[p.id]
                  const toggle = () => (kids.length ? setExpanded((e) => ({ ...e, [p.id]: !e[p.id] })) : onProfile(p.id))
                  const r = s.roleOf(p.role)
                  return (
                    <div key={p.id} className="anim-rise">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={toggle}
                        onKeyDown={(e) => {
                          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                            e.preventDefault()
                            toggle()
                          }
                        }}
                        aria-expanded={kids.length ? isOpen : undefined}
                        className={`flex h-11 w-full items-center gap-2.5 pr-4 pl-5 text-left transition-colors hover:bg-hover ${p.closed ? "" : `wash-${g.key}`}`}
                      >
                        <StatusIcon status={g.key} label={g.means} />
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onProfile(p.id)
                          }}
                          className={`shrink-0 rounded-md font-medium decoration-faint underline-offset-4 hover:underline ${p.closed ? "text-mute" : "text-ink"}`}
                        >
                          {p.name}
                        </button>
                        <span className="truncate text-mute">{p.closed ? p.closed : lead ? title(lead) : p.next}</span>
                        {kids.length > 0 && <ChevronRight size={13} className={`shrink-0 text-faint transition-transform ${isOpen ? "rotate-90" : ""}`} />}
                        <span className="ml-auto flex shrink-0 items-center gap-3 pl-3">
                          {/* Blank when there is nothing to say: no placeholder */}
                          <span className="hidden max-w-[220px] truncate text-mute @xl:inline">{p.closed ? "" : lead ? standing(lead) : p.due ? `Due ${p.due}` : ""}</span>
                          <span className="hidden w-[150px] truncate text-right text-faint @3xl:inline">{s.team ? r.title : teamOf(r.team).name}</span>
                          <span className="hidden w-[136px] @2xl:block">{!p.closed && <StagePips stage={p.stage} />}</span>
                          <Member id={p.owner} />
                        </span>
                      </div>
                      {isOpen &&
                        kids.map((t, i) => (
                          <button key={t.id} onClick={() => onOpen(t.id)} className={`relative flex h-10 w-full items-center gap-2.5 pr-4 pl-[52px] text-left transition-colors ${openId === t.id ? "bg-raised" : "hover:bg-hover"}`}>
                            <span className={`absolute left-[26px] w-px bg-line-strong ${i === kids.length - 1 ? "top-0 h-1/2" : "inset-y-0"}`} />
                            <span className="absolute top-1/2 left-[26px] h-px w-3.5 bg-line-strong" />
                            <StatusIcon status={statusOf(t)} />
                            <span className="text-ink">{title(t)}</span>
                            <span className="ml-auto truncate pl-3 text-mute">{standing(t)}</span>
                          </button>
                        ))}
                    </div>
                  )
                })}
            </section>
          )
        })}
      </div>
    </>
  )
}
