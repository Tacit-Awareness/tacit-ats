import type { Db } from "@tacit/db";
import { ACTIVE_STAGES, getRolePipeline, type PipelineCard } from "@tacit/core";
import { editableRoles } from "./candidate-edits";
import { columnOf, type ColumnKey, type InterviewTimes } from "./pipeline-columns";

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

export type PipelineEntry = PipelineCard & { roleId: string; roleTitle: string; column: ColumnKey; interviews: InterviewTimes[]; editable: boolean };
export type PipelineRead = { jobs: { id: string; title: string }[]; entries: PipelineEntry[] };

async function interviewsFor(db: Db, applicationIds: string[]) {
  const byApp = new Map<string, InterviewTimes[]>();
  const starts = Array.from({ length: Math.ceil(applicationIds.length / IDS_PER_READ) }, (_, n) => n * IDS_PER_READ);
  // At once: this is every live card now, on Home, Inbox and Analytics as well as the board.
  const reads = await Promise.all(
    starts.map((i) =>
      db
        .from("interviews")
        .select("application_id, starts_at, ends_at, status")
        .in("application_id", applicationIds.slice(i, i + IDS_PER_READ))
        .neq("status", "cancelled"),
    ),
  );
  for (const { data, error } of reads) {
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
  const [interviews, editable] = await Promise.all([
    live.length ? interviewsFor(db, live.map((c) => c.applicationId)) : new Map<string, InterviewTimes[]>(),
    editableRoles(db, live.map((c) => c.roleId)),
  ]);

  const entries: PipelineEntry[] = [];
  for (const card of live) {
    const ivs = interviews.get(card.applicationId) ?? [];
    const column = columnOf(card.stage, ivs, now.getTime());
    if (column) entries.push({ ...card, column, interviews: ivs, editable: editable.has(card.roleId) });
  }
  return { jobs: pipelines.map((p) => ({ id: p.roleId, title: p.roleTitle })), entries };
}
