"use client";

import { useSyncExternalStore } from "react";
import { Pill, StatusGlyph, type GlyphKind } from "@/components/page";
import { ago } from "@/lib/client/pipeline-columns";
import { stateWords, type AgentMap, type AgentState, type Lane, type LaneState, type MapStep, type TaskKind, type TaskState } from "@/lib/client/agent-map";
import { cn } from "@/lib/utils";
import { LocalStamp, LocalWhen } from "../../candidates/local-day";

// The small pieces the board and the pop-up share: a state as a tag with its
// square glyph (Testbench's StatusGlyph, never a dot), a task's kind as a bare
// line icon, the bot's own glyph, when something happened in 12-hour time,
// a task's steps as a row of short dashes, and the colour each connector takes.

type Tone = "blue" | "amber" | "red" | "green" | "grey";
const TONE: Record<AgentState | TaskState, Tone> = { working: "blue", waiting: "amber", needs_you: "red", failed: "red", done: "green", idle: "grey" };
export const INK: Record<AgentState | TaskState, string> = {
  working: "var(--accent)",
  waiting: "var(--amber)",
  needs_you: "var(--red)",
  failed: "var(--red)",
  done: "var(--green)",
  idle: "var(--faint)",
};

/**
 * The connector's look for a lane's state: live is the accent and moves, a
 * stuck one is red, a failed one red and dashed, a finished one a quiet
 * dotted grey (the decoration grey, which still shows on the dark ground
 * where the hairline grey would vanish).
 */
export const WIRE: Record<LaneState, { color: string; dash?: string; flow: boolean }> = {
  live: { color: "var(--accent)", flow: true },
  stuck: { color: "var(--red)", flow: false },
  failed: { color: "var(--red)", dash: "5 4", flow: false },
  done: { color: "var(--ink-4)", dash: "1.5 4", flow: false },
};

/**
 * Working is `live` (the accent square: happening now) and waiting the still
 * corner the rest of the app gives a wait on a person (the Inbox, the
 * interviews' reads still to come). Nothing here turns, so the corner never
 * reads as a spinner.
 */
const GLYPH: Record<AgentState | TaskState, GlyphKind> = { working: "live", waiting: "pending", needs_you: "alert", failed: "alert", done: "done", idle: "empty" };

/** The state's square, never turning. */
export function StateMark({ state, className }: { state: AgentState | TaskState; className?: string }) {
  return <StatusGlyph kind={GLYPH[state]} color={state === "waiting" ? INK.waiting : undefined} still className={className} />;
}

/** "Working", "Waiting on Daniel", "Needs you", "Failed", "Idle" as a tag with its square. */
export function StateChip({ state, waitingOn = null, className }: { state: AgentState | TaskState; waitingOn?: string | null; className?: string }) {
  return (
    <Pill tone={TONE[state]} className={cn("gap-1.5 pl-1.5", className)}>
      <StateMark state={state} className="size-3" />
      {stateWords(state, waitingOn)}
    </Pill>
  );
}

/** A task's kind as a bare line icon: a calendar for booking, a speech bubble for asking, an envelope for sending. */
export function KindIcon({ kind, className }: { kind: TaskKind; className?: string }) {
  const common = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, className: cn("size-[15px] shrink-0 text-faint", className) };
  if (kind === "schedule_interview")
    return (
      <svg {...common}>
        <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
        <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
      </svg>
    );
  if (kind === "send_testbench" || kind === "send_invite" || kind === "send_rejection")
    return (
      <svg {...common}>
        <rect x="2" y="3.5" width="12" height="9" rx="2" />
        <path d="m2.5 4.5 5.5 4 5.5-4" />
      </svg>
    );
  if (kind === "other")
    return (
      <svg {...common}>
        <rect x="3" y="3" width="10" height="10" rx="2.5" />
        <path d="M6 8h4" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M3 4.5A2 2 0 0 1 5 2.5h6a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H7.5L4.5 13v-2.5H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

/** The team's bot, beside a teammate's name: their agent. Bare, in the faint ink. */
export function BotGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn("size-[15px] shrink-0 text-faint", className)}>
      <rect x="2.5" y="5" width="11" height="8.5" rx="2.5" />
      <path d="M8 5V2.5M6 9h.01M10 9h.01" strokeWidth={1.8} />
    </svg>
  );
}

const noSubscribe = () => () => {};
/** The browser's time zone, null on the server and the first paint (as local-day.tsx reads it), for words in a hover title. */
export function useZone(): string | null {
  return useSyncExternalStore(
    noSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null,
  );
}

/** When something happened: the time today ("12:35 AM"), else the day; "3d ago" until the browser knows its zone. */
export function Stamp({ iso, now }: { iso: string; now: number }) {
  return <LocalStamp iso={iso} fallback={ago(iso, now)} />;
}

/** The time and its weekday this past week ("Wed 9:05 AM"), else the date and time. */
export function When({ iso, now }: { iso: string; now: number }) {
  return <LocalWhen iso={iso} fallback={ago(iso, now)} />;
}

/** A task's steps as short dashes, the newest in its state's colour and, while it is open, one hollow dash for what comes next. */
export function StepDashes({ steps, state, className }: { steps: MapStep[]; state: TaskState; className?: string }) {
  const shown = steps.slice(-7);
  const open = state === "working" || state === "waiting" || state === "needs_you";
  return (
    <span aria-hidden className={cn("flex items-center gap-[3px]", className)}>
      {shown.map((s, i) => (
        <i key={i} className="block h-[3px] w-3 rounded-[2px]" style={{ background: i === shown.length - 1 ? INK[state] : "var(--line-strong)" }} />
      ))}
      {open ? <i className="block h-[3px] w-3 rounded-[2px] shadow-[inset_0_0_0_1px_var(--line-strong)]" /> : null}
    </span>
  );
}

/** "Priya → Daniel" between two agents, "Lena → Camille Laurent" when the lane ends at a candidate (whose whole name the board shows nowhere else). */
export function laneTitle(map: AgentMap, lane: Lane): { from: string; to: string } {
  return { from: map.agents[lane.from]?.short ?? "An agent", to: lane.to.kind === "member" ? lane.to.short : lane.to.name };
}

/** The arrow between two names: drawn, so it sits on the text's middle in both fonts. */
export function Arrow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn("size-3.5 shrink-0", className)}>
      <path d="M3 8h10M9.5 4.5 13 8l-3.5 3.5" />
    </svg>
  );
}
