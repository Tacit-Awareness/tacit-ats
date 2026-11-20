import { useState, type ReactNode } from "react"
import { THEMES } from "../types"
import { Check, ChevronDown, Copy, FileText, Plus, X } from "lucide-react"
import { STAFF, TEAMS } from "../data"
import { Person as Member } from "../ui"
import { Btn, Empty, Header, Menu, Segmented, TeamTile, Toggle, heading } from "../kit"
import { ACCESS, ACCESS_LABEL, CONNECTOR_URL, ME, MEMBERS, PREFERENCE_LABEL, REPORTS, type Access, type Preference } from "../org"
import { useStore } from "../store"

import { SETTINGS_SECTIONS } from "./command"

/* ---------------- Settings: the company's setup, out of the way ---------------- */

/* One row of a settings list */
function Line({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex min-h-12 items-center gap-3 border-b border-line px-1 py-2 last:border-b-0 ${className}`}>{children}</div>
}
function Group({ title: heading, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mt-9 first:mt-0">
      <div className="mb-2 flex items-baseline gap-3">
        <h3 className={heading}>{heading}</h3>
        {hint && <span className="text-mute">{hint}</span>}
      </div>
      <div className="rounded-xl border border-line-strong px-3">{children}</div>
    </section>
  )
}
/* A list of plain names you can add to and remove from */
function Names({ items, onChange, placeholder }: { items: string[]; onChange: (next: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("")
  const add = () => {
    const v = draft.trim()
    if (v && !items.includes(v)) onChange([...items, v])
    setDraft("")
  }
  return (
    <>
      {items.map((x) => (
        <Line key={x} className="group min-h-10">
          <span className="min-w-0 flex-1 truncate text-ink">{x}</span>
          <button aria-label={`Remove ${x}`} onClick={() => onChange(items.filter((y) => y !== x))} className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100">
            <X size={14} />
          </button>
        </Line>
      ))}
      <Line className="min-h-10">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-7 min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint"
        />
        {draft.trim() && <Btn onClick={add}>Add</Btn>}
      </Line>
    </>
  )
}
const Pick = ({ children }: { children: ReactNode }) => (
  <button className="flex h-7 items-center gap-1.5 rounded-md px-2 text-body transition-colors hover:bg-hover">
    {children}
    <ChevronDown size={13} className="text-faint" />
  </button>
)

export function SettingsView() {
  const s = useStore()
  const sec = s.settings
  const [invite, setInvite] = useState("")
  const [inviteAs, setInviteAs] = useState<Access>("interviewer")
  const [tpl, setTpl] = useState(s.templates[0].id)
  const [fieldName, setFieldName] = useState("")
  const [copied, setCopied] = useState(false)
  const template = s.templates.find((t) => t.id === tpl) ?? s.templates[0]
  const editTpl = (patch: Partial<typeof template>) => s.setTemplates((all) => all.map((t) => (t.id === template.id ? { ...t, ...patch } : t)))
  const staff = Object.values(STAFF)
  const sendInvite = () => {
    const e = invite.trim()
    if (!e.includes("@")) return
    s.setInvites((all) => [...all, { email: e, access: inviteAs, sent: "now" }])
    setInvite("")
    s.setToast("Invitation sent")
  }

  return (
    <main className="@container my-2 mr-2 flex min-w-0 flex-1 overflow-hidden rounded-lg border border-line bg-panel max-md:ml-2">
      <nav className="scroll-quiet flex w-[200px] shrink-0 flex-col gap-px overflow-y-auto border-r border-line p-2 @max-2xl:hidden">
        <div className="flex h-9 items-center px-2.5 font-medium text-ink">Settings</div>
        {SETTINGS_SECTIONS.map((x) => (
          <button key={x} onClick={() => s.setSettings(x)} aria-current={sec === x} className={`flex h-7 items-center rounded-md px-2.5 text-left transition-colors ${sec === x ? "bg-raised text-ink" : "text-body hover:bg-hover"}`}>
            {x}
          </button>
        ))}
      </nav>

      <div key={sec} className="scroll-quiet anim-rise min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[640px] px-8 py-9 @max-2xl:px-5">
          <div className="mb-7 flex items-center gap-3">
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{sec}</h2>
            <span className="@2xl:hidden">
              <Menu width={180} items={SETTINGS_SECTIONS.map((x) => ({ label: x, on: x === sec, onPick: () => s.setSettings(x) }))} trigger={() => <Pick>Section</Pick>} />
            </span>
          </div>

          {sec === "General" && (
            <>
              <Group title="Workspace">
                <Line>
                  <span className="flex-1 text-body">Name</span>
                  <span className="text-ink">Tacit</span>
                </Line>
                <Line>
                  <span className="flex-1 text-body">Signed In As</span>
                  <span className="flex items-center gap-2 text-ink">
                    <Member id={ME} size={18} />
                    {STAFF[ME].name}
                    <span className="text-mute">{ACCESS_LABEL[MEMBERS[ME].access]}</span>
                  </span>
                </Line>
              </Group>
              <Group title="Appearance">
                <Line>
                  <span className="flex-1 text-body">Theme</span>
                  <Segmented label="Theme" value={s.theme} onChange={s.setTheme} options={THEMES.map((t) => ({ key: t.key, label: t.name, hint: t.means }))} />
                </Line>
              </Group>
            </>
          )}

          {sec === "Members" && (
            <>
              <Group title="People">
                {staff.map((m) => (
                  <Line key={m.id}>
                    <Member id={m.id} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ink">{m.name}</span>
                      <span className="block truncate text-xs text-mute">
                        {MEMBERS[m.id].title} <span className="ml-1.5 text-faint">{MEMBERS[m.id].email}</span>
                      </span>
                    </span>
                    <Menu
                      align="right"
                      width={170}
                      items={ACCESS.map((a) => ({
                        label: ACCESS_LABEL[a],
                        on: MEMBERS[m.id].access === a,
                        onPick: () => {
                          MEMBERS[m.id].access = a
                          s.touch()
                        },
                      }))}
                      trigger={() => <Pick>{ACCESS_LABEL[MEMBERS[m.id].access]}</Pick>}
                    />
                  </Line>
                ))}
              </Group>
              <Group title="Invitations">
                {s.invites.map((i) => (
                  <Line key={i.email}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ink">{i.email}</span>
                      <span className="block text-xs text-mute">
                        {ACCESS_LABEL[i.access]}, sent {i.sent}
                      </span>
                    </span>
                    <Btn onClick={() => s.setInvites((all) => all.filter((x) => x.email !== i.email))}>Withdraw</Btn>
                  </Line>
                ))}
                <Line>
                  <input
                    value={invite}
                    onChange={(e) => setInvite(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendInvite()}
                    placeholder="Invite by email"
                    aria-label="Invite by email"
                    className="h-7 min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint"
                  />
                  <Menu align="right" width={170} items={ACCESS.map((a) => ({ label: ACCESS_LABEL[a], on: inviteAs === a, onPick: () => setInviteAs(a) }))} trigger={() => <Pick>{ACCESS_LABEL[inviteAs]}</Pick>} />
                  <Btn solid disabled={!invite.includes("@")} onClick={sendInvite}>
                    Invite
                  </Btn>
                </Line>
              </Group>
            </>
          )}

          {sec === "Rounds" && (
            <Group title="Interview Rounds" hint="The blocks on Tickets, in this order">
              <Names items={s.rounds} onChange={s.setRounds} placeholder="Add a round" />
              <div className="mt-4 flex gap-1.5">
                <Btn solid onClick={() => s.setSheet({ kind: "rounds" })}>
                  Open The Builder
                </Btn>
                <Btn onClick={() => s.setSheet({ kind: "rounds", ask: true })}>Ask Claude</Btn>
              </div>
            </Group>
          )}

          {sec === "Interviewers" && (
            <Group title="Interview Load" hint="What the bot and find-a-time respect">
              {staff.map((m) => (
                <Line key={m.id} className="flex-wrap">
                  <Member id={m.id} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{m.name}</span>
                    <span className="block truncate text-xs text-mute">{m.focus.join(", ")}</span>
                  </span>
                  <Menu
                    align="right"
                    width={150}
                    items={(Object.keys(PREFERENCE_LABEL) as Preference[]).map((p) => ({
                      label: PREFERENCE_LABEL[p],
                      on: MEMBERS[m.id].preference === p,
                      onPick: () => {
                        MEMBERS[m.id].preference = p
                        s.touch()
                      },
                    }))}
                    trigger={() => <Pick>{PREFERENCE_LABEL[MEMBERS[m.id].preference]}</Pick>}
                  />
                  <Menu
                    align="right"
                    width={150}
                    items={[
                      {
                        label: "No Limit",
                        on: m.cap === null,
                        onPick: () => {
                          m.cap = null
                          s.touch()
                        },
                      },
                      ...[2, 3, 4, 5, 6].map((n) => ({
                        label: `${n} a week`,
                        on: m.cap === n,
                        onPick: () => {
                          m.cap = n
                          s.touch()
                        },
                      })),
                    ]}
                    trigger={() => (
                      <Pick>
                        <span className={m.cap !== null && m.load >= m.cap ? "text-bad" : ""}>{m.cap === null ? `${m.load} this week` : `${m.load} of ${m.cap}`}</span>
                      </Pick>
                    )}
                  />
                  <Menu
                    align="right"
                    width={170}
                    items={[
                      {
                        label: "Here",
                        on: !m.awayUntil,
                        onPick: () => {
                          m.awayUntil = undefined
                          s.touch()
                        },
                      },
                      ...["Nov 24", "Dec 1", "Dec 8"].map((d) => ({
                        label: `Away through ${d}`,
                        on: m.awayUntil === d,
                        onPick: () => {
                          m.awayUntil = d
                          s.touch()
                        },
                      })),
                    ]}
                    trigger={() => <Pick>{m.awayUntil ? `Away to ${m.awayUntil}` : "Here"}</Pick>}
                  />
                </Line>
              ))}
            </Group>
          )}

          {sec === "Teams" && (
            <>
              <Group title="Departments">
                {TEAMS.map((t) => (
                  <Line key={t.id} className="min-h-10">
                    <TeamTile id={t.id} />
                    <span className="flex-1 text-ink">{t.name}</span>
                    <span className="text-xs text-faint tabular-nums">{s.roles.filter((r) => r.team === t.id).length} asks</span>
                  </Line>
                ))}
              </Group>
              <Group title="Offices">
                <Names items={s.offices} onChange={s.setOffices} placeholder="Add an office" />
              </Group>
            </>
          )}

          {sec === "Templates" && (
            <Group title="Email Templates" hint="Starters for replies to candidates">
              <Line className="gap-1">
                {s.templates.map((t) => (
                  <button key={t.id} onClick={() => setTpl(t.id)} className={`h-7 rounded-md px-2.5 transition-colors ${t.id === template.id ? "bg-raised text-ink" : "text-mute hover:text-ink"}`}>
                    {t.name || "Untitled"}
                  </button>
                ))}
                <button
                  aria-label="New template"
                  onClick={() => {
                    const id = `t${Date.now()}`
                    s.setTemplates((all) => [...all, { id, name: "New", subject: "", body: "" }])
                    setTpl(id)
                  }}
                  className="flex size-7 items-center justify-center rounded-md text-mute hover:bg-hover hover:text-ink"
                >
                  <Plus size={14} />
                </button>
              </Line>
              <div className="py-3">
                <label className="flex items-center gap-3 px-1">
                  <span className="w-14 shrink-0 text-mute">Name</span>
                  <input value={template.name} onChange={(e) => editTpl({ name: e.target.value })} aria-label="Template name" className="min-w-0 flex-1 bg-transparent text-ink outline-none" />
                </label>
                <label className="mt-2.5 flex items-center gap-3 border-b border-line px-1 pb-3">
                  <span className="w-14 shrink-0 text-mute">Subject</span>
                  <input value={template.subject} onChange={(e) => editTpl({ subject: e.target.value })} aria-label="Subject" className="min-w-0 flex-1 bg-transparent text-ink outline-none" />
                </label>
                <textarea
                  value={template.body}
                  onChange={(e) => editTpl({ body: e.target.value })}
                  aria-label="Body"
                  placeholder="Body"
                  rows={7}
                  className="scroll-quiet mt-2 block w-full resize-none bg-transparent px-1 leading-[1.55] text-body outline-none placeholder:text-faint"
                />
              </div>
            </Group>
          )}

          {sec === "Labels" && (
            <>
              <Group title="Tags">
                <Names items={s.tags} onChange={s.setTags} placeholder="Add a tag" />
              </Group>
              <Group title="Pools" hint="Where prospects are kept">
                <Names items={s.pools} onChange={s.setPools} placeholder="Add a pool" />
              </Group>
              <Group title="Rejection Reasons">
                <Names items={s.reasons} onChange={s.setReasons} placeholder="Add a reason" />
              </Group>
            </>
          )}

          {sec === "Fields" && (
            <Group title="Custom Fields">
              {s.fields.map((f) => (
                <Line key={f.id} className="group min-h-10">
                  <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
                  <span className="text-mute">{f.type}</span>
                  <span className="w-20 text-right text-faint">{f.on}</span>
                  <button
                    aria-label={`Remove ${f.name}`}
                    onClick={() => s.setFields((all) => all.filter((x) => x.id !== f.id))}
                    className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100"
                  >
                    <X size={14} />
                  </button>
                </Line>
              ))}
              <Line className="min-h-10">
                <input
                  value={fieldName}
                  onChange={(e) => setFieldName(e.target.value)}
                  placeholder="Add a field"
                  aria-label="Add a field"
                  className="h-7 min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && fieldName.trim()) {
                      s.setFields((all) => [...all, { id: `f${Date.now()}`, name: fieldName.trim(), type: "Text", on: "Candidate" }])
                      setFieldName("")
                    }
                  }}
                />
              </Line>
            </Group>
          )}

          {sec === "Approvals" && (
            <Group title="Who Approves" hint="Asked in order">
              {(
                [
                  ["offer", "An Offer"],
                  ["job_open", "Opening a Job"],
                ] as const
              ).map(([k, name]) => (
                <Line key={k}>
                  <span className="flex-1 text-body">{name}</span>
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {staff
                      .filter((m) => MEMBERS[m.id].access !== "interviewer")
                      .map((m) => {
                        const on = s.flows[k].includes(m.id)
                        return (
                          <button
                            key={m.id}
                            aria-pressed={on}
                            onClick={() => s.setFlows((f) => ({ ...f, [k]: on ? f[k].filter((x) => x !== m.id) : [...f[k], m.id] }))}
                            className={`flex h-7 items-center gap-1.5 rounded-full border pr-2.5 pl-1 transition-colors ${on ? "border-ink text-ink" : "border-line-strong text-mute hover:text-ink"}`}
                          >
                            <Member id={m.id} size={18} /> {m.first}
                          </button>
                        )
                      })}
                  </span>
                </Line>
              ))}
            </Group>
          )}

          {sec === "Integrations" && (
            <Group title="Connected">
              {s.integrations.map((i) => (
                <Line key={i.id}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-ink">{i.name}</span>
                    <span className="block truncate text-xs text-mute">{i.on ? i.detail : "Off"}</span>
                  </span>
                  {i.id === "bot" && i.on && <Btn onClick={() => s.setToast("Grokbot answered")}>Verify</Btn>}
                  <Toggle label={i.name} on={i.on} onChange={(on) => s.setIntegrations((all) => all.map((x) => (x.id === i.id ? { ...x, on } : x)))} />
                </Line>
              ))}
            </Group>
          )}

          {sec === "Connector" && (
            <>
              <Group title="Connect Claude Or Your Bot" hint="Every action here is also a tool">
                <Line>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{CONNECTOR_URL}</span>
                  <Btn
                    onClick={() => {
                      void navigator.clipboard?.writeText(CONNECTOR_URL).catch(() => {})
                      setCopied(true)
                      window.setTimeout(() => setCopied(false), 1400)
                    }}
                  >
                    {copied ? (
                      <>
                        <Check size={13} /> Copied
                      </>
                    ) : (
                      <>
                        <Copy size={13} /> Copy
                      </>
                    )}
                  </Btn>
                </Line>
              </Group>
              <Group title="Who Can Use It">
                {ACCESS.map((a) => (
                  <Line key={a}>
                    <span className="flex-1 text-body">{ACCESS_LABEL[a]}</span>
                    <Toggle label={ACCESS_LABEL[a]} on={s.connector[a]} onChange={(on) => s.setConnector((c) => ({ ...c, [a]: on }))} />
                  </Line>
                ))}
              </Group>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

/* ---------------- Insights: the reports, as plain bars ---------------- */

/* One report: a name, a bar and a number per row. `unit` rides on the number ("31d"); a row's own note sits before it */
function Bars({ title: heading, rows, total, unit = "" }: { title: string; rows: [string, number, string?][]; total?: number; unit?: string }) {
  const max = total ?? Math.max(...rows.map((r) => r[1]), 1)
  return (
    <section className="rounded-xl border border-line-strong px-4 pt-3.5 pb-4">
      <h3 className={heading}>{heading}</h3>
      <div className="mt-3.5 flex flex-col gap-3">
        {rows
          .filter((r) => r[1] > 0)
          .map(([name, value, note]) => (
            <div key={name}>
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-body">{name}</span>
                {note && <span className="text-xs text-faint">{note}</span>}
                <span className="w-9 text-right text-ink tabular-nums">
                  {value}
                  {unit}
                </span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-raised">
                <div className="h-full rounded-full bg-mute" style={{ width: `${Math.max((value / max) * 100, 2)}%` }} />
              </div>
            </div>
          ))}
      </div>
    </section>
  )
}

export function Insights() {
  const [tab, setTab] = useState("Overview")
  const [range, setRange] = useState<"30d" | "90d">("30d")
  const r = REPORTS[range]
  const staff = Object.values(STAFF)
  const posts = useStore().roles.filter((x) => x.post && x.post.status !== "draft").sort((a, b) => b.post!.applications - a.post!.applications)
  const stats: [string, string | number][] = [
    ["Applied", r.funnel[0][1]],
    ["Hired", r.funnel[4][1]],
    ["Time To Hire", `${Math.round(r.hire.reduce((a, b) => a + b[1], 0) / r.hire.length)}d`],
    ["Offers Accepted", `${Math.round((r.offers[1][1] / r.offers[0][1]) * 100)}%`],
  ]
  return (
    <main className="@container my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-panel max-md:ml-2">
      <Header
        title="Insights"
        tabs={["Overview", "Outcomes", "Job Posts"]}
        tab={tab}
        setTab={setTab}
        right={
          <Segmented
            label="Range"
            value={range}
            onChange={setRange}
            options={[
              { key: "30d", label: "30 Days" },
              { key: "90d", label: "90 Days" },
            ]}
          />
        }
      />
      <div className="scroll-quiet flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[880px] px-6 py-6">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line-strong bg-line @2xl:grid-cols-4">
            {stats.map(([k, v]) => (
              <div key={k} className="bg-panel px-4 py-3.5">
                <div className="text-mute">{k}</div>
                <div className={`mt-1 ${heading} tabular-nums`}>{v}</div>
              </div>
            ))}
          </div>
          <div key={range + tab} className="anim-rise mt-3 grid grid-cols-1 gap-3 @2xl:grid-cols-2">
            {tab === "Overview" ? (
              <>
                <Bars title="Pipeline" rows={r.funnel} />
                <Bars title="Sources" rows={r.sources} />
                <Bars title="Time To Hire" rows={r.hire.map(([n, v]) => [n, v])} unit="d" />
                <Bars title="Interviewer Load" rows={staff.map((m) => [m.name, m.load, m.cap === null ? "no limit" : `of ${m.cap}`])} total={6} />
              </>
            ) : tab === "Job Posts" ? (
              <section className="overflow-hidden rounded-xl border border-line-strong @2xl:col-span-2">
                <div className="grid h-9 grid-cols-[minmax(0,1fr)_72px_72px_72px] items-center gap-3 border-b border-line px-4 text-xs text-faint">
                  <span>Role</span>
                  <span className="text-right">Views</span>
                  <span className="text-right">Applied</span>
                  <span className="text-right">Rate</span>
                </div>
                {posts.map((x) => (
                  <div key={x.id} className="grid h-10 grid-cols-[minmax(0,1fr)_72px_72px_72px] items-center gap-3 border-b border-line px-4 tabular-nums last:border-b-0">
                    <span className="truncate text-ink">
                      {x.title || "Untitled"}
                      {x.post!.status === "closed" && <span className="ml-2 text-faint">Closed</span>}
                    </span>
                    <span className="text-right text-body">{x.post!.views}</span>
                    <span className="text-right text-body">{x.post!.applications}</span>
                    <span className="text-right text-mute">{x.post!.views ? `${Math.round((x.post!.applications / x.post!.views) * 100)}%` : ""}</span>
                  </div>
                ))}
                {!posts.length && (
                  <Empty icon={<FileText size={18} />} title="No live posts">
                    Views and applications appear here once a post goes live.
                  </Empty>
                )}
              </section>
            ) : (
              <>
                <Bars title="Offers" rows={r.offers} />
                <Bars title="Rejections" rows={r.rejections} />
                <section className="rounded-xl border border-line-strong px-4 pt-3.5 pb-4 @2xl:col-span-2">
                  <h3 className={heading}>Equal Opportunity</h3>
                  <p className="mt-2 text-body">
                    {r.eeo[0][1]} {r.eeo[0][2]} applicants answered, {r.eeo[1][1]} declined to say. Totals only; any group under 5 is hidden.
                  </p>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
