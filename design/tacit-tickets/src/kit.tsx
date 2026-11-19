import { useEffect, useRef, useState, type ReactNode } from "react"
import { EmptyState } from "./components/ui/empty-state-clean"
import { Loading, Skeleton } from "./components/ui/skeleton-clean"
import {
  Brain, Database, Handshake, HeartHandshake, Landmark, Layers, PenTool, Rocket, Scale, Server, Shield, Smartphone, TrendingUp, Users, X,
  type LucideIcon,
} from "lucide-react"

import { KIND_LABEL, STAFF, TEAMS, type Status, type Task } from "./data"
import { Kbd } from "./ui"

void [useEffect, useRef]

export const teamOf = (id: string) => TEAMS.find((t) => t.id === id)!

const TEAM_ICON: Record<string, LucideIcon> = {
  infra: Server, fde: Rocket, design: PenTool, platform: Layers, data: Database, ml: Brain, security: Shield,
  mobile: Smartphone, growth: TrendingUp, sales: Handshake, cs: HeartHandshake, finance: Landmark, peopleops: Users, legal: Scale,
}

/* A team's icon in its own colour, softened so a long list of teams stays quiet */
export function TeamTile({ id, size = 16 }: { id: string; size?: number }) {
  const Icon = TEAM_ICON[id] ?? Users
  return (
    <span className="inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size, color: `color-mix(in oklab, ${teamOf(id).color} 62%, var(--color-mute))` }}>
      <Icon size={size - 2} strokeWidth={2} />
    </span>
  )
}

export const isOpen = (s: Status) => s !== "done" && s !== "cancelled"
export const wash = (s: Status) => (isOpen(s) ? `wash-${s}` : "")
/*
 * The same colours as a ticket's status, for people: amber is waiting on you, red is overdue or
 * rejected, blue is waiting on someone else, green is moving. Used for dots, blocks, bars and tiles.
 */
export type Tone = "needs" | "failed" | "waiting" | "running"
export const TONE_COLOR: Record<Tone, string> = { needs: "var(--color-s-needs)", failed: "var(--color-bad)", waiting: "var(--color-s-routing)", running: "var(--color-s-scheduled)" }
export const toneOf = (p: { closed?: string; stalled?: string }): Tone => (p.closed === "Rejected" || p.stalled === "overdue" ? "failed" : p.stalled === "no_touch" || p.closed === "Withdrawn" ? "waiting" : "running")
/*
 * A block is only coloured when something in it needs you: red if anyone is overdue, amber if
 * anyone is waiting on you. A block where the work is simply moving stays plain, so colour on a
 * block always means "look here".
 */
export const worst = (tones: Tone[]): Tone | undefined => (["failed", "needs"] as Tone[]).find((t) => tones.includes(t))

/* What each colour means, said once beside the blocks */
export function ToneLegend({ className = "" }: { className?: string }) {
  const items: [Tone, string, string][] = [
    ["needs", "Needs you", "Waiting on you to act"],
    ["failed", "Overdue", "Past its date, needs a look"],
    ["running", "Moving", "Nothing for you to do"],
    ["waiting", "Waiting on them", "Someone else has not replied"],
  ]
  return (
    <span className={`flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-mute ${className}`}>
      {items.map(([tone, name, means]) => (
        <span key={tone} title={means} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="size-2 rounded-full" style={{ background: TONE_COLOR[tone] }} />
          {name}
        </span>
      ))}
    </span>
  )
}
const NAME_TONE: Record<string, Tone> = { "awaiting review": "needs", referred: "needs", applied: "needs", sourced: "needs", rejected: "failed", overdue: "failed", withdrew: "waiting", "no reply": "waiting" }
export const toneOfName = (name: string): Tone => NAME_TONE[name] ?? "running"

export const title = (t: Task) => (t.step ? `${KIND_LABEL[t.kind]}, ${t.step}` : KIND_LABEL[t.kind])
export const last = (t: Task) => t.steps[t.steps.length - 1]?.label ?? ""
/* The one line that says where a task stands */
export const standing = (t: Task) => (t.status === "failed" ? (t.error ?? "Failed") : t.status === "waiting" && t.draft ? "Draft not sent" : t.waitingOn && t.status === "waiting" ? `${t.waitingOn.name} on ${t.waitingOn.channel}` : last(t))

export function IconButton({ label, children, onClick }: { label: string; children: ReactNode; onClick?: () => void }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className="flex size-7 items-center justify-center rounded-md text-mute transition-colors hover:bg-raised hover:text-ink">
      {children}
    </button>
  )
}

export function Header({ scope, title, tabs, tab, setTab, right }: { scope?: ReactNode; title: string; tabs?: string[]; tab?: string; setTab?: (t: string) => void; right?: ReactNode }) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-line pr-3 pl-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {scope && <span className="mr-0.5 flex shrink-0 items-center gap-2">{scope}</span>}
      <h1 className="mr-2 shrink-0 font-medium text-ink">{title}</h1>
      {tabs?.map((t) => (
        <button
          key={t}
          onClick={() => setTab?.(t)}
          className={`h-7 shrink-0 rounded-md px-2.5 whitespace-nowrap transition-colors ${tab === t ? "bg-raised text-ink" : "text-mute hover:text-ink"}`}
        >
          {t}
        </button>
      ))}
      <span className="ml-auto flex shrink-0 items-center gap-0.5 pl-2">{right}</span>
    </header>
  )
}

export function Composer({ placeholder, onAdd }: { placeholder: string; onAdd: (text: string) => void }) {
  const [draft, setDraft] = useState("")
  const add = () => {
    const text = draft.trim()
    if (!text) return
    onAdd(text)
    setDraft("")
  }
  return (
    <div className="mt-2 flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-hover pr-1 pl-3 focus-within:border-mute">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-full min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint"
      />
      <button onClick={add} disabled={!draft.trim()} className="flex h-7 items-center gap-1.5 rounded-md bg-ink px-2.5 font-medium text-well transition-opacity disabled:opacity-30">
        Add <Kbd>↵</Kbd>
      </button>
    </div>
  )
}

/*
 * A stand-in for something still loading: a grey shape the size of what it replaces, with a sheen
 * that sweeps across every one in step. Size it with classes. Wrap an area's bones in <Loading>,
 * which waits a beat before showing them, so a fast load never flashes.
 */
export const Bone = ({ className = "" }: { className?: string }) => <Skeleton width="" height="" className={`rounded-full ${className}`} />
export { Loading }

export const loadOf = (id: string) => {
  const s = STAFF[id]
  if (s.awayUntil) return `Away through ${s.awayUntil}`
  return s.cap === null ? `${s.load} this week` : `${s.load} of ${s.cap} this week`
}

export function Pips({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-[3px]" aria-label={`${value} of 4`}>
      {[0, 1, 2, 3].map((i) => <span key={i} className="h-2.5 w-1 rounded-full" style={{ background: i < value ? "currentColor" : "var(--color-line-strong)" }} />)}
    </span>
  )
}

/* ---------------- Small shared parts ---------------- */

export const label = "mb-2 text-xs text-faint"
/* Every card and section title: one size, one weight, numbers included */
export const heading = "text-[15px] font-semibold tracking-[-0.01em] text-ink"

/* A quiet button: `solid` is the one primary action on a surface */
export function Btn({ children, onClick, solid, disabled, title: tip, className = "" }: { children: ReactNode; onClick?: () => void; solid?: boolean; disabled?: boolean; title?: string; className?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} title={tip}
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 whitespace-nowrap transition disabled:opacity-30 ${solid ? "bg-ink font-medium text-well hover:opacity-90" : "border border-line-strong text-ink hover:bg-hover"} ${className}`}>
      {children}
    </button>
  )
}

/* A menu that opens from its trigger; closes on pick, outside click or Escape */
export function Menu({ trigger, items, align = "left", up, width = 200 }: {
  trigger: (open: boolean) => ReactNode
  items: ({ label: ReactNode; onPick: () => void; on?: boolean; danger?: boolean } | "sep" | { heading: string })[]
  align?: "left" | "right"; up?: boolean; width?: number
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false) } }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open])
  return (
    <span className="relative inline-flex">
      <span onClick={() => setOpen(!open)} className="inline-flex">{trigger(open)}</span>
      {open && (
        <>
          <span className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <span role="menu" style={{ width }} className={`anim-rise scroll-quiet absolute z-50 flex max-h-[320px] flex-col overflow-y-auto rounded-xl border border-line-strong bg-panel p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.45)] ${up ? "bottom-full mb-1.5" : "top-full mt-1.5"} ${align === "right" ? "right-0" : "left-0"}`}>
            {items.map((it, i) => it === "sep" ? <span key={i} className="mx-1 my-1 h-px shrink-0 bg-line" />
              : "heading" in it ? <span key={i} className="px-2.5 pt-1.5 pb-1 text-xs text-faint">{it.heading}</span>
              : (
                <button key={i} role="menuitem" onClick={() => { setOpen(false); it.onPick() }}
                  className={`flex min-h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 py-1 text-left transition-colors hover:bg-hover ${it.danger ? "text-bad" : "text-ink"}`}>
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.on && <span className="size-1.5 shrink-0 rounded-full bg-ink" />}
                </button>
              ))}
          </span>
        </>
      )}
    </span>
  )
}

/* A centred sheet over the app. Escape and the scrim close it */
export function Dialog({ title: heading, onClose, children, footer, width = 460 }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose() } }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[14vh]" role="dialog" aria-modal="true" aria-label={heading}>
      <div className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[2px]" onClick={onClose} />
      <div style={{ maxWidth: width }} className="anim-rise relative w-full overflow-hidden rounded-xl border border-line-strong bg-panel shadow-[0_24px_80px_-12px_rgba(0,0,0,0.6)]">
        <div className="flex h-11 items-center border-b border-line pr-2 pl-5">
          <span className="font-medium text-ink">{heading}</span>
          <span className="ml-auto"><IconButton label="Close" onClick={onClose}><X size={15} /></IconButton></span>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label: aria }: { value: T; options: { key: T; label: string; hint?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="inline-flex rounded-lg bg-well p-0.5" role="radiogroup" aria-label={aria}>
      {options.map((o) => (
        <button key={o.key} role="radio" aria-checked={value === o.key} onClick={() => onChange(o.key)}
          className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 whitespace-nowrap transition-colors ${value === o.key ? "bg-panel text-ink shadow-[0_0_0_1px_var(--color-line-strong)]" : "text-mute hover:text-ink"}`}>
          {o.label} {o.hint && <Kbd>{o.hint}</Kbd>}
        </button>
      ))}
    </div>
  )
}

/* A plain text field in the app's style */
export function Field({ value, onChange, placeholder, label: aria, onEnter, className = "", autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; label: string; onEnter?: () => void; className?: string; autoFocus?: boolean }) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onEnter?.()} placeholder={placeholder} aria-label={aria} autoFocus={autoFocus}
      className={`h-8 min-w-0 rounded-lg border border-line-strong bg-transparent px-2.5 text-ink outline-none placeholder:text-faint focus:border-mute ${className}`} />
  )
}

export function Toggle({ on, onChange, label: aria }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={aria} onClick={() => onChange(!on)} className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${on ? "bg-ink" : "bg-line-strong"}`}>
      <span className={`absolute top-0.5 size-3.5 rounded-full bg-panel transition-[left] ${on ? "left-4" : "left-0.5"}`} />
    </button>
  )
}

export function Empty({ icon, title: heading, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="h-full min-h-[240px] px-8 py-6">
      <EmptyState bare tall icon={icon} title={heading} text={children} action={action} />
    </div>
  )
}
