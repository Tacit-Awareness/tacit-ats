import type { Db } from "@tacit/db";
import { ACTIVE_STAGES, getRolePipeline, type PipelineCard } from "@tacit/core";
import { clientTools } from "@tacit-ats/core";
import { editableRoles } from "./candidate-edits";
import { columnOf, type ColumnKey, type InterviewTimes } from "./pipeline-columns";
import { readDrawnProcess } from "./process";
import { jobStages, nextPlanStep, processStages, stageList, stageNameFor, type JobStages, type ProcessStages, type StageName } from "./process-stages";

// The Pipeline board's read, on the member's OWN client (never a privileged
// one): every open job through core's getRolePipeline, as the job page reads
// one, and every live application's interviews straight from `interviews`,
// which the `interviewing` columns are computed from and which say where a
// move into `interviewing` would land. The policies decide what comes back: an
// admin's every job, a hiring-team member's own, an external recruiter's own
// adds; nothing here filters by org or level. `editable` is can_on_role's
// answer, the check a move makes again.
//
// One getRolePipeline per job rather than core's listOpenPipelines: that one
// reads `companies(name)`, which only an admin may read, and fails for
// everyone else.

/** Application ids per `interviews` read, to keep the query string short. */
const IDS_PER_READ = 150;
/**
 * The most applications getRolePipeline gets back for a job: it does not page,
 * so PostgREST's row limit ends it, and it reads the stalest first, closed ones
 * included. The fix is paging in tacit-internal's `pipelinesFor`.
 */
const ROLE_ROWS_MAX = 1000;

export type PipelineEntry = PipelineCard & {
  roleId: string;
  roleTitle: string;
  column: ColumnKey;
  interviews: InterviewTimes[];
  editable: boolean;
  /** What the company's process calls this stage on this job; null keeps today's label. Only when the read was given a ctx. */
  stageName: StageName | null;
};
export type PipelineRead = {
  jobs: { id: string; title: string }[];
  entries: PipelineEntry[];
  /** A job reached ROLE_ROWS_MAX, so the people touched most recently may be missing from it. */
  capped: boolean;
  /** The process's stages in order, when the read was given a ctx and the member may read one. */
  stages: StageName[] | null;
};

const INTERVIEWS_PER_PAGE = 1000;

async function interviewsFor(db: Db, applicationIds: string[]) {
  const byApp = new Map<string, InterviewTimes[]>();
  const starts = Array.from({ length: Math.ceil(applicationIds.length / IDS_PER_READ) }, (_, n) => n * IDS_PER_READ);
  // At once: this is every live card now, on Home, Inbox and Analytics as well as the board.
  const reads = await Promise.all(
    starts.map(async (i) => {
      // A request brings back 1,000 rows at most, and 150 applications can have more.
      const rows = [];
      for (let from = 0; ; from += INTERVIEWS_PER_PAGE) {
        const { data, error } = await db
          .from("interviews")
          .select("id, application_id, starts_at, ends_at, status, step")
          .in("application_id", applicationIds.slice(i, i + IDS_PER_READ))
          .neq("status", "cancelled")
          .order("id")
          .range(from, from + INTERVIEWS_PER_PAGE - 1);
        if (error) throw new Error(error.message);
        rows.push(...(data ?? []));
        if ((data ?? []).length < INTERVIEWS_PER_PAGE) return rows;
      }
    }),
  );
  for (const rows of reads) {
    for (const row of rows) {
      if (!row.application_id) continue;
      const list = byApp.get(row.application_id) ?? [];
      list.push({ startsAt: row.starts_at, endsAt: row.ends_at, status: row.status, step: row.step });
      byApp.set(row.application_id, list);
    }
  }
  return byApp;
}

/**
 * Every open job the member can see, and each live application in it with its
 * column. With `naming` the page wants stage names too, so the process is read, for
 * whoever may (lib/client/process.ts); the pages that only count leave it out.
 */
export async function readPipeline(db: Db, now: Date, naming?: clientTools.ClientToolCtx): Promise<PipelineRead> {
  const { data: roles, error } = await db.from("roles").select("id, title, department_id, interview_steps").eq("status", "open").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const pipelines = (await Promise.all(roles.map((r) => getRolePipeline(db, r.id, now)))).filter((p) => p !== null);

  const live = pipelines.flatMap((p) =>
    p.cards.filter((c) => (ACTIVE_STAGES as readonly string[]).includes(c.stage)).map((c) => ({ ...c, roleId: p.roleId, roleTitle: p.roleTitle })),
  );
  const [interviews, editable, drawn] = await Promise.all([
    live.length ? interviewsFor(db, live.map((c) => c.applicationId)) : new Map<string, InterviewTimes[]>(),
    editableRoles(db, live.map((c) => c.roleId)),
    naming ? readDrawnProcess(db, naming) : null,
  ]);
  const process: ProcessStages | null = drawn ? processStages(drawn.graph, drawn.lookup.departments) : null;
  const plans = new Map(roles.map((r) => [r.id, clientTools.stepsOf(r.interview_steps)]));
  const stagesOf = new Map<string, JobStages | null>(
    process ? roles.map((r) => [r.id, jobStages(process, { departmentId: r.department_id, steps: plans.get(r.id) ?? [] })]) : [],
  );

  const entries: PipelineEntry[] = [];
  for (const card of live) {
    const ivs = interviews.get(card.applicationId) ?? [];
    const column = columnOf(card.stage, ivs, now.getTime());
    if (!column) continue;
    const stageName = stageNameFor(stagesOf.get(card.roleId) ?? null, card.stage, nextPlanStep(plans.get(card.roleId) ?? [], ivs));
    entries.push({ ...card, column, interviews: ivs, editable: editable.has(card.roleId), stageName });
  }
  return {
    jobs: pipelines.map((p) => ({ id: p.roleId, title: p.roleTitle })),
    entries,
    capped: pipelines.some((p) => p.cards.length >= ROLE_ROWS_MAX),
    stages: process ? stageList(process) : null,
  };
}
