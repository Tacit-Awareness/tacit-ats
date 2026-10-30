import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import type { AccessLevel } from "./session";
import { readPipeline } from "./pipeline";
import {
  bins,
  periodCount,
  waitingSince,
  type Bin,
  type FeedbackRow,
  type PeriodCount,
  type StageMove,
  type Waiting,
  type WorkloadInterview,
} from "./home-metrics";

// Home's read (design/tats's Recruiting Overview), on the member's OWN client
// (never a privileged one), so every number counts only what their token can
// read: an admin's org, a hiring-team member's jobs, an external recruiter's
// own adds. The live candidates are the Pipeline board's read; around them,
// plain reads of applications, application_events and interviews, and
// @tacit-ats/core's pipelineReport and interviewerActivity, the connector's
// own reports. lib/client/home-metrics.ts does the counting.
//
// Not for interviewers (`limited`): the reports refuse them and the page
// keeps their own home.

const IDS_PER_READ = 150;
const PAGE = 1000;
/** Rows a table read stops at, like the reports' REPORT_SCAN_MAX; the page says so. */
const SCAN_MAX = 5000;
const DAY = 86_400_000;

export type HomeRead = {
  jobs: { id: string; title: string }[];
  /** The job picked, when the member can see it; null is every job. */
  jobId: string | null;
  applications: PeriodCount & { bins: Bin[] };
  waiting: Waiting[];
  /** Average days in each stage over stays that ended, applications added in the period (pipelineReport). */
  stays: { stage: string; avgDays: number | null; stays: number }[];
  interviews: WorkloadInterview[];
  /** Interviewer names by actor id, for the workload. */
  names: Record<string, string>;
  /** interviewerActivity, or null for someone who manages no job. It has no job filter: every job they manage. */
  feedback: FeedbackRow[] | null;
  /** A read stopped at its cap, so a number is a floor. */
  truncated: boolean;
};

async function scanRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; from < SCAN_MAX; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

async function movesFor(db: Db, applicationIds: string[]) {
  const byApp = new Map<string, StageMove[]>();
  for (let i = 0; i < applicationIds.length; i += IDS_PER_READ) {
    const { data, error } = await db
      .from("application_events")
      .select("application_id, to_stage, created_at")
      .in("application_id", applicationIds.slice(i, i + IDS_PER_READ))
      .not("to_stage", "is", null);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (!row.to_stage) continue;
      const list = byApp.get(row.application_id) ?? [];
      list.push({ toStage: row.to_stage, at: row.created_at });
      byApp.set(row.application_id, list);
    }
  }
  return byApp;
}

/** The YYYY-MM-DD the reports take as `since`. */
const sinceDay = (now: Date, days: number) => new Date(now.getTime() - days * DAY).toISOString().slice(0, 10);

export async function readHome(
  db: Db,
  member: { actorId: string; orgId: string; accessLevel: AccessLevel },
  input: { days: number; jobId: string | null },
  now: Date,
): Promise<HomeRead> {
  const nowMs = now.getTime();
  // The reports never write an audit row, so the source is never read.
  const ctx: clientTools.ClientToolCtx = { ...member, source: "claude" };
  const pipeline = await readPipeline(db, now);
  const jobId = input.jobId && pipeline.jobs.some((j) => j.id === input.jobId) ? input.jobId : null;
  const entries = pipeline.entries.filter((e) => !jobId || e.roleId === jobId);

  const prevFrom = new Date(nowMs - 2 * input.days * DAY).toISOString();
  const [moves, apps, report, ivs, activity] = await Promise.all([
    movesFor(db, entries.map((e) => e.applicationId)),
    scanRows<{ created_at: string }>((from, to) => {
      // A merged application is the same candidate counted twice: only live ones count.
      let q = db.from("applications").select("created_at").is("merged_into_id", null).gte("created_at", prevFrom);
      if (jobId) q = q.eq("role_id", jobId);
      return q.order("created_at", { ascending: false }).order("id").range(from, to);
    }),
    clientTools.pipelineReport(db, ctx, { jobId: jobId ?? undefined, since: sinceDay(now, input.days) }),
    scanRows<{ starts_at: string; ends_at: string; interviewer_actor_ids: string[] }>((from, to) => {
      let q = db
        .from("interviews")
        .select("starts_at, ends_at, interviewer_actor_ids, applications!inner(role_id, merged_into_id)")
        .neq("status", "cancelled")
        .is("applications.merged_into_id", null)
        .gte("starts_at", new Date(nowMs - input.days * DAY).toISOString())
        .lt("starts_at", new Date(nowMs + input.days * DAY).toISOString());
      if (jobId) q = q.eq("applications.role_id", jobId);
      return q.order("starts_at").order("id").range(from, to);
    }),
    clientTools.interviewerActivity(db, ctx, { since: sinceDay(now, input.days) }).catch((err: unknown) => {
      // Someone who manages no job: the card is not theirs.
      if (err instanceof clientTools.ClientToolError && err.code === "forbidden") return null;
      throw err;
    }),
  ]);

  const waiting: Waiting[] = entries.map((e) => ({
    applicationId: e.applicationId,
    personId: e.personId,
    roleId: e.roleId,
    roleTitle: e.roleTitle,
    personName: e.personName,
    column: e.column,
    stalled: e.stalled.length > 0,
    lastTouchAt: e.lastTouchAt,
    hours: Math.max(0, nowMs - Date.parse(waitingSince(e, moves.get(e.applicationId) ?? [], nowMs))) / 3_600_000,
  }));

  const interviews = ivs.rows.map((i) => ({ startsAt: i.starts_at, endsAt: i.ends_at, interviewerIds: i.interviewer_actor_ids ?? [] }));
  const ids = [...new Set(interviews.flatMap((i) => i.interviewerIds))];
  const names: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += IDS_PER_READ) {
    const { data, error } = await db.from("org_members").select("id, display_name").in("id", ids.slice(i, i + IDS_PER_READ));
    if (error) throw new Error(error.message);
    for (const m of data ?? []) if (m.id && m.display_name) names[m.id] = m.display_name;
  }

  const createdAts = apps.rows.map((a) => a.created_at);
  return {
    jobs: pipeline.jobs,
    jobId,
    applications: { ...periodCount(createdAts, input.days, nowMs), bins: bins(createdAts, input.days, nowMs) },
    waiting,
    stays: report.stages.filter((s) => s.reached !== null && s.stage !== "hired").map((s) => ({ stage: s.stage, avgDays: s.avgDaysInStage, stays: s.stays })),
    interviews,
    names,
    feedback: activity ? activity.interviewers : null,
    truncated: apps.truncated || ivs.truncated || report.truncated || (activity?.truncated ?? false),
  };
}
