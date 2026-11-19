import { useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight, CircleUser, Mail, Ticket as TicketIcon, X } from "lucide-react"
import { ThinkingLoader } from "@/components/ui/thinking-loader"
import { COMMAND_LABEL, KIND_LABEL, STAFF, STATUS_LABEL, STATUS_ORDER, commandsFor, statusOf, type Command, type Person, type Role, type Task } from "../data"
import { Avatar, BotMark, Chip, Kbd, Person as Member, StatusIcon, mod } from "../ui"
import { Empty, Header, IconButton, isOpen as open, last, loadOf, standing, teamOf, title, wash } from "../kit"
import { RoundBlocks, useRounds } from "./rounds"

/* ---------------- Tickets: the bot's tasks ---------------- */

export function Tickets({
  scope,
  allTeams,
  tickets,
  personOf,
  roleOf,
  openId,
  onOpen,
}: {
  scope?: ReactNode
  allTeams?: boolean
  tickets: Task[]
  personOf: (id: string) => Person
  roleOf: (id: string) => Role
  openId: string | null
  onOpen: (id: string) => void
}) {
  const [tab, setTab] = useState("Active")
  /* The round picked on the blocks narrows the list to the people on it; folded groups stay folded */
  const [round, setRound] = useState<string | null>(null)
  const [shut, setShut] = useState<string[]>([])
  const { active } = useRounds()
  const onRound = round ? new Set(active.filter((x) => x.at === round).map((x) => x.p.id)) : null
  const shown = tickets.filter((t) => (tab === "All" ? true : open(statusOf(t)))).filter((t) => !onRound || onRound.has(t.person))
  return (
    <>
      <Header scope={scope} title="Tickets" tabs={["Active", "All"]} tab={tab} setTab={setTab} />
      <div className="scroll-quiet flex-1 overflow-y-auto">
        <RoundBlocks picked={round} onPick={setRound} />
        {STATUS_ORDER.map((s) => {
          const rows = shown.filter((t) => statusOf(t) === s)
          if (!rows.length) return null
          return (
            <section key={s}>
              <button onClick={() => setShut(shut.includes(s) ? shut.filter((x) => x !== s) : [...shut, s])} aria-expanded={!shut.includes(s)} className="sticky top-0 z-10 flex h-9 w-full items-center gap-2.5 bg-panel pt-1 pr-3 pl-5 text-left">
                <StatusIcon status={s} />
                <span className="font-medium text-ink">{STATUS_LABEL[s]}</span>
                <span className="text-faint tabular-nums">{rows.length}</span>
                <ChevronDown size={13} className={`text-faint transition-transform ${shut.includes(s) ? "-rotate-90" : ""}`} />
              </button>
              {!shut.includes(s) && rows.map((t) => {
                const p = personOf(t.person)
                const r = roleOf(p.role)
                return (
                  <button key={t.id} onClick={() => onOpen(t.id)} className={`anim-rise flex h-11 w-full items-center gap-2.5 pr-4 pl-5 text-left transition-colors ${wash(s)} ${openId === t.id ? "bg-raised" : "hover:bg-hover"}`}>
                    <StatusIcon status={s} />
                    <span className="shrink-0 font-medium text-ink">{p.name}</span>
                    <span className="truncate text-mute">{title(t)}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-3 pl-3">
                      <span className="hidden max-w-[220px] truncate text-mute @xl:inline">{standing(t)}</span>
                      <span className="hidden w-[150px] truncate text-right text-faint @3xl:inline">{allTeams ? teamOf(r.team).name : r.title}</span>
                      <Member id={p.owner} />
                      <span className="w-7 text-right text-faint tabular-nums">{t.age}</span>
                    </span>
                  </button>
                )
              })}
            </section>
          )
        })}
        {!shown.length && (
          <Empty icon={<TicketIcon size={18} />} title={round ? `No tickets on ${round}` : "No tickets"}>
            A ticket appears for each step the bot is working on for a candidate. What needs you is in Triage.
          </Empty>
        )}
      </div>
    </>
  )
}

/* ---------------- Ticket panel ---------------- */

const ASKED: Record<Task["status"], { label: string; tone: string }> = {
  done: { label: "Answered", tone: "text-ink" },
  waiting: { label: "Waiting", tone: "text-body" },
  running: { label: "Asking", tone: "text-body" },
  cancelled: { label: "Out", tone: "text-faint" },
  failed: { label: "Failed", tone: "text-bad" },
}
/* From the interviewer's profile: away, or how full their week is against their own limit */

export function TicketPanel({
  task,
  asked,
  person,
  role,
  busy,
  onClose,
  onCommand,
  onProfile,
  embedded,
}: {
  /* Inside another view's pane, not as a panel of its own */
  embedded?: boolean
  task: Task
  asked: Task[]
  person: Person
  role: Role
  busy: boolean
  onClose: () => void
  onCommand: (t: Task, c: Command) => void
  onProfile: (id: string) => void
}) {
  const end = useRef<HTMLDivElement>(null)
  const [draftOpen, setDraftOpen] = useState(false)
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" })
  }, [task.steps.length, task.status])

  const status = statusOf(task)
  const commands = busy ? [] : commandsFor(task)
  const first = commands[0]
  useEffect(() => {
    if (!first || first === "cancel") return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onCommand(task, first)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [task, first, onCommand])

  const why = task.status === "failed" ? (task.error ?? "The task failed") : task.draft ? "Invite drafted, not sent" : task.waitingOn ? `No reply from ${task.waitingOn.name} in ${task.age}` : "Needs a look"
  const label = "mb-2 text-xs text-faint"

  return (
    <aside className={embedded ? "flex h-full min-w-0 flex-col" : "anim-slide my-2 mr-2 flex w-[420px] shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-panel max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:w-[min(420px,calc(100vw-16px))] max-lg:shadow-2xl"}>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-2 pl-5">
        <button onClick={() => onProfile(person.id)} className="truncate rounded text-mute transition-colors hover:text-ink">
          {person.name}
        </button>
        <ChevronRight size={12} className="shrink-0 text-faint" />
        <span className="truncate text-ink">{KIND_LABEL[task.kind]}</span>
        <span className="ml-auto">
          <IconButton label="Close" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </span>
      </header>

      <div className="scroll-quiet flex-1 overflow-y-auto px-5 pt-6 pb-4">
        <div className="flex items-center gap-2.5">
          <Avatar name={person.name} size={28} />
          <h2 className="min-w-0 truncate text-[19px] font-semibold tracking-[-0.02em] text-ink">{KIND_LABEL[task.kind]}</h2>
          <button onClick={() => onProfile(person.id)} className="ml-auto flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-body transition-colors hover:bg-raised hover:text-ink">
            <CircleUser size={14} className="text-mute" /> Profile
          </button>
        </div>

        <div className="mt-5 flex flex-wrap gap-1.5">
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-line-strong px-2 text-xs text-body">
            <StatusIcon status={status} size={12} /> {STATUS_LABEL[status]}
          </span>
          <Chip>{role.title}</Chip>
          {task.step && <Chip>{task.step}</Chip>}
          {task.waitingOn && task.status === "waiting" && (
            <Chip>
              {task.waitingOn.name} on {task.waitingOn.channel}
            </Chip>
          )}
        </div>

        {asked.length > 0 && (
          <>
            <div className={`${label} mt-7 flex`}>
              Interviewers
              <span className="ml-auto tabular-nums">
                {asked.filter((k) => k.status === "done").length} of {asked.length} answered
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-line-strong">
              {asked.map((k) => {
                const s = STAFF[k.interviewer!]
                return (
                  <div key={k.id} className="flex min-h-[52px] items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0">
                    <span className={k.status === "cancelled" ? "opacity-50" : ""}>
                      <Member id={s.id} size={22} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${k.status === "cancelled" ? "text-mute" : "text-ink"}`}>
                        {s.first} <span className="text-mute">{last(k)}</span>
                      </span>
                      <span className="block truncate text-xs text-faint">{loadOf(s.id)}</span>
                    </span>
                    <span className={`shrink-0 font-medium ${ASKED[k.status].tone}`}>{ASKED[k.status].label}</span>
                  </div>
                )
              })}
            </div>
          </>
        )}

        <div className={`${label} mt-7 flex items-center gap-1.5`}>
          <BotMark size={11} /> Grokbot
        </div>
        <ol className="relative flex flex-col gap-2.5">
          <span className="absolute top-2 bottom-2 left-[3px] w-px bg-line-strong" aria-hidden="true" />
          {task.steps.map((s, i) => (
            <li key={i} className="anim-rise relative flex items-baseline gap-3 pl-[18px]">
              <span className={`absolute top-[7px] left-0 size-[7px] rounded-full ring-4 ring-panel ${i === task.steps.length - 1 && open(status) ? "bg-ink" : "bg-faint"}`} />
              <span className={`min-w-0 flex-1 ${i === task.steps.length - 1 ? "text-ink" : "text-body"}`}>{s.label}</span>
              <span className="shrink-0 text-xs text-faint tabular-nums">{s.at}</span>
            </li>
          ))}
        </ol>

        {task.draft && (
          <div className="mt-4 overflow-hidden rounded-lg border border-line-strong">
            <button onClick={() => setDraftOpen(!draftOpen)} aria-expanded={draftOpen} className="flex h-9 w-full items-center gap-2 px-2.5 text-left transition-colors hover:bg-hover">
              <Mail size={14} className="shrink-0 text-mute" />
              <span className="truncate text-ink">{task.draft.subject}</span>
              <span className="ml-auto shrink-0 text-xs text-faint">Draft</span>
              <ChevronRight size={13} className={`shrink-0 text-faint transition-transform ${draftOpen ? "rotate-90" : ""}`} />
            </button>
            {draftOpen && (
              <div className="anim-rise border-t border-line px-3 pt-2.5 pb-3">
                <div className="flex gap-2 text-xs">
                  <span className="w-5 text-faint">To</span>
                  <span className="text-body">{task.draft.to}</span>
                </div>
                <p className="mt-2.5 leading-[1.55] whitespace-pre-wrap text-body">{task.draft.body}</p>
              </div>
            )}
          </div>
        )}

        {task.status === "running" && (
          <div className="anim-rise mt-4 pl-[18px]">
            <ThinkingLoader key={last(task)} size="sm" phases={[last(task)]} />
          </div>
        )}
        <div ref={end} />
      </div>

      {commands.length > 0 && (
        <div className="anim-rise shrink-0 border-t border-line p-3">
          <div className={`rounded-lg border border-line-strong bg-raised p-3 ${status === "needs" || status === "failed" ? wash(status) : ""}`}>
            {(status === "needs" || status === "failed") && (
              <div className="mb-3 flex items-center gap-2 text-ink">
                <StatusIcon status={status} />
                <span className="font-medium">{why}</span>
              </div>
            )}
            <div className="flex gap-1.5">
              {commands.map((c, i) => (
                <button
                  key={c}
                  onClick={() => onCommand(task, c)}
                  className={`flex h-8 flex-1 items-center justify-center gap-2 rounded-md whitespace-nowrap transition ${i === 0 && c !== "cancel" ? "bg-ink font-medium text-well hover:opacity-90" : "border border-line-strong text-ink hover:bg-hover"}`}
                >
                  {COMMAND_LABEL[c]}{" "}
                  {i === 0 && c !== "cancel" && (
                    <span className="text-well/60">
                      <Kbd>{mod("↵")}</Kbd>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
