import { useState, type ReactNode } from "react"
import { Check, ChevronDown, Circle, FileCheck, Inbox, Plus, RotateCcw } from "lucide-react"
import { STAFF, STAGES } from "../data"
import { COMPANY, ME, MEMBERS, OFFER_LABEL, type Offer } from "../org"
import { Btn, Empty, Header, Menu, label as small } from "../kit"
import { Person as Member, StatusIcon } from "../ui"
import { useStore } from "../store"
import { Rich, blanks, buildLetter, plain } from "./letter"
import { WinOver } from "./win"

/*
 * Offers: where an offer is written, signed off and sent for signature. The letter in the middle is
 * the company's own form, filled in from the offer, the candidate and the job; a blank it cannot
 * fill is a field on the right. Any clause can be rewritten for this offer. Once signed off it goes
 * out through DocuSign. get_offers, create_offer, update_offer, request_approval.
 */

type Group = "sign" | "draft" | "out" | "closed"
const GROUPS: { key: Group; label: string }[] = [
  { key: "sign", label: "Needs Your Sign-Off" },
  { key: "draft", label: "Drafts" },
  { key: "out", label: "Out For Signature" },
  { key: "closed", label: "Closed" },
]
const TODAY = "November 18, 2026"

/* A sheet of paper: always white, like the PDF it becomes */
function Sheet({ children }: { children: ReactNode }) {
  return <article className="mx-auto min-h-[min(1056px,129.4cqw)] w-full max-w-[816px] bg-white px-[72px] py-[72px] text-[14px] leading-[1.7] text-[#26262a] shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_10px_-2px_rgba(0,0,0,0.25)] @max-4xl:px-10 @max-4xl:py-12 @max-2xl:px-6 @max-2xl:py-8">{children}</article>
}
const Slot = ({ label }: { label: string }) => <span className="rounded bg-[#fff3c4] px-1.5 text-[#7a5b00]">{label}</span>

export function Offers({ scope }: { scope?: ReactNode }) {
  const s = useStore()
  const [page, setPage] = useState<"Letter" | "Attachment A">("Letter")
  const [rewriting, setRewriting] = useState<string | null>(null)
  const mine = s.flows.offer.includes(ME)
  const groupOf = (o: Offer): Group => (o.status === "draft" ? (o.approval === "pending" && mine ? "sign" : "draft") : o.status === "extended" ? "out" : "closed")
  const rows = Object.entries(s.offers)
    .map(([id, o]) => ({ id, o, p: s.personOf(id) }))
    .filter((x) => x.p && (!s.team || s.roleOf(x.p.role).team === s.team))
  const sel = rows.find((x) => x.id === s.offerId) ?? GROUPS.flatMap((g) => rows.filter((x) => groupOf(x.o) === g.key))[0]
  const waitingOnMe = rows.filter((x) => groupOf(x.o) === "sign").length
  const without = s.people.filter((p) => !p.closed && !s.offers[p.id] && (!s.team || s.roleOf(p.role).team === s.team)).sort((a, b) => b.stage - a.stage)

  const create = (id: string) => {
    s.setOffer(id, () => ({ salary: "", equity: "", start: "", status: "draft", approval: "none", grant: "option", benefits: true }), "Drafted an offer")
    s.setOfferId(id)
  }
  const add = (
    <Menu
      align="right"
      width={260}
      items={[{ heading: "Draft An Offer For" }, ...without.slice(0, 12).map((p) => ({ label: `${p.name}, ${STAGES[p.stage]}`, onPick: () => create(p.id) }))]}
      trigger={() => (
        <Btn>
          <Plus size={14} /> New
        </Btn>
      )}
    />
  )

  if (!sel) {
    return (
      <main className="@container my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-panel max-md:ml-2">
        <Header scope={scope} title="Offers" right={add} />
        <Empty icon={<FileCheck size={18} />} title="No offers yet">
          Draft one for someone in process. Its letter is written from your form and sent for signature from here.
        </Empty>
      </main>
    )
  }

  const { id, o, p } = sel
  const role = s.roleOf(p.role)
  const first = p.name.split(" ")[0]
  const set = (patch: Partial<Offer>, said: string) => s.setOffer(id, (old) => ({ ...old!, ...patch }), said)
  /* A draft can be changed until it is sent. Changing one that was signed off, or that is waiting on someone else, puts it back to needing sign-off, so nobody approves terms they did not see. */
  const reopens = o.approval === "approved" || (o.approval === "pending" && !mine)
  const quiet = (patch: Partial<Offer>) => {
    s.setOffers((all) => ({ ...all, [id]: { ...o, ...patch, ...(reopens && { approval: "none" as const }) } }))
    if (reopens) {
      s.log(id, { who: ME, text: "Changed the offer, so it needs sign-off again", when: "now" })
      s.setToast("Changed, so it needs sign-off again")
    }
  }
  const editable = o.status === "draft"
  const approver = STAFF[s.flows.offer[0]]
  const sent = o.status !== "draft"
  const signed = o.status === "accepted"
  const signedOff = o.approval === "approved" || sent
  const docusign = s.integrations.find((i) => i.id === "docusign")?.on ?? false

  /* The letter: every blank the app can fill is filled from what it already holds */
  const duties = o.duties ?? role.post?.body.filter((b) => b.kind === "li").slice(0, 3).map((b) => b.text.charAt(0).toLowerCase() + b.text.slice(1)).join("; ")
  const clauses = buildLetter({
    company: COMPANY.name, state: COMPANY.state, date: TODAY, name: p.name, first, address: o.address, title: o.title ?? role.title, supervisor: MEMBERS[role.manager]?.title, duties,
    salary: o.salary, period: o.period ?? "year", benefits: o.benefits ?? true, grant: o.grant ?? "option", shares: o.shares, plan: o.plan, expires: o.expires, start: o.start,
  })
  const edits = o.edits ?? {}
  const missing = [...blanks(clauses.filter((c) => !edits[c.key])), ...(o.address?.trim() ? [] : ["Employee address"])]

  const fields: [string, ReactNode][] = [
    ["Title", <Text key="t" value={o.title ?? role.title} placeholder={role.title} label="Title" on={editable} onChange={(v) => quiet({ title: v })} />],
    ["Duties", <Text key="d" value={duties ?? ""} placeholder="What they will do" label="Primary duties" on={editable} onChange={(v) => quiet({ duties: v })} />],
    ["Salary", <Text key="s" value={o.salary} placeholder="$180,000" label="Salary" on={editable} onChange={(v) => quiet({ salary: v })} />],
    ["Per", <Pick key="p" on={editable} value={o.period ?? "year"} options={[["year", "Year"], ["month", "Month"], ["hour", "Hour"]]} onChange={(v) => quiet({ period: v as Offer["period"] })} />],
    ["Start", <Text key="st" value={o.start} placeholder="January 5, 2027" label="Start date" on={editable} onChange={(v) => quiet({ start: v })} />],
    ["Expires", <Text key="e" value={o.expires ?? ""} placeholder="November 28, 2026" label="Offer expires" on={editable} onChange={(v) => quiet({ expires: v })} />],
    ["Benefits", <Pick key="b" on={editable} value={(o.benefits ?? true) ? "yes" : "no"} options={[["yes", "Included"], ["no", "Left Out"]]} onChange={(v) => quiet({ benefits: v === "yes" })} />],
    ["Grant", <Pick key="g" on={editable} value={o.grant ?? "option"} options={[["option", "Stock Option"], ["purchase", "Restricted Stock"], ["none", "No Equity"]]} onChange={(v) => quiet({ grant: v as Offer["grant"] })} />],
    ...((o.grant ?? "option") === "none"
      ? []
      : ([
          ["Shares", <Text key="sh" value={o.shares ?? ""} placeholder="40,000" label="Shares" on={editable} onChange={(v) => quiet({ shares: v })} />],
          ["Stake", <Text key="eq" value={o.equity} placeholder="0.25%" label="Stake" on={editable} onChange={(v) => quiet({ equity: v })} />],
          ["Plan", <Text key="pl" value={o.plan ?? ""} placeholder="2026 Stock Plan" label="Stock plan" on={editable} onChange={(v) => quiet({ plan: v })} />],
        ] as [string, ReactNode][])),
    ["Address", <Text key="a" value={o.address ?? ""} placeholder="Street, city, postcode" label="Employee address" on={editable} onChange={(v) => quiet({ address: v })} />],
  ]

  /* Sign-off, in order. Each step is done, current or still to come. */
  const env = o.envelope
  const steps: { name: string; who?: string; note: string; done: boolean; now: boolean }[] = [
    { name: "Drafted", who: o.askedBy ?? ME, note: "", done: true, now: false },
    ...s.flows.offer.map((m) => ({ name: "Approval", who: m, note: signedOff ? "Approved" : o.approval === "rejected" ? "Sent back" : o.approval === "pending" ? "Waiting" : "", done: signedOff, now: o.approval === "pending" })),
    { name: docusign ? "Sent Through DocuSign" : "Sent To The Candidate", note: sent ? (env?.sent ?? "Sent") : "", done: sent, now: o.status === "draft" && o.approval === "approved" },
    { name: "Signed", note: signed ? "Signed" : o.status === "declined" ? "Declined" : o.status === "withdrawn" ? "Withdrawn" : "", done: signed, now: o.status === "extended" },
  ]

  /* The one next step */
  const next: { say: string; actions: ReactNode } =
    o.status === "draft" && o.approval === "pending"
      ? mine
        ? {
            say: `${o.askedBy ? STAFF[o.askedBy].first : "Someone"} asked you to sign off`,
            actions: (
              <>
                <Btn className="h-8 px-3" onClick={() => set({ approval: "rejected" }, "Sent the offer back")}>
                  Send Back
                </Btn>
                <Btn
                  solid
                  className="h-8 px-3.5"
                  onClick={() => {
                    set({ approval: "approved" }, "Approved the offer")
                    s.setToast("Offer approved")
                  }}
                >
                  Sign Off
                </Btn>
              </>
            ),
          }
        : { say: `Waiting on ${approver.first} to sign off`, actions: null }
      : o.status === "draft" && o.approval === "approved"
        ? {
            say: missing.length ? `Fill ${missing.length === 1 ? "the last blank" : `${missing.length} blanks`} before it goes out: ${missing.join(", ")}` : docusign ? "Signed off. Ready to go out for signature." : "Signed off. DocuSign is off in Settings.",
            actions: (
              <Btn
                solid
                disabled={missing.length > 0}
                className="h-8 px-3.5"
                onClick={() => {
                  set({ status: "extended", envelope: { sent: "Nov 18", candidate: "sent" } }, docusign ? "Sent the offer through DocuSign" : "Sent the offer")
                  s.setToast(docusign ? `Sent to ${first} through DocuSign` : `Marked as sent to ${first}`)
                }}
              >
                {docusign ? "Send Through DocuSign" : `Mark As Sent`}
              </Btn>
            ),
          }
        : o.status === "draft"
          ? {
              say: o.approval === "rejected" ? `${approver.first} sent it back. Change the terms and ask again.` : missing.length ? `${missing.length} ${missing.length === 1 ? "blank" : "blanks"} left in the letter: ${missing.join(", ")}` : "The letter is complete. Ask for sign-off.",
              actions: (
                <Btn solid disabled={!o.salary.trim()} className="h-8 px-3.5" onClick={() => set({ approval: "pending", askedBy: ME }, "Asked for sign-off on the offer")}>
                  Request Sign-Off
                </Btn>
              ),
            }
          : o.status === "extended"
            ? {
                say: docusign ? `With ${first} in DocuSign, sent ${env?.sent ?? "today"}` : `With ${first} to sign`,
                actions: (
                  <>
                    <Btn className="h-8 px-3" onClick={() => set({ status: "declined", envelope: env && { ...env, candidate: "declined" } }, "Offer declined")}>
                      They Declined
                    </Btn>
                    <Btn
                      solid
                      className="h-8 px-3.5"
                      onClick={() => {
                        set({ status: "accepted", envelope: env && { ...env, candidate: "signed" } }, "Offer signed")
                        s.moveStage(id, { closed: "Hired" })
                      }}
                    >
                      They Signed
                    </Btn>
                  </>
                ),
              }
            : { say: OFFER_LABEL[o.status], actions: null }

  /* Clause numbers, worked out once: 1, 2, 3 for the headed clauses, then (a), (b) under Miscellaneous */
  const marks = clauses.reduce<{ num: string; misc?: number }[]>((out, c) => {
    const nums = out.filter((x) => /^\d/.test(x.num)).length + out.filter((x) => x.misc).length
    const subs = out.filter((x) => x.num.startsWith("(")).length
    if (c.sub) return [...out, { num: `(${String.fromCharCode(97 + subs)})`, misc: c.key === "law" ? nums + 1 : undefined }]
    return [...out, { num: c.head ? `${nums + 1}.` : "" }]
  }, [])
  return (
    <>
      <main className="@container my-2 mr-2 flex min-w-0 flex-1 overflow-hidden rounded-lg border border-line bg-panel max-md:ml-2">
        {/* The queue */}
        <div className="flex w-[208px] shrink-0 flex-col border-r border-line @max-7xl:hidden">
          <Header scope={scope} title="Offers" right={add} />
          <div className="scroll-quiet flex-1 overflow-y-auto p-1.5">
            {GROUPS.map((g) => {
              const group = rows.filter((x) => groupOf(x.o) === g.key)
              if (!group.length) return null
              return (
                <section key={g.key} className="mb-1.5">
                  <div className="flex h-8 items-center gap-2 px-3 text-xs text-faint">
                    {g.label} <span className="tabular-nums">{group.length}</span>
                  </div>
                  {group.map((x) => (
                    <button key={x.id} onClick={() => s.setOfferId(x.id)} className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${x.id === id ? "bg-raised" : "hover:bg-hover"}`}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">{x.p.name}</span>
                        <span className="block truncate text-mute">{s.roleOf(x.p.role).title}</span>
                      </span>

                    </button>
                  ))}
                </section>
              )
            })}
          </div>
        </div>

        {/* The letter, as it will be sent */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line pr-3 pl-5 text-mute">
            {/* The inbox of offers: a dropdown here whenever the list column has no room beside a full-size page */}
            <span className="shrink-0 @7xl:hidden">
              <Menu
                width={280}
                items={[
                  ...GROUPS.flatMap((g) => {
                    const group = rows.filter((x) => groupOf(x.o) === g.key)
                    return group.length ? [{ heading: `${g.label}, ${group.length}` }, ...group.map((x) => ({ label: `${x.p.name}${x.o.salary ? `, ${x.o.salary}` : ""}`, on: x.id === id, onPick: () => s.setOfferId(x.id) }))] : []
                  }),
                  "sep" as const,
                  { heading: "Draft An Offer For" },
                  ...without.slice(0, 6).map((w) => ({ label: `${w.name}, ${STAGES[w.stage]}`, onPick: () => create(w.id) })),
                ]}
                trigger={() => (
                  <button aria-label="All offers" className="-ml-2 flex h-7 items-center gap-1.5 rounded-md border border-line-strong px-2 text-ink transition-colors hover:bg-hover">
                    <Inbox size={14} className="text-mute" />
                    Offers
                    <span className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-medium tabular-nums ${waitingOnMe ? "bg-s-needs text-white" : "bg-raised text-mute"}`}>{waitingOnMe || rows.length}</span>
                    <ChevronDown size={13} className="text-faint" />
                  </button>
                )}
              />
            </span>
            <span className="mr-1 ml-1.5 min-w-0 truncate font-medium text-ink @7xl:ml-0">{p.name}</span>
            {(["Letter", "Attachment A"] as const).map((k) => (
              <button key={k} onClick={() => setPage(k)} aria-pressed={page === k} className={`h-7 shrink-0 rounded-md px-2.5 transition-colors ${page === k ? "bg-raised text-ink" : "text-mute hover:text-ink"}`}>
                {k}
              </button>
            ))}
            <span className="ml-auto shrink-0 rounded-md bg-raised px-1.5 py-px text-xs text-body">{o.status === "extended" && docusign ? "Out For Signature" : OFFER_LABEL[o.status]}</span>
          </div>
          <div key={`${id}${page}`} className="scroll-quiet @container min-h-0 flex-1 overflow-y-auto bg-well px-4 py-5 @max-2xl:px-3">
            <div className="anim-rise flex flex-col gap-4">
              {page === "Letter" ? (
                <>
                  <Sheet>
                    <div className="text-center text-[15px] font-bold tracking-[-0.01em] text-black">{COMPANY.name}</div>
                    <p className="mt-10">{TODAY}</p>
                    <p className="mt-6">
                      {p.name}
                      <br />
                      {o.address?.trim() ? o.address : <Slot label="Employee address" />}
                    </p>
                    <p className="mt-6">Dear {first}:</p>
                    {clauses.map((c, ci) => {
                      const mark = marks[ci]
                      const mine = edits[c.key]
                      return (
                        <div key={c.key}>
                          {mark.misc && (
                            <p className="mt-4">
                              <span className="mr-2">{mark.misc}.</span>
                              <span className="font-semibold text-black underline">Miscellaneous</span>.
                            </p>
                          )}
                          {rewriting === c.key ? (
                            <textarea
                              autoFocus
                              defaultValue={mine ?? plain(c.text)}
                              rows={Math.max(3, Math.ceil((mine ?? plain(c.text)).length / 78))}
                              aria-label={`Rewrite ${c.head ?? "this paragraph"}`}
                              onBlur={(e) => {
                                const v = e.target.value.trim()
                                if (v && v !== plain(c.text)) quiet({ edits: { ...edits, [c.key]: v } })
                                setRewriting(null)
                              }}
                              onKeyDown={(e) => e.key === "Escape" && setRewriting(null)}
                              className="doc-line mt-4 block w-full resize-none rounded bg-[#f4f6fb] px-2 py-1.5 text-[#26262a] outline-none"
                            />
                          ) : (
                            <p className={`group/c relative mt-4 ${c.sub ? "pl-8" : ""} ${editable ? "-mx-2 cursor-text rounded px-2 transition-colors hover:bg-[#f4f6fb]" : ""}`} onClick={() => editable && setRewriting(c.key)} title={editable ? "Click to rewrite" : undefined}>
                              {mark.num && <span className="mr-2">{mark.num}</span>}
                              {c.head && (
                                <>
                                  <span className="font-semibold text-black underline">{c.head}</span>.{" "}
                                </>
                              )}
                              {mine ?? <Rich text={c.text} />}
                              {mine && editable && (
                                <button
                                  aria-label="Back to the form's wording"
                                  title="Back to the form's wording"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    const rest = { ...edits }
                                    delete rest[c.key]
                                    quiet({ edits: rest })
                                  }}
                                  className="absolute top-0.5 -right-6 text-[#9a9aa2] opacity-0 transition-opacity group-hover/c:opacity-100 hover:text-black focus-visible:opacity-100"
                                >
                                  <RotateCcw size={13} />
                                </button>
                              )}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </Sheet>
                  <Sheet>
                    <p>Very truly yours,</p>
                    <p className="mt-4 font-semibold text-black">{COMPANY.name}</p>
                    <div className="mt-6 grid max-w-[340px] grid-cols-[64px_minmax(0,1fr)] items-end gap-y-3">
                      <span>By:</span>
                      <span className="flex h-8 items-end border-b border-[#bdbdc4] pb-0.5 font-semibold text-black italic">{signedOff && approver.name}</span>
                      <span>Name:</span>
                      <span className="border-b border-[#bdbdc4] pb-0.5">{approver.name}</span>
                      <span>Title:</span>
                      <span className="border-b border-[#bdbdc4] pb-0.5">{MEMBERS[approver.id]?.title}</span>
                    </div>
                    <p className="mt-10 font-semibold text-black">ACCEPTED AND AGREED:</p>
                    <div className="mt-4 grid max-w-[340px] grid-cols-[64px_minmax(0,1fr)] items-end gap-y-3">
                      <span>Name:</span>
                      <span className="border-b border-[#bdbdc4] pb-0.5">{p.name}</span>
                      <span>Signed:</span>
                      <span className="flex h-8 items-end border-b border-[#bdbdc4] pb-0.5 font-semibold text-black italic">{signed && p.name}</span>
                      <span>Date:</span>
                      <span className="h-6 border-b border-[#bdbdc4] pb-0.5">{signed && TODAY}</span>
                    </div>
                    <p className="mt-8">Anticipated Start Date: {o.start.trim() ? <span className="font-semibold text-black">{o.start}</span> : <Slot label="Start date" />}</p>
                    <p className="mt-6 text-[#77777f]">Attachment A: Confidential Information and Invention Assignment Agreement</p>
                  </Sheet>
                </>
              ) : (
                <Sheet>
                  <div className="text-center font-semibold text-black">ATTACHMENT A</div>
                  <div className="mt-2 text-center font-semibold text-black">CONFIDENTIAL INFORMATION AND INVENTION ASSIGNMENT AGREEMENT</div>
                  <p className="mt-10 text-center text-[#77777f]">Your company's standard agreement goes out with the letter. It has not been added here yet.</p>
                </Sheet>
              )}
            </div>
          </div>

          {/* The bar under the letter: where it stands, and the one next step */}
          <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-t border-line px-5 py-2.5">
            <span className="min-w-0 flex-1 text-ink">{next.say}</span>
            {o.status === "draft" || o.status === "extended" ? (
              <Btn className="h-8 border-transparent px-3 text-mute" onClick={() => set({ status: "withdrawn" }, "Withdrew the offer")}>
                Withdraw
              </Btn>
            ) : null}
            {next.actions}
          </div>
        </div>
      </main>

      {/* What fills the letter, who has signed off, and what would win them */}
      <aside className="scroll-quiet my-2 mr-2 hidden w-[300px] shrink-0 overflow-y-auto rounded-lg border border-line bg-panel xl:block">
        <div key={id} className="anim-rise px-5 py-5">
          <button onClick={() => s.openProfile(id)} className="block max-w-full truncate text-left text-[15px] font-semibold tracking-[-0.01em] text-ink hover:underline">
            {p.name}
          </button>
          <div className="truncate text-mute">{o.title || role.title}</div>

          <div className={`${small} mt-6 flex items-center`}>
            <span className="flex-1">Fills The Letter</span>
            {missing.length > 0 && <span className="text-ink tabular-nums">{missing.length} left</span>}
          </div>
          <dl data-tour="offer-fields" className="overflow-hidden rounded-lg border border-line-strong">
            {fields.map(([name, input]) => (
              <div key={name} className="flex h-10 items-center gap-3 border-b border-line px-3.5 last:border-b-0">
                <dt className="w-16 shrink-0 text-mute">{name}</dt>
                <dd className="min-w-0 flex-1">{input}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs leading-[1.5] text-faint">{editable ? `Name, manager, date and signer are filled in for you. Click any paragraph of the letter to rewrite it.${reopens ? " A change now sends it back for sign-off." : ""}` : "The letter is locked once it is out for signature."}</p>

          <div className={`${small} mt-7`}>Sign-Off</div>
          <ol>
            {steps.map((st, i) => (
              <li key={i} className="flex h-9 items-center gap-2.5">
                {st.done ? <Check size={14} className="shrink-0 text-s-scheduled" /> : st.now ? <StatusIcon status="needs" /> : <Circle size={13} className="shrink-0 text-faint" />}
                <span className={`min-w-0 flex-1 truncate ${st.done || st.now ? "text-ink" : "text-mute"}`}>{st.name}</span>
                {st.note && <span className="text-xs text-faint">{st.note}</span>}
                {st.who && <Member id={st.who} size={18} />}
              </li>
            ))}
          </ol>

          <div className="@container mt-7 border-t border-line pt-6">
            <WinOver id={id} />
          </div>
        </div>
      </aside>
    </>
  )
}

/* A field of the letter you type into */
function Text({ value, placeholder, label, on, onChange }: { value: string; placeholder: string; label: string; on: boolean; onChange: (v: string) => void }) {
  return <input value={value} disabled={!on} placeholder={placeholder} aria-label={label} onChange={(e) => onChange(e.target.value)} className="w-full bg-transparent text-ink outline-none placeholder:text-faint disabled:text-body" />
}
/* A field of the letter with a few fixed answers */
function Pick({ value, options, on, onChange }: { value: string; options: [string, string][]; on: boolean; onChange: (v: string) => void }) {
  const shown = options.find((x) => x[0] === value)?.[1] ?? value
  if (!on) return <span className="text-body">{shown}</span>
  return <Menu width={180} items={options.map(([k, name]) => ({ label: name, on: k === value, onPick: () => onChange(k) }))} trigger={() => <button className="-mx-1.5 rounded px-1.5 text-left text-ink hover:bg-hover">{shown}</button>} />
}
