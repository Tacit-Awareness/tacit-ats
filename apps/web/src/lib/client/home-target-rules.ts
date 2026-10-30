import { clientTools } from "@tacit-ats/core";
import { fmtHours } from "./home-metrics";

// Home's targets (design/tats's "Set a target"), the pure half: what each card's
// number means, the dialog's post read back, and a stored number in words.
// lib/client/home-targets.ts reads and writes; home-props.ts and home-target.tsx draw.

export type TargetMetric = clientTools.HomeTargetMetric;
export type HomeTargets = clientTools.HomeTargets;
export type TargetUnit = "d" | "h";
export type TargetError = "invalid" | "not_number" | "not_whole" | "too_big" | "too_small" | "forbidden" | "rate_limited" | "failed";

/**
 * count: a number of things, flagged below. time: hours in the column, entered
 * in days or hours. hours: hours only, as a cap of "5 days" of interviewing
 * would mean nothing.
 */
export type TargetKind = "count" | "time" | "hours";

type Rule = { kind: TargetKind; label: string; flag: "below" | "over"; sub: string };

const TARGET_RULES: Record<TargetMetric, Rule> = {
  new_applications: { kind: "count", label: "Alert below", flag: "below", sub: "Flag it when the count drops below this." },
  review: { kind: "time", label: "Target", flag: "over", sub: "Flag it when the typical wait goes over this." },
  schedule: { kind: "time", label: "Target", flag: "over", sub: "Flag it when the typical wait goes over this." },
  feedback: { kind: "time", label: "Target", flag: "over", sub: "Flag it when feedback typically takes longer than this to come in." },
  workload: { kind: "hours", label: "Cap", flag: "over", sub: "Flag it when the team's interview hours go over this." },
};

export const targetRule = (metric: TargetMetric): Rule => TARGET_RULES[metric];

/** Whether a card's number is on the wrong side of its target. 0 is a target; no number has nothing to compare. */
export function isOffTarget(metric: TargetMetric, value: number | null, target: number | null | undefined): boolean {
  if (target === null || target === undefined || value === null) return false;
  return TARGET_RULES[metric].flag === "below" ? value < target : value > target;
}

const plain = (n: number) => String(+n.toFixed(2));

/**
 * A stored target in the card's words. Unlike a measured wait, which fmtHours
 * rounds and floors at a minute, this is a number someone chose, so it stays
 * exact: 1.5 reads "1.5h" rather than "2h", and 0 reads "0h" rather than "1m".
 */
export function targetWords(metric: TargetMetric, value: number): string {
  const { kind } = TARGET_RULES[metric];
  if (kind === "count") return value.toLocaleString("en-US");
  if (kind === "hours" || value === 0) return `${plain(value)}h`;
  if (value >= 48) return `${plain(value / 24)}d`;
  return value >= 1 ? `${plain(value)}h` : fmtHours(value);
}

/**
 * What the dialog opens with: a stored target as a number and a unit that come
 * back to the same hours on a Save. Days from two days up, as the card reads,
 * unless days would round: 49.5h is 2.0625d, and two places of days would put
 * 49.44h back in the column.
 */
export function targetField(metric: TargetMetric, value: number | null): { value: string; unit: TargetUnit } {
  const { kind } = TARGET_RULES[metric];
  if (value === null) return { value: "", unit: kind === "time" ? "d" : "h" };
  if (kind === "time" && value >= 48) {
    const days = +(value / 24).toFixed(2);
    if (Math.round(days * 2400) / 100 === value) return { value: plain(days), unit: "d" };
  }
  return { value: plain(value), unit: "h" };
}

/** Plain decimals only: Number() would read "", " ", "0x10" and "1e3". */
const DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)$/;
const FIELD_MAX = 32;

export type ParsedTarget = { ok: true; metric: TargetMetric; value: number | null } | { ok: false; error: TargetError };

/**
 * The dialog's post, read back. Left blank means no target, as the prototype; a
 * tampered metric or unit is refused and never guessed at. The result is what
 * home_targets.value keeps: hours, or a count, to two places.
 */
export function parseTarget(input: { metric: unknown; value: unknown; unit: unknown; clear: unknown }): ParsedTarget {
  if (!clientTools.isHomeTargetMetric(input.metric)) return { ok: false, error: "invalid" };
  const metric = input.metric;
  const { kind } = TARGET_RULES[metric];
  const raw = typeof input.value === "string" ? input.value.trim() : "";
  if (input.clear === "on" || raw === "") return { ok: true, metric, value: null };
  if (raw.length > FIELD_MAX || !DECIMAL.test(raw)) return { ok: false, error: "not_number" };
  const n = Number(raw);
  if (kind === "count" && !Number.isInteger(n)) return { ok: false, error: "not_whole" };
  let hours = n;
  if (kind === "time") {
    if (input.unit !== "d" && input.unit !== "h") return { ok: false, error: "invalid" };
    if (input.unit === "d") hours = n * 24;
  }
  const value = Math.round(hours * 100) / 100;
  if (value > clientTools.HOME_TARGET_MAX) return { ok: false, error: "too_big" };
  if (value === 0 && n > 0) return { ok: false, error: "too_small" };
  return { ok: true, metric, value };
}
