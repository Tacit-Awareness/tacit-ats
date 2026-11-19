import { useState, type ReactNode } from "react"
import { Calendar, ChevronDown, ChevronRight, CircleUser, Clock, Plus, X } from "lucide-react"
import { STAFF, type Status } from "../data"
import { REC_LABEL, profileOf } from "../profiles"
import { Avatar, Chip, Person as Member, StatusIcon } from "../ui"
import { Btn, Dialog, Empty, Field, Header, IconButton, Menu, TeamTile, label, loadOf } from "../kit"
import { DAYS, ME, SLOTS, type Interview } from "../org"
import { useStore } from "../store"
import { type Recommendation } from "../profiles"

/* ---------------- Interviews: what is booked, and the feedback owed on what is done ---------------- */

const RECS: { key: Recommendation; label: string }[] = [
  { key: "strong_yes", label: "Strong Yes" },
  { key: "yes", label: "Yes" },
  { key: "no", label: "No" },
  { key: "strong_no", label: "Strong No" },
]

/* Whether this interviewer has filed on this interview: written feedback on the same step */
function useFiled() {
  const s = useStore()
  return (i: Interview, who: string) => {
    const person = s.people.find((p) => p.id === i.person)
    if (!person) return undefined
    const all = [...profileOf(person, s.roleOf(person.role)).feedback, ...(s.filed[i.person] ?? [])]
    return all.find((f) => f.step === i.step && f.who === who)
  }
}

export function Interviews({ scope }: { scope?: ReactNode }) {
  const s = useStore()
  const filedBy = useFiled()
  const [tab, setTab] = useState("List")
  const [sel, setSel] = useState<string | null>(null)
  const inScope = s.interviews.filter((i) => {
    const p = s.people.find((x) => x.id === i.person)
    return p && (!s.team || s.roleOf(p.role).team === s.team)
  })
  const owed = inScope.filter((i) => i.done && i.interviewers.includes(ME) && !filedBy(i, ME))
  const groups: [string, Status, Interview[]][] = [
    ["Needs Your Feedback", "needs", owed],
    ["Upcoming", "waiting", inScope.filter((i) => !i.done)],
    ["Done", "done", inScope.filter((i) => i.done && !owed.includes(i))],
  ]
  const shown = inScope.find((i) => i.id === sel) ?? null

  /* Groups you have folded away */
  const [shut, setShut] = useState<string[]>([])

  return (
    <>
      <main className="@container my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-panel max-md:ml-2">
        <Header
          scope={scope}
          title="Interviews"
          tabs={["List", "Week"]}
          tab={tab}
          setTab={setTab}
          right={
            <Btn onClick={() => s.setSheet({ kind: "schedule" })}>
              <Plus size={14} /> Schedule
            </Btn>
          }
        />
        {tab === "List" ? (
          <div className="scroll-quiet flex-1 overflow-y-auto">
            {groups.map(
              ([name, status, rows]) =>
                rows.length > 0 && (
                  <section key={name}>
                    <button onClick={() => setShut(shut.includes(name) ? shut.filter((x) => x !== name) : [...shut, name])} aria-expanded={!shut.includes(name)} className="sticky top-0 z-10 flex h-9 w-full items-center gap-2.5 bg-panel pt-1 pr-3 pl-5 text-left">
                      <StatusIcon status={status} label={status === "needs" ? "Needs your feedback" : status === "waiting" ? "Upcoming, booked" : "Done, feedback filed"} />
                      <span className="font-medium text-ink">{name}</span>
                      <span className="text-faint tabular-nums">{rows.length}</span>
                      <ChevronDown size={13} className={`text-faint transition-transform ${shut.includes(name) ? "-rotate-90" : ""}`} />
                    </button>
                    {!shut.includes(name) && rows.map((i) => {
                      const p = s.personOf(i.person)
                      return (
                        <button
                          key={i.id}
                          onClick={() => setSel(i.id)}
                          className={`anim-rise flex h-11 w-full items-center gap-2.5 pr-4 pl-5 text-left transition-colors ${status === "needs" ? "wash-needs" : ""} ${sel === i.id ? "bg-raised" : "hover:bg-hover"}`}
                        >
                          <StatusIcon status={status} label={status === "needs" ? "Needs your feedback" : status === "waiting" ? "Upcoming, booked" : "Done, feedback filed"} />
                          <span className="shrink-0 font-medium text-ink">{p.name}</span>
                          <span className="truncate text-mute">{i.step}</span>
                          <span className="ml-auto flex shrink-0 items-center gap-3 pl-3">
                            <span className="hidden text-faint @2xl:inline">{s.roleOf(p.role).title}</span>
                            <span className="w-[104px] text-right text-mute">{i.when}</span>
                            <span className="flex w-[52px] justify-end -space-x-1">
                              {i.interviewers.slice(0, 3).map((m) => (
                                <span key={m} className="rounded-full ring-2 ring-panel">
                                  <Member id={m} size={18} />
                                </span>
                              ))}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </section>
                )
            )}
            {!inScope.length && (
              <Empty icon={<Calendar size={18} />} title="No interviews">
                Booked interviews show up here.
              </Empty>
            )}
          </div>
        ) : (
          <Week interviews={inScope} sel={sel} onPick={setSel} />
        )}
      </main>
      {shown && <InterviewPanel key={shown.id} i={shown} onClose={() => setSel(null)} />}
    </>
  )
}

/* The week as a grid, 9 to 6 */
function Week({ interviews, sel, onPick }: { interviews: Interview[]; sel: string | null; onPick: (id: string) => void }) {
  const s = useStore()
  const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17]
  const H = 56
  return (
    <div className="scroll-quiet flex-1 overflow-auto">
      <div className="grid min-w-[640px] grid-cols-[48px_repeat(5,minmax(0,1fr))]">
        <div className="sticky top-0 z-10 h-9 bg-panel" />
        {DAYS.map((d, n) => (
          <div key={d} className="sticky top-0 z-10 flex h-9 items-center border-l border-line bg-panel px-3 text-xs text-faint">
            {d} <span className="ml-1.5 tabular-nums">{16 + n}</span>
          </div>
        ))}
        <div className="relative" style={{ height: hours.length * H }}>
          {hours.map((h, n) => (
            <span key={h} className="absolute right-2 -translate-y-1/2 text-xs text-faint tabular-nums" style={{ top: n * H }}>
              {n > 0 && (h > 12 ? h - 12 : h)}
            </span>
          ))}
        </div>
        {DAYS.map((d, day) => (
          <div key={d} className="relative border-l border-line" style={{ height: hours.length * H }}>
            {hours.map((h, n) => (
              <span key={h} className="absolute inset-x-0 border-t border-line/70" style={{ top: n * H }} />
            ))}
            {interviews
              .filter((i) => i.day === day)
              .map((i) => (
                <button
                  key={i.id}
                  onClick={() => onPick(i.id)}
                  style={{ top: (i.start - 9) * H + 2, height: Math.max((i.mins / 60) * H - 4, 26) }}
                  className={`absolute inset-x-1.5 overflow-hidden rounded-md border px-2 py-1 text-left transition-colors ${sel === i.id ? "border-mute bg-raised" : "border-line-strong bg-hover hover:border-mute"} ${i.done ? "opacity-60" : ""}`}
                >
                  <span className="block truncate text-xs font-medium text-ink">{s.personOf(i.person).name}</span>
                  {i.mins >= 60 && <span className="block truncate text-xs text-mute">{i.step}</span>}
                </button>
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function InterviewPanel({ i, onClose, embedded }: { i: Interview; onClose: () => void; embedded?: boolean }) {
  const s = useStore()
  const filedBy = useFiled()
  const person = s.personOf(i.person)
  const role = s.roleOf(person.role)
  const owe = i.done && i.interviewers.includes(ME) && !filedBy(i, ME)
  const [rec, setRec] = useState<Recommendation | null>(null)
  const [ratings, setRatings] = useState<number[]>(role.scorecard.map(() => 0))
  const [notes, setNotes] = useState("")
  const submit = () => rec && s.fileFeedback(i, { step: i.step, who: ME, date: "Today", recommendation: rec, notes: notes.trim() || "No notes", ratings })

  return (
    <aside className={embedded ? "flex h-full min-w-0 flex-col" : "anim-slide my-2 mr-2 flex w-[420px] shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-panel max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:w-[min(420px,calc(100vw-16px))] max-lg:shadow-2xl"}>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-2 pl-5">
        <button onClick={() => s.openProfile(person.id)} className="truncate rounded text-mute transition-colors hover:text-ink">
          {person.name}
        </button>
        <ChevronRight size={12} className="shrink-0 text-faint" />
        <span className="truncate text-ink">{i.step}</span>
        <span className="ml-auto">
          <IconButton label="Close" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </span>
      </header>
      <div className="scroll-quiet flex-1 overflow-y-auto px-5 pt-6 pb-5">
        <div className="flex items-center gap-2.5">
          <Avatar name={person.name} size={28} />
          <h2 className="min-w-0 truncate text-[19px] font-semibold tracking-[-0.02em] text-ink">{i.step}</h2>
          <button onClick={() => s.openProfile(person.id)} className="ml-auto flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-body transition-colors hover:bg-raised hover:text-ink">
            <CircleUser size={14} className="text-mute" /> Profile
          </button>
        </div>
        <div className="mt-5 flex flex-wrap gap-1.5">
          <Chip>{i.when}</Chip>
          <Chip>{i.mins} min</Chip>
          <Chip>{role.title}</Chip>
        </div>

        <div className={`${label} mt-7`}>Interviewers</div>
        <div className="overflow-hidden rounded-lg border border-line-strong">
          {i.interviewers.map((m) => {
            const f = filedBy(i, m)
            return (
              <div key={m} className="flex h-11 items-center gap-2.5 border-b border-line px-3 last:border-b-0">
                <Member id={m} size={22} />
                <span className="text-ink">{STAFF[m].name}</span>
                <span className={`ml-auto ${f ? "font-medium text-ink" : "text-faint"}`}>{f ? REC_LABEL[f.recommendation] : i.done ? "Not filed" : loadOf(m)}</span>
              </div>
            )
          })}
        </div>

        {i.notes && (
          <>
            <div className={`${label} mt-7`}>Meeting Notes</div>
            <p className="rounded-lg bg-hover px-3 py-2.5 leading-[1.55] text-body">{i.notes}</p>
          </>
        )}

        {owe && (
          <>
            <div className={`${label} mt-7`}>Your Feedback</div>
            <div className="grid grid-cols-4 gap-1 rounded-lg bg-well p-0.5" role="radiogroup" aria-label="Recommendation">
              {RECS.map((r) => (
                <button
                  key={r.key}
                  role="radio"
                  aria-checked={rec === r.key}
                  onClick={() => setRec(r.key)}
                  className={`h-8 rounded-md whitespace-nowrap transition-colors ${rec === r.key ? "bg-panel font-medium text-ink shadow-[0_0_0_1px_var(--color-line-strong)]" : "text-mute hover:text-ink"}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {role.scorecard.map((a, n) => (
                <div key={a.id} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-body">{a.name}</span>
                  <span className="flex gap-1" role="radiogroup" aria-label={a.name}>
                    {[1, 2, 3, 4].map((v) => (
                      <button
                        key={v}
                        role="radio"
                        aria-checked={ratings[n] === v}
                        aria-label={`${v} of 4`}
                        onClick={() => setRatings(ratings.map((x, k) => (k === n ? (x === v ? 0 : v) : x)))}
                        className={`h-4 w-5 rounded-sm transition-colors ${v <= ratings[n] ? "bg-ink" : "bg-line-strong hover:bg-faint"}`}
                      />
                    ))}
                  </span>
                </div>
              ))}
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="How did it go?"
              aria-label="Notes"
              rows={4}
              className="scroll-quiet mt-4 block w-full resize-none rounded-lg border border-line-strong bg-hover px-3 py-2.5 leading-[1.55] text-ink outline-none placeholder:text-faint focus:border-mute"
            />
          </>
        )}
      </div>
      <div className="flex shrink-0 gap-1.5 border-t border-line p-3">
        {owe ? (
          <Btn solid disabled={!rec} onClick={submit} className="h-8 flex-1 justify-center">
            Submit Feedback
          </Btn>
        ) : !i.done ? (
          <>
            <Btn className="h-8 flex-1 justify-center" onClick={() => s.setSheet({ kind: "schedule", person: i.person, interview: i.id })}>
              Reschedule
            </Btn>
            <Btn
              className="h-8 flex-1 justify-center"
              onClick={() => {
                s.setInterviews((all) => all.filter((x) => x.id !== i.id))
                s.log(i.person, { who: ME, text: `Cancelled ${i.step}`, when: "now" })
                onClose()
              }}
            >
              Cancel
            </Btn>
          </>
        ) : (
          <Btn className="h-8 flex-1 justify-center" onClick={() => s.openProfile(person.id)}>
            Open Feedback
          </Btn>
        )}
      </div>
    </aside>
  )
}

/* ---------------- Sheets: the few things that need a small form ---------------- */

/* find_interview_times, then schedule_interview or update_interview */
export function ScheduleSheet() {
  const s = useStore()
  const sheet = s.sheet as { kind: "schedule"; person?: string; interview?: string }
  const moving = s.interviews.find((i) => i.id === sheet.interview)
  const active = s.people.filter((p) => !p.closed)
  const [personId, setPersonId] = useState(sheet.person ?? active[0].id)
  const person = s.personOf(personId)
  const role = s.roleOf(person.role)
  const [step, setStep] = useState(moving?.step ?? role.plan[Math.min(1, role.plan.length - 1)])
  const [who, setWho] = useState<string[]>(moving?.interviewers ?? [role.manager])
  const [slot, setSlot] = useState(SLOTS[0])
  const close = () => s.setSheet(null)
  const book = () => {
    const [d, time, half] = slot.split(" ")
    const [h, m] = time.split(":").map(Number)
    s.book({ person: personId, step, day: DAYS.indexOf(d), start: (h % 12) + (half === "PM" ? 12 : 0) + m / 60, mins: 60, when: slot, interviewers: who }, moving?.id)
    close()
  }
  const pool = [role.manager, ...(role.team_members ?? []), ...Object.keys(STAFF)].filter((m, n, all) => all.indexOf(m) === n)

  return (
    <Dialog
      title={moving ? "Reschedule" : "Schedule Interview"}
      onClose={close}
      footer={
        <>
          <Btn onClick={close}>Cancel</Btn>
          <Btn solid disabled={!who.length} onClick={book}>
            {moving ? "Move" : "Book"}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-mute">Candidate</span>
          <Menu
            width={240}
            items={active.map((p) => ({
              label: p.name,
              on: p.id === personId,
              onPick: () => {
                setPersonId(p.id)
                const r = s.roleOf(p.role)
                setStep(r.plan[0])
                setWho([r.manager])
              },
            }))}
            trigger={() => (
              <Btn>
                <Avatar name={person.name} size={16} /> {person.name} <ChevronDown size={13} className="text-faint" />
              </Btn>
            )}
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-mute">Step</span>
          <Menu
            width={200}
            items={role.plan.map((p) => ({ label: p, on: p === step, onPick: () => setStep(p) }))}
            trigger={() => (
              <Btn>
                {step} <ChevronDown size={13} className="text-faint" />
              </Btn>
            )}
          />
        </div>
        <div className="flex items-start gap-3">
          <span className="w-20 shrink-0 pt-1 text-mute">With</span>
          <div className="flex flex-wrap gap-1.5">
            {pool.map((m) => {
              const on = who.includes(m)
              return (
                <button
                  key={m}
                  aria-pressed={on}
                  title={loadOf(m)}
                  onClick={() => setWho(on ? who.filter((x) => x !== m) : [...who, m])}
                  className={`flex h-7 items-center gap-1.5 rounded-full border pr-2.5 pl-1 transition-colors ${on ? "border-ink text-ink" : "border-line-strong text-mute hover:text-ink"}`}
                >
                  <Member id={m} size={18} /> {STAFF[m].first}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex items-start gap-3">
          <span className="w-20 shrink-0 pt-1.5 text-mute">When</span>
          <div className="flex flex-1 flex-col gap-1" role="radiogroup" aria-label="When">
            {SLOTS.map((t) => (
              <button
                key={t}
                role="radio"
                aria-checked={slot === t}
                onClick={() => setSlot(t)}
                className={`flex h-9 items-center gap-2.5 rounded-lg border px-3 text-left transition-colors ${slot === t ? "border-ink text-ink" : "border-line-strong text-body hover:bg-hover"}`}
              >
                <Clock size={14} className="text-mute" /> {t}
                <span className="ml-auto text-xs text-faint">Everyone free</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  )
}

/* add_candidate */
export function CandidateSheet() {
  const s = useStore()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const open = s.roles.filter((r) => !r.closed)
  const [roleId, setRoleId] = useState((s.team && open.find((r) => r.team === s.team)?.id) || open[0].id)
  const close = () => s.setSheet(null)
  const add = () => {
    if (!name.trim()) return
    s.addCandidate(name.trim(), email.trim() || "No email yet", roleId)
    close()
    s.go("triage")
  }
  return (
    <Dialog
      title="New Candidate"
      onClose={close}
      footer={
        <>
          <Btn onClick={close}>Cancel</Btn>
          <Btn solid disabled={!name.trim()} onClick={add}>
            Add
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <Field label="Name" value={name} onChange={setName} placeholder="Name" autoFocus onEnter={add} />
        <Field label="Email" value={email} onChange={setEmail} placeholder="Email" onEnter={add} />
        <div className="flex items-center gap-3 pt-1">
          <span className="text-mute">For</span>
          <Menu
            width={260}
            items={open.map((r) => ({ label: r.title, on: r.id === roleId, onPick: () => setRoleId(r.id) }))}
            trigger={() => (
              <Btn>
                <TeamTile id={s.roleOf(roleId).team} size={14} /> {s.roleOf(roleId).title} <ChevronDown size={13} className="text-faint" />
              </Btn>
            )}
          />
        </div>
      </div>
    </Dialog>
  )
}
