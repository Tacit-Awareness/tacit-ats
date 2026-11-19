import { useState, type ReactNode } from "react"
import { ChevronRight, CircleUser, Plus } from "lucide-react"
import { STAGES, statusOf, type Person, type Task } from "../data"
import { Avatar, Person as Member, StagePips, StatusIcon } from "../ui"
import { Btn, Empty, Header, Menu, heading, standing, title, TONE_COLOR, toneOf, worst, ToneLegend } from "../kit"
import { useStore } from "../store"
import { CheckIns } from "./checkin"
import { FUNNEL_INSET, Funnel } from "./funnel"

/* ---------------- People: applications ---------------- */

const COLS = "grid grid-cols-[minmax(180px,1fr)_150px_minmax(140px,220px)_40px] @max-2xl:grid-cols-[minmax(160px,1fr)_150px] items-center gap-4"

export function People({ scope, people, tickets, openId, onOpen, onProfile }: { scope?: ReactNode; people: Person[]; tickets: Task[]; openId: string | null; onOpen: (id: string) => void; onProfile: (id: string) => void }) {
  const s = useStore()
  const [tab, setTab] = useState("Active")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ rohan: true })
  /* On a team, the blocks at the top are that team's people by stage; picking one shows only that stage */
  const [stage, setStage] = useState<number | null>(null)
  const [hot, setHot] = useState<number | null>(null)
  const teamOpen = people.filter((p) => !p.closed)
  const waiting = s.triage.filter((a) => s.team && s.roleOf(a.role).team === s.team)
  const blocks = [
    { name: "New", tone: waiting.length ? TONE_COLOR.needs : undefined, dots: waiting.map((a) => ({ id: a.id, name: a.name, sub: s.roleOf(a.role).title, note: "Waiting to be routed", tone: TONE_COLOR.needs })) },
    ...STAGES.map((name, i) => {
      const here = teamOpen.filter((p) => p.stage === i)
      const tone = worst(here.map(toneOf))
      return { name, tone: tone && TONE_COLOR[tone], dots: here.map((p) => ({ id: p.id, name: p.name, sub: s.roleOf(p.role).title, note: p.next ?? undefined, tone: TONE_COLOR[toneOf(p)] })) }
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
      <div className={`${COLS} h-9 shrink-0 border-b border-line pr-5 pl-5 text-xs text-faint`}>
        <span className="pl-6">Name</span>
        <span>Stage</span>
        <span className="@max-2xl:hidden">Next</span>
        <span className="@max-2xl:hidden">Owner</span>
      </div>
      <div className="scroll-quiet flex-1 overflow-y-auto py-1">
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
        {shown.map((p) => {
          const kids = tickets.filter((t) => t.person === p.id)
          const isOpen = !!expanded[p.id]
          const toggle = () => setExpanded((e) => ({ ...e, [p.id]: !e[p.id] }))
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
                aria-expanded={isOpen}
                className={`${COLS} h-12 w-full pr-5 pl-5 text-left transition-colors hover:bg-hover ${p.closed ? "opacity-55" : p.stalled === "overdue" ? "wash-failed" : p.stalled === "no_touch" ? "wash-needs" : ""}`}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <ChevronRight size={14} className={`shrink-0 text-faint transition-transform ${isOpen ? "rotate-90" : ""} ${kids.length ? "" : "invisible"}`} />
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onProfile(p.id)
                    }}
                    className="flex shrink-0 items-center gap-2.5 rounded-md font-medium text-ink decoration-faint underline-offset-4 hover:underline"
                  >
                    <Avatar name={p.name} size={22} />
                    {p.name}
                  </button>
                </span>
                {p.closed ? <span className="text-faint">{p.closed}</span> : <StagePips stage={p.stage} />}
                <span className="truncate text-mute @max-2xl:hidden">
                  {p.next}
                  {p.due && <span className="ml-2 text-faint">Due {p.due}</span>}
                </span>
                <span className="flex items-center @max-2xl:hidden">
                  <Member id={p.owner} />
                </span>
              </div>
              {isOpen &&
                kids.map((t, i) => (
                  <button key={t.id} onClick={() => onOpen(t.id)} className={`relative flex h-10 w-full items-center gap-2.5 pr-5 pl-[62px] text-left transition-colors ${openId === t.id ? "bg-raised" : "hover:bg-hover"}`}>
                    <span className={`absolute left-[38px] w-px bg-line-strong ${i === kids.length - 1 ? "top-0 h-1/2" : "inset-y-0"}`} />
                    <span className="absolute top-1/2 left-[38px] h-px w-3.5 bg-line-strong" />
                    <StatusIcon status={statusOf(t)} />
                    <span className="text-ink">{title(t)}</span>
                    <span className="ml-auto truncate pl-3 text-mute">{standing(t)}</span>
                  </button>
                ))}
            </div>
          )
        })}
      </div>
    </>
  )
}
