import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import type { AccessLevel } from "./session";
import { departmentScope, inScope, type DepartmentOption } from "./department-tree";
import { readDepartments } from "./departments";
import { SOURCE_GROUPS, sourceGroup, type SourceGroup } from "./analytics-metrics";
import { readHomeTargets } from "./home-targets";
import type { HomeTargets } from "./home-target-rules";
import { readPipeline } from "./pipeline";
import type { StageName } from "./process-stages";
import { CLOSED } from "./past-applications";
import {
  EFFICIENCY_DAYS,
  bins,
  closedApplications,
  interviewEfficiency,
  mergeStays,
  periodCount,
  stretches,
  waitingSince,
  type Bin,
  type ClosedApplication,
  type EfficiencyInterview,
  type FeedbackRow,
  type InterviewEfficiency,
  type PeriodCount,
  type StageMove,
  type Waiting,
  type WorkloadInterview,
} from "./home-metrics";

// Home's read (design/tats's Recruiting Overview), on the member's OWN client
// (never a privileged one), so every number counts only what their token can
// read: an admin's org, a hiring-team member's jobs, an external recruiter's
// own adds. The live candidates are the Pipeline board's read; around them,
// plain reads of applications, application_events, interviews and each closed
// application's job, and @tacit-ats/core's pipelineReport and interviewerActivity, the connector's
// own reports. lib/client/home-metrics.ts does the counting.
//
// A department (lib/client/departments.ts) narrows every card to its jobs and
// those of the departments inside it, except interviewerActivity's (feedback
// on time, time to feedback, feedback outstanding), which has no job filter:
// those say "every job you manage". pipelineReport takes one job, so a
// department's average stays are its jobs' reports merged, weighted by stays.
//
// Not for interviewers (`limited`): the reports refuse them and the page
// keeps their own home.

const IDS_PER_READ = 150;
const PAGE = 1000;
/** Rows a table read stops at, like the reports' REPORT_SCAN_MAX; the page says so. */
const SCAN_MAX = 5000;
const DAY = 86_400_000;
/** Outstanding feedback the card lists, oldest first, before "All in Interviews". */
export const OUTSTANDING_PREVIEW = 5;
/** The hires widget's weeks; the same again before them is what it compares with. */
export const HIRE_WEEKS = 12;
/** Offers the widget lists before "All in the Inbox". */
export const OFFER_PREVIEW = 5;

export type HomeRead = {
  /** The live departments to filter by; empty for an org with none, which shows no filter. */
  departments: DepartmentOption[];
  /** The department picked, when it is a live one; null is every department. */
  departmentId: string | null;
  /** The open jobs, only the department's once one is picked. */
  jobs: { id: string; title: string }[];
  /** The job picked, when the member can see it; null is every job. */
  jobId: string | null;
  applications: PeriodCount & { bins: Bin[] };
  /** Applications per day over two periods, oldest first, so its second half is this period. */
  daily: number[];
  /** Where this period's applications came from. */
  sources: Record<SourceGroup, number>;
  /** Hires per week over HIRE_WEEKS twice, oldest first, so its second half is the last 12 weeks. */
  hires: number[];
  /** Offers waiting on this member's own sign-off, oldest first: who and for which job, never the terms. */
  offers: OfferWaiting[];
  waiting: Waiting[];
  /** The stages of the company's process, in order; null with none, or for a member who may not read it. */
  stages: StageName[] | null;
  /** Average days in each stage over stays that ended, applications added in the period (pipelineReport). */
  stays: { stage: string; avgDays: number | null; stays: number }[];
  /** From applications closed in the last EFFICIENCY_DAYS, whatever the period; null with too few. */
  efficiency: InterviewEfficiency | null;
  interviews: WorkloadInterview[];
  /** Interviewer names by actor id, for the workload. */
  names: Record<string, string>;
  /** interviewerActivity, or null for someone who manages no job. It has no job filter: every job they manage. */
  feedback: FeedbackRow[] | null;
  /** Median hours from an interview ending to feedback, over all of `feedback`'s filings; null with none. */
  feedbackMedianHours: number | null;
  /** The oldest feedback not filed (interviewerActivity's, so every job they manage), at most OUTSTANDING_PREVIEW. */
  outstanding: OutstandingRow[];
  /** What the company has set, or null when they could not be read. The company's, whatever is filtered. */
  targets: HomeTargets | null;
  /** A read stopped at its cap, so a number is a floor. */
  truncated: boolean;
};

export type OfferWaiting = { requestId: string; candidateName: string | null; jobTitle: string; requestedBy: string | null; requestedAt: string };

export type OutstandingRow = {
  interviewId: string;
  interviewerId: string;
  interviewerName: string | null;
  candidateName: string | null;
  jobTitle: string;
  endsAt: string;
};

/** Who and for which job, for the few outstanding pieces the card lists. */
async function outstandingRows(db: Db, activity: clientTools.InterviewerActivity): Promise<OutstandingRow[]> {
  const shown = activity.outstanding.slice(0, OUTSTANDING_PREVIEW);
  if (!shown.length) return [];
  const { data, error } = await db
    .from("applications")
    .select("id, people(display_name), roles(title)")
    .in("id", [...new Set(shown.map((o) => o.applicationId))]);
  if (error) throw new Error(error.message);
  const apps = new Map((data ?? []).map((a) => [a.id, a]));
  const names = new Map(activity.interviewers.map((i) => [i.userId, i.name]));
  return shown.map((o) => {
    const app = apps.get(o.applicationId);
    return {
      interviewId: o.interviewId,
      interviewerId: o.interviewerId,
      interviewerName: names.get(o.interviewerId) ?? null,
      candidateName: app?.people?.display_name ?? null,
      jobTitle: app?.roles?.title ?? "",
      endsAt: o.endsAt,
    };
  });
}

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

type ClosingRow = { application_id: string; to_stage: string; created_at: string; applications: { stage: string; role_id: string } };

/**
 * Everything interviewEfficiency counts for these applications: their
 * interviews, each read to its end, and their jobs' plans, closed jobs too.
 */
async function efficiencyReads(db: Db, closed: ClosedApplication[]) {
  const interviews: EfficiencyInterview[] = [];
  let truncated = false;
  for (let i = 0; i < closed.length; i += IDS_PER_READ) {
    const ids = closed.slice(i, i + IDS_PER_READ).map((a) => a.id);
    const read = await scanRows<{ application_id: string | null; step: string | null; status: string; starts_at: string; ends_at: string; interviewer_actor_ids: string[] | null }>((from, to) =>
      db.from("interviews").select("application_id, step, status, starts_at, ends_at, interviewer_actor_ids").in("application_id", ids).neq("status", "cancelled").order("id").range(from, to),
    );
    truncated ||= read.truncated;
    for (const row of read.rows) {
      if (row.application_id) interviews.push({ applicationId: row.application_id, step: row.step, status: row.status, startsAt: row.starts_at, endsAt: row.ends_at, interviewerIds: row.interviewer_actor_ids ?? [] });
    }
  }
  const plans = new Map<string, string[]>();
  const jobIds = [...new Set(closed.map((a) => a.roleId))];
  for (let i = 0; i < jobIds.length; i += IDS_PER_READ) {
    const { data, error } = await db.from("roles").select("id, interview_steps").in("id", jobIds.slice(i, i + IDS_PER_READ));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) plans.set(r.id, clientTools.stepsOf(r.interview_steps));
  }
  return { interviews, plans, truncated };
}

/** The YYYY-MM-DD the reports take as `since`. */
const sinceDay = (now: Date, days: number) => new Date(now.getTime() - days * DAY).toISOString().slice(0, 10);

export async function readHome(
  db: Db,
  member: { actorId: string; orgId: string; accessLevel: AccessLevel },
  input: { days: number; jobId: string | null; departmentId?: string | null },
  now: Date,
): Promise<HomeRead> {
  const nowMs = now.getTime();
  // The reports never write an audit row, so the source is never read.
  const ctx: clientTools.ClientToolCtx = { ...member, source: "claude" };
  const [pipeline, structure] = await Promise.all([readPipeline(db, now, ctx), readDepartments(db)]);
  const scope = departmentScope(structure, input.departmentId);
  const jobs = pipeline.jobs.filter((j) => inScope(scope, j.id));
  const jobId = input.jobId && jobs.some((j) => j.id === input.jobId) ? input.jobId : null;
  /** Whether a job's numbers count: the job picked, else the department's jobs, else every job. */
  const counts = (roleId: string | null | undefined) => (jobId ? roleId === jobId : !!roleId && inScope(scope, roleId));
  const entries = pipeline.entries.filter((e) => counts(e.roleId));

  const prevFrom = new Date(nowMs - 2 * input.days * DAY).toISOString();
  const since = sinceDay(now, input.days);
  const [moves, apps, ivs, activity, targets, closings, approvals] = await Promise.all([
    movesFor(db, entries.map((e) => e.applicationId)),
    // A department is narrowed here, after the read, so a long list of job ids never rides in the URL.
    scanRows<{ created_at: string; role_id: string; source: string; source_detail: string | null }>((from, to) => {
      // A merged application is the same candidate counted twice: only live ones count.
      let q = db.from("applications").select("created_at, role_id, source, source_detail").is("merged_into_id", null).gte("created_at", prevFrom);
      if (jobId) q = q.eq("role_id", jobId);
      return q.order("created_at", { ascending: false }).order("id").range(from, to);
    }),
    scanRows<{ starts_at: string; ends_at: string; interviewer_actor_ids: string[]; applications: { role_id: string } | null }>((from, to) => {
      let q = db
        .from("interviews")
        .select("starts_at, ends_at, interviewer_actor_ids, applications!inner(role_id, merged_into_id)")
        .neq("status", "cancelled")
        .is("applications.merged_into_id", null)
        .gte("starts_at", new Date(nowMs - input.days * DAY).toISOString())
        .lt("starts_at", new Date(nowMs + input.days * DAY).toISOString());
      if (jobId) q = q.eq("applications.role_id", jobId);
      return q
        .order("starts_at")
        .order("id")
        .range(from, to)
        .overrideTypes<Array<{ starts_at: string; ends_at: string; interviewer_actor_ids: string[]; applications: { role_id: string } | null }>, { merge: false }>();
    }),
    clientTools.interviewerActivity(db, ctx, { since }).catch((err: unknown) => {
      // Someone who manages no job: the card is not theirs.
      if (err instanceof clientTools.ClientToolError && err.code === "forbidden") return null;
      throw err;
    }),
    readHomeTargets(db),
    // Dated by the move that closed each one, as core's rejectionReport: an application has no closed date of its own.
    scanRows<ClosingRow>((from, to) => {
      let q = db
        .from("application_events")
        .select("application_id, to_stage, created_at, applications!inner(stage, role_id, merged_into_id)")
        .in("to_stage", [...CLOSED])
        .is("applications.merged_into_id", null)
        .in("applications.stage", [...CLOSED])
        .gte("created_at", new Date(nowMs - EFFICIENCY_DAYS * DAY).toISOString());
      if (jobId) q = q.eq("applications.role_id", jobId);
      return q.order("created_at", { ascending: false }).order("id").range(from, to).overrideTypes<ClosingRow[], { merge: false }>();
    }),
    clientTools.listMyApprovals(db, ctx),
  ]);

  const appRows = apps.rows.filter((a) => counts(a.role_id));
  // pipelineReport takes one job: every job, the job picked, or each of the
  // department's jobs with an application added since (no other job has a stay to count).
  const reportJobs: (string | undefined)[] = jobId
    ? [jobId]
    : scope.jobIds
      ? [...new Set(appRows.filter((a) => a.created_at >= since).map((a) => a.role_id))]
      : [undefined];
  const reports = await Promise.all(reportJobs.map((id) => clientTools.pipelineReport(db, ctx, { jobId: id, since })));

  const waiting: Waiting[] = entries.map((e) => ({
    applicationId: e.applicationId,
    personId: e.personId,
    roleId: e.roleId,
    roleTitle: e.roleTitle,
    personName: e.personName,
    column: e.column,
    stage: e.stageName,
    stalled: e.stalled.length > 0,
    lastTouchAt: e.lastTouchAt,
    hours: Math.max(0, nowMs - Date.parse(waitingSince(e, moves.get(e.applicationId) ?? [], nowMs))) / 3_600_000,
  }));

  const closed = closedApplications(
    closings.rows.map((m) => ({ applicationId: m.application_id, roleId: m.applications.role_id, toStage: m.to_stage, stage: m.applications.stage })),
  ).filter((a) => counts(a.roleId));
  const closedRead = await efficiencyReads(db, closed);

  // A job's department by its name, its path once it is a live one the filter offers.
  const paths = new Map(scope.options.map((o) => [o.id, o.path]));
  const teamNames = new Map(structure.departments.map((d) => [d.id, paths.get(d.id) ?? d.name]));
  const teamOf = new Map(structure.jobs.map((j) => [j.jobId, j.departmentId ? (teamNames.get(j.departmentId) ?? null) : null]));
  const interviews = ivs.rows
    .filter((i) => counts(i.applications?.role_id))
    .map((i) => ({ startsAt: i.starts_at, endsAt: i.ends_at, interviewerIds: i.interviewer_actor_ids ?? [], team: teamOf.get(i.applications?.role_id ?? "") ?? null }));
  const ids = [...new Set(interviews.flatMap((i) => i.interviewerIds))];
  const names: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += IDS_PER_READ) {
    const { data, error } = await db.from("org_members").select("id, display_name").in("id", ids.slice(i, i + IDS_PER_READ));
    if (error) throw new Error(error.message);
    for (const m of data ?? []) if (m.id && m.display_name) names[m.id] = m.display_name;
  }

  const outstanding = activity ? await outstandingRows(db, activity) : [];
  const createdAts = appRows.map((a) => a.created_at);
  const periodFrom = nowMs - input.days * DAY;
  const sources = Object.fromEntries(SOURCE_GROUPS.map((g) => [g.key, 0])) as Record<SourceGroup, number>;
  for (const a of appRows) if (Date.parse(a.created_at) >= periodFrom) sources[sourceGroup(a.source, a.source_detail)] += 1;
  // Newest first, so someone hired twice over counts at their last hire.
  const hiredAt = new Map<string, string>();
  for (const m of closings.rows) {
    if (m.to_stage === "hired" && m.applications.stage === "hired" && counts(m.applications.role_id) && !hiredAt.has(m.application_id)) hiredAt.set(m.application_id, m.created_at);
  }
  const offers = approvals
    .filter((a) => a.kind === "offer" && counts(a.jobId))
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
    .map((a) => ({ requestId: a.requestId, candidateName: a.candidateName, jobTitle: a.jobTitle, requestedBy: a.requestedBy, requestedAt: a.requestedAt }));
  return {
    departments: scope.options,
    departmentId: scope.departmentId,
    jobs,
    jobId,
    applications: { ...periodCount(createdAts, input.days, nowMs), bins: bins(createdAts, input.days, nowMs) },
    daily: stretches(createdAts, 1, input.days * 2, nowMs),
    sources,
    hires: stretches([...hiredAt.values()], 7, HIRE_WEEKS * 2, nowMs),
    offers,
    waiting,
    stages: pipeline.stages,
    stays: mergeStays(reports),
    efficiency: interviewEfficiency(closed, closedRead.interviews, closedRead.plans, nowMs),
    interviews,
    names,
    feedback: activity ? activity.interviewers : null,
    feedbackMedianHours: activity ? activity.medianHoursToFeedback : null,
    outstanding,
    targets,
    truncated: apps.truncated || ivs.truncated || reports.some((r) => r.truncated) || (activity?.truncated ?? false) || closings.truncated || closedRead.truncated,
  };
}
