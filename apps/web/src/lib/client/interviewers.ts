import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import type { AccessLevel } from "./session";
import {
  assembleInterviewers,
  groupByDepartment,
  readWindow,
  type DepartmentRef,
  type Feedback,
  type InterviewerGroup,
  type JobRef,
  type LoadInterview,
  type TeamSeat,
} from "./interviewer-load";

// The Interviewers page's reads, on the member's OWN client (never a
// privileged one). The policies decide what comes back: the jobs and hiring
// teams they can see, the interviews on applications they can read (the inner
// join drops one whose application they cannot, so a hiring manager counts
// only their jobs' interviews), departments for the hiring team and admins,
// and core's interviewerActivity for admins and whoever manages a job.
// Nothing here filters by org. Not for an interviewer (`limited`), who is
// refused: the page points them home instead.

const PAGE = 1000;
/** Interview rows the read stops at; the page says so. */
const SCAN_MAX = 5000;
const DAY = 86_400_000;

export type InterviewersRead = {
  groups: InterviewerGroup[];
  /** Whether the member may read interviewer activity (admins, and whoever manages a job). */
  feedback: boolean;
  /** The interviews read stopped at SCAN_MAX. */
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

type InterviewRow = { starts_at: string; interviewer_actor_ids: string[]; applications: { role_id: string } };

export async function readInterviewers(
  db: Db,
  member: { actorId: string; orgId: string; accessLevel: AccessLevel },
  now: Date,
): Promise<InterviewersRead> {
  if (member.accessLevel === "limited") throw new clientTools.ClientToolError("forbidden", "Interviewers do not see who else interviews.");
  // The report never writes an audit row, so the source is never read.
  const ctx: clientTools.ClientToolCtx = { ...member, source: "claude" };
  const window = readWindow(now);
  const [interviews, seats, jobs, departments, activity] = await Promise.all([
    scanRows<InterviewRow>((from, to) =>
      db
        .from("interviews")
        .select("starts_at, interviewer_actor_ids, applications!inner(role_id, merged_into_id)")
        .neq("status", "cancelled")
        .is("applications.merged_into_id", null)
        .gte("starts_at", window.from)
        .lt("starts_at", window.to)
        .order("starts_at")
        .order("id")
        .range(from, to)
        .overrideTypes<InterviewRow[], { merge: false }>(),
    ),
    db.from("hiring_team").select("role_id, actor_id, team_role"),
    db.from("roles").select("id, title, status, department_id"),
    db.from("departments").select("id, name, parent_id"),
    clientTools.interviewerActivity(db, ctx, { since: new Date(now.getTime() - 30 * DAY).toISOString().slice(0, 10) }).catch((err: unknown) => {
      // A member who manages no job: the column is not theirs.
      if (err instanceof clientTools.ClientToolError && err.code === "forbidden") return null;
      throw err;
    }),
  ]);
  for (const r of [seats, jobs, departments]) if (r.error) throw new Error(r.error.message);

  const loads: LoadInterview[] = interviews.rows.map((i) => ({
    startsAt: i.starts_at,
    interviewerIds: i.interviewer_actor_ids ?? [],
    roleId: i.applications.role_id,
  }));
  const feedback = activity
    ? new Map<string, Feedback>(activity.interviewers.map((r) => [r.userId, { onTime: r.onTime, late: r.late, notFiled: r.notFiled, notVisible: r.notVisible }]))
    : null;

  const actorIds = new Set<string>([...(seats.data ?? []).map((s) => s.actor_id), ...loads.flatMap((i) => i.interviewerIds), ...(feedback?.keys() ?? [])]);
  const names = new Map<string, string>();
  const ids = [...actorIds];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await db.from("org_members").select("id, display_name").in("id", ids.slice(i, i + 150));
    if (error) throw new Error(error.message);
    for (const m of data ?? []) if (m.id) names.set(m.id, m.display_name ?? "");
  }

  const interviewers = assembleInterviewers({
    interviews: loads,
    seats: (seats.data ?? []).map((s): TeamSeat => ({ roleId: s.role_id, actorId: s.actor_id, teamRole: s.team_role })),
    jobs: (jobs.data ?? []).map((j): JobRef => ({ id: j.id, title: j.title, status: j.status, departmentId: j.department_id })),
    departments: (departments.data ?? []).map((d): DepartmentRef => ({ id: d.id, name: d.name, parentId: d.parent_id })),
    names,
    feedback,
    now,
  });
  return { groups: groupByDepartment(interviewers), feedback: feedback !== null, truncated: interviews.truncated };
}
