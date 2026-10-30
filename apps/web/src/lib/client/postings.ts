import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import type { PostingJob } from "./posting-groups";

// The Job Postings reads, on the member's OWN client (never a privileged
// one), through the client connector's own tools where it has one, so the
// page and the connector agree on what a member may read: listDepartments
// (each with its path) and listJobPosts (each post with its questions and
// the applications counted under the answers policy). The jobs themselves are
// read straight from `roles`, as list_jobs reads them, with the department's
// id rather than its name (two departments may share a name under different
// parents) and without list_jobs's cap of 50. An interviewer reads no
// departments and no counts.

export type PostingsRead = { departments: clientTools.Department[]; jobs: PostingJob[]; posts: clientTools.JobPost[] };

type RoleRow = {
  id: string; title: string; status: string; location: string | null;
  department_id?: string | null; applications?: Array<{ count: number }>;
};

export async function readPostings(db: Db, ctx: clientTools.ClientToolCtx): Promise<PostingsRead> {
  const full = ctx.accessLevel !== "limited";
  const { data, error } = await db
    .from("roles")
    .select(full ? "id, title, status, location, department_id, applications(count)" : "id, title, status, location")
    .order("created_at", { ascending: false })
    .overrideTypes<RoleRow[], { merge: false }>();
  if (error) throw new Error(error.message);
  const jobs: PostingJob[] = (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    location: r.location,
    departmentId: full ? (r.department_id ?? null) : null,
    inPipeline: full ? (r.applications?.[0]?.count ?? 0) : null,
  }));

  const [departments, posts] = await Promise.all([
    // Archived ones too: a job keeps the department it was filed under.
    full ? clientTools.listDepartments(db, ctx, { includeArchived: true }) : Promise.resolve([]),
    allPosts(db, ctx, jobs),
  ]);
  return { departments, jobs, posts };
}

/**
 * Every post on these jobs. listJobPosts stops at LIST_MAX; when it does,
 * the jobs it left without a post are asked one by one, so a row never says
 * "No post" for a post past the cap.
 */
async function allPosts(db: Db, ctx: clientTools.ClientToolCtx, jobs: PostingJob[]): Promise<clientTools.JobPost[]> {
  const first = await clientTools.listJobPosts(db, ctx);
  if (first.length < clientTools.LIST_MAX) return first;
  const seen = new Set(first.map((p) => p.jobId));
  const rest = await Promise.all(jobs.filter((j) => !seen.has(j.id)).map((j) => clientTools.listJobPosts(db, ctx, { jobId: j.id })));
  return [...first, ...rest.flat()];
}

export type PostingDetail = {
  job: { id: string; title: string; status: string; location: string | null; department: string | null; departmentId: string | null };
  posts: clientTools.JobPost[];
};

/** One job and its posts, newest first; null when the member cannot see the job. */
export async function readPosting(db: Db, ctx: clientTools.ClientToolCtx, jobId: string): Promise<PostingDetail | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) return null;
  const full = ctx.accessLevel !== "limited";
  const { data, error } = await db
    .from("roles")
    .select(full ? "id, title, status, location, department_id" : "id, title, status, location")
    .eq("id", jobId)
    .maybeSingle()
    .overrideTypes<RoleRow | null, { merge: false }>();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const [departments, posts] = await Promise.all([
    full && data.department_id ? clientTools.listDepartments(db, ctx, { includeArchived: true }) : Promise.resolve([]),
    clientTools.listJobPosts(db, ctx, { jobId }),
  ]);
  return {
    job: {
      id: data.id,
      title: data.title,
      status: data.status,
      location: data.location,
      department: departments.find((d) => d.departmentId === data.department_id)?.path ?? null,
      departmentId: full ? (data.department_id ?? null) : null,
    },
    posts,
  };
}

export type DepartmentChoice = { id: string; path: string };

/** The departments a job may be filed under: the live ones, plus the archived one it is already in. */
export async function departmentChoices(db: Db, ctx: clientTools.ClientToolCtx, current: string | null): Promise<DepartmentChoice[]> {
  const all = await clientTools.listDepartments(db, ctx, { includeArchived: true });
  return all.filter((d) => !d.archived || d.departmentId === current).map((d) => ({ id: d.departmentId, path: d.path }));
}

export type PostingEditing = { steps: string[]; departments: DepartmentChoice[] };

/**
 * What the editor adds to the read, for whoever may manage the job
 * (`can_on_role(job, 'can_manage_job')`, what updateJobPost itself asks); null
 * for everyone else, who get the read-only post. Hiding the editor is
 * presentation: the writes and the policies check again.
 */
export async function readPostingEditing(
  db: Db,
  ctx: clientTools.ClientToolCtx,
  job: Pick<PostingDetail["job"], "id" | "departmentId">,
): Promise<PostingEditing | null> {
  if (ctx.accessLevel === "limited") return null;
  const { data, error } = await db.rpc("can_on_role", { p_role: job.id, perm: "can_manage_job" });
  if (error) throw new Error(error.message);
  if (data !== true) return null;
  const [plan, departments] = await Promise.all([
    clientTools.getInterviewPlan(db, ctx, { jobId: job.id }),
    departmentChoices(db, ctx, job.departmentId),
  ]);
  return { steps: plan.steps, departments };
}
