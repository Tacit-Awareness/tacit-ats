import type { Db } from "@tacit/db";

import { ACTIVE_STAGES, APPLICATION_STAGES, CANDIDATE_SOURCES, parseDueDate } from "@tacit/core";
import { ClientToolError, type ClientToolCtx } from "./context.js";

/**
 * Hiring reports for the client connector. Every one is read on the MEMBER'S
 * OWN client, so it counts only what that member's token can read: an admin
 * reports on the org (minus confidential jobs they cannot see), a hiring
 * manager on their jobs, an external recruiter on the candidates they added.
 * No SQL function and no privileged client: plain reads of the existing tables
 * (applications, application_events, interviews, interview_feedback, offers,
 * rejection_reasons), aggregated here.
 *
 * Scans are capped (REPORT_SCAN_MAX rows a table, read 1,000 at a time, the
 * API's page size) and a report says `truncated` when a cap was reached, so a
 * number is never silently partial. Interviewers get no reports: their token
 * reads their own interviews and nothing to count.
 */

export const REPORT_SCAN_MAX = 5000;
const EVENT_SCAN_MAX = 10_000;
const PAGE = 1000;
const DAY_MS = 86_400_000;
/** Feedback is on time when filed within this long of the interview's end. */
export const FEEDBACK_ON_TIME_HOURS = 24;
/** How many jobs or interviewer pairs a report asks the access helpers about. */
const HELPER_CHECKS_MAX = 200;
const ID_CHUNK = 100;

/** The stages a candidate moves forward through, in order; rejected and withdrawn are exits. */
const PROGRESS = ["sourced", "contacted", "screening", "interviewing", "offer", "hired"] as const;

export type ReportScope = { jobId: string | null; since: string | null; truncated: boolean };

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export const notForInterviewers = () =>
  new ClientToolError("forbidden", "Reports are for the hiring team and admins, not interviewers.");

/** `since` as the start of that UTC day, or null. A date in the future is refused. */
export function parseSince(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null || raw.trim() === "") return null;
  const day = parseDueDate(raw);
  if (!day) throw new ClientToolError("invalid", "since is a date, YYYY-MM-DD.");
  const iso = `${day}T00:00:00.000Z`;
  if (Date.parse(iso) > Date.now()) throw new ClientToolError("invalid", "since is in the future, so there is nothing to report yet.");
  return iso;
}

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Reads a query 1,000 rows at a time up to `max`. `page` builds a fresh query for each range. */
export async function scan<T>(page: (from: number, to: number) => PageResult<T>, max = REPORT_SCAN_MAX): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const to = Math.min(from + PAGE, max) - 1;
    const { data, error } = await page(from, to);
    if (error) throw new Error(error.message);
    const got = data ?? [];
    rows.push(...got);
    if (got.length < to - from + 1) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** The job, if the member can see it. */
export async function requireJob(db: Db, jobId: string): Promise<{ id: string; title: string }> {
  const { data, error } = await db.from("roles").select("id, title").eq("id", jobId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ClientToolError("not_found", "No job with that id that you can see. Call list_jobs for the ids.");
  return data;
}

const days = (fromIso: string, toIso: string) => (Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS;
const round1 = (n: number) => Math.round(n * 10) / 10;
const rate = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) / 100 : null);

export type DayStats = { count: number; medianDays: number | null; avgDays: number | null };

export function dayStats(values: number[]): DayStats {
  if (!values.length) return { count: 0, medianDays: null, avgDays: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { count: values.length, medianDays: round1(median), avgDays: round1(values.reduce((s, v) => s + v, 0) / values.length) };
}

type AppRow = { id: string; stage: string; source: string; created_at: string };
type StageEventRow = { application_id: string; kind: string; from_stage: string | null; to_stage: string | null; created_at: string };

/** The applications in scope: the member's, on one job, created since. Newest first. */
async function scopedApplications(db: Db, jobId: string | null, since: string | null) {
  return scan<AppRow>((from, to) => {
    // A merged application is the same candidate counted twice: only live ones count.
    let q = db.from("applications").select("id, stage, source, created_at").is("merged_into_id", null);
    if (jobId) q = q.eq("role_id", jobId);
    if (since) q = q.gte("created_at", since);
    return q.order("created_at", { ascending: false }).order("id").range(from, to);
  });
}

// ---------------------------------------------------------------------------
// pipeline_report
// ---------------------------------------------------------------------------

export type StageRow = {
  stage: string;
  /** Applications at this stage now. */
  now: number;
  /** Applications that got at least this far (forward stages only; a skipped stage counts as passed). */
  reached: number | null;
  /** reached(next stage) / reached(this), 0 to 1; null at the last forward stage or with nobody here. */
  conversionToNext: number | null;
  /** Average days spent in this stage, over stays that ended (live stages only). */
  avgDaysInStage: number | null;
  /** How many ended stays that average is over. */
  stays: number;
};

export type PipelineReport = ReportScope & { applications: number; stages: StageRow[] };

export async function pipelineReport(
  db: Db,
  ctx: ClientToolCtx,
  input: { jobId?: string; since?: string } = {},
): Promise<PipelineReport> {
  const since = parseSince(input.since);
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  const jobId = input.jobId ?? null;
  if (jobId) await requireJob(db, jobId);

  const apps = await scopedApplications(db, jobId, since);
  const events = await scan<StageEventRow & { applications: unknown }>((from, to) => {
    let q = db
      .from("application_events")
      .select("application_id, kind, from_stage, to_stage, created_at, applications!inner(role_id, created_at, merged_into_id)")
      .not("to_stage", "is", null)
      .is("applications.merged_into_id", null);
    if (jobId) q = q.eq("applications.role_id", jobId);
    if (since) q = q.gte("applications.created_at", since);
    return q
      .order("created_at")
      .order("id")
      .range(from, to)
      .overrideTypes<Array<StageEventRow & { applications: unknown }>, { merge: false }>();
  }, EVENT_SCAN_MAX);

  const byApp = new Map<string, StageEventRow[]>();
  for (const e of events.rows) {
    const list = byApp.get(e.application_id) ?? [];
    list.push(e);
    byApp.set(e.application_id, list);
  }

  const now = Object.fromEntries(APPLICATION_STAGES.map((s) => [s, 0])) as Record<string, number>;
  const furthest: number[] = [];
  const stays = new Map<string, number[]>();
  const progressIndex = (s: string | null) => (s ? (PROGRESS as readonly string[]).indexOf(s) : -1);

  for (const app of apps.rows) {
    if (app.stage in now) now[app.stage] += 1;
    const evs = (byApp.get(app.id) ?? []).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    let far = progressIndex(app.stage);
    for (const e of evs) far = Math.max(far, progressIndex(e.from_stage), progressIndex(e.to_stage));
    furthest.push(far);

    // Stays: from entering a stage to the next move out of it.
    let current: string | null = null;
    let enteredAt: string | null = null;
    if (evs.length && evs[0].kind !== "added" && evs[0].from_stage) {
      current = evs[0].from_stage;
      enteredAt = app.created_at;
    }
    for (const e of evs) {
      if (current && enteredAt && (ACTIVE_STAGES as readonly string[]).includes(current)) {
        const list = stays.get(current) ?? [];
        list.push(Math.max(0, days(enteredAt, e.created_at)));
        stays.set(current, list);
      }
      current = e.to_stage;
      enteredAt = e.created_at;
    }
  }

  const reached = PROGRESS.map((_, i) => furthest.filter((f) => f >= i).length);
  const stages: StageRow[] = APPLICATION_STAGES.map((stage) => {
    const i = progressIndex(stage);
    const s = stays.get(stage) ?? [];
    return {
      stage,
      now: now[stage],
      reached: i >= 0 ? reached[i] : null,
      conversionToNext: i >= 0 && i < PROGRESS.length - 1 ? rate(reached[i + 1], reached[i]) : null,
      avgDaysInStage: s.length ? dayStats(s).avgDays : null,
      stays: s.length,
    };
  });
  return { jobId, since, truncated: apps.truncated || events.truncated, applications: apps.rows.length, stages };
}

// ---------------------------------------------------------------------------
// source_report
// ---------------------------------------------------------------------------

export type SourceRow = {
  source: string;
  applications: number;
  active: number;
  hired: number;
  rejected: number;
  withdrawn: number;
  /** hired / applications, 0 to 1. */
  hireRate: number | null;
};

export type SourceReport = ReportScope & { applications: number; hired: number; sources: SourceRow[] };

export async function sourceReport(db: Db, ctx: ClientToolCtx, input: { since?: string } = {}): Promise<SourceReport> {
  const since = parseSince(input.since);
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  const apps = await scopedApplications(db, null, since);
  const rows = new Map<string, SourceRow>();
  for (const app of apps.rows) {
    const row = rows.get(app.source) ?? {
      source: app.source, applications: 0, active: 0, hired: 0, rejected: 0, withdrawn: 0, hireRate: null,
    };
    row.applications += 1;
    if ((ACTIVE_STAGES as readonly string[]).includes(app.stage)) row.active += 1;
    else if (app.stage === "hired") row.hired += 1;
    else if (app.stage === "rejected") row.rejected += 1;
    else if (app.stage === "withdrawn") row.withdrawn += 1;
    rows.set(app.source, row);
  }
  const order = (s: string) => {
    const i = (CANDIDATE_SOURCES as readonly string[]).indexOf(s);
    return i < 0 ? CANDIDATE_SOURCES.length : i;
  };
  const sources = [...rows.values()]
    .map((r) => ({ ...r, hireRate: rate(r.hired, r.applications) }))
    .sort((a, b) => b.applications - a.applications || order(a.source) - order(b.source));
  return {
    jobId: null, since, truncated: apps.truncated,
    applications: apps.rows.length, hired: sources.reduce((s, r) => s + r.hired, 0), sources,
  };
}

// ---------------------------------------------------------------------------
// time_to_hire
// ---------------------------------------------------------------------------

export type JobFirstHire = { jobId: string; title: string; openedAt: string; firstHireAt: string; days: number };

export type TimeToHire = ReportScope & {
  /** Hires since `since` (by the day they were marked hired). */
  hires: number;
  /** Days from an application being added to its hire. */
  applicationToHire: DayStats;
  /** Days from a job being created to its first hire, for jobs whose first hire is in range. */
  jobOpenToFirstHire: DayStats;
  jobs: JobFirstHire[];
};

type HireEventRow = { application_id: string; created_at: string; applications: { role_id: string; created_at: string } };

/**
 * A hire is an application whose stage is hired now, dated by the last move
 * to hired in its history (an application set to hired without one, outside
 * the pipeline module, is not counted). A job's opening is its created_at:
 * roles record no separate opening date.
 */
export async function timeToHire(
  db: Db,
  ctx: ClientToolCtx,
  input: { jobId?: string; since?: string } = {},
): Promise<TimeToHire> {
  const since = parseSince(input.since);
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  const jobId = input.jobId ?? null;
  if (jobId) await requireJob(db, jobId);

  // All of them, not only since: a job's first hire may be before the window.
  const events = await scan<HireEventRow>((from, to) => {
    let q = db
      .from("application_events")
      .select("application_id, created_at, applications!inner(role_id, created_at, stage, merged_into_id)")
      .eq("to_stage", "hired")
      .is("applications.merged_into_id", null)
      .eq("applications.stage", "hired");
    if (jobId) q = q.eq("applications.role_id", jobId);
    return q.order("created_at").order("id").range(from, to).overrideTypes<HireEventRow[], { merge: false }>();
  });

  const hireAt = new Map<string, HireEventRow>();
  for (const e of events.rows) {
    const seen = hireAt.get(e.application_id);
    if (!seen || Date.parse(e.created_at) > Date.parse(seen.created_at)) hireAt.set(e.application_id, e);
  }
  const inRange = (iso: string) => !since || Date.parse(iso) >= Date.parse(since);

  const toHire: number[] = [];
  const firstByJob = new Map<string, string>();
  for (const e of hireAt.values()) {
    if (inRange(e.created_at)) toHire.push(Math.max(0, days(e.applications.created_at, e.created_at)));
    const first = firstByJob.get(e.applications.role_id);
    if (!first || Date.parse(e.created_at) < Date.parse(first)) firstByJob.set(e.applications.role_id, e.created_at);
  }

  const jobIds = [...firstByJob.entries()].filter(([, at]) => inRange(at)).map(([id]) => id).slice(0, HELPER_CHECKS_MAX);
  const jobs: JobFirstHire[] = [];
  for (let i = 0; i < jobIds.length; i += ID_CHUNK) {
    const { data, error } = await db.from("roles").select("id, title, created_at").in("id", jobIds.slice(i, i + ID_CHUNK));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const firstHireAt = firstByJob.get(r.id)!;
      jobs.push({ jobId: r.id, title: r.title, openedAt: r.created_at, firstHireAt, days: round1(Math.max(0, days(r.created_at, firstHireAt))) });
    }
  }
  jobs.sort((a, b) => Date.parse(a.firstHireAt) - Date.parse(b.firstHireAt));
  return {
    jobId, since, truncated: events.truncated,
    hires: toHire.length,
    applicationToHire: dayStats(toHire),
    jobOpenToFirstHire: dayStats(jobs.map((j) => j.days)),
    jobs,
  };
}

// ---------------------------------------------------------------------------
// rejection_report
// ---------------------------------------------------------------------------

export type RejectionRow = { kind: "rejected" | "withdrew"; reason: string | null; applications: number };

export type RejectionReport = ReportScope & { rejected: number; withdrawn: number; reasons: RejectionRow[] };

type CloseEventRow = {
  application_id: string;
  to_stage: string;
  created_at: string;
  applications: { stage: string; rejection_reason_id: string | null };
};

/**
 * Applications closed now (rejected or withdrawn), dated by their last move
 * to that stage, grouped by reason. `reason` null = closed without one (a
 * board drag can). Only applications the member can read count.
 */
export async function rejectionReport(db: Db, ctx: ClientToolCtx, input: { since?: string } = {}): Promise<RejectionReport> {
  const since = parseSince(input.since);
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  const events = await scan<CloseEventRow>((from, to) => {
    let q = db
      .from("application_events")
      .select("application_id, to_stage, created_at, applications!inner(stage, rejection_reason_id, merged_into_id)")
      .in("to_stage", ["rejected", "withdrawn"])
      .is("applications.merged_into_id", null)
      .in("applications.stage", ["rejected", "withdrawn"]);
    if (since) q = q.gte("created_at", since);
    return q.order("created_at").order("id").range(from, to).overrideTypes<CloseEventRow[], { merge: false }>();
  });
  const closed = new Map<string, CloseEventRow>();
  for (const e of events.rows) {
    // The move that closed it as it stands now: the last one to its current stage.
    if (e.to_stage !== e.applications.stage) continue;
    const seen = closed.get(e.application_id);
    if (!seen || Date.parse(e.created_at) > Date.parse(seen.created_at)) closed.set(e.application_id, e);
  }

  const { data: reasons, error } = await db.from("rejection_reasons").select("id, kind, name");
  if (error) throw new Error(error.message);
  const names = new Map((reasons ?? []).map((r) => [r.id, r.name]));

  const counts = new Map<string, RejectionRow>();
  let rejected = 0;
  let withdrawn = 0;
  for (const e of closed.values()) {
    const kind = e.applications.stage === "rejected" ? "rejected" : "withdrew";
    if (kind === "rejected") rejected += 1;
    else withdrawn += 1;
    const reason = e.applications.rejection_reason_id ? (names.get(e.applications.rejection_reason_id) ?? null) : null;
    const key = `${kind}\u0000${reason ?? ""}`;
    const row = counts.get(key) ?? { kind, reason, applications: 0 };
    row.applications += 1;
    counts.set(key, row);
  }
  const rows = [...counts.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || b.applications - a.applications || (a.reason ?? "~").localeCompare(b.reason ?? "~"),
  );
  return { jobId: null, since, truncated: events.truncated, rejected, withdrawn, reasons: rows };
}

// ---------------------------------------------------------------------------
// interviewer_activity
// ---------------------------------------------------------------------------

export type InterviewerRow = {
  userId: string;
  name: string | null;
  /** Interviews that have ended and were not cancelled. */
  interviews: number;
  feedbackFiled: number;
  onTime: number;
  late: number;
  notFiled: number;
  /** Whether they filed is hidden from the caller by the org's feedback setting. */
  notVisible: number;
  /** Median hours from the interview's end to their feedback. */
  medianHoursToFeedback: number | null;
};

/** One interviewer's feedback not filed on one interview, as far as the caller can tell (never a hidden one). */
export type OutstandingFeedback = { interviewId: string; applicationId: string; interviewerId: string; endsAt: string };

export type InterviewerActivity = ReportScope & {
  onTimeHours: number;
  interviewers: InterviewerRow[];
  /** Every not-filed pair counted in `notFiled`, oldest interview first. */
  outstanding: OutstandingFeedback[];
};

type InterviewRow = {
  id: string;
  application_id: string;
  ends_at: string;
  interviewer_actor_ids: string[];
  applications: { role_id: string };
};

/**
 * For admins and anyone who manages a job (a hiring manager or recruiter on
 * its team): per interviewer, the interviews that ended since `since` on the
 * jobs the caller manages, and whether and when they filed feedback. Whether
 * someone filed is what the caller's token reads: an admin reads every
 * feedback row, a hiring manager only what the org's feedback_visibility
 * shows them, and a filing they cannot see is counted as not visible, never
 * as missing.
 */
export async function interviewerActivity(
  db: Db,
  ctx: ClientToolCtx,
  input: { since?: string } = {},
): Promise<InterviewerActivity> {
  const since = parseSince(input.since);
  const refuse = () =>
    new ClientToolError("forbidden", "Interviewer activity is for admins and the people who manage a job (its hiring manager or recruiter).");
  if (ctx.accessLevel === "limited") throw refuse();
  const admin = ctx.accessLevel === "admin";

  // A hiring-team member: the jobs they manage, asked of the policies' own helper.
  let managed: Set<string> | null = null;
  if (!admin) {
    const { data: jobs, error } = await db.from("roles").select("id").order("created_at", { ascending: false }).limit(HELPER_CHECKS_MAX);
    if (error) throw new Error(error.message);
    managed = new Set();
    for (const j of jobs ?? []) {
      const { data: can, error: permError } = await db.rpc("can_on_role", { p_role: j.id, perm: "can_manage_job" });
      if (permError) throw new Error(permError.message);
      if (can === true) managed.add(j.id);
    }
    if (!managed.size) throw refuse();
  }

  const nowIso = new Date().toISOString();
  const interviews = await scan<InterviewRow>((from, to) => {
    let q = db
      .from("interviews")
      .select("id, application_id, ends_at, interviewer_actor_ids, applications!inner(role_id, merged_into_id)")
      .neq("status", "cancelled")
      .is("applications.merged_into_id", null)
      .lte("ends_at", nowIso);
    if (since) q = q.gte("ends_at", since);
    return q.order("ends_at").order("id").range(from, to).overrideTypes<InterviewRow[], { merge: false }>();
  });
  const rows = interviews.rows.filter((i) => !managed || managed.has(i.applications.role_id));

  const filed = new Map<string, string>();
  const ids = rows.map((i) => i.id);
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await db
      .from("interview_feedback").select("interview_id, interviewer_actor_id, submitted_at").in("interview_id", ids.slice(i, i + ID_CHUNK));
    if (error) throw new Error(error.message);
    for (const f of data ?? []) filed.set(`${f.interview_id}:${f.interviewer_actor_id}`, f.submitted_at);
  }

  const per = new Map<string, InterviewerRow & { hours: number[] }>();
  const outstanding: OutstandingFeedback[] = [];
  const missing = (interview: InterviewRow, userId: string) =>
    outstanding.push({ interviewId: interview.id, applicationId: interview.application_id, interviewerId: userId, endsAt: interview.ends_at });
  let checks = 0;
  for (const interview of rows) {
    for (const userId of interview.interviewer_actor_ids ?? []) {
      const row = per.get(userId) ?? {
        userId, name: null, interviews: 0, feedbackFiled: 0, onTime: 0, late: 0, notFiled: 0, notVisible: 0,
        medianHoursToFeedback: null, hours: [],
      };
      row.interviews += 1;
      const at = filed.get(`${interview.id}:${userId}`);
      if (at) {
        row.feedbackFiled += 1;
        const hours = (Date.parse(at) - Date.parse(interview.ends_at)) / 3_600_000;
        row.hours.push(Math.max(0, hours));
        if (hours <= FEEDBACK_ON_TIME_HOURS) row.onTime += 1;
        else row.late += 1;
      } else if (admin) {
        row.notFiled += 1;
        missing(interview, userId);
      } else if (checks < HELPER_CHECKS_MAX) {
        checks += 1;
        // Absent or hidden: the same helper the feedback policy uses tells them apart.
        const { data: sees, error } = await db.rpc("can_see_feedback", { p_interview: interview.id, p_interviewer: userId });
        if (error) throw new Error(error.message);
        if (sees === true) {
          row.notFiled += 1;
          missing(interview, userId);
        } else row.notVisible += 1;
      } else {
        row.notVisible += 1;
      }
      per.set(userId, row);
    }
  }

  const userIds = [...per.keys()];
  for (let i = 0; i < userIds.length; i += ID_CHUNK) {
    const { data, error } = await db.from("org_members").select("id, display_name").in("id", userIds.slice(i, i + ID_CHUNK));
    if (error) throw new Error(error.message);
    for (const m of data ?? []) if (m.id && per.has(m.id)) per.get(m.id)!.name = m.display_name;
  }

  const interviewers = [...per.values()]
    .map(({ hours, ...r }) => ({ ...r, medianHoursToFeedback: hours.length ? dayStats(hours).medianDays : null }))
    .sort((a, b) => b.interviews - a.interviews || (a.name ?? "").localeCompare(b.name ?? ""));
  // The scan is ordered by ends_at, so the list already runs oldest first.
  return { jobId: null, since, truncated: interviews.truncated, onTimeHours: FEEDBACK_ON_TIME_HOURS, interviewers, outstanding };
}

// ---------------------------------------------------------------------------
// offer_report
// ---------------------------------------------------------------------------

export type OfferReport = ReportScope & {
  offers: number;
  byStatus: Record<"draft" | "extended" | "accepted" | "declined" | "withdrawn", number>;
  /** accepted / (accepted + declined), 0 to 1. */
  acceptanceRate: number | null;
  /** Days from extending an offer to its answer, over accepted and declined ones. */
  daysToAnswer: DayStats;
};

type OfferRow = { status: string; extended_at: string | null; resolved_at: string | null };

/** Offers created since `since`, on the jobs the member manages (the offers policy decides). */
export async function offerReport(db: Db, ctx: ClientToolCtx, input: { since?: string } = {}): Promise<OfferReport> {
  const since = parseSince(input.since);
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  const offers = await scan<OfferRow>((from, to) => {
    // An offer stays on an application a merge marked merged: not counted twice.
    let q = db
      .from("offers")
      .select("status, extended_at, resolved_at, applications!inner(merged_into_id)")
      .is("applications.merged_into_id", null);
    if (since) q = q.gte("created_at", since);
    return q.order("created_at").order("id").range(from, to).overrideTypes<OfferRow[], { merge: false }>();
  });
  const byStatus = { draft: 0, extended: 0, accepted: 0, declined: 0, withdrawn: 0 };
  const answered: number[] = [];
  for (const o of offers.rows) {
    if (o.status in byStatus) byStatus[o.status as keyof typeof byStatus] += 1;
    if ((o.status === "accepted" || o.status === "declined") && o.extended_at && o.resolved_at) {
      answered.push(Math.max(0, days(o.extended_at, o.resolved_at)));
    }
  }
  return {
    jobId: null, since, truncated: offers.truncated,
    offers: offers.rows.length,
    byStatus,
    acceptanceRate: rate(byStatus.accepted, byStatus.accepted + byStatus.declined),
    daysToAnswer: dayStats(answered),
  };
}
