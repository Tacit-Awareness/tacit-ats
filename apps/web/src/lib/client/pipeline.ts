import type { Db } from "@tacit/db";
import { ACTIVE_STAGES, getRolePipeline, type PipelineCard } from "@tacit/core";
import { columnOf, type ColumnKey, type InterviewTimes } from "./pipeline-columns";

// The Pipeline board's read, on the member's OWN client (never a privileged
// one): every open job through core's getRolePipeline, as the job page reads
// one, and the interviews behind the `interviewing` columns straight from
// `interviews`. The policies decide what comes back: an admin's every job, a
// hiring-team member's own, an external recruiter's own adds; nothing here
// filters by org or level.
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

export type PipelineEntry = PipelineCard & { roleId: string; roleTitle: string; column: ColumnKey; interviews: InterviewTimes[] };
export type PipelineRead = {
  jobs: { id: string; title: string }[];
  entries: PipelineEntry[];
  /** A job reached ROLE_ROWS_MAX, so the people touched most recently may be missing from it. */
  capped: boolean;
};

async function interviewsFor(db: Db, applicationIds: string[]) {
  const byApp = new Map<string, InterviewTimes[]>();
  for (let i = 0; i < applicationIds.length; i += IDS_PER_READ) {
    const { data, error } = await db
      .from("interviews")
      .select("application_id, starts_at, ends_at, status")
      .in("application_id", applicationIds.slice(i, i + IDS_PER_READ))
      .neq("status", "cancelled");
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (!row.application_id) continue;
      const list = byApp.get(row.application_id) ?? [];
      list.push({ startsAt: row.starts_at, endsAt: row.ends_at, status: row.status });
      byApp.set(row.application_id, list);
    }
  }
  return byApp;
}

/** Every open job the member can see, and each live application in it with its column. */
export async function readPipeline(db: Db, now: Date): Promise<PipelineRead> {
  const { data: roles, error } = await db.from("roles").select("id, title").eq("status", "open").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const pipelines = (await Promise.all(roles.map((r) => getRolePipeline(db, r.id, now)))).filter((p) => p !== null);

  const live = pipelines.flatMap((p) =>
    p.cards.filter((c) => (ACTIVE_STAGES as readonly string[]).includes(c.stage)).map((c) => ({ ...c, roleId: p.roleId, roleTitle: p.roleTitle })),
  );
  const interviewing = live.filter((c) => c.stage === "interviewing").map((c) => c.applicationId);
  const interviews = interviewing.length ? await interviewsFor(db, interviewing) : new Map<string, InterviewTimes[]>();

  const entries: PipelineEntry[] = [];
  for (const card of live) {
    const ivs = interviews.get(card.applicationId) ?? [];
    const column = columnOf(card.stage, ivs, now.getTime());
    if (column) entries.push({ ...card, column, interviews: ivs });
  }
  return { jobs: pipelines.map((p) => ({ id: p.roleId, title: p.roleTitle })), entries, capped: pipelines.some((p) => p.cards.length >= ROLE_ROWS_MAX) };
}
