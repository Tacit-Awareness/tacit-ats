import { useEffect, useRef, useState, type ReactNode } from "react"
import { Calendar, FileCheck, ChevronDown, ChevronRight, CircleUser, House, Inbox, Pin, Search, Settings, SquarePen, Target, Ticket as TicketIcon, X, Moon, MoonStar, Sun, Contrast, Monitor, GraduationCap } from "lucide-react"
import { AvatarGroup } from "@/components/arc/avatar-group/avatar-group"
import { STAFF, TEAMS } from "../data"
import { Kbd, TacitMark, mod } from "../ui"
import { IconButton, Menu, TeamTile } from "../kit"
import { ACCESS_LABEL, ME, MEMBERS } from "../org"
import { useStore } from "../store"
import { GO_KEYS, THEMES, resolveTheme, type TeamStat, type Theme, type View } from "../types"

/* ---------------- Sidebar ---------------- */

/* One mark per look, the same in the button's menu as anywhere else it is named */
const THEME_ICON: Record<Theme, ReactNode> = {
  "classic-dark": <MoonStar size={14} />,
  dark: <Moon size={14} />,
  light: <Sun size={14} />,
  "max-light": <Contrast size={14} />,
  system: <Monitor size={14} />,
}

export function Sidebar({ view, team, go, triage, needs, stats }: { view: View; team: string | null; go: (v: View, t: string | null) => void; triage: number; needs: number; stats: Record<string, TeamStat> }) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [pins, setPins] = useState<string[]>(["infra", "design"])
  const [onlyAttn, setOnlyAttn] = useState(false)
  const s = useStore()
  const list = useRef<HTMLDivElement>(null)
  /* What is on screen now, whichever way the theme was chosen */
  const dark = resolveTheme(s.theme, typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches).base === "dark"
  /* Keep the selected team and its sub-items in view, however long the list is */
  useEffect(() => {
    if (team) list.current?.querySelector(`[data-team="${team}"]`)?.scrollIntoView({ block: "nearest" })
  }, [team, open])

  const items: { id: View; label: string; icon: ReactNode; count?: number; under?: boolean }[] = [
    { id: "home", label: "Home", icon: <House size={15} /> },
    /* Triage is everything waiting on you: people to route, and tickets, offers and feedback that need you */
    { id: "triage", label: "Triage", icon: <Inbox size={15} />, count: triage + needs },
    /* Tickets is the record of the work, with its people, interviews and offers under it */
    { id: "tickets", label: "Tickets", icon: <TicketIcon size={15} /> },
    { id: "people", label: "People", icon: <CircleUser size={15} />, under: true },
    { id: "interviews", label: "Interviews", icon: <Calendar size={15} />, under: true },
    { id: "offers", label: "Offers", icon: <FileCheck size={15} />, under: true },
    { id: "asks", label: "Listings & Asks", icon: <Target size={15} /> },
  ]
  const sub: { id: View; label: string }[] = [
    { id: "tickets", label: "Tickets" },
    { id: "people", label: "People" },
    { id: "asks", label: "Listings & Asks" },
    { id: "triage", label: "Triage" },
  ]
  const match = (name: string) => name.toLowerCase().includes(q.trim().toLowerCase())
  const visible = TEAMS.filter((t) => match(t.name) && (!onlyAttn || stats[t.id].attn > 0 || t.id === team))
  const pinned = visible.filter((t) => pins.includes(t.id))
  const rest = visible.filter((t) => !pins.includes(t.id)).sort((a, b) => a.name.localeCompare(b.name))
  const staff = Object.values(STAFF)

  const row = (t: (typeof TEAMS)[number]) => {
    const st = stats[t.id]
    const isOpen = !!open[t.id] || !!q.trim()
    const here = team === t.id
    return (
      <div key={t.id} data-team={t.id}>
        <div className={`group flex h-7 items-center rounded-md pr-1 transition-colors ${here && !isOpen ? "bg-raised" : "hover:bg-hover"}`}>
          <button
            onClick={() => {
              if (isOpen && here) return setOpen((o) => ({ ...o, [t.id]: false }))
              setOpen((o) => ({ ...o, [t.id]: true }))
              go(view === "insights" || view === "settings" ? "tickets" : view, t.id)
            }}
            aria-expanded={isOpen}
            className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pl-1.5 text-left"
          >
            <TeamTile id={t.id} />
            <span className={`truncate ${here ? "text-ink" : "text-body"}`}>{t.name}</span>
            <ChevronRight size={12} className={`shrink-0 text-faint transition-transform ${isOpen ? "rotate-90" : ""}`} />
          </button>
          <button
            aria-label={pins.includes(t.id) ? `Unpin ${t.name}` : `Pin ${t.name}`}
            aria-pressed={pins.includes(t.id)}
            onClick={() => setPins((p) => (p.includes(t.id) ? p.filter((x) => x !== t.id) : [...p, t.id]))}
            className="hidden size-5 items-center justify-center rounded text-faint group-hover:flex hover:text-ink focus-visible:flex"
          >
            <Pin size={12} className={pins.includes(t.id) ? "fill-current" : ""} />
          </button>
          {st.attn > 0 && (
            <span
              className={`ml-1 inline-flex h-[18px] items-center justify-center text-xs tabular-nums group-hover:hidden ${st.stuck ? "min-w-[18px] rounded-full bg-bad px-1 text-[11px] font-medium text-white" : "px-1 text-faint"}`}
              title={st.stuck ? "Has a failed task" : "Needs you"}
            >
              {st.attn}
            </span>
          )}
        </div>
        {isOpen && (
          <div className="relative mb-1 ml-[13px] flex flex-col gap-px border-l border-line pl-2">
            {sub.map((it) => {
              const active = here && view === it.id
              const count = it.id === "tickets" ? st.attn : it.id === "triage" ? st.triage : 0
              return (
                <button
                  key={it.id}
                  onClick={() => go(it.id, t.id)}
                  aria-current={active}
                  className={`flex h-7 items-center rounded-md px-2 text-left transition-colors ${active ? "bg-raised text-ink" : "text-mute hover:bg-hover hover:text-body"}`}
                >
                  {it.label}
                  {!!count && <span className="ml-auto text-xs text-faint tabular-nums">{count}</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className="hidden w-[244px] shrink-0 flex-col py-3 md:flex">
      <div className="flex h-8 shrink-0 items-center gap-2 pr-[18px] pl-3">
        <Menu
          width={220}
          items={[
            { heading: `${STAFF[ME].name}, ${ACCESS_LABEL[MEMBERS[ME].access]}` },
            { label: "Insights", onPick: () => go("insights", null) },
            { label: "Settings", onPick: () => go("settings", null) },
            "sep",
            {
              label: (
                <span className="flex items-center">
                  Command Menu{" "}
                  <span className="ml-auto text-faint">
                    <Kbd>{mod("K")}</Kbd>
                  </span>
                </span>
              ),
              onPick: () => s.setPalette(true),
            },
          ]}
          trigger={() => (
            <button className="flex h-8 items-center gap-2 rounded-md px-1.5 transition-colors hover:bg-hover">
              <span className="flex size-5 shrink-0 items-center justify-center text-ink">
                <TacitMark size={18} />
              </span>
              <span className="font-medium text-ink">Tacit</span>
              <ChevronDown size={13} className="text-faint" />
            </button>
          )}
        />
        <span className="-mr-1.5 ml-auto flex gap-0.5 text-mute">
          <IconButton label={`Search, ${mod("K")}`} onClick={() => s.setPalette(true)}>
            <Search size={15} />
          </IconButton>
          <IconButton label="New Candidate" onClick={() => s.setSheet({ kind: "candidate" })}>
            <SquarePen size={15} />
          </IconButton>
        </span>
      </div>

      <div className="mt-4 shrink-0 px-[18px] text-xs text-faint">All Teams</div>
      <nav className="mt-1.5 flex shrink-0 flex-col gap-px px-3">
        {items.map((it) => {
          const active = !team && view === it.id
          return (
            <button key={it.id} onClick={() => go(it.id, null)} aria-current={active} title={`Press G, then ${GO_KEYS[it.id]}`} className={`group/nav flex h-7 items-center gap-2 rounded-md px-1.5 text-left transition-colors ${it.under ? "ml-[15px] border-l border-line pl-3 rounded-l-none" : ""} ${active ? "bg-raised text-ink" : it.under ? "text-mute hover:bg-hover hover:text-body" : "text-body hover:bg-hover"}`}>
              {!it.under && <span className={active ? "text-ink" : "text-mute"}>{it.icon}</span>}
              {it.label}
              {!!it.count && <span className="ml-auto text-xs text-faint tabular-nums">{it.count}</span>}
              {!it.count && (
                <span className="ml-auto hidden text-[11px] text-faint group-hover/nav:inline">G then {GO_KEYS[it.id]}</span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="mt-5 flex shrink-0 items-center px-[18px] text-xs text-faint">
        Teams <span className="ml-1.5 tabular-nums">{TEAMS.length}</span>
        <button
          onClick={() => setOnlyAttn(!onlyAttn)}
          aria-pressed={onlyAttn}
          title="Only teams that need you"
          className={`ml-auto flex h-5 items-center gap-1 rounded px-1.5 transition-colors ${onlyAttn ? "bg-raised text-ink" : "hover:text-body"}`}
        >
          Needs You
        </button>
      </div>
      <div className="mx-3 mt-1.5 flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line px-2 focus-within:border-line-strong">
        <Search size={12} className="shrink-0 text-faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a team" aria-label="Find a team" className="h-full min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint" />
        {q && (
          <button aria-label="Clear" onClick={() => setQ("")} className="text-faint hover:text-ink">
            <X size={12} />
          </button>
        )}
      </div>

      <div ref={list} className="scroll-quiet mt-1.5 flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-3 pb-2">
        {pinned.map(row)}
        {pinned.length > 0 && rest.length > 0 && <div className="mx-1.5 my-1.5 h-px shrink-0 bg-line" />}
        {rest.map(row)}
        {!visible.length && <div className="px-1.5 py-3 text-faint">No teams</div>}
      </div>

      <div className="arc-scope flex shrink-0 items-center gap-2.5 border-t border-line px-[18px] pt-3">
        {/* Your team: hover for who is not shown, click for everyone */}
        <Menu
          up
          width={230}
          items={[
            { heading: "Your Team" },
            ...staff.map((m) => ({ label: `${m.name}, ${MEMBERS[m.id]?.title ?? ACCESS_LABEL[MEMBERS[m.id]?.access]}`, onPick: () => { s.setSettings("Members"); go("settings", null) } })),
            "sep" as const,
            { label: "Manage Members", onPick: () => { s.setSettings("Members"); go("settings", null) } },
          ]}
          trigger={() => (
            <button aria-label="Your team" title={staff.length > 4 ? `Also ${staff.slice(4).map((m) => m.name).join(", ")}` : staff.map((m) => m.name).join(", ")} className="rounded-full">
              <AvatarGroup size="sm" max={4} label="Team" members={staff.map((m) => ({ name: m.name }))} />
            </button>
          )}
        />
        <span className="-mr-1.5 ml-auto flex items-center">
          <IconButton label="Tutorial" onClick={() => s.setSheet({ kind: "tutorial" })}>
            <GraduationCap size={15} />
          </IconButton>
          {/* The look: the button shows the one in use, and opens the list of all of them with what each is */}
          <Menu
            up
            width={264}
            items={[
              { heading: "Appearance" },
              ...THEMES.map((t) => ({
                on: s.theme === t.key,
                onPick: () => s.setTheme(t.key),
                label: (
                  <span className="flex items-center gap-2.5 py-0.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line-strong text-body">{THEME_ICON[t.key]}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-ink">{t.name}</span>
                      <span className="block truncate text-xs text-mute">{t.means}</span>
                    </span>
                  </span>
                ),
              })),
            ]}
            trigger={() => <IconButton label={`Appearance: ${THEMES.find((t) => t.key === s.theme)?.name ?? "System"}`}>{dark ? <Moon size={15} /> : <Sun size={15} />}</IconButton>}
          />
          <IconButton label="Settings" onClick={() => go("settings", null)}>
            <Settings size={15} />
          </IconButton>
        </span>
      </div>
    </aside>
  )
}
