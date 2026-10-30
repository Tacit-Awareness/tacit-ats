import type { Db } from "@tacit/db";
import { departmentScope, inScope, type DepartmentNode, type DepartmentOption } from "./department-tree";
import { readDepartments } from "./departments";
import { parseChannel } from "../public/channel";
import { readPipeline } from "./pipeline";
import { readFrom, sourceGroup, type CareersData, type ExplorerApp, type ExplorerNames, type RangeKey } from "./analytics-metrics";

// Analytics' reads (design/tats's #analytics), on the member's OWN client
// (never a privileged one), so every number counts only what their token can
// read: an admin's org, a hiring-team member's jobs, an external recruiter's
// own adds. Not for interviewers (`limited`): the page sends them home.
// lib/client/analytics-metrics.ts does the counting.
//
// The careers page: `applications` added since the start of the period
// before this one, with their source and channel, `job_post_views` over the
// same days, and every job's title the member can see (a closed job's
// applications count too). Views are a separate policy from applications, so
// a member who reads one job's applications may read another job's views or
// none: each number is still only what their token can read. The explorer: the
// Pipeline board's read (open jobs, live applications, computed columns) and
// those applications' interviews with who sits on them.
//
// A department narrows both to its jobs and those of the departments inside
// it, after the read, so a long id list never rides in the URL.

const IDS_PER_READ = 150;
const PAGE = 1000;
/** Rows a table read stops at, as Home's; the page says so. */
const SCAN_MAX = 5000;

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

type Scoped = {
  /** The live departments to filter by; empty for an org with none, which shows no filter. */
  departments: DepartmentOption[];
  /** The department picked, when it is a live one; null is every department. */
  departmentId: string | null;
};

export type CareersRead = Scoped & CareersData & {
  /** Job titles by id, every job the member can see. */
  jobs: Record<string, string>;
  truncated: boolean;
};

export async function readCareers(db: Db, input: { range: RangeKey; departmentId: string | null }, now: Date): Promise<CareersRead> {
  const from = readFrom(input.range, now.getTime());
  const [structure, roles, apps, views, firstView] = await Promise.all([
    readDepartments(db),
    scanRows<{ id: string; title: string }>((from, to) => db.from("roles").select("id, title").order("id").range(from, to)),
    scanRows<{ created_at: string; role_id: string; source: string; source_detail: string | null; channel: string | null }>((start, to) =>
      // A merged application is the same candidate counted twice: only live ones count.
      db
        .from("applications")
        .select("created_at, role_id, source, source_detail, channel")
        .is("merged_into_id", null)
        .gte("created_at", from)
        .order("created_at", { ascending: false })
        .order("id")
        .range(start, to),
    ),
    // Never the rate limit's columns, which say nothing about a post.
    scanRows<{ job_post_id: string; day: string; views: number; job_posts: { role_id: string } | null }>((start, to) =>
      db
        .from("job_post_views")
        .select("job_post_id, day, views, job_posts(role_id)")
        .gte("day", from.slice(0, 10))
        .order("day", { ascending: false })
        .order("job_post_id")
        .range(start, to),
    ),
    // Views begin once, for every post: the whole org's first, so a department picked does not change when that was.
    db.from("job_post_views").select("day").order("day").limit(1).maybeSingle(),
  ]);
  if (firstView.error) throw new Error(firstView.error.message);
  const scope = departmentScope(structure, input.departmentId);
  return {
    departments: scope.options,
    departmentId: scope.departmentId,
    apps: apps.rows
      .filter((a) => inScope(scope, a.role_id))
      .map((a) => ({ createdAt: a.created_at, roleId: a.role_id, group: sourceGroup(a.source, a.source_detail), channel: parseChannel(a.channel) })),
    views: views.rows.flatMap((v) => (v.job_posts && inScope(scope, v.job_posts.role_id) ? [{ day: v.day, roleId: v.job_posts.role_id, views: v.views }] : [])),
    viewsFrom: firstView.data?.day ?? null,
    jobs: Object.fromEntries(roles.rows.map((r) => [r.id, r.title])),
    truncated: apps.truncated || roles.truncated || views.truncated,
  };
}

export type ExplorerRead = Scoped & { apps: ExplorerApp[]; names: ExplorerNames };

/** The nearest live department at or above this one, so a job in an archived department counts in its live parent. */
function liveDepartment(byId: Map<string, DepartmentNode>, id: string | null): string | null {
  const seen = new Set<string>();
  for (let d = id ? byId.get(id) : undefined; d && !seen.has(d.id); d = d.parentId ? byId.get(d.parentId) : undefined) {
    if (!d.archived) return d.id;
    seen.add(d.id);
  }
  return null;
}

export async function readExplorer(db: Db, input: { departmentId: string | null }, now: Date): Promise<ExplorerRead> {
  const [pipeline, structure] = await Promise.all([readPipeline(db, now), readDepartments(db)]);
  const scope = departmentScope(structure, input.departmentId);
  const entries = pipeline.entries.filter((e) => inScope(scope, e.roleId));

  const interviews = new Map<string, { interviewerIds: string[] }[]>();
  const ids = entries.map((e) => e.applicationId);
  for (let i = 0; i < ids.length; i += IDS_PER_READ) {
    const { data, error } = await db
      .from("interviews")
      .select("application_id, interviewer_actor_ids")
      .in("application_id", ids.slice(i, i + IDS_PER_READ))
      .neq("status", "cancelled");
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (!row.application_id) continue;
      const list = interviews.get(row.application_id) ?? [];
      list.push({ interviewerIds: row.interviewer_actor_ids ?? [] });
      interviews.set(row.application_id, list);
    }
  }

  const people = [...new Set([...interviews.values()].flat().flatMap((iv) => iv.interviewerIds))];
  const interviewers: Record<string, string> = {};
  for (let i = 0; i < people.length; i += IDS_PER_READ) {
    const { data, error } = await db.from("org_members").select("id, display_name").in("id", people.slice(i, i + IDS_PER_READ));
    if (error) throw new Error(error.message);
    for (const m of data ?? []) if (m.id && m.display_name) interviewers[m.id] = m.display_name;
  }

  const byId = new Map(structure.departments.map((d) => [d.id, d]));
  const jobDepartment = new Map(structure.jobs.map((j) => [j.jobId, liveDepartment(byId, j.departmentId)]));
  return {
    departments: scope.options,
    departmentId: scope.departmentId,
    apps: entries.map((e) => ({
      applicationId: e.applicationId,
      roleId: e.roleId,
      column: e.column,
      group: sourceGroup(e.source, e.sourceDetail),
      departmentId: jobDepartment.get(e.roleId) ?? null,
      interviews: interviews.get(e.applicationId) ?? [],
    })),
    names: {
      jobs: pipeline.jobs.filter((j) => inScope(scope, j.id)),
      departments: scope.options.map((o) => ({ id: o.id, label: o.path })),
      interviewers,
    },
  };
}
