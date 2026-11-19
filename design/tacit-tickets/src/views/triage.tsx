import { useEffect, useState, type ReactNode } from "react"
import { ChevronDown, ChevronsDown, ChevronsUp, CircleUser, FileText, Inbox, Ticket as TicketIcon } from "lucide-react"
import { ThinkingLoader } from "@/components/ui/thinking-loader"
import { ORIGIN_LABEL, ORIGIN_ORDER, REJECTION_REASONS, STAFF, STAGES as STAGE_NAMES, type Applicant, type Role } from "../data"
import { PdfReader } from "../pdf-reader"
import { PROFILES, profileOf } from "../profiles"
import { ME } from "../org"
import { BotMark, Kbd, Person as Member, StatusIcon, mod } from "../ui"
import { Bone, Btn, Empty, Header, Loading, Menu, TeamTile, teamOf, heading, title } from "../kit"
import type { Routing } from "../types"
import { useStore } from "../store"
import { ResizablePanel, ResizablePanels } from "@/components/arc/resizable-panels/resizable-panels"
import { TestbenchReport } from "./testbench"
import { TicketPanel } from "./tickets"
import { InterviewPanel } from "./interviews"

/* ---------------- Triage: new applicants, read like an inbox ---------------- */

/* The routing bar's moves, as in tATS's New Applicants: each also picks the reply's starter */
type Move = Routing["move"]
const MOVES: { key: Move; label: string; hint: string }[] = [
  { key: "interview", label: "Interview", hint: "I" },
  { key: "testbench", label: "Testbench", hint: "T" },
  { key: "decline", label: "Decline", hint: "D" },
]

/*
 * What the reply opens with: real words a member reads and changes, never placeholders.
 * These are tATS's built-in starters, with the person they would meet named when there is one.
 */
function draftFor(move: Move, a: Applicant, role: Role, sender: string, leadId: string) {
  const first = a.name.split(" ")[0]
  const lead = STAFF[leadId]
  const intro = leadId === role.manager ? `${lead.name}, who leads ${teamOf(role.team).name},` : `${lead.name}, on the ${teamOf(role.team).name} team,`
  const letter = (text: string) => `Hi ${first},\n\n${text}\n\n${sender}`
  const thanks = a.origin === "referral" && a.by ? `${STAFF[a.by].first} told us about you, and we'd love to talk about the ${role.title} role.` : `Thanks for applying for the ${role.title} role.`
  if (move === "interview")
    return {
      subject: `Next step for ${role.title}`,
      body: letter(`${thanks} ${intro} would like to meet you for a ${role.plan[0].toLowerCase()}. What times work for you this week or next? Please reply with a few options, and your time zone.`),
    }
  if (move === "testbench")
    return { subject: `A short take-home for ${role.title}`, body: letter(`${thanks} Before we talk, we'd like you to try a short take-home in a real coding environment. Do it whenever suits you this week. Your link is below.`) }
  return {
    subject: `Your application for ${role.title}`,
    body: letter(`Thank you for your interest in the ${role.title} role, and in Tacit. We've looked closely and decided not to move forward right now. We'd be glad to hear from you again in the future.`),
  }
}

export function Triage({
  scope,
  items,
  roles,
  roleOf,
  sourceOf,
  onRoute,
  onTickets,
}: {
  scope?: ReactNode
  items: Applicant[]
  roles: Role[]
  roleOf: (id: string) => Role
  sourceOf: (a: Applicant) => string
  onRoute: (a: Applicant, r: Routing) => void
  onTickets: () => void
}) {
  const store = useStore()
  const [tab, setTab] = useState("Open")
  /* What needs you beyond new applicants: offers to sign off, feedback you owe, tickets the bot is stuck on */
  const inTeam = (personId: string) => !store.team || roleOf(store.personOf(personId).role).team === store.team
  const needs: { key: string; name: string; what: string; failed?: boolean; kind: "offer" | "feedback" | "ticket"; id: string; person: string; where: string; open: () => void }[] = [
    ...store.approvals.filter(inTeam).map((id) => ({ key: `o${id}`, name: store.personOf(id).name, what: "Offer to sign off", kind: "offer" as const, id, person: id, where: "Offers", open: () => store.openOffer(id) })),
    ...store.interviews
      .filter((i) => i.done && i.interviewers.includes(ME) && inTeam(i.person) && ![...(PROFILES[i.person]?.feedback ?? []), ...(store.filed[i.person] ?? [])].some((f) => f.step === i.step && f.who === ME))
      .map((i) => ({ key: `i${i.id}`, name: store.personOf(i.person).name, what: `Feedback owed, ${i.step}`, kind: "feedback" as const, id: i.id, person: i.person, where: "Interviews", open: () => store.go("interviews") })),
    ...store.tickets
      .filter((t) => store.attn(t) && inTeam(t.person))
      .map((t) => ({ key: `t${t.id}`, name: store.personOf(t.person).name, what: title(t), failed: t.status === "failed", kind: "ticket" as const, id: t.id, person: t.person, where: "Tickets", open: () => store.go("tickets", store.team, t.id) })),
  ]
  const [pane, setPane] = useState<"resume" | "testbench">("resume")
  /* The Needs You item open in the middle, to be dealt with here */
  const [needKey, setNeedKey] = useState<string | null>(null)
  const need = needs.find((n) => n.key === needKey) ?? null
  /* Passed on for now, the ones you were surest about first */
  const passed = [...store.passed].sort((x, y) => (y.confidence ?? 0) - (x.confidence ?? 0))
  const [done, setDone] = useState<{ a: Applicant; outcome: string }[]>([])
  const [sel, setSel] = useState<string | null>(items[0]?.id ?? null)
  const [move, setMove] = useState<Move>("interview")
  const [target, setTarget] = useState<string | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [edited, setEdited] = useState<{ subject: string; body: string } | null>(null)
  const [picking, setPicking] = useState(false)
  const [who, setWho] = useState<string | null>(null)
  /* Side by side only where there is room; each pane's share of the width is remembered */
  const [wide, setWide] = useState(() => window.innerWidth >= 1024)
  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= 1024)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  const [layout] = useState<number[]>(() => {
    try {
      const kept = JSON.parse(localStorage.getItem("tacit-triage-layout") ?? "null")
      return Array.isArray(kept) && kept.length === 3 && kept.every((n) => typeof n === "number" && n > 0) ? kept : [22, 50, 28]
    } catch {
      return [22, 50, 28]
    }
  })
  const saveLayout = (sizes: number[]) => {
    try {
      if (sizes.every((n) => n > 1)) localStorage.setItem("tacit-triage-layout", JSON.stringify(sizes))
    } catch {
      /* private window: the widths last for this visit */
    }
  }
  /* Sections of the right pane you have folded away */
  const [folded, setFolded] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("tacit-triage-folded") ?? "[]")
    } catch {
      return []
    }
  })
  const fold = (k: string) => {
    const next = folded.includes(k) ? folded.filter((x) => x !== k) : [...folded, k]
    setFolded(next)
    try {
      localStorage.setItem("tacit-triage-folded", JSON.stringify(next))
    } catch {
      /* it lasts for this visit */
    }
  }
  /* The reply card folded down to one line; the choice stays in this browser */
  const [mini, setMiniState] = useState(() => {
    try {
      return localStorage.getItem("tacit-triage-mini") === "1"
    } catch {
      return false
    }
  })
  const setMini = (on: boolean) => {
    setMiniState(on)
    try {
      localStorage.setItem("tacit-triage-mini", on ? "1" : "0")
    } catch {
      /* private window: it lasts for this visit */
    }
  }
  /* The grade, as Testbench takes it: how confident you are they will pass, and a comment */
  const [confidence, setConfidence] = useState<number | null>(null)
  const [comment, setComment] = useState("")
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), 650)
    return () => window.clearTimeout(t)
  }, [])

  const a = tab === "Open" ? (items.find((x) => x.id === sel) ?? items[0]) : tab === "Revisit" ? (passed.find((d) => d.a.id === sel) ?? passed[0])?.a : (done.find((d) => d.a.id === sel) ?? done[0])?.a
  const held = tab === "Revisit" ? passed.find((d) => d.a.id === a?.id) : undefined
  const finished = tab === "Open" ? undefined : done.find((d) => d.a.id === a?.id)
  /* Where they would go: the team picked here, else the bot's first choice, else the role they came in for */
  const routes = a?.suggestion?.routes ?? []
  const role = a ? roleOf(target ?? routes[0]?.role ?? a.role) : null
  const canPickTeam = !!a?.suggestion
  /* Who on that team they go to: the hiring manager unless you pick someone else */
  const lead = role ? (who ?? role.manager) : null
  const auto = a && role && lead ? draftFor(move, a, role, "Nick", lead) : null
  const draft = edited ?? auto
  const ready = !!a && !finished && (move !== "decline" || !!reason) && !!draft?.body.trim()

  const reset = () => {
    setMove("interview")
    setTarget(null)
    setWho(null)
    setReason(null)
    setEdited(null)
    setPicking(false)
    setConfidence(null)
    setComment("")
  }
  const openOne = (id: string) => {
    setNeedKey(null)
    setSel(id)
    setPane("resume")
    reset()
  }
  const pickMove = (m: Move) => {
    setMove(m)
    setReason(null)
    setEdited(null)
  }
  const send = () => {
    if (!a || !role || !ready) return
    const outcome = move === "decline" ? `Declined: ${reason}` : move === "testbench" ? "Testbench sent" : `Interview with ${teamOf(role.team).name}`
    const i = items.findIndex((x) => x.id === a.id)
    const n = items[i + 1] ?? items.find((x) => x.id !== a.id)
    setDone((d) => [{ a, outcome }, ...d])
    openOne(n?.id ?? "")
    onRoute(a, { move, roleId: role.id, to: lead ?? undefined, reason: reason ?? undefined, grade: { confidence: confidence ?? undefined, note: comment.trim() } })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) return send()
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (typing || e.metaKey || e.ctrlKey || e.altKey || !a || finished) return
      const m = MOVES.find((x) => x.hint.toLowerCase() === e.key.toLowerCase())
      if (m) pickMove(m.key)
      if (/^[1-5]$/.test(e.key)) setConfidence(Number(e.key))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const pr = a ? profileOf({ id: a.id, name: a.name, role: a.role, stage: 0, owner: roleOf(a.role).manager, next: null, source: "" }, roleOf(a.role)) : null
  const label = "mb-2 text-xs text-faint"
  const others = roles.filter((r) => r.open > r.filled && !routes.some((x) => x.role === r.id))
  const tb = a?.testbench
  /* The reader's two pages: their resume, and what Testbench recorded */
  const tabs = a && (
    <>
      <span className="mr-1 truncate font-medium text-ink">{a.name}</span>
      {(["resume", "testbench"] as const).map((k) => (
        <button key={k} onClick={() => setPane(k)} aria-pressed={pane === k} className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 transition-colors ${pane === k ? "bg-raised text-ink" : "text-mute hover:text-ink"}`}>
          {k === "resume" ? "Resume" : "Testbench"}
          {k === "testbench" && tb?.score !== undefined && <span className="font-medium text-ink tabular-nums">{tb.score}</span>}
        </button>
      ))}
    </>
  )

  /* A section heading in the right pane that folds what is under it */
  const head = (k: string, children: ReactNode) => (
    <button onClick={() => fold(k)} aria-expanded={!folded.includes(k)} className={`${label} mt-7 flex w-full items-center gap-1.5 text-left transition-colors hover:text-mute`}>
      <span className="flex flex-1 items-center gap-1.5">{children}</span>
      <ChevronDown size={12} className={`transition-transform ${folded.includes(k) ? "-rotate-90" : ""}`} />
    </button>
  )
  const shut = (k: string) => (folded.includes(k) ? "hidden" : "")

  /* A Needs You item, opened here: the same ticket, feedback form or offer you would find on its own page */
  const needPerson = need ? store.personOf(need.person) : null
  const needRole = needPerson ? roleOf(needPerson.role) : null
  const needTask = need?.kind === "ticket" ? store.tickets.find((t) => t.id === need.id) : undefined
  const needInterview = need?.kind === "feedback" ? store.interviews.find((i) => i.id === need.id) : undefined
  const needOffer = need?.kind === "offer" ? store.offers[need.id] : undefined
  const needPane = need && needPerson && needRole && (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-3 pl-5">
        {/* The ticket and the feedback form carry their own heading, so this bar only says why it is here */}
        {need.kind === "offer" ? (
          <>
            <span className="truncate font-medium text-ink">{need.name}</span>
            <span className="min-w-0 flex-1 truncate text-mute">{need.what}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-mute">Needs You</span>
        )}
        <button onClick={need.open} className="shrink-0 rounded text-mute underline decoration-faint underline-offset-2 transition-colors hover:text-ink" title="See it in its own view, with everything around it">
          Open In {need.where}
        </button>
      </div>
      <div key={need.key} className="min-h-0 flex-1 overflow-hidden">
        {needTask && <TicketPanel embedded task={needTask} asked={store.tasks.filter((t) => t.parent === needTask.id)} person={needPerson} role={needRole} busy={store.working === needTask.id} onClose={() => setNeedKey(null)} onCommand={store.command} onProfile={store.openProfile} />}
        {needInterview && <InterviewPanel embedded i={needInterview} onClose={() => setNeedKey(null)} />}
        {needOffer && (
          <div className="scroll-quiet h-full overflow-y-auto px-6 py-6">
            <div className="mx-auto max-w-[460px]">
              <div className={heading}>Offer for {needPerson.name}</div>
              <div className="mt-1 text-mute">
                {needRole.title}
                {needOffer.askedBy ? `, asked by ${STAFF[needOffer.askedBy].first}` : ""}
              </div>
              <dl className="mt-5 overflow-hidden rounded-lg border border-line-strong">
                {(
                  [
                    ["Salary", needOffer.salary],
                    ["Equity", [needOffer.shares && `${needOffer.shares} shares`, needOffer.equity].filter(Boolean).join(", ")],
                    ["Start", needOffer.start],
                    ["Expires", needOffer.expires ?? ""],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div key={k} className="flex h-10 items-center gap-3 border-b border-line px-3.5 last:border-b-0">
                    <dt className="w-16 shrink-0 text-mute">{k}</dt>
                    <dd className={`min-w-0 flex-1 truncate ${v ? "text-ink" : "text-faint"}`}>{v || "Not set"}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 flex justify-end gap-1.5">
                <Btn className="h-8 px-3" onClick={() => store.setOffer(need.id, (o) => ({ ...o!, approval: "rejected" }), "Sent the offer back")}>
                  Send Back
                </Btn>
                <Btn
                  solid
                  className="h-8 px-3.5"
                  onClick={() => {
                    store.setOffer(need.id, (o) => ({ ...o!, approval: "approved" }), "Approved the offer")
                    store.setToast("Offer approved")
                  }}
                >
                  Sign Off
                </Btn>
              </div>
              <p className="mt-4 text-xs leading-[1.5] text-faint">The letter itself, and sending it for signature, are in Offers.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
  const needInfo = need && needPerson && needRole && (
    <aside className="scroll-quiet h-full overflow-y-auto px-5 py-5">
      <button onClick={() => store.openProfile(needPerson.id)} className="block max-w-full truncate text-left text-[15px] font-semibold tracking-[-0.01em] text-ink hover:underline">
        {needPerson.name}
      </button>
      <div className="truncate text-mute">{needRole.title}</div>
      <p className="mt-4 leading-[1.55] text-body">{profileOf(needPerson, needRole).summary}</p>
      <dl className="mt-5 flex flex-col gap-2.5">
        {(
          [
            ["Stage", needPerson.closed ?? STAGE_NAMES[needPerson.stage]],
            ["Next", needPerson.next ?? "Nothing set"],
            ["Owner", STAFF[needPerson.owner].name],
            ["Team", teamOf(needRole.team).name],
            ["Source", needPerson.source],
          ] as [string, string][]
        ).map(([k, v]) => (
          <div key={k} className="flex gap-3">
            <dt className="w-[68px] shrink-0 text-mute">{k}</dt>
            <dd className="min-w-0 truncate text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </aside>
  )

  /* The three panes. Side by side they trade width at the dividers; on a narrow screen only the application shows. */
  const queuePane = (
        <div className="flex h-full min-w-0 flex-col">
          <Header
            scope={scope}
            title="Triage"
            right={
              <span className="flex gap-0.5">
                {["Open", "Revisit", "Done"].map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setTab(t)
                      setSel(null)
                      reset()
                    }}
                    className={`h-7 rounded-md px-2.5 transition-colors ${tab === t ? "bg-raised text-ink" : "text-mute hover:text-ink"}`}
                  >
                    {t}
                  </button>
                ))}
              </span>
            }
          />
          <div className="scroll-quiet flex-1 overflow-y-auto p-1.5">
            {loading ? (
              <Loading label="Loading applicants">
                <Bone className="mx-3 mt-3 mb-2 h-2 w-16" />
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="space-y-2.5 px-3 py-3">
                    <Bone className={`h-2.5 ${["w-3/5", "w-2/5", "w-1/2", "w-3/5", "w-2/5"][i]}`} />
                    <Bone className={`h-2 ${["w-4/5", "w-3/4", "w-2/3", "w-4/5", "w-3/5"][i]}`} />
                  </div>
                ))}
              </Loading>
            ) : tab === "Revisit" ? (
              passed.length ? (
                passed.map(({ a: x, reason: why, confidence: c }) => (
                  <button key={x.id} onClick={() => openOne(x.id)} className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${!need && a?.id === x.id ? "bg-raised" : "hover:bg-hover"}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{x.name}</span>
                      <span className="block truncate text-mute">{why}</span>
                    </span>
                    {c && (
                      <span title={`Confidence ${c} of 5`} className="shrink-0 pt-0.5 text-mute tabular-nums">
                        {c}
                        <span className="text-faint"> / 5</span>
                      </span>
                    )}
                  </button>
                ))
              ) : (
                <div className="px-3 py-3 text-faint">Nobody to revisit</div>
              )
            ) : tab === "Done" ? (
              done.length ? (
                done.map(({ a: x, outcome }) => (
                  <button key={x.id} onClick={() => openOne(x.id)} className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${!need && a?.id === x.id ? "bg-raised" : "hover:bg-hover"}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ink">{x.name}</span>
                      <span className="block truncate text-mute">{outcome}</span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="px-3 py-3 text-faint">Nothing routed yet</div>
              )
            ) : items.length || needs.length ? (
              <>
              {/* Everything else waiting on you, each a way straight to it */}
              {needs.length > 0 && (
                <section className="mb-1.5">
                  <div className="flex h-8 items-center gap-2 px-3 text-xs text-faint">
                    Needs You <span className="tabular-nums">{needs.length}</span>
                  </div>
                  {needs.map((n) => (
                    <button key={n.key} onClick={() => setNeedKey(n.key)} className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors ${need?.key === n.key ? "bg-raised" : "hover:bg-hover"}`}>
                      <span className="pt-0.5">
                        <StatusIcon status={n.failed ? "failed" : "needs"} label={n.what} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">{n.name}</span>
                        <span className="block truncate text-mute">{n.what}</span>
                      </span>
                    </button>
                  ))}
                </section>
              )}
              {ORIGIN_ORDER.map((origin) => {
                const group = items.filter((x) => x.origin === origin)
                if (!group.length) return null
                return (
                  <section key={origin} className="mb-1.5">
                    <div className="flex h-8 items-center gap-2 px-3 text-xs text-faint">
                      {ORIGIN_LABEL[origin]} <span className="tabular-nums">{group.length}</span>
                    </div>
                    {group.map((x) => (
                      <button key={x.id} onClick={() => openOne(x.id)} className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${!need && a?.id === x.id ? "bg-raised" : "hover:bg-hover"}`}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-ink">{x.name}</span>
                          <span className="block truncate text-mute">
                            {roleOf(x.role).title} <span className="ml-1.5 text-faint">{x.time}</span>
                          </span>
                        </span>
                        {x.suggestion?.status === "running" && <span className="mr-0.5 size-2 shrink-0 animate-pulse self-center rounded-full bg-s-routing" title="Still being read" />}
                      </button>
                    ))}
                  </section>
                )
              })}
              </>
            ) : (
              <div className="px-3 py-3 text-faint">Nothing waiting on you</div>
            )}
          </div>
        </div>

  )
  const readerPane = (
        <div className="@container flex h-full min-w-0 flex-1 flex-col">
          {loading ? (
            <Loading label="Loading the resume" className="flex min-h-0 flex-1 flex-col">
              <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-5">
                <Bone className="h-2.5 w-28" />
                <Bone className="h-2.5 w-16" />
              </div>
              <div className="min-h-0 flex-1 overflow-hidden bg-well px-6 py-5">
                <Bone className="mx-auto aspect-[612/792] w-full max-w-[760px] !rounded" />
              </div>
            </Loading>
          ) : !a || !pr || !role ? (
            <Empty
              icon={<Inbox size={18} />}
              title={tab === "Open" ? "Nothing in triage" : tab === "Revisit" ? "Nobody to revisit" : "Nothing routed yet"}
              action={
                tab === "Open" && (
                  <Btn onClick={onTickets}>
                    <TicketIcon size={14} className="text-mute" /> Go To Tickets
                  </Btn>
                )
              }
            >
              {tab === "Open" ? "When someone applies or is referred in, they land here for you to route." : tab === "Revisit" ? "People you decline are kept here with your grade, surest first, so you can look again later." : "People you route this session show up here."}
            </Empty>
          ) : (
            <>
              <div className="min-h-0 flex-1">
                {pane === "testbench" ? (
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-2 pl-5 text-mute">{tabs}</div>
                    <TestbenchReport key={a.id} tb={tb} name={a.name} peers={[...items, ...store.passed.map((x) => x.a)].filter((x) => x.id !== a.id && x.testbench?.shape).map((x) => ({ name: x.name.split(" ")[0], shape: x.testbench!.shape! }))} onSend={() => pickMove("testbench")} />
                  </div>
                ) : !/^a[1-7]$/.test(a.id) ? (
                  <Empty icon={<FileText size={18} />} title="No resume on file">
                    Added by hand. Ask for one in your reply, or add it to their files.
                  </Empty>
                ) : (
                  <PdfReader
                    key={a.id}
                    url={`/resumes/${a.id}.pdf`}
                    name={pr.files[0]}
                    title={
tabs
                    }
                  />
                )}
              </div>

              {held ? (
                <div className="flex min-h-14 shrink-0 items-center gap-3 border-t border-line px-5 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">
                      Declined: {held.reason}
                      {held.confidence && <span className="ml-2 text-mute">Confidence {held.confidence} of 5</span>}
                    </span>
                    {held.note && <span className="block truncate text-mute">{held.note}</span>}
                  </span>
                  <Btn solid onClick={() => { store.reopen(held.a.id); setTab("Open"); openOne(held.a.id) }}>
                    Reopen
                  </Btn>
                </div>
              ) : finished ? (
                <div className="flex h-14 shrink-0 items-center gap-2.5 border-t border-line px-5 text-ink">
                  <StatusIcon status="done" /> {finished.outcome}
                </div>
              ) : (
                /* The bottom bar: where they go, and the reply that goes with it */
                <div className="relative shrink-0 border-t border-line bg-panel px-4 pt-3 pb-3.5 shadow-[0_-16px_32px_-24px_rgba(0,0,0,0.35)]">
                  {/* Minimized: one line saying what will happen, so the resume gets the room */}
                  {mini && (
                    <button onClick={() => setMini(false)} aria-expanded={false} title="Show the grade and the reply" className="flex h-10 w-full items-center gap-2.5 rounded-xl border border-line-strong bg-hover px-3.5 text-left transition-colors hover:border-mute">
                      <span className="min-w-0 flex-1 truncate text-ink">
                        {move === "decline" ? `Decline${reason ? `: ${reason}` : ""}` : `${move === "testbench" ? "Testbench" : "Interview"} with ${teamOf(role.team).name}, ${STAFF[lead!].first}`}
                        <span className="ml-2 text-mute">
                          {confidence ? `Grade ${confidence}, ` : ""}
                          {edited ? "reply edited" : "reply drafted"}
                        </span>
                      </span>
                      <ChevronsUp size={15} className="shrink-0 text-mute" />
                    </button>
                  )}
                  <div className={`rounded-xl border border-line-strong bg-hover focus-within:border-mute ${mini ? "hidden" : ""}`}>
                    <div className="flex h-11 items-center gap-2 border-b border-line px-3.5">
                      <span className="w-12 shrink-0 text-faint">Grade</span>
                      <div className="flex shrink-0 gap-1" role="radiogroup" aria-label="Confidence they'll pass">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            role="radio"
                            aria-checked={confidence === n}
                            aria-label={`${n} of 5${n === 1 ? ", unlikely" : n === 5 ? ", certain" : ""}`}
                            title={n === 1 ? "Unlikely to pass" : n === 5 ? "Certain to pass" : `Confidence ${n} of 5`}
                            onClick={() => setConfidence(confidence === n ? null : n)}
                            className={`size-7 rounded-md border tabular-nums transition-colors ${confidence === n ? "border-ink bg-ink font-medium text-well" : "border-line-strong text-mute hover:text-ink"}`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment" aria-label="Grade comment" className="doc-line ml-2 h-7 min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-faint" />
                      <button aria-label="Minimize" title="Minimize" onClick={() => setMini(true)} className="-mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-mute transition-colors hover:bg-raised hover:text-ink">
                        <ChevronsDown size={15} />
                      </button>
                    </div>
                    {/* Where it goes sits first and never moves: the team, or the reason for a decline */}
                    <div className="flex min-h-11 items-start gap-2 border-b border-line px-3.5 py-1.5">
                      <span className="w-12 shrink-0 pt-1.5 text-faint">{move === "decline" ? "Reason" : "Team"}</span>
                      {move === "decline" ? (
                        <div className="flex min-w-0 flex-1 flex-wrap gap-1 py-0.5" role="radiogroup" aria-label="Reason">
                          {REJECTION_REASONS.map((r) => (
                            <button
                              key={r}
                              role="radio"
                              aria-checked={reason === r}
                              onClick={() => setReason(r)}
                              className={`h-7 rounded-md border px-2.5 transition-colors ${reason === r ? "border-ink text-ink" : "border-line-strong text-mute hover:text-ink"}`}
                            >
                              {r}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="relative flex min-w-0 items-center gap-1">
                          <button
                            onClick={() => canPickTeam && setPicking(!picking)}
                            aria-expanded={picking}
                            title={canPickTeam ? "Change who this goes to" : "They came in for this role"}
                            className={`-ml-2 flex h-8 items-center gap-2 rounded-lg pr-2 pl-2 text-ink transition-colors ${canPickTeam ? "hover:bg-raised" : "cursor-default"}`}
                          >
                            <TeamTile id={role.team} size={14} />
                            {teamOf(role.team).name}
                            {canPickTeam && <ChevronDown size={13} className="text-faint" />}
                          </button>
                          {/* Who on the team: the hiring manager first, then the rest of its hiring team, then anyone else */}
                          <Menu
                            up
                            width={220}
                            items={[
                              { heading: teamOf(role.team).name },
                              ...[role.manager, ...(role.team_members ?? [])].map((m) => ({ label: `${STAFF[m].name}${m === role.manager ? ", hiring manager" : ""}`, on: m === lead, onPick: () => { setWho(m); setEdited(null) } })),
                              "sep" as const,
                              { heading: "Someone Else" },
                              ...Object.values(STAFF).filter((m) => m.id !== role.manager && !(role.team_members ?? []).includes(m.id)).map((m) => ({ label: m.name, on: m.id === lead, onPick: () => { setWho(m.id); setEdited(null) } })),
                            ]}
                            trigger={() => (
                              <button title="Change who they go to" className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-mute transition-colors hover:bg-raised hover:text-ink">
                                <Member id={lead!} size={16} /> {STAFF[lead!].first}
                                <ChevronDown size={13} className="text-faint" />
                              </button>
                            )}
                          />
                          {picking && (
                            <>
                              <div className="fixed inset-0 z-30" onClick={() => setPicking(false)} />
                              <div
                                role="listbox"
                                aria-label="Send to"
                                className="anim-rise scroll-quiet absolute bottom-10 left-0 z-40 max-h-[340px] w-[340px] overflow-y-auto rounded-xl border border-line-strong bg-panel p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.45)]"
                              >
                                {[...routes.map((x) => ({ r: roleOf(x.role), matched: x.matched })), ...others.map((r) => ({ r, matched: [] as string[] }))].map(({ r, matched }, i) => (
                                  <button
                                    key={r.id}
                                    role="option"
                                    aria-selected={r.id === role.id}
                                    onClick={() => {
                                      setTarget(r.id)
                                      setWho(null)
                                      setEdited(null)
                                      setPicking(false)
                                    }}
                                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${r.id === role.id ? "bg-raised" : "hover:bg-hover"}`}
                                  >
                                    <TeamTile id={r.team} />
                                    <span className="min-w-0 flex-1">
                                      <span className="flex items-center gap-2">
                                        <span className="truncate text-ink">{teamOf(r.team).name}</span>
                                        {i === 0 && routes.length > 0 && <span className="rounded bg-s-scheduled/20 px-1.5 text-xs text-s-scheduled">Recommended</span>}
                                      </span>
                                      <span className="block truncate text-xs text-mute">{matched.length ? matched.join(", ") : r.title}</span>
                                    </span>
                                    <Member id={r.manager} size={18} />
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 border-b border-line px-3.5 py-2">
                      <span className="w-12 shrink-0 text-faint">To</span>
                      <span className="min-w-0 truncate text-ink">{a.name}</span>
                      <span className="hidden min-w-0 truncate text-faint @2xl:inline">{a.email}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-faint">
                        <BotMark size={10} /> {edited ? "Edited" : "Drafted"}
                      </span>
                      {edited && (
                        <button onClick={() => setEdited(null)} className="shrink-0 rounded text-xs text-mute underline decoration-faint underline-offset-2 hover:text-ink">
                          Reset
                        </button>
                      )}
                    </div>
                    <input value={draft!.subject} onChange={(e) => setEdited({ subject: e.target.value, body: draft!.body })} aria-label="Subject" className="block w-full bg-transparent px-3.5 pt-2.5 font-medium text-ink outline-none" />
                    {/* A fixed height, so nothing above or below shifts when the note appears */}
                    <div className="flex h-[150px] flex-col">
                      <textarea
                        value={draft!.body}
                        onChange={(e) => setEdited({ subject: draft!.subject, body: e.target.value })}
                        aria-label="Reply"
                                              className="scroll-quiet block min-h-0 w-full flex-1 resize-none bg-transparent px-3.5 pt-1.5 pb-2.5 leading-[1.55] text-body outline-none"
                      />
                      {move === "testbench" && (
                        <div className="px-3.5 pb-2.5">
                          <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-raised px-2 text-xs text-mute">
                            <FileText size={12} /> Their own Testbench link is added on send
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-2.5 flex items-center gap-2">
                    <div className="flex rounded-lg bg-well p-0.5" role="radiogroup" aria-label="Next step">
                      {MOVES.map((m) => (
                        <button
                          key={m.key}
                          role="radio"
                          aria-checked={move === m.key}
                          onClick={() => pickMove(m.key)}
                          className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 transition-colors ${move === m.key ? "bg-panel text-ink shadow-[0_0_0_1px_var(--color-line-strong)]" : "text-mute hover:text-ink"}`}
                        >
                          {m.label}
                          <span className="hidden min-[1720px]:inline">
                            <Kbd>{m.hint}</Kbd>
                          </span>
                        </button>
                      ))}
                    </div>

                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => {
                          const i = items.findIndex((x) => x.id === a.id)
                          openOne((items[i + 1] ?? items[0]).id)
                        }}
                        className="h-8 rounded-lg px-3 text-ink transition-colors hover:bg-hover"
                      >
                        Later
                      </button>
                      <button onClick={send} disabled={!ready} className="flex h-8 items-center gap-2 rounded-lg bg-ink px-3.5 font-medium text-well transition-opacity hover:opacity-90 disabled:opacity-30">
                        {move === "decline" ? "Decline" : "Send"}{" "}
                        <span className="text-well/60">
                          <Kbd>{mod("↵")}</Kbd>
                        </span>
                      </button>
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
  )
  const infoPane = (
      <aside className="scroll-quiet h-full overflow-y-auto">
        {loading ? (
          <Loading label="Loading their application" className="space-y-3 px-5 py-5">
            <Bone className="h-3.5 w-2/5" />
            <Bone className="h-2.5 w-3/5" />
            <Bone className="!mt-6 h-2.5 w-full" />
            <Bone className="h-2.5 w-4/5" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`flex gap-4 ${i ? "" : "!mt-7"}`}>
                <Bone className="h-2.5 w-16" />
                <Bone className={`h-2.5 ${["w-24", "w-32", "w-20", "w-36"][i]}`} />
              </div>
            ))}
            <Bone className="!mt-7 h-24 w-full !rounded-lg" />
          </Loading>
        ) : !a || !pr ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <span className="flex size-11 items-center justify-center rounded-xl bg-raised text-mute">
              <CircleUser size={18} />
            </span>
            <div className="mt-4 font-medium text-ink">No application open</div>
            <p className="mt-1.5 max-w-[220px] text-mute">The application behind the person you pick shows up here.</p>
          </div>
        ) : (
          <div key={a.id} className="anim-rise px-5 py-5">
            <div className="flex items-center gap-3">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{a.name}</div>
                <div className="truncate text-mute">{pr.headline}</div>
              </div>
            </div>
            <p className="mt-4 leading-[1.55] text-body">{pr.summary}</p>

            {head("details", "Details")}
            <dl className={`flex flex-col gap-2.5 ${shut("details")}`}>
              {(
                [
                  ["Applied", `${a.time} ago`],
                  ["Source", sourceOf(a)],
                  ["Role", roleOf(a.role).title],
                  ["Location", pr.location],
                  ["Email", a.email],
                  ...(a.phone ? [["Phone", a.phone]] : []),
                  ...(a.linkedin ? [["LinkedIn", a.linkedin]] : []),
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <dt className="w-[68px] shrink-0 text-mute">{k}</dt>
                  <dd className="min-w-0 truncate text-ink">{v}</dd>
                </div>
              ))}
            </dl>

            {a.notes && a.by && (
              <>
                {head("note", a.origin === "referral" ? "Referral Note" : "Note")}
                <div className={`flex gap-2.5 rounded-lg bg-hover px-3 py-2.5 ${shut("note")}`}>
                  <span className="pt-0.5">
                    <Member id={a.by} size={18} />
                  </span>
                  <p className="leading-[1.5] text-body">
                    <span className="font-medium text-ink">{STAFF[a.by].first}</span> {a.notes}
                  </p>
                </div>
              </>
            )}

            {a.answers && (
              <>
                <div className={`${label} mt-7`}>Answers</div>
                <dl className="flex flex-col gap-3.5 rounded-lg bg-hover px-3 py-2.5">
                  {a.answers.map((x) => (
                    <div key={x.q}>
                      <dt className="text-mute">{x.q}</dt>
                      <dd className="mt-0.5 leading-[1.5] text-ink">{x.a}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}

            {head("testbench", "Testbench")}
            {folded.includes("testbench") ? null : !tb ? (
              <div className="flex h-10 items-center justify-between rounded-lg border border-dashed border-line-strong px-3 text-mute">
                Not sent
                <button onClick={() => pickMove("testbench")} className="rounded text-ink underline decoration-faint underline-offset-2 hover:decoration-ink">
                  Send one
                </button>
              </div>
            ) : (
              <div className={`rounded-lg border border-line-strong ${tb.status === "submitted" ? "wash-running" : "wash-waiting"}`}>
                <div className="flex items-center gap-2.5 px-3 py-2.5">
                  <StatusIcon status={tb.status === "submitted" ? "done" : "waiting"} />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{tb.task}</span>
                  <span className="shrink-0 text-mute">{tb.status === "submitted" ? `Submitted ${tb.when}` : `Invited ${tb.when}`}</span>
                </div>
                {tb.status === "submitted" && (
                  <div className="border-t border-line px-3 py-3">
                    <div className="flex items-baseline gap-2">
                      <span className={`${heading} tabular-nums`}>{tb.score} of 100</span>
                      <span className="ml-auto text-mute">
                        {tb.percentile}, {tb.took}
                      </span>
                    </div>
                    <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-raised">
                      <div className="h-full rounded-full bg-ink" style={{ width: `${tb.score}%` }} />
                    </div>
                    <ul className="mt-3 flex flex-col gap-1.5 text-body">
                      {tb.highlights?.map((h) => (
                        <li key={h} className="flex gap-2">
                          <span className="mt-[7px] size-1 shrink-0 rounded-full bg-faint" />
                          {h}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {routes.length > 0 && (
              <>
                {head("routes", <><BotMark size={11} /> Could Pick Up</>)}
                <div className={`overflow-hidden rounded-lg border border-line-strong ${shut("routes")}`}>
                  {routes.map((x, i) => {
                    const r = roleOf(x.role)
                    return (
                      <button
                        key={r.id}
                        onClick={() => {
                          setTarget(r.id)
                          setWho(null)
                          setEdited(null)
                        }}
                        className={`flex w-full items-center gap-2.5 border-b border-line px-3 py-2 text-left transition-colors last:border-b-0 ${r.id === role?.id ? "bg-raised" : "hover:bg-hover"}`}
                      >
                        <TeamTile id={r.team} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-ink">
                            {teamOf(r.team).name}
                            {i === 0 && <span className="ml-2 text-xs text-s-scheduled">Recommended</span>}
                          </span>
                          <span className="block truncate text-xs text-mute">{x.matched.join(", ")}</span>
                        </span>
                        <span className="shrink-0 text-xs text-faint tabular-nums">{r.open - r.filled} open</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
            {a.suggestion?.status === "running" && (
              <div className="mt-7">
                <ThinkingLoader size="sm" variant="plain" phases={["Reading the resume", "Comparing against the open asks", "Ranking teams"]} loop />
              </div>
            )}

            {head("files", <>Files <span className="tabular-nums">{pr.files.length}</span></>)}
            <div className={`flex flex-col gap-1.5 ${shut("files")}`}>
              {pr.files.map((f) => (
                <div key={f} className="flex h-8 items-center gap-2 rounded-lg bg-hover px-2.5 text-ink">
                  <FileText size={14} className="shrink-0 text-mute" /> <span className="truncate">{f}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>
  )

  return wide ? (
    <main className="arc-scope my-2 mr-2 min-w-0 flex-1 overflow-hidden rounded-lg border border-line bg-panel">
      <ResizablePanels label="Triage" onLayoutChange={saveLayout}>
        <ResizablePanel id="triage-queue" label="Queue" defaultSize={layout[0]} minSize={200} maxSize={440} collapsible>
          {queuePane}
        </ResizablePanel>
        <ResizablePanel id="triage-reader" label="Application" defaultSize={layout[1]} minSize={380}>
          {needPane || readerPane}
        </ResizablePanel>
        <ResizablePanel id="triage-info" label="Details" defaultSize={layout[2]} minSize={260} maxSize={560} collapsible>
          {needInfo || infoPane}
        </ResizablePanel>
      </ResizablePanels>
    </main>
  ) : (
    <main className="my-2 mr-2 flex min-w-0 flex-1 overflow-hidden rounded-lg border border-line bg-panel max-md:ml-2">{needPane || readerPane}</main>
  )
}
