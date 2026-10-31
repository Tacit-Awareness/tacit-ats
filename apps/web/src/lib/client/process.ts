import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { readMembers } from "./member-access";
import type { ApplyError, SaveAnswer, SaveError, SkipReason } from "@/app/client/onboarding/process/messages";
import { scanRows } from "./interviewers";
import { cleanGraph, defaultGraph, jobSteps, planChange, readGraph, validateGraph, type PlanChange, type ProcessDoc, type ProcessLookup } from "./process-graph";

// Onboarding's Interview process step, on the member's own token: admins and the
// company's own hiring team read (core's getProcess refuses anyone else, and the
// page has asked onboardingAccess first).

export type ProcessRead = {
  graph: ProcessDoc;
  /** False while the company has saved nothing: `graph` is then the neutral start, stored nowhere. */
  drawn: boolean;
  /** What the next save names. Null with nothing saved. */
  updatedAt: string | null;
  lookup: ProcessLookup;
};

/** Every department, archived ones too: a job may sit in one, and the graph outlives them. */
async function readLookup(db: Db, ctx: clientTools.ClientToolCtx): Promise<ProcessLookup> {
  const [departments, members] = await Promise.all([clientTools.listDepartments(db, ctx, { includeArchived: true }), readMembers(db)]);
  return {
    departments: departments.map((d) => ({ id: d.departmentId, name: d.name, parentId: d.parentId, archived: d.archived })),
    members: members.rows.flatMap((m) => (m.id ? [{ id: m.id, name: m.display_name ?? "" }] : [])),
  };
}

export async function readProcess(db: Db, ctx: clientTools.ClientToolCtx): Promise<ProcessRead> {
  const [saved, lookup] = await Promise.all([clientTools.getProcess(db, ctx), readLookup(db, ctx)]);
  if (!saved) return { graph: defaultGraph(), drawn: false, updatedAt: null, lookup };
  return { graph: readGraph(saved.graph), drawn: true, updatedAt: saved.updatedAt, lookup };
}

const SAVE_REFUSALS: Partial<Record<clientTools.ClientToolErrorCode, SaveError>> = {
  forbidden: "forbidden",
  invalid: "invalid",
  rate_limited: "rate_limited",
};

/**
 * A save keeps a drawing with problems in it: nothing live reads the graph, and a
 * half-drawn process should not be lost to a closed tab. Apply is what wants a sound
 * one. What the page sent is read strictly, so nothing is dropped quietly.
 */
export async function saveProcess(db: Db, ctx: clientTools.ClientToolCtx, input: { graph: unknown; expectedUpdatedAt: string | null }): Promise<SaveAnswer> {
  const graph = cleanGraph(input.graph);
  if (!graph) return { ok: false, error: "invalid" };
  try {
    const result = await clientTools.setProcess(db, ctx, { graph, expectedUpdatedAt: input.expectedUpdatedAt });
    if (result.outcome !== "stale") return { ok: true, updatedAt: result.updatedAt, changed: result.outcome !== "unchanged" };
    const now = await clientTools.getProcess(db, ctx);
    return { ok: false, stale: true, latest: now?.updatedAt ?? null };
  } catch (err) {
    if (err instanceof clientTools.ClientToolError) {
      const error = SAVE_REFUSALS[err.code];
      if (error) return { ok: false, error };
    }
    console.error("[client-process] saving failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "failed" };
  }
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/** A job that has finished hiring keeps the plan it was hired on. */
const FINISHED = ["filled", "closed"];

type JobRow = { id: string; title: string; status: string; department_id: string | null; interview_steps: unknown };

export type ApplyJob = {
  jobId: string;
  title: string;
  /** The department's name; null for a job in none. */
  team: string | null;
  current: string[];
  /** What Apply would write; null when it would write nothing. */
  next: string[] | null;
  /** `change`: Apply would change it. `same`: it already matches. `skipped`: see reason. */
  state: "change" | "same" | "skipped";
  reason: SkipReason | null;
  change: PlanChange | null;
  keptOnInterviews: Array<{ step: string; interviews: number; scheduled: number }>;
};

export type ApplyAnswer =
  | { ok: true; mode: "preview" | "applied"; jobs: ApplyJob[]; updated: number; truncated: boolean }
  | { ok: false; error: ApplyError };

/** The jobs Apply offers: every one the member's token reads, so a confidential job they are not on is not among them. */
async function readJobs(db: Db) {
  return scanRows<JobRow>((from, to) =>
    db.from("roles").select("id, title, status, department_id, interview_steps").not("status", "in", `(${FINISHED.join(",")})`).order("title").order("id").range(from, to),
  );
}

function jobFor(row: JobRow, graph: ProcessDoc, lookup: ProcessLookup): ApplyJob {
  const current = clientTools.stepsOf(row.interview_steps);
  const team = lookup.departments.find((d) => d.id === row.department_id)?.name ?? null;
  const base = { jobId: row.id, title: row.title, team, current, keptOnInterviews: [] };
  const next = jobSteps(graph, row.department_id, lookup.departments);
  if (!next) return { ...base, next: null, state: "skipped", reason: "no_path", change: null };
  // An empty plan would clear what the job has, and that is nobody's intent here.
  if (!next.length) return { ...base, next: null, state: "skipped", reason: "no_interviews", change: null };
  const change = planChange(current, next);
  return { ...base, next, state: change.same ? "same" : "change", reason: null, change };
}

function withResult(job: ApplyJob, applied: clientTools.JobApplied | undefined): ApplyJob {
  if (!applied) return job;
  if (applied.outcome === "skipped") return { ...job, state: "skipped", reason: applied.reason };
  return { ...job, keptOnInterviews: applied.keptOnInterviews };
}

type Ready = { ok: true; jobs: ApplyJob[]; truncated: boolean } | { ok: false; error: ApplyError };

/** What is saved now, as each job would take it. Read here and never from the page, so nothing stale or tampered goes on a job. */
async function readReady(db: Db, ctx: clientTools.ClientToolCtx, expectedUpdatedAt: string): Promise<Ready> {
  const { accessLevel } = ctx;
  if (accessLevel !== "admin") return { ok: false, error: "forbidden" };
  const [saved, lookup, rows] = await Promise.all([clientTools.getProcess(db, ctx), readLookup(db, ctx), readJobs(db)]);
  if (!saved || saved.updatedAt !== expectedUpdatedAt) return { ok: false, error: "stale" };
  const graph = readGraph(saved.graph);
  if (validateGraph(graph, lookup).problems.length) return { ok: false, error: "invalid" };
  return { ok: true, jobs: rows.rows.map((r) => jobFor(r, graph, lookup)), truncated: rows.truncated };
}

function refusal(err: unknown, what: string): ApplyAnswer {
  if (err instanceof clientTools.ClientToolError) {
    if (err.code === "forbidden") return { ok: false, error: "forbidden" };
    if (err.code === "rate_limited") return { ok: false, error: "rate_limited" };
  }
  console.error(`[client-process] ${what} failed:`, err instanceof Error ? err.message : err);
  return { ok: false, error: "failed" };
}

/** What Apply would do to every job, with nothing written: core's dry run asks each job what setInterviewPlan would say. */
export async function previewApply(db: Db, ctx: clientTools.ClientToolCtx, expectedUpdatedAt: string): Promise<ApplyAnswer> {
  try {
    const ready = await readReady(db, ctx, expectedUpdatedAt);
    if (!ready.ok) return ready;
    const plans = ready.jobs.flatMap((j) => (j.state === "change" && j.next ? [{ jobId: j.jobId, steps: j.next }] : []));
    const result = await clientTools.applyProcessToJobs(db, ctx, { plans, expectedUpdatedAt, dryRun: true });
    if (result.outcome === "stale") return { ok: false, error: "stale" };
    const byJob = new Map(result.jobs.map((j) => [j.jobId, j]));
    return { ok: true, mode: "preview", jobs: ready.jobs.map((j) => withResult(j, byJob.get(j.jobId))), updated: 0, truncated: ready.truncated };
  } catch (err) {
    return refusal(err, "previewing an apply");
  }
}

/**
 * Applies what is saved to the jobs the admin ticked. Only a job the read still
 * shows, and still wants changing, is sent; one that went from under the dialog is
 * listed as skipped, with no name to give.
 */
export async function applyProcess(db: Db, ctx: clientTools.ClientToolCtx, input: { expectedUpdatedAt: string; jobIds: string[] }): Promise<ApplyAnswer> {
  try {
    const ready = await readReady(db, ctx, input.expectedUpdatedAt);
    if (!ready.ok) return ready;
    const wanted = new Set(input.jobIds);
    const picked = ready.jobs.filter((j) => wanted.has(j.jobId));
    const plans = picked.flatMap((j) => (j.state === "change" && j.next ? [{ jobId: j.jobId, steps: j.next }] : []));
    const result = await clientTools.applyProcessToJobs(db, ctx, { plans, expectedUpdatedAt: input.expectedUpdatedAt });
    if (result.outcome === "stale") return { ok: false, error: "stale" };
    const byJob = new Map(result.jobs.map((j) => [j.jobId, j]));
    const seen = new Set(picked.map((j) => j.jobId));
    const gone: ApplyJob[] = [...wanted].filter((id) => !seen.has(id)).map((jobId) => ({
      jobId, title: "A job you can't see now", team: null, current: [], next: null, state: "skipped", reason: "not_found", change: null, keptOnInterviews: [],
    }));
    return { ok: true, mode: "applied", jobs: [...picked.map((j) => withResult(j, byJob.get(j.jobId))), ...gone], updated: result.updated, truncated: ready.truncated };
  } catch (err) {
    return refusal(err, "applying the process");
  }
}
