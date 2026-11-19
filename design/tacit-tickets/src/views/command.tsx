import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Calendar, Check, FileCheck, CircleUser, Globe, House, Inbox, Plus, Search, Settings, Target, Ticket as TicketIcon } from "lucide-react"
import { STAGES, TEAMS } from "../data"
import { Avatar, Kbd } from "../ui"
import { TeamTile } from "../kit"
import { useStore } from "../store"
import { GO_KEYS, type View, THEMES } from "../types"

/* ---------------- Command menu: everything, from the keyboard ---------------- */

export const SETTINGS_SECTIONS = ["General", "Members", "Interviewers", "Rounds", "Teams", "Templates", "Labels", "Fields", "Approvals", "Integrations", "Connector"]

type Cmd = { group: string; label: string; hint?: string; icon: ReactNode; run: () => void }

export function CommandMenu() {
  const s = useStore()
  const [q, setQ] = useState("")
  const [at, setAt] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const close = () => s.setPalette(false)
  const nav =
    (v: View, team: string | null = null) =>
    () =>
      s.go(v, team)

  const commands = useMemo<Cmd[]>(() => {
    const query = q.trim().toLowerCase()
    const match = (text: string) => text.toLowerCase().includes(query)
    const people: Cmd[] = query
      ? [
          ...s.people.filter((p) => match(p.name)).map((p): Cmd => ({ group: "Candidates", label: p.name, hint: p.closed ?? STAGES[p.stage], icon: <Avatar name={p.name} size={18} />, run: () => s.openProfile(p.id) })),
          ...s.triage.filter((a) => match(a.name)).map((a): Cmd => ({ group: "Candidates", label: a.name, hint: "In Triage", icon: <Avatar name={a.name} size={18} />, run: nav("triage") })),
          ...s.prospects.filter((p) => match(p.name)).map((p): Cmd => ({ group: "Candidates", label: p.name, hint: p.pool, icon: <Avatar name={p.name} size={18} />, run: nav("people") })),
        ].slice(0, 6)
      : []
    /* Everything else with a name: roles, offers, and people set aside to check in on */
    const found: Cmd[] = query
      ? [
          ...s.roles.filter((r) => match(r.title)).slice(0, 5).map((r): Cmd => ({ group: "Roles", label: r.title || "Untitled", hint: r.closed ? "Closed" : r.post?.status === "live" ? "Live" : "Draft", icon: <Target size={15} />, run: () => { s.setAskId(r.id); s.go("asks", null) } })),
          ...Object.entries(s.offers).filter(([id]) => match(s.personOf(id).name)).map(([id, o]): Cmd => ({ group: "Offers", label: s.personOf(id).name, hint: o.salary || "Draft", icon: <FileCheck size={15} />, run: () => s.openOffer(id) })),
          ...s.checkins.filter((c) => match(c.name)).slice(0, 4).map((c): Cmd => ({ group: "Check In", label: c.name, hint: c.due, icon: <Calendar size={15} />, run: nav("people") })),
        ]
      : []
    const all: Cmd[] = [
      ...people,
      ...found,
      { group: "Go To", label: "Home", hint: `G then ${GO_KEYS.home}`, icon: <House size={15} />, run: nav("home") },
      { group: "Go To", label: "Triage", hint: `G then ${GO_KEYS.triage}`, icon: <Inbox size={15} />, run: nav("triage") },
      { group: "Go To", label: "Tickets", hint: `G then ${GO_KEYS.tickets}`, icon: <TicketIcon size={15} />, run: nav("tickets") },
      { group: "Go To", label: "People", hint: `G then ${GO_KEYS.people}`, icon: <CircleUser size={15} />, run: nav("people") },
      { group: "Go To", label: "Interviews", hint: `G then ${GO_KEYS.interviews}`, icon: <Calendar size={15} />, run: nav("interviews") },
      { group: "Go To", label: "Offers", hint: `G then ${GO_KEYS.offers}`, icon: <FileCheck size={15} />, run: nav("offers") },
      { group: "Go To", label: "Listings & Asks", hint: `G then ${GO_KEYS.asks}`, icon: <Target size={15} />, run: nav("asks") },
      { group: "Go To", label: "Insights", hint: `G then ${GO_KEYS.insights}`, icon: <Globe size={15} />, run: nav("insights") },
      ...(s.approvals.length ? [{ group: "Go To", label: "My Approvals", hint: String(s.approvals.length), icon: <Check size={15} />, run: () => s.openOffer(s.approvals[0]) } as Cmd] : []),
      { group: "Go To", label: "Tutorial", icon: <Search size={15} />, run: () => s.setSheet({ kind: "tutorial" }) },
      { group: "Create", label: "New Candidate", hint: "C", icon: <Plus size={15} />, run: () => s.setSheet({ kind: "candidate" }) },
      { group: "Create", label: "Schedule Interview", icon: <Plus size={15} />, run: () => s.setSheet({ kind: "schedule" }) },
      {
        group: "Create",
        label: "Invite Member",
        icon: <Plus size={15} />,
        run: () => {
          s.setSettings("Members")
          s.go("settings", null)
        },
      },
      ...TEAMS.map((t): Cmd => ({ group: "Teams", label: t.name, icon: <TeamTile id={t.id} />, run: nav("tickets", t.id) })),
      ...SETTINGS_SECTIONS.map((sec): Cmd => ({
        group: "Settings",
        label: sec,
        icon: <Settings size={15} />,
        run: () => {
          s.setSettings(sec)
          s.go("settings", null)
        },
      })),
      ...THEMES.map((t): Cmd => ({ group: "Appearance", label: t.name, hint: s.theme === t.key ? "On" : undefined, icon: <Settings size={15} />, run: () => s.setTheme(t.key) })),
    ]
    return query ? all.filter((c) => ["Candidates", "Roles", "Offers", "Check In"].includes(c.group) || match(c.label) || match(c.group)) : all.filter((c) => c.group !== "Teams" && c.group !== "Settings")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, s.people, s.triage, s.prospects, s.roles, s.offers, s.checkins, s.theme, s.approvals.length])

  const idx = Math.min(at, Math.max(commands.length - 1, 0))
  const run = (c?: Cmd) => {
    if (!c) return
    close()
    c.run()
  }
  useEffect(() => {
    list.current?.querySelector(`[data-i="${idx}"]`)?.scrollIntoView({ block: "nearest" })
  }, [idx])

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[14vh]" role="dialog" aria-modal="true" aria-label="Command menu">
      <div className="absolute inset-0 bg-[var(--scrim)]" onClick={close} />
      <div className="anim-rise relative w-full max-w-[560px] overflow-hidden rounded-xl border border-line-strong bg-panel shadow-[0_24px_80px_-12px_rgba(0,0,0,0.6)]">
        <div className="flex h-12 items-center gap-2.5 border-b border-line px-4">
          <Search size={15} className="shrink-0 text-faint" />
          <input
            autoFocus
            value={q}
            placeholder="Search people, roles, offers, or type a command"
            aria-label="Search people, roles, offers, or type a command"
            onChange={(e) => {
              setQ(e.target.value)
              setAt(0)
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setAt(Math.min(idx + 1, commands.length - 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setAt(Math.max(idx - 1, 0))
              } else if (e.key === "Enter") run(commands[idx])
              else if (e.key === "Escape") {
                e.stopPropagation()
                close()
              }
            }}
            className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
          />
          <Kbd>esc</Kbd>
        </div>
        <div ref={list} className="scroll-quiet max-h-[380px] overflow-y-auto p-1.5">
          {commands.map((c, i) => (
            <div key={`${c.group}${c.label}`}>
              {(i === 0 || commands[i - 1].group !== c.group) && <div className="px-2.5 pt-2 pb-1 text-xs text-faint">{c.group}</div>}
              <button data-i={i} onMouseMove={() => setAt(i)} onClick={() => run(c)} className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left ${i === idx ? "bg-raised text-ink" : "text-body"}`}>
                <span className="flex w-[18px] shrink-0 justify-center text-mute">{c.icon}</span>
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.hint && <span className="shrink-0 text-xs text-faint">{c.hint}</span>}
              </button>
            </div>
          ))}
          {!commands.length && <div className="px-3 py-6 text-center text-faint">Nothing matches</div>}
        </div>
      </div>
    </div>
  )
}
