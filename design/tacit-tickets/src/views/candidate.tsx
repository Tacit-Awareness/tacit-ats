import { useState, type ReactNode } from "react"
import { Calendar, ChevronDown, FileText, MoreHorizontal, Plus, X } from "lucide-react"
import { APPLICANTS, STAFF, STAGES, statusOf } from "../data"
import { REC_LABEL, fileUrl, profileOf } from "../profiles"
import { PdfReader } from "../pdf-reader"
import { TestbenchReport } from "./testbench"
import { Avatar, BotMark, Person as Member, StagePips, StatusIcon } from "../ui"
import { Btn, Composer, Empty, IconButton, Menu, Pips, isOpen as open, label, standing, teamOf, title } from "../kit"
import { ME, OFFER_LABEL } from "../org"
import { useStore, type CandidateTab } from "../store"

/* ---------------- Candidate: everything about one person, and every write on them ---------------- */

const TABS: CandidateTab[] = ["Resume", "Testbench", "Interviews", "Activity", "Emails"]

export function Candidate() {
  const s = useStore()
  const { id, tab } = s.profile!
  const person = s.personOf(id)
  const role = s.roleOf(person.role)
  const pr = profileOf(person, role)
  const close = () => s.setProfile(null)
  const setTab = (t: CandidateTab) => s.setProfile({ id, tab: t })

  const tags = s.personTags[id] ?? []
  const live = s.tickets.filter((t) => t.person === id && open(statusOf(t)))
  const upcoming = s.interviews.filter((i) => i.person === id && !i.done)
  const feedback = [...pr.feedback, ...(s.filed[id] ?? [])]
  const activity = s.activity[id] ?? []
  const mail = s.emails[id] ?? []
  const offer = s.offers[id]
  /* Emails as chains: everything under one subject, replies included, oldest chain first */
  const threads = mail.reduce<{ subject: string; mails: typeof mail }[]>((out, m) => {
    const subjectOf = m.subject.replace(/^(re:\s*)+/i, "")
    const hit = out.find((t) => t.subject === subjectOf)
    if (hit) hit.mails.push(m)
    else out.push({ subject: subjectOf, mails: [m] })
    return out
  }, [])
  /* Which chains are open; until you touch one, only the latest is */
  const [openThreads, setOpenThreads] = useState<string[] | null>(null)
  const toggleThread = (subjectOf: string, isOpen: boolean) => {
    const now = openThreads ?? (threads.length ? [threads[threads.length - 1].subject] : [])
    setOpenThreads(isOpen ? now.filter((x) => x !== subjectOf) : [...now, subjectOf])
  }
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [dupe, setDupe] = useState(false)
  /* The file in the reader: the one picked from Files, else the first on record */
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null)
  const docName = (picked?.id === id ? picked.name : undefined) ?? pr.files[0]
  const docUrl = docName ? fileUrl(id, docName, pr.files.indexOf(docName)) : null
  const tb = APPLICANTS.find((a) => a.id === id)?.testbench
  const tabStrip = TABS.map((t) => (
    <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 transition-colors ${tab === t ? "bg-raised text-ink" : "text-mute hover:text-ink"}`}>
      {t}
      {t === "Testbench" && tb?.score !== undefined && <span className="font-medium text-ink tabular-nums">{tb.score}</span>}
    </button>
  ))
  const first = person.name.split(" ")[0]

  const stageItems = [
    { heading: "Move To" } as const,
    ...STAGES.map((st, i) => ({ label: st, on: !person.closed && person.stage === i, onPick: () => s.moveStage(id, i) })),
    "sep" as const,
    { label: "Hired", on: person.closed === "Hired", onPick: () => s.moveStage(id, { closed: "Hired" }) },
    { label: "Withdrawn", on: person.closed === "Withdrawn", onPick: () => s.moveStage(id, { closed: "Withdrawn" }) },
    { heading: "Reject" } as const,
    ...s.reasons.map((r) => ({ label: r, danger: true, onPick: () => s.moveStage(id, { closed: "Rejected", reason: r }) })),
  ]

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={person.name}>
      <div className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[2px]" onClick={close} />
      <div className="anim-rise relative flex h-[min(860px,calc(100vh-32px))] w-full max-w-[1240px] flex-col overflow-hidden rounded-xl border border-line-strong bg-panel shadow-[0_24px_80px_-12px_rgba(0,0,0,0.6)]">
        <header className="flex shrink-0 items-center gap-3.5 border-b border-line py-4 pr-3 pl-6">
          <Avatar name={person.name} size={38} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] leading-tight font-semibold tracking-[-0.015em] text-ink">{person.name}</h2>
            <div className="mt-0.5 truncate text-mute">
              {pr.headline}, {pr.location}
            </div>
          </div>
          <Menu
            align="right"
            width={190}
            items={stageItems}
            trigger={() => (
              <Btn>
                {person.closed ? person.closed : <StagePips stage={person.stage} />} <ChevronDown size={13} className="text-faint" />
              </Btn>
            )}
          />
          <Menu
            align="right"
            width={210}
            trigger={() => (
              <IconButton label="More">
                <MoreHorizontal size={16} />
              </IconButton>
            )}
            items={[
              { heading: "Add To Pool" },
              ...s.pools.map((p) => ({
                label: p,
                onPick: () => {
                  s.log(id, { who: ME, text: `Added to ${p}`, when: "now" })
                  s.setToast(`Added to ${p}`)
                },
              })),
              { heading: "Check In Later" },
              ...(
                [
                  ["In 1 Month", "Dec 18"],
                  ["In 3 Months", "Feb 18"],
                  ["In 6 Months", "May 18"],
                ] as const
              ).map(([name, due]) => ({
                label: name,
                onPick: () => {
                  s.setCheckins((all) => [...all.filter((c) => c.id !== id), { id, name: person.name, was: `${role.title}, ${(person.closed ?? STAGES[person.stage]).toLowerCase()}`, now: pr.headline, due }])
                  s.log(id, { who: ME, text: `Set a check-in for ${due}`, when: "now" })
                  s.setToast(`Check-in set for ${due}`)
                },
              })),
              "sep",
              { label: "Find Duplicates", onPick: () => setDupe(true) },
              {
                label: "Anonymize",
                danger: true,
                onPick: () => {
                  s.patchPerson(id, (p) => ({ ...p, name: "Removed Candidate", closed: p.closed ?? "Withdrawn", next: null }))
                  close()
                  s.setToast("Candidate anonymized")
                },
              },
            ]}
          />
          <IconButton label="Close" onClick={close}>
            <X size={16} />
          </IconButton>
        </header>

        {dupe && (
          <div className="flex shrink-0 items-center gap-3 border-b border-line bg-hover px-6 py-2.5 text-body">
            {id === "arjun" ? (
              <>
                One likely duplicate: <span className="text-ink">Arjun M. Mehta</span>, same email, added Nov 2.
              </>
            ) : (
              "No duplicates found."
            )}
            <span className="ml-auto flex gap-1.5">
              {id === "arjun" && (
                <Btn
                  solid
                  onClick={() => {
                    setDupe(false)
                    s.log(id, { who: ME, text: "Merged a duplicate record", when: "now" })
                    s.setToast("Records merged")
                  }}
                >
                  Merge
                </Btn>
              )}
              <Btn onClick={() => setDupe(false)}>Dismiss</Btn>
            </span>
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_340px]">
          {/* What is known about them */}
          <section className="scroll-quiet overflow-y-auto px-6 py-5 max-md:hidden md:order-2 md:border-l md:border-line">
            <p className="leading-[1.55] text-body">{pr.summary}</p>

            <div className={`${label} mt-6`}>Next</div>
            <input
              value={person.next ?? ""}
              onChange={(e) => s.patchPerson(id, (p) => ({ ...p, next: e.target.value || null }))}
              placeholder="Nothing set"
              aria-label="Next action"
              className={`doc-line block h-8 w-full rounded-lg px-2.5 text-ink outline-none transition-colors placeholder:text-faint ${person.next ? "bg-s-scheduled/15 hover:bg-s-scheduled/25 focus:bg-s-scheduled/25" : "bg-hover"}`}
            />

            <dl className="mt-5 flex flex-col gap-2.5">
              {(
                [
                  ["Role", role.title],
                  ["Team", teamOf(role.team).name],
                  [
                    "Owner",
                    <Menu
                      key="o"
                      width={180}
                      items={Object.values(STAFF).map((m) => ({ label: m.name, on: m.id === person.owner, onPick: () => s.patchPerson(id, (p) => ({ ...p, owner: m.id })) }))}
                      trigger={() => (
                        <button className="-mx-1 inline-flex items-center gap-2 rounded px-1 hover:bg-hover">
                          <Member id={person.owner} size={16} />
                          {STAFF[person.owner].name}
                        </button>
                      )}
                    />,
                  ],
                  ["Source", person.source],
                  ...(offer || person.stage === STAGES.length - 1
                    ? [
                        [
                          "Offer",
                          <button key="offer" onClick={() => s.openOffer(id)} className="-mx-1 rounded px-1 text-left underline decoration-faint underline-offset-2 hover:bg-hover">
                            {offer ? `${OFFER_LABEL[offer.status]}${offer.salary ? `, ${offer.salary}` : ""}` : "Draft One"}
                          </button>,
                        ] as [string, ReactNode],
                      ]
                    : []),
                  ...s.fields
                    .filter((f) => f.on === "Candidate")
                    .map((f): [string, ReactNode] => [
                      f.name,
                      <input
                        key={f.id}
                        value={s.fieldValues[id]?.[f.id] ?? ""}
                        placeholder="Empty"
                        aria-label={f.name}
                        onChange={(e) => s.setFieldValues((all) => ({ ...all, [id]: { ...all[id], [f.id]: e.target.value } }))}
                        className="-mx-1 h-6 w-full rounded bg-transparent px-1 text-ink outline-none placeholder:text-faint hover:bg-hover focus:bg-hover"
                      />,
                    ]),
                ] as [string, ReactNode][]
              ).map(([k, v]) => (
                <div key={k} className="flex items-center gap-3">
                  <dt className="w-[92px] shrink-0 truncate text-mute">{k}</dt>
                  <dd className="min-w-0 flex-1 truncate text-ink">{v}</dd>
                </div>
              ))}
            </dl>

            <div className={`${label} mt-6`}>Tags</div>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <button
                  key={t}
                  title="Remove"
                  onClick={() => s.setPersonTags((all) => ({ ...all, [id]: tags.filter((x) => x !== t) }))}
                  className="group inline-flex h-6 items-center gap-1 rounded-full border border-line-strong px-2 text-xs text-mute hover:text-ink"
                >
                  {t} <X size={11} className="text-faint group-hover:text-ink" />
                </button>
              ))}
              <Menu
                width={190}
                items={s.tags.filter((t) => !tags.includes(t)).map((t) => ({ label: t, onPick: () => s.setPersonTags((all) => ({ ...all, [id]: [...tags, t] })) }))}
                trigger={() => (
                  <button aria-label="Add tag" className="inline-flex size-6 items-center justify-center rounded-full border border-dashed border-line-strong text-faint hover:text-ink">
                    <Plus size={12} />
                  </button>
                )}
              />
            </div>

            <div className={`${label} mt-6`}>Files</div>
            <div className="flex flex-col gap-1.5">
              {pr.files.map((f, i) => {
                const url = fileUrl(id, f, i)
                const on = tab === "Resume" && docName === f
                const row = `flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-left text-ink ${on ? "bg-raised" : "bg-hover"}`
                const inner = (
                  <>
                    <FileText size={14} className="shrink-0 text-mute" />
                    <span className="truncate">{f}</span>
                  </>
                )
                return url ? (
                  <button key={f} aria-pressed={on} onClick={() => {
                      setPicked({ id, name: f })
                      setTab("Resume")
                    }} className={`${row} transition-colors hover:bg-raised`}>
                    {inner}
                  </button>
                ) : (
                  <div key={f} className={row}>
                    {inner}
                  </div>
                )
              })}
              <button onClick={() => s.setToast("File added")} className="flex h-8 items-center gap-2 rounded-lg border border-dashed border-line-strong px-2.5 text-mute transition-colors hover:text-ink">
                <Plus size={13} /> Add File
              </button>
            </div>
          </section>

          {/* What has happened, and what you can do */}
          <section className="flex min-h-0 min-w-0 flex-col">
            {tab === "Resume" && docUrl ? (
              <PdfReader key={docUrl} url={docUrl} name={docName} title={tabStrip} />
            ) : (
              <div className="scroll-quiet flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-4 [scrollbar-width:none]">{tabStrip}</div>
            )}
            {tab === "Resume" && !docUrl && (
              <Empty icon={<FileText size={18} />} title="No resume on file">
                Add one under Files and it opens here.
              </Empty>
            )}
            {tab === "Testbench" && <TestbenchReport key={id} tb={tb} name={person.name} peers={[]} onSend={() => setTab("Emails")} />}

            <div key={tab} className={`scroll-quiet anim-rise min-h-0 flex-1 overflow-y-auto px-6 py-5 ${tab === "Resume" || tab === "Testbench" ? "hidden" : ""}`}>
              {tab === "Interviews" && (
                <div className="flex flex-col gap-2.5">
                  {!live.length && !upcoming.length && !feedback.length && (
                    <Empty icon={<Calendar size={18} />} title="No interviews yet">
                      Booked interviews and each interviewer's feedback show up here.
                    </Empty>
                  )}
                  {live.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        close()
                        s.go("tickets", s.team, t.id)
                      }}
                      className="flex h-11 items-center gap-2.5 rounded-lg border border-dashed border-line-strong px-3.5 text-left transition-colors hover:bg-hover"
                    >
                      <StatusIcon status={statusOf(t)} />
                      <span className="shrink-0 font-medium text-ink">{title(t)}</span>
                      <span className="ml-auto truncate text-mute">{standing(t)}</span>
                    </button>
                  ))}
                  {upcoming.map((i) => (
                    <div key={i.id} className="flex h-11 items-center gap-2.5 rounded-lg border border-line-strong px-3.5">
                      <Calendar size={14} className="shrink-0 text-mute" />
                      <span className="font-medium text-ink">{i.step}</span>
                      <span className="text-mute">{i.when}</span>
                      <span className="ml-auto flex items-center gap-1">
                        {i.interviewers.map((m) => (
                          <Member key={m} id={m} size={18} />
                        ))}
                      </span>
                      <button onClick={() => s.setSheet({ kind: "schedule", person: id, interview: i.id })} className="rounded text-mute underline decoration-faint underline-offset-2 hover:text-ink">
                        Move
                      </button>
                    </div>
                  ))}
                  {[...feedback].reverse().map((f, n) => (
                    <article key={`${f.step}${n}`} className="rounded-lg border border-line-strong bg-hover px-3.5 py-3">
                      <div className="flex items-center gap-2.5">
                        <StatusIcon status="done" />
                        <span className="font-medium text-ink">{f.step}</span>
                        <span className="text-faint">{f.date}</span>
                        <span className={`ml-auto font-medium ${f.recommendation === "strong_yes" ? "text-ink" : f.recommendation === "yes" ? "text-body" : "text-mute"}`}>{REC_LABEL[f.recommendation]}</span>
                      </div>
                      <div className="mt-2.5 flex gap-2.5">
                        <span className="pt-0.5">
                          <Member id={f.who} size={18} />
                        </span>
                        <p className="leading-[1.5] text-body">
                          <span className="font-medium text-ink">{STAFF[f.who].first}</span> {f.notes}
                        </p>
                      </div>
                      {f.ratings.some((r) => r > 0) && (
                        <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
                          {role.scorecard.map(
                            (a, i) =>
                              f.ratings[i] > 0 && (
                                <div key={a.id} className="flex items-center gap-3 text-mute">
                                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                                  <Pips value={f.ratings[i]} />
                                </div>
                              )
                          )}
                        </div>
                      )}
                    </article>
                  ))}
                  {!person.closed && (
                    <button onClick={() => s.setSheet({ kind: "schedule", person: id })} className="flex h-10 items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong text-mute transition-colors hover:text-ink">
                      <Plus size={14} /> Schedule Interview
                    </button>
                  )}
                </div>
              )}

              {tab === "Activity" && (
                <>
                  <Composer placeholder="Add a note" onAdd={(text) => s.addNote(id, text)} />
                  <ol className="relative mt-5 flex flex-col gap-3.5">
                    <span className="absolute top-2 bottom-2 left-[9.5px] w-px bg-line" aria-hidden="true" />
                    {[...activity].reverse().map((a, i) => (
                      <li key={i} className="relative flex gap-3">
                        <span className="relative z-10 shrink-0 bg-panel py-0.5">
                          {a.who ? (
                            <Member id={a.who} size={20} />
                          ) : (
                            <span className="flex size-5 items-center justify-center text-mute">
                              <BotMark />
                            </span>
                          )}
                        </span>
                        <div className={`min-w-0 flex-1 ${a.note ? "rounded-lg bg-hover px-3 py-2" : "pt-0.5"}`}>
                          <span className={a.note ? "text-ink" : "text-body"}>
                            {a.note && a.who && <span className="font-medium">{STAFF[a.who].first} </span>}
                            {a.text}
                          </span>
                        </div>
                        <span className="shrink-0 pt-0.5 text-xs text-faint tabular-nums">{a.when}</span>
                      </li>
                    ))}
                  </ol>
                  {!activity.length && (
                    <Empty icon={<FileText size={18} />} title="No activity yet">
                      Stage moves, emails and notes on {first} are kept here.
                    </Empty>
                  )}
                </>
              )}

              {tab === "Emails" && (
                <div className="flex flex-col gap-2.5">
                  {/* One chain per conversation: the invitation to each round, and the replies under it */}
                  {threads.map((t, n) => {
                    const openNow = openThreads ? openThreads.includes(t.subject) : n === threads.length - 1
                    const last = t.mails[t.mails.length - 1]
                    return (
                      <section key={t.subject} className="overflow-hidden rounded-lg border border-line-strong">
                        <button onClick={() => toggleThread(t.subject, openNow)} aria-expanded={openNow} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-hover">
                          <ChevronDown size={13} className={`shrink-0 text-faint transition-transform ${openNow ? "" : "-rotate-90"}`} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-ink">{t.subject}</span>
                            {!openNow && (
                              <span className="block truncate text-mute">
                                {last.out ? (STAFF[last.who]?.first ?? last.who) : last.who}: {last.body}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-xs text-faint tabular-nums">
                            {t.mails.length} {t.mails.length === 1 ? "email" : "emails"}, {last.when}
                          </span>
                        </button>
                        {openNow && (
                          <div className="border-t border-line">
                            {t.mails.map((m, i) => (
                              <article key={i} className={`border-b border-line px-3.5 py-3 last:border-b-0 ${m.out ? "" : "bg-hover"}`}>
                                <div className="flex items-baseline gap-2">
                                  <span className="font-medium text-ink">{m.out ? (STAFF[m.who]?.first ?? m.who) : m.who}</span>
                                  <span className="text-xs text-faint">{m.out ? `to ${first}` : "replied"}</span>
                                  <span className="ml-auto shrink-0 text-xs text-faint tabular-nums">{m.when}</span>
                                </div>
                                <p className="mt-1.5 leading-[1.55] whitespace-pre-wrap text-body">{m.body}</p>
                              </article>
                            ))}
                            <div className="flex justify-end border-t border-line px-2 py-1.5">
                              <Btn className="border-transparent text-mute" onClick={() => setSubject(`Re: ${t.subject}`)}>
                                Reply In This Chain
                              </Btn>
                            </div>
                          </div>
                        )}
                      </section>
                    )
                  })}
                  <div className="rounded-xl border border-line-strong bg-hover focus-within:border-mute">
                    <div className="flex items-center gap-2 border-b border-line px-3.5 py-2">
                      <span className="text-faint">To</span>
                      <span className="text-ink">{person.name}</span>
                      <span className="ml-auto">
                        <Menu
                          align="right"
                          width={180}
                          items={[
                            { heading: "Start From" },
                            ...s.templates.map((t) => ({
                              label: t.name,
                              onPick: () => {
                                setSubject(t.subject.replace("{{job}}", role.title))
                                setBody(t.body.replace("{{first_name}}", first).replace("{{job}}", role.title).replace("\n\n{{testbench_link}}", ""))
                              },
                            })),
                          ]}
                          trigger={() => <button className="rounded text-xs text-mute underline decoration-faint underline-offset-2 hover:text-ink">Template</button>}
                        />
                      </span>
                    </div>
                    <input
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Subject"
                      aria-label="Subject"
                      className="block w-full bg-transparent px-3.5 pt-2.5 font-medium text-ink outline-none placeholder:font-normal placeholder:text-faint"
                    />
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder={`Write to ${first}`}
                      aria-label="Message"
                      rows={4}
                      className="scroll-quiet block w-full resize-none bg-transparent px-3.5 pt-1.5 pb-2 leading-[1.55] text-body outline-none placeholder:text-faint"
                    />
                    <div className="flex justify-end px-2 pb-2">
                      <Btn
                        solid
                        disabled={!subject.trim() || !body.trim()}
                        onClick={() => {
                          s.sendEmail(id, { subject, body })
                          setSubject("")
                          setBody("")
                        }}
                      >
                        Send
                      </Btn>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
