import type { Db, Json } from "@tacit/db";

import { withAudit } from "./audit.js";
import { requireSetupAdmin, requireSetupReader } from "./company-setup.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { setInterviewPlan, type PlanChange } from "./plans.js";

/**
 * How a company interviews, as one flowchart (interview_processes, tacit-internal
 * 20261031120000_tats_onboarding): at most one row per org, none meaning it has
 * not drawn one. Admins write on their own token; admins and the company's own
 * hiring team read (company-setup.ts).
 *
 * The graph is the app's to understand. This file checks only what the table's
 * trigger does: an object holding a nodes array and an edges array, and its size.
 * What a node means and whether the edges connect is the web app's
 * (lib/client/process-graph.ts), which also works out each job's steps: Apply is
 * handed them.
 *
 * A save replaces the whole graph, so it carries the `updated_at` the page read: a
 * save made since is reported and not overwritten. The audit row is the node and
 * edge count, before and after, and never the graph.
 */

/** The trigger's limit, on the graph as text. */
export const PROCESS_GRAPH_MAX_BYTES = 262144;

export type ProcessGraph = { nodes: unknown[]; edges: unknown[] };

export type InterviewProcess = {
  graph: ProcessGraph;
  /** What the next save has to name. */
  updatedAt: string;
  /** Null once that member's actor is deleted. */
  updatedBy: string | null;
};

const TOO_BIG = `An interview process is at most ${PROCESS_GRAPH_MAX_BYTES / 1024} KiB.`;
const COLUMNS = "graph, updated_at, updated_by_actor_id";

const shaped = (graph: unknown): graph is ProcessGraph => {
  const g = graph as Partial<ProcessGraph> | null;
  return typeof g === "object" && g !== null && !Array.isArray(g) && Array.isArray(g.nodes) && Array.isArray(g.edges);
};

const countsOf = (graph: ProcessGraph) => ({ nodes: graph.nodes.length, edges: graph.edges.length });

/** jsonb keeps no key order, so a graph read back is compared with its keys sorted. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(object).sort().map((k) => [k, canonical(object[k])]));
}

const sameGraph = (a: ProcessGraph, b: ProcessGraph) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** The graph's size as JSON, or null for one too deeply nested to write out. Never smaller than the trigger's measure. */
function jsonBytes(graph: ProcessGraph): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(graph)).length;
  } catch {
    return null;
  }
}

/** The company's process, or null when it has not drawn one. */
export async function getProcess(db: Db, ctx: ClientToolCtx): Promise<InterviewProcess | null> {
  await requireSetupReader(db, ctx);
  const { data, error } = await db.from("interview_processes").select(COLUMNS).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { graph: data.graph as unknown as ProcessGraph, updatedAt: data.updated_at, updatedBy: data.updated_by_actor_id };
}

export type SetProcessResult =
  | { outcome: "created" | "updated" | "unchanged"; updatedAt: string }
  /** Someone saved since `expectedUpdatedAt`: nothing was written. */
  | { outcome: "stale" };

export async function setProcess(
  db: Db,
  ctx: ClientToolCtx,
  input: {
    graph: unknown;
    /** The `updated_at` the page read; null when it read no process. */
    expectedUpdatedAt: string | null;
  },
): Promise<SetProcessResult> {
  requireSetupAdmin(ctx, "change the interview process");
  const { graph } = input;
  if (!shaped(graph)) throw new ClientToolError("invalid", "A process is an object with a nodes array and an edges array.", "graph");
  const bytes = jsonBytes(graph);
  if (bytes === null || bytes > PROCESS_GRAPH_MAX_BYTES) throw new ClientToolError("invalid", TOO_BIG, "graph");

  const { data: row, error: readError } = await db.from("interview_processes").select("graph, updated_at").maybeSingle();
  if (readError) throw new Error(readError.message);
  const before = row ? (row.graph as unknown as ProcessGraph) : null;
  if (row && before && sameGraph(before, graph)) return { outcome: "unchanged", updatedAt: row.updated_at };
  if ((row?.updated_at ?? null) !== input.expectedUpdatedAt) return { outcome: "stale" };

  const value = graph as unknown as Json;
  return withAudit<SetProcessResult>(db, ctx, { action: "interview_process.update", entity: "interview_process" }, async () => {
    const write = row
      ? await db.from("interview_processes").update({ graph: value }).eq("org_id", ctx.orgId).eq("updated_at", row.updated_at).select("updated_at")
      : await db.from("interview_processes").insert({ graph: value }).select("updated_at");
    const { data, error } = write;
    if (error) {
      // Two first saves at once: the second one finds the row.
      if (error.code === "23505") return { result: { outcome: "stale" }, entityId: null, changed: false };
      // The trigger measures the graph as text, which runs a little longer than JSON.
      if (error.code === "22023") throw new ClientToolError("invalid", TOO_BIG, "graph");
      // What the request or jsonb cannot hold: half a surrogate pair (PostgREST's PGRST102), a NUL in a string.
      if (error.code === "PGRST102" || error.code === "22P02" || error.code === "22P05") {
        throw new ClientToolError("invalid", "That process has text in it that cannot be saved.", "graph");
      }
      throw new Error(error.message);
    }
    const updatedAt = data?.[0]?.updated_at;
    if (!updatedAt) return { result: { outcome: "stale" }, entityId: null, changed: false };
    return {
      result: { outcome: row ? "updated" : "created", updatedAt },
      entityId: ctx.orgId,
      before: before ? countsOf(before) : null,
      after: countsOf(graph),
      changed: true,
    };
  });
}

/** One job, and the steps its department's way through gives it. */
export type ProcessJobPlan = { jobId: string; steps: string[] };

/**
 * Why a job was left as it was. `refused` is setInterviewPlan's forbidden: a job
 * the member sees and may not change, a confidential one they are only partly on.
 * `not_found` is one their token no longer reads, which a confidential job is to
 * an admin who is not on it.
 */
export type ApplySkipReason = "refused" | "not_found" | "invalid" | "rate_limited" | "failed";

export type JobApplied =
  | ({ jobId: string; outcome: "updated" | "unchanged" } & Pick<PlanChange, "steps" | "removed" | "keptOnInterviews">)
  | { jobId: string; outcome: "skipped"; reason: ApplySkipReason };

export type ApplyProcessResult =
  /** Someone saved the process since `expectedUpdatedAt`: nothing was written. */
  | { outcome: "stale" }
  | { outcome: "applied" | "previewed"; jobs: JobApplied[]; updated: number; unchanged: number; skipped: number };

const SKIPPED_FOR: Partial<Record<ClientToolError["code"], ApplySkipReason>> = {
  forbidden: "refused",
  not_found: "not_found",
  invalid: "invalid",
  rate_limited: "rate_limited",
};

async function applyToJob(db: Db, ctx: ClientToolCtx, plan: ProcessJobPlan, dryRun: boolean): Promise<JobApplied> {
  try {
    const { outcome, steps, removed, keptOnInterviews } = await setInterviewPlan(db, ctx, { ...plan, dryRun });
    return { jobId: plan.jobId, outcome, steps, removed, keptOnInterviews };
  } catch (err) {
    if (err instanceof ClientToolError) return { jobId: plan.jobId, outcome: "skipped", reason: SKIPPED_FOR[err.code] ?? "failed" };
    console.error("[client-tools] applying the process to a job failed:", err instanceof Error ? err.message : err);
    return { jobId: plan.jobId, outcome: "skipped", reason: "failed" };
  }
}

async function applyEach(db: Db, ctx: ClientToolCtx, plans: ProcessJobPlan[], dryRun: boolean): Promise<JobApplied[]> {
  const jobs: JobApplied[] = [];
  let limited = false;
  for (const plan of plans) {
    // Past the hourly limit every other job would only be refused too.
    const job: JobApplied = limited ? { jobId: plan.jobId, outcome: "skipped", reason: "rate_limited" } : await applyToJob(db, ctx, plan, dryRun);
    limited ||= job.outcome === "skipped" && job.reason === "rate_limited";
    jobs.push(job);
  }
  return jobs;
}

const tally = (jobs: JobApplied[]) => ({
  updated: jobs.filter((j) => j.outcome === "updated").length,
  unchanged: jobs.filter((j) => j.outcome === "unchanged").length,
  skipped: jobs.filter((j) => j.outcome === "skipped").length,
});

/**
 * The only way the process reaches a live job, and only ever asked for: each
 * job's plan is set by setInterviewPlan on the admin's own token, so its permission
 * check, its audit row and its keeping of interviews on a removed step are that
 * tool's. A job it refuses is skipped, not an error: the rest still go. `dryRun`
 * says what would happen with nothing written.
 *
 * Nothing is atomic: each job is its own write. The audit row here is the counts,
 * never the graph; each job's own `role.interview_plan` row is as ever.
 */
export async function applyProcessToJobs(
  db: Db,
  ctx: ClientToolCtx,
  input: { plans: ProcessJobPlan[]; expectedUpdatedAt: string; dryRun?: boolean },
): Promise<ApplyProcessResult> {
  requireSetupAdmin(ctx, "apply the interview process to jobs");
  const { data: row, error } = await db.from("interview_processes").select("updated_at").maybeSingle();
  if (error) throw new Error(error.message);
  if (row?.updated_at !== input.expectedUpdatedAt) return { outcome: "stale" };

  if (input.dryRun || !input.plans.length) {
    const jobs = await applyEach(db, ctx, input.plans, true);
    return { outcome: "previewed", jobs, ...tally(jobs) };
  }
  return withAudit<ApplyProcessResult>(db, ctx, { action: "interview_process.apply", entity: "interview_process" }, async () => {
    const jobs = await applyEach(db, ctx, input.plans, false);
    const counts = tally(jobs);
    return {
      result: { outcome: "applied", jobs, ...counts },
      entityId: ctx.orgId,
      after: { jobs: jobs.length, ...counts },
      changed: counts.updated > 0,
    };
  });
}
