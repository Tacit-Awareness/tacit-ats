import type { Tone } from "@/components/tickets/tone";
import { sourceGroup } from "./analytics-metrics";
import { PIPELINE_COLUMNS, type ColumnKey } from "./pipeline-columns";

// Home's rules (design/tacit-tickets's Home), pure and unit-tested: how an
// application came in, a person's colour, and the funnel's blocks. The read is
// lib/client/home-tickets.ts; the drawing is app/client/home-tickets.tsx.

/** design/tacit-tickets's three ways in, and everything else (Tacit's own submissions, agencies, events) as Other. */
export const WAYS = [
  { key: "referred", label: "Referred" },
  { key: "inbound", label: "Inbound" },
  { key: "outreach", label: "Reached Out" },
  { key: "other", label: "Other" },
] as const;
export type Way = (typeof WAYS)[number]["key"];

/** analytics-metrics.ts's source groups, folded into the ways: a referral, the careers page, someone sourced. */
export function wayOf(source: string, detail: string | null): Way {
  switch (sourceGroup(source, detail)) {
    case "referral":
      return "referred";
    case "careers":
      return "inbound";
    case "sourced":
      return "outreach";
    default:
      return "other";
  }
}

/**
 * A live application's colour, worst first: red when core calls it overdue (a
 * next action past its date), amber when it is the team's call (interviews held,
 * nothing booked) or an approval is waiting on this member, blue when nobody has
 * touched it in a week (core's no_touch), green when it is moving.
 */
export function liveTone(x: { column: ColumnKey; stalled: readonly string[]; waitingOnMe: boolean }): Tone {
  if (x.stalled.includes("overdue")) return "failed";
  if (x.column === "decide" || x.waitingOnMe) return "needs";
  if (x.stalled.includes("no_touch")) return "waiting";
  return "running";
}

/** Someone who came in and has since closed: rejected reads red, withdrawn blue, hired green. */
export function closedTone(stage: string): Tone {
  if (stage === "rejected") return "failed";
  if (stage === "withdrawn") return "waiting";
  return "running";
}

/** Where someone who came in stands now, for the day's summary, in the summary's order. */
export const STANDINGS = ["awaiting review", "screening", "interviewing", "offer", "hired", "rejected", "withdrew"] as const;
export function standingOf(stage: string): (typeof STANDINGS)[number] {
  switch (stage) {
    case "screening":
    case "interviewing":
    case "offer":
    case "hired":
    case "rejected":
      return stage;
    case "withdrawn":
      return "withdrew";
    default:
      return "awaiting review";
  }
}

/** The stage's own words, Title Case, for a tile's foot: "Interviewing", "Awaiting Review". */
export const standingLabel = (stage: string) => standingOf(stage).replace(/\b\w/g, (c) => c.toUpperCase());

/** The Pipeline's computed columns as the funnel's blocks, labels in Title Case. */
export const FUNNEL_STAGES: { key: ColumnKey; label: string }[] = PIPELINE_COLUMNS.map((c) => ({
  key: c.key,
  label: c.label.replace(/\b\w/g, (ch) => ch.toUpperCase()),
}));

/** Counts by name, in a fixed order, leaving out what is empty. */
export const tally = (order: readonly string[], of: string[]): [string, number][] =>
  order.map((k): [string, number] => [k, of.filter((x) => x === k).length]).filter((x) => x[1] > 0);

/** How a block's people stand: on track, overdue, or quiet. */
export const HEALTH = ["on track", "overdue", "no reply"] as const;
export function healthOf(stalled: readonly string[]): (typeof HEALTH)[number] {
  return stalled.includes("overdue") ? "overdue" : stalled.includes("no_touch") ? "no reply" : "on track";
}

/** Twelve months of days ending at the end of this calendar year, a month earlier for each step back. */
export function yearWindow(today: Date, back: number): { start: Date; end: Date } {
  const y = today.getFullYear();
  return { start: new Date(y, -back, 1), end: new Date(y, 12 - back, 0) };
}
