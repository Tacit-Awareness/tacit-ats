import { useRef, useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight, Circle, CircleUser, FileText, Link2, Plus, Target, Upload, X } from "lucide-react"
import { STAFF, TEAMS, type JobPost, type Role } from "../data"
import { Person as Member, StatusIcon } from "../ui"
import { Btn, Empty, Header, Menu, Segmented, TeamTile, loadOf, teamOf, heading } from "../kit"
import { ME } from "../org"
import { useStore } from "../store"
import { DocEditor, DocView, Lines, hasText, parseDoc } from "./doc"

/*
 * Asks: the job board, as an applicant sees it, with the hiring side one click behind it.
 * The list is the careers page. A role opens as its public post (Overview, Application), and
 * Internal holds what only the team sees: who is hiring, what they look for, how they interview.
 */

const BLANK: JobPost = { status: "draft", applications: 0, views: 0, questions: ["Resume", "LinkedIn"], body: [] }
const POST_LABEL = { draft: "Draft", live: "Live", closed: "Closed" } as const
const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "untitled"

export function Asks({ scope }: { scope?: ReactNode }) {
  const s = useStore()
  const roles = s.roles.filter((r) => !s.team || r.team === s.team)
  const [sel, setSel] = useState<string | null>(s.askId)
  const [shut, setShut] = useState<string[]>([])
  const role = roles.find((r) => r.id === sel)
  const groups = TEAMS.filter((t) => !s.team || t.id === s.team)
    .map((t) => ({ team: t, rows: roles.filter((r) => r.team === t.id) }))
    .filter((g) => g.rows.length)

  /* create_job, then create_job_post: a new role starts as a draft nobody outside can see */
  const create = (team?: string) => {
    const id = `r${Date.now()}`
    s.setRoles((rs) => [...rs, { id, team: team ?? s.team ?? TEAMS[0].id, title: "", manager: ME, open: 1, filled: 0, plan: ["Recruiter Screen", "Round 2", "Onsite"], scorecard: [], office: s.offices[0], team_members: [], post: BLANK }])
    setSel(id)
  }

  if (role) return <RolePage role={role} scope={scope} onBack={() => {
          setSel(null)
          s.setAskId(null)
        }}
      />

  return (
    <>
      <Header
        scope={scope}
        title="Listings & Asks"
        right={
          <Btn
            onClick={() => {
              void navigator.clipboard?.writeText("https://tacit.example/jobs").catch(() => {})
              s.setToast("Careers page link copied")
            }}
          >
            <Link2 size={13} className="text-mute" /> Careers Page
          </Btn>
        }
      />
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        {!groups.length ? (
          <Empty
            icon={<Target size={18} />}
            title="No roles yet"
            action={
              <Btn solid onClick={() => create()}>
                <Plus size={14} /> Add A Role
              </Btn>
            }
          >
            A role is what a hiring manager is asking for. Add one and it becomes a draft post on your careers page.
          </Empty>
        ) : (
          <div className="mx-auto max-w-[820px] px-8 pt-14 pb-16 @max-2xl:px-5 @max-2xl:pt-9">
            <h2 className="text-center text-[34px] leading-tight font-semibold tracking-[-0.03em] text-ink @max-2xl:text-[26px]">Careers at Tacit</h2>
            <div className="mt-10 flex justify-end">
              <button onClick={() => create()} className="flex h-8 items-center gap-1.5 rounded-md px-2 text-mute transition-colors hover:bg-hover hover:text-ink">
                <Plus size={14} /> Add A Role
              </button>
            </div>
            <div className="mt-1 border-t border-line">
              {groups.map(({ team, rows }) => {
                const open = !shut.includes(team.id)
                return (
                  <section key={team.id}>
                    <div className="group flex h-12 items-center border-b border-line pr-1">
                      <button
                        aria-expanded={open}
                        onClick={() => setShut(open ? [...shut, team.id] : shut.filter((x) => x !== team.id))}
                        className="-ml-1 flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-md pl-1 text-left"
                      >
                        <ChevronDown size={14} className={`shrink-0 text-faint transition-transform ${open ? "" : "-rotate-90"}`} />
                        <TeamTile id={team.id} />
                        <span className="truncate font-medium text-ink">{team.name}</span>
                        <span className="text-faint tabular-nums">{rows.length}</span>
                      </button>
                      <button
                        aria-label={`Add a role to ${team.name}`}
                        title="Add A Role"
                        onClick={() => create(team.id)}
                        className="flex size-7 items-center justify-center rounded-md text-mute opacity-0 transition group-hover:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100"
                      >
                        <Plus size={15} />
                      </button>
                    </div>
                    {open &&
                      rows.map((r) => {
                        const active = s.people.filter((p) => p.role === r.id && !p.closed).length
                        const state = r.closed ? "Closed" : r.post?.status === "live" ? null : POST_LABEL[r.post?.status ?? "draft"]
                        return (
                          <button key={r.id} onClick={() => setSel(r.id)} className="flex h-[52px] w-full items-center gap-3 border-b border-line pr-2 pl-8 text-left transition-colors hover:bg-hover">
                            <FileText size={15} className="shrink-0 text-faint" />
                            <span className={`min-w-0 flex-1 truncate font-medium ${r.title ? "text-ink" : "text-faint"}`}>{r.title || "Untitled"}</span>
                            {state && <span className="shrink-0 rounded-md bg-raised px-1.5 py-px text-xs text-mute">{state}</span>}
                            <span className="w-[120px] shrink-0 text-mute tabular-nums @max-2xl:hidden">{active > 0 && `${active} in pipeline`}</span>
                            <span className="w-[120px] shrink-0 truncate text-mute @max-xl:hidden">{r.office}</span>
                          </button>
                        )
                      })}
                  </section>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

/* A row you can remove, used by every editable list on the page */
function Item({ children, onRemove, name }: { children: ReactNode; onRemove?: () => void; name: string }) {
  return (
    <li className="group -mx-2 flex min-h-9 items-center gap-3 rounded-md px-2 hover:bg-hover">
      {children}
      {onRemove && (
        <button aria-label={`Remove ${name}`} onClick={onRemove} className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100">
          <X size={14} />
        </button>
      )}
    </li>
  )
}

const h3 = `mt-10 mb-3 ${heading}`
const quiet = "-mx-1.5 rounded-md px-1.5 text-left text-mute transition-colors hover:bg-hover hover:text-ink"

type Mode = "edit" | "preview"
type Tab = "Overview" | "Application" | "Internal"

function RolePage({ role, scope, onBack }: { role: Role; scope?: ReactNode; onBack: () => void }) {
  const s = useStore()
  const [mode, setMode] = useState<Mode>("edit")
  const [picked, setTab] = useState<Tab>("Overview")
  const editing = mode === "edit"
  const tab = !editing && picked === "Internal" ? "Overview" : picked
  const post = role.post ?? BLANK
  const edit = (fn: (r: Role) => Role) => s.patchRole(role.id, fn)
  const editPost = (patch: Partial<JobPost>) => edit((r) => ({ ...r, post: { ...(r.post ?? BLANK), ...patch } }))
  const staff = Object.values(STAFF)
  const team = [role.manager, ...(role.team_members ?? [])]
  const url = `tacit.example/jobs/${slug(role.title)}`
  const titleEl = useRef<HTMLInputElement>(null)
  const compEl = useRef<HTMLInputElement>(null)
  const fileEl = useRef<HTMLInputElement>(null)
  const [naming, setNaming] = useState(false)
  const [fresh, setFresh] = useState<string | null>(null)

  /* Extra details are the job's custom fields: set_custom_field, and create_custom_field for a new one */
  const values = s.fieldValues[role.id] ?? {}
  const setValue = (fid: string, v: string | null) =>
    s.setFieldValues((all) => {
      const mine = { ...all[role.id] }
      if (v === null) delete mine[fid]
      else mine[fid] = v
      return { ...all, [role.id]: mine }
    })
  const jobFields = s.fields.filter((f) => f.on === "Job")
  const unused = jobFields.filter((f) => !(f.id in values))
  const addDetail = (fid: string) => {
    setValue(fid, "")
    setFresh(fid)
  }

  /* What a role still needs, and how much each thing matters */
  const needs = [
    { name: "Title", need: "Required", done: !!role.title.trim() },
    { name: "Description", need: "To post", done: hasText(post.body) },
    { name: "Looking For", need: "Suggested", done: role.scorecard.length > 0 },
    { name: "Compensation", need: "Optional", done: !!role.comp?.trim() },
  ]
  const jump = (name: string) => {
    if (name === "Title") titleEl.current?.focus()
    else if (name === "Compensation") compEl.current?.focus()
    else setTab(name === "Description" ? "Overview" : "Internal")
  }
  const missing = needs.filter((n) => !n.done)
  const blocking = missing.filter((n) => n.need !== "Suggested" && n.need !== "Optional")
  const setStatus = (st: JobPost["status"]) => {
    if (st === "live" && blocking.length) return s.setToast(`Add a ${blocking.map((n) => n.name.toLowerCase()).join(" and a ")} before it goes live`)
    editPost({ status: st })
  }
  const importText = (text: string) => {
    const lines = parseDoc(text)
    if (!lines.length) return s.setToast("Nothing to import in that file")
    editPost({ body: hasText(post.body) ? [...post.body, ...lines] : lines })
    s.setToast(`Imported ${lines.length} ${lines.length === 1 ? "line" : "lines"}`)
  }

  const meta: [string, ReactNode, (() => void)?][] = [
    [
      "Location",
      editing ? (
        <Menu width={180} items={s.offices.map((o) => ({ label: o, on: o === role.office, onPick: () => edit((r) => ({ ...r, office: o })) }))} trigger={() => <button className={quiet}>{role.office ?? "Choose"}</button>} />
      ) : (
        (role.office ?? "Not set")
      ),
    ],
    [
      "Department",
      editing ? (
        <Menu width={200} items={TEAMS.map((t) => ({ label: t.name, on: t.id === role.team, onPick: () => edit((r) => ({ ...r, team: t.id })) }))} trigger={() => <button className={quiet}>{teamOf(role.team).name}</button>} />
      ) : (
        teamOf(role.team).name
      ),
    ],
    [
      "Compensation",
      editing ? (
        <input
          value={role.comp ?? ""}
          onChange={(e) => edit((r) => ({ ...r, comp: e.target.value || undefined }))}
          placeholder="Add a range"
          aria-label="Compensation"
          ref={compEl}
          className="-mx-1.5 h-6 w-[calc(100%+12px)] rounded-md bg-transparent px-1.5 text-mute outline-none placeholder:text-faint hover:bg-hover focus:bg-hover focus:text-ink"
        />
      ) : (
        (role.comp ?? "Not listed")
      ),
    ],
    ...jobFields
      .filter((f) => f.id in values && (editing || values[f.id].trim()))
      .map((f): [string, ReactNode, (() => void)?] => [
        f.name,
        editing ? (
          <input
            value={values[f.id]}
            onChange={(e) => setValue(f.id, e.target.value)}
            placeholder="Add a value"
            aria-label={f.name}
            autoFocus={fresh === f.id}
            className="-mx-1.5 h-6 w-[calc(100%+12px)] rounded-md bg-transparent px-1.5 text-mute outline-none placeholder:text-faint hover:bg-hover focus:bg-hover focus:text-ink"
          />
        ) : (
          values[f.id]
        ),
        editing ? () => setValue(f.id, null) : undefined,
      ]),
  ]

  return (
    <>
      <Header
        scope={
          <>
            {scope}
            <button onClick={onBack} className="rounded text-mute transition-colors hover:text-ink">
              Listings &amp; Asks
            </button>
            <ChevronRight size={13} className="text-faint" />
          </>
        }
        title={role.title || "Untitled"}
        right={
          editing && (
            <Menu
              align="right"
              width={150}
              items={[
                ...(["draft", "live", "closed"] as const).map((st) => ({ label: POST_LABEL[st], on: post.status === st, onPick: () => setStatus(st) })),
                ...(post.status === "live"
                  ? [
                      "sep" as const,
                      {
                        label: "Copy Link",
                        onPick: () => {
                          void navigator.clipboard?.writeText(`https://${url}`).catch(() => {})
                          s.setToast("Link copied")
                        },
                      },
                    ]
                  : []),
              ]}
              trigger={() => (
                <Btn>
                  <StatusIcon status={post.status === "live" ? "running" : post.status === "closed" ? "cancelled" : "waiting"} size={12} /> {POST_LABEL[post.status]}
                </Btn>
              )}
            />
          )
        }
      />
      <div key={role.id} className="scroll-quiet anim-rise min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[980px] px-10 pt-12 pb-16 @max-2xl:px-5 @max-2xl:pt-7">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
            {editing ? (
              <input
                value={role.title}
                onChange={(e) => edit((r) => ({ ...r, title: e.target.value }))}
                placeholder="Role title"
                aria-label="Role title"
                ref={titleEl}
                autoFocus={!role.title}
                className="doc-line min-w-0 flex-1 basis-[280px] bg-transparent text-[32px] leading-tight font-semibold tracking-[-0.03em] text-ink outline-none placeholder:text-faint @max-2xl:text-[24px]"
              />
            ) : (
              <h2 className="min-w-0 flex-1 basis-[280px] text-[32px] leading-tight font-semibold tracking-[-0.03em] text-ink @max-2xl:text-[24px]">{role.title || "Untitled"}</h2>
            )}
            <Segmented
              label="View"
              value={mode}
              onChange={setMode}
              options={[
                { key: "edit", label: "Edit" },
                { key: "preview", label: "Preview As Applicant" },
              ]}
            />
          </div>

          <div className="mt-10 grid gap-x-14 gap-y-8 @3xl:grid-cols-[224px_minmax(0,1fr)]">
            <div className="min-w-0">
              <dl className="flex flex-col @max-3xl:flex-row @max-3xl:flex-wrap @max-3xl:gap-x-10 @max-3xl:gap-y-4">
                {meta.map(([k, v, remove]) => (
                  <div key={k} className="group border-b border-line py-4 first:pt-0 @max-3xl:border-b-0 @max-3xl:py-0">
                    <dt className="flex items-center font-medium text-ink">
                      <span className="min-w-0 flex-1 truncate">{k}</span>
                      {remove && (
                        <button aria-label={`Remove ${k}`} onClick={remove} className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100">
                          <X size={13} />
                        </button>
                      )}
                    </dt>
                    <dd className="mt-1.5 text-mute">{v}</dd>
                  </div>
                ))}
              </dl>
              {editing &&
                (naming ? (
                  <input
                    autoFocus
                    placeholder="Name the detail"
                    aria-label="Name the detail"
                    onBlur={() => setNaming(false)}
                    onKeyDown={(e) => {
                      const name = e.currentTarget.value.trim()
                      if (e.key === "Escape") setNaming(false)
                      if (e.key !== "Enter" || !name) return
                      const id = `f${Date.now()}`
                      s.setFields((all) => [...all, { id, name, type: "Text", on: "Job" }])
                      addDetail(id)
                      setNaming(false)
                    }}
                    className="mt-3 h-7 w-full rounded-md border border-line-strong bg-transparent px-2 text-ink outline-none placeholder:text-faint focus:border-mute"
                  />
                ) : (
                  <div className="mt-3">
                    <Menu
                      width={200}
                      items={[...unused.map((f) => ({ label: f.name, onPick: () => addDetail(f.id) })), ...(unused.length ? ["sep" as const] : []), { label: "New Detail", onPick: () => setNaming(true) }]}
                      trigger={() => (
                        <button className="-ml-1.5 flex h-7 items-center gap-1.5 rounded-md px-1.5 text-mute transition-colors hover:bg-hover hover:text-ink">
                          <Plus size={13} /> Add Detail
                        </button>
                      )}
                    />
                  </div>
                ))}

              {editing && missing.length > 0 && (
                <div className="mt-6 rounded-lg border border-line-strong p-3">
                  <div className="font-medium text-ink">{blocking.length ? `${blocking.length} ${blocking.length === 1 ? "thing" : "things"} needed to post` : "Ready to post"}</div>
                  <ul className="mt-1.5">
                    {missing.map((n) => (
                      <li key={n.name}>
                        <button onClick={() => jump(n.name)} className="-mx-1.5 flex h-7 w-[calc(100%+12px)] items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-hover">
                          <Circle size={12} className="shrink-0 text-faint" />
                          <span className="min-w-0 flex-1 truncate text-body">{n.name}</span>
                          <span className="shrink-0 text-xs text-faint">{n.need}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {blocking.length ? (
                    <p className="mt-2 text-xs leading-[1.5] text-faint">An internal ask only needs a title.</p>
                  ) : (
                    post.status === "draft" && (
                      <Btn solid className="mt-2.5" onClick={() => setStatus("live")}>
                        Go Live
                      </Btn>
                    )
                  )}
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex gap-6 border-b border-line" role="tablist">
                {(["Overview", "Application", ...(editing ? ["Internal"] : [])] as Tab[]).map((t) => (
                  <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`-mb-px h-9 border-b-2 transition-colors ${tab === t ? "border-ink font-medium text-ink" : "border-transparent text-mute hover:text-ink"}`}>
                    {t}
                  </button>
                ))}
                {editing && tab === "Overview" && (
                  <>
                    <button onClick={() => fileEl.current?.click()} title="Import a text or Markdown file" className="mb-1 ml-auto flex h-7 items-center gap-1.5 self-center rounded-md px-2 text-mute transition-colors hover:bg-hover hover:text-ink">
                      <Upload size={13} /> Import
                    </button>
                    <input
                      ref={fileEl}
                      type="file"
                      accept=".txt,.md,.markdown,text/plain,text/markdown"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ""
                        if (file) void file.text().then(importText)
                      }}
                    />
                  </>
                )}
              </div>

              <div key={`${tab}${mode}`} className="anim-rise pt-7">
                {tab === "Overview" &&
                  (!editing && !hasText(post.body) ? (
                    <Empty
                      icon={<FileText size={18} />}
                      title="Nothing written yet"
                      action={
                        <Btn solid onClick={() => setMode("edit")}>
                          Write The Overview
                        </Btn>
                      }
                    >
                      Applicants see the role's description here once you add one.
                    </Empty>
                  ) : (
                    editing ? <DocEditor blocks={post.body} onChange={(body) => editPost({ body })} /> : <DocView blocks={post.body} />
                  ))}

                {tab === "Application" &&
                  (editing ? (
                    <Lines
                      label="Question"
                      placeholder="Add a question"
                      locked={2}
                      items={["Name", "Email", ...post.questions]}
                      onEdit={(i, text) => editPost({ questions: post.questions.map((q, n) => (n === i - 2 ? text : q)) })}
                      onAdd={(text) => editPost({ questions: [...post.questions, text] })}
                      onRemove={(i) => editPost({ questions: post.questions.filter((_, n) => n !== i - 2) })}
                      after={(i) => (i < 2 ? <span className="ml-auto text-faint">Always asked</span> : null)}
                    />
                  ) : (
                    <div className="flex max-w-[520px] flex-col gap-5">
                      {["Name", "Email", ...post.questions].map((q) => (
                        <label key={q} className="block">
                          <span className="mb-1.5 block font-medium text-ink">{q}</span>
                          {q === "Resume" ? (
                            <span className="flex h-20 items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong text-mute">
                              <Upload size={14} /> Upload a PDF
                            </span>
                          ) : q === "Why this role?" ? (
                            <textarea readOnly rows={4} aria-label={q} className="block w-full resize-none rounded-lg border border-line-strong bg-transparent px-3 py-2 text-ink outline-none" />
                          ) : (
                            <input readOnly aria-label={q} className="block h-9 w-full rounded-lg border border-line-strong bg-transparent px-3 text-ink outline-none" />
                          )}
                        </label>
                      ))}
                      <div>
                        <Btn solid disabled className="h-9 px-4">
                          Submit Application
                        </Btn>
                      </div>
                    </div>
                  ))}

                {tab === "Internal" && (
                  <>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Menu
                        width={150}
                        items={[
                          { label: "Open", on: !role.closed, onPick: () => edit((r) => ({ ...r, closed: false })) },
                          { label: "Closed", on: !!role.closed, onPick: () => edit((r) => ({ ...r, closed: true })) },
                        ]}
                        trigger={() => (
                          <Btn>
                            <StatusIcon status={role.closed ? "cancelled" : "running"} size={12} /> {role.closed ? "Closed" : "Open"}
                          </Btn>
                        )}
                      />
                      <Menu
                        width={200}
                        items={staff.map((m) => ({ label: m.name, on: m.id === role.manager, onPick: () => edit((r) => ({ ...r, manager: m.id, team_members: (r.team_members ?? []).filter((x) => x !== m.id) })) }))}
                        trigger={() => (
                          <Btn>
                            <Member id={role.manager} size={16} /> {STAFF[role.manager].name}
                          </Btn>
                        )}
                      />
                      <Menu
                        width={170}
                        items={[
                          { label: "Add An Opening", onPick: () => edit((r) => ({ ...r, open: r.open + 1 })) },
                          ...(role.open > Math.max(role.filled, 1) ? [{ label: "Close An Opening", onPick: () => edit((r) => ({ ...r, open: r.open - 1 })) }] : []),
                        ]}
                        trigger={() => (
                          <Btn>
                            <CircleUser size={14} className="text-mute" /> {role.filled} of {role.open} filled
                          </Btn>
                        )}
                      />
                    </div>

                    <h3 className={h3}>Looking For</h3>
                    <Lines
                      label="Looking for"
                      placeholder="Add what you're looking for"
                      items={role.scorecard.map((a) => a.name)}
                      onEdit={(i, name) => edit((r) => ({ ...r, scorecard: r.scorecard.map((a, n) => (n === i ? { ...a, name } : a)) }))}
                      onAdd={(name) => edit((r) => ({ ...r, scorecard: [...r.scorecard, { id: `n${Date.now()}`, name }] }))}
                      onRemove={(i) => edit((r) => ({ ...r, scorecard: r.scorecard.filter((_, n) => n !== i) }))}
                      after={(i) => (
                        <input
                          value={role.scorecard[i].note ?? ""}
                          onChange={(e) => edit((r) => ({ ...r, scorecard: r.scorecard.map((a, n) => (n === i ? { ...a, note: e.target.value || undefined } : a)) }))}
                          placeholder="Add a note"
                          aria-label={`Note on ${role.scorecard[i].name}`}
                          className="doc-line h-9 min-w-0 flex-1 bg-transparent text-mute outline-none placeholder:text-transparent group-hover:placeholder:text-faint focus:text-ink focus:placeholder:text-faint"
                        />
                      )}
                    />

                    <h3 className={h3}>Interview Plan</h3>
                    <Lines
                      label="Step"
                      placeholder="Add a step"
                      items={role.plan}
                      marker={(i) => <span className="w-3 shrink-0 text-right text-faint tabular-nums">{i + 1}</span>}
                      onEdit={(i, text) => edit((r) => ({ ...r, plan: r.plan.map((x, n) => (n === i ? text : x)) }))}
                      onAdd={(text) => edit((r) => ({ ...r, plan: [...r.plan, text] }))}
                      onRemove={(i) => edit((r) => ({ ...r, plan: r.plan.filter((_, n) => n !== i) }))}
                    />

                    <h3 className={h3}>Hiring Team</h3>
                    <ul>
                      {team.map((m) => (
                        <Item key={m} name={STAFF[m].name} onRemove={m === role.manager ? undefined : () => edit((r) => ({ ...r, team_members: (r.team_members ?? []).filter((x) => x !== m) }))}>
                          <Member id={m} size={20} />
                          <span className="flex-1 text-[14px] text-ink">{STAFF[m].name}</span>
                          <span className="text-mute">{m === role.manager ? "Hiring Manager" : loadOf(m)}</span>
                        </Item>
                      ))}
                    </ul>
                    {staff.some((m) => !team.includes(m.id)) && (
                      <div className="mt-1.5">
                        <Menu
                          width={200}
                          items={staff.filter((m) => !team.includes(m.id)).map((m) => ({ label: m.name, onPick: () => edit((r) => ({ ...r, team_members: [...(r.team_members ?? []), m.id] })) }))}
                          trigger={() => (
                            <button className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-mute transition-colors hover:text-ink">
                              <Plus size={13} /> Add Someone
                            </button>
                          )}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
