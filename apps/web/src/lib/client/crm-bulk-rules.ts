import type { ApplicationStage } from "@tacit/core";
import { NOTE_MAX } from "./candidate-edit-rules";

// The CRM's bulk actions, the pure half: what a selection is, what a reject
// would touch and leave alone, the posted input read back, and a run's rows
// worded for the report. The writes are lib/client/crm-bulk.ts; the selection
// lives in the browser (candidates/selection.ts).

/** Rows a run writes at most: 100 selected is a third of the 300-an-hour limit the writes share. */
export const BULK_MAX = 100;

/** An open application the row is about, as the page showed it. */
export type BulkApp = { applicationId: string; jobTitle: string; stage: string };

/** A selected row, kept as shown: a reject carries the stage the member saw, and the report needs the name. */
export type BulkItem = { candidateId: string; name: string; apps: BulkApp[] };

export type Picked = ReadonlyMap<string, BulkItem>;

/** Selects or unselects a row. Past BULK_MAX a new row is refused: the same map comes back. */
export function togglePick(picked: Picked, item: BulkItem): Picked {
  const next = new Map(picked);
  if (next.delete(item.candidateId)) return next;
  if (next.size >= BULK_MAX) return picked;
  return next.set(item.candidateId, item);
}

/** The header's box: unselects the page when all of it is selected, else selects the rest of it, up to BULK_MAX. */
export function togglePage(picked: Picked, items: readonly BulkItem[]): Picked {
  const next = new Map(picked);
  if (items.length > 0 && items.every((i) => picked.has(i.candidateId))) {
    for (const i of items) next.delete(i.candidateId);
    return next;
  }
  for (const i of items) {
    if (next.size >= BULK_MAX) break;
    if (!next.has(i.candidateId)) next.set(i.candidateId, i);
  }
  return next;
}

/** The stages a bulk reject takes. Offer is left out: someone with an offer out is rejected from their own page. */
const REJECTABLE: readonly string[] = ["sourced", "contacted", "screening", "interviewing"] satisfies ApplicationStage[];

export type SkipReason = "no_open" | "at_offer";

export type RejectPlan = {
  /** What the run posts, each with what the report calls it. */
  apps: { applicationId: string; expectedStage: string; label: string }[];
  skipped: { id: string; label: string; why: SkipReason }[];
};

const appLabel = (name: string, jobTitle: string) => `${name} · ${jobTitle}`;

/** Each selected candidate's open applications on their row, less anyone at offer; the rest is reported as left alone. */
export function rejectPlan(items: readonly BulkItem[]): RejectPlan {
  const plan: RejectPlan = { apps: [], skipped: [] };
  for (const item of items) {
    if (item.apps.length === 0) plan.skipped.push({ id: item.candidateId, label: item.name, why: "no_open" });
    for (const a of item.apps) {
      const label = appLabel(item.name, a.jobTitle);
      if (REJECTABLE.includes(a.stage)) plan.apps.push({ applicationId: a.applicationId, expectedStage: a.stage, label });
      else plan.skipped.push({ id: a.applicationId, label, why: a.stage === "offer" ? "at_offer" : "no_open" });
    }
  }
  return plan;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const distinct = <T>(xs: T[], key: (x: T) => string) => [...new Map(xs.map((x) => [key(x), x])).values()];

export type BulkRejectInput = {
  applications: { applicationId: string; expectedStage: ApplicationStage }[];
  reasonId: string;
  note: string | null;
};

/** A posted reject, re-read: ids, stages a bulk reject may take, and the cap. Null for anything the dialog never sends. */
export function parseBulkReject(raw: unknown): BulkRejectInput | null {
  if (!isRecord(raw) || !isId(raw.reasonId) || !Array.isArray(raw.applications)) return null;
  const applications: BulkRejectInput["applications"] = [];
  for (const a of raw.applications as unknown[]) {
    if (!isRecord(a) || !isId(a.applicationId) || typeof a.expectedStage !== "string" || !REJECTABLE.includes(a.expectedStage)) return null;
    applications.push({ applicationId: a.applicationId, expectedStage: a.expectedStage as ApplicationStage });
  }
  const unique = distinct(applications, (a) => a.applicationId.toLowerCase());
  if (unique.length === 0 || unique.length > BULK_MAX) return null;
  const note = typeof raw.note === "string" && raw.note.trim() !== "" ? raw.note.trim().slice(0, NOTE_MAX) : null;
  return { applications: unique, reasonId: raw.reasonId, note };
}

export type BulkNameInput = { candidateIds: string[]; name: string };

/** A posted tag or pool: the candidates and the name typed or picked. The tool checks the name itself. */
export function parseBulkName(raw: unknown): BulkNameInput | null {
  if (!isRecord(raw) || typeof raw.name !== "string" || !Array.isArray(raw.candidateIds)) return null;
  const ids = raw.candidateIds as unknown[];
  if (!ids.every(isId)) return null;
  const candidateIds = distinct(ids as string[], (id) => id.toLowerCase());
  const name = raw.name.trim();
  if (candidateIds.length === 0 || candidateIds.length > BULK_MAX || !name) return null;
  return { candidateIds, name };
}

/** One row of a run: done, nothing to do (`unchanged`), or why it did not go through. */
export type BulkOutcome = "done" | "unchanged" | "not_found" | "forbidden" | "changed" | "rate_limited" | "not_tried" | "failed";
export type BulkRow = { id: string; outcome: BulkOutcome };

/** A run that never started: nothing was written. */
export type BulkError = "invalid" | "forbidden" | "bad_reason" | "bad_name" | "cannot_create" | "rate_limited" | "failed";
export type BulkAnswer = { ok: true; rows: BulkRow[] } | { ok: false; error: BulkError };

export type BulkAction = "reject" | "tag" | "pool";

export const BULK_ERRORS: Record<BulkError, string> = {
  invalid: "That selection didn't look right, so nothing was changed. Select the rows again.",
  forbidden: "You can't do that here. Nothing was changed.",
  bad_reason: "Pick one of your company's rejection reasons. Nothing was changed.",
  bad_name: "That name can't be used. It may be too long, or archived: an admin can bring an archived one back. Nothing was changed.",
  cannot_create: "Only people who can add candidates make new ones. Pick an existing one. Nothing was changed.",
  rate_limited: "You've made 300 changes in the last hour, the limit. Nothing was changed. Try again later.",
  failed: "That didn't work. Nothing was changed.",
};

const FORBIDDEN: Record<BulkAction, string> = {
  reject: "You can't edit that job's pipeline.",
  tag: "You can't change this person's record.",
  pool: "You can't add people to talent pools.",
};

const SENTENCES: Record<Exclude<BulkOutcome, "done" | "unchanged" | "forbidden">, string> = {
  not_found: "Not someone you can see any more.",
  changed: "Someone already moved them, so nothing was changed.",
  rate_limited: "You've hit the limit of 300 changes an hour.",
  not_tried: "Not tried: the hourly limit stopped the run first.",
  failed: "That didn't work.",
};

export const SKIP_SENTENCES: Record<SkipReason, string> = {
  no_open: "No open application in this view, so nothing to reject.",
  at_offer: "At offer. Reject them from their own page.",
};

export type BulkSummary = {
  done: number;
  unchanged: number;
  /** Every row that did not go through, and every row left alone on purpose. */
  problems: { id: string; label: string; sentence: string }[];
};

/** A run's rows for the report. `labels` names each row (the ids and codes are all the server sends back). */
export function summarize(action: BulkAction, rows: readonly BulkRow[], labels: ReadonlyMap<string, string>, skipped: RejectPlan["skipped"] = []): BulkSummary {
  const summary: BulkSummary = { done: 0, unchanged: 0, problems: [] };
  for (const r of rows) {
    if (r.outcome === "done") summary.done += 1;
    else if (r.outcome === "unchanged") summary.unchanged += 1;
    else summary.problems.push({ id: r.id, label: labels.get(r.id) ?? "Unnamed", sentence: r.outcome === "forbidden" ? FORBIDDEN[action] : SENTENCES[r.outcome] });
  }
  for (const s of skipped) summary.problems.push({ id: s.id, label: s.label, sentence: SKIP_SENTENCES[s.why] });
  return summary;
}
