import type { ReactNode } from "react"
import { STAFF, STAGES, STATUS_LABEL, type Status } from "./data"

const STATUS_COLOR: Record<Status, string> = {
  needs: "var(--color-s-needs)",
  failed: "var(--color-bad)",
  waiting: "var(--color-s-routing)",
  running: "var(--color-s-scheduled)",
  done: "var(--color-s-done)",
  cancelled: "var(--color-s-passed)",
}
const PIE: Partial<Record<Status, number>> = { running: 0.25, waiting: 0.5, needs: 0.75 }

/* Linear's status ring: the pie fills as the step gets closer to done */
/* What each ring means, said on hover. `label` replaces the default where the page means something more exact. */
const STATUS_MEANS: Record<Status, string> = {
  needs: "Needs you",
  failed: "Failed, needs a look",
  waiting: "Waiting on someone else",
  running: "In progress",
  done: "Done",
  cancelled: "Cancelled",
}
export function StatusIcon({ status, size = 14, label }: { status: Status; size?: number; label?: string }) {
  const c = STATUS_COLOR[status]
  const frac = PIE[status]
  const says = label ?? STATUS_MEANS[status] ?? STATUS_LABEL[status]
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className="shrink-0" role="img" aria-label={says}>
      <title>{says}</title>
      {status === "failed" ? (
        <>
          <circle cx="7" cy="7" r="6" fill="none" stroke={c} strokeWidth="1.5" />
          <path d="M7 3.8v3.6" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="7" cy="9.9" r="0.9" fill={c} />
        </>
      ) : frac !== undefined ? (
        <>
          <circle cx="7" cy="7" r="6" fill="none" stroke={c} strokeWidth="1.5" />
          <circle
            cx="7" cy="7" r="2" fill="none" stroke={c} strokeWidth="4"
            strokeDasharray={`${frac * 12.566} 12.566`} transform="rotate(-90 7 7)"
          />
        </>
      ) : (
        <>
          <circle cx="7" cy="7" r="6.75" fill={c} />
          {status === "done" ? (
            <path d="M4.3 7.2 6.2 9 9.8 5.2" fill="none" stroke="var(--color-panel)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M4.9 4.9 9.1 9.1M9.1 4.9 4.9 9.1" stroke="var(--color-panel)" strokeWidth="1.6" strokeLinecap="round" />
          )}
        </>
      )}
    </svg>
  )
}

const initials = (name: string) => name.replace("'s bot", "").split(" ").map((p) => p[0]).slice(0, 2).join("")

/* People are round, bots are square. No colour: the name does the work */
export function Avatar({ name, size = 20, square }: { name: string; color?: string; size?: number; square?: boolean }) {
  return (
    <span
      title={name}
      className={`inline-flex shrink-0 items-center justify-center font-medium ${square ? "rounded-[5px] bg-transparent text-mute ring-1 ring-line-strong ring-inset" : "rounded-full bg-chip text-body"}`}
      style={{ width: size, height: size, fontSize: Math.max(8, size * 0.4), letterSpacing: 0 }}
    >
      {initials(name)}
    </span>
  )
}

/* The company's Grokbot. A stand-in mark: swap the path for the real SVG */
export function BotMark({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="4.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2.6 13.4 13.4 2.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function Person({ id, size = 20 }: { id: string; size?: number }) {
  return <Avatar name={STAFF[id].name} size={size} />
}

export function Chip({ children }: { color?: string; children: ReactNode }) {
  return <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-line-strong px-2 text-xs whitespace-nowrap text-mute">{children}</span>
}

export function StagePips({ stage, closed }: { stage: number; closed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="inline-flex gap-[3px]" aria-hidden="true">
        {STAGES.map((s, i) => (
          <span
            key={s}
            className="h-2.5 w-1 rounded-full"
            style={{ background: i <= stage ? (closed ? "var(--color-s-passed)" : "var(--color-mute)") : "var(--color-line-strong)" }}
          />
        ))}
      </span>
      <span className={closed ? "text-faint" : "text-body"}>{STAGES[stage]}</span>
    </span>
  )
}

/* The shortcut key as this computer names it: ⌘ on a Mac, Ctrl everywhere else */
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
export const mod = (key: string) => (MAC ? `⌘${key}` : `Ctrl ${key}`)

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded bg-current/10 px-1 font-sans text-[11px] text-current/70">
      {children}
    </kbd>
  )
}

/* The Tacit mark: two corners facing each other, in the current text colour */
export function TacitMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Tacit">
      <path d="M40 14H66V40" />
      <path d="M40 66H14V40" />
    </svg>
  )
}
