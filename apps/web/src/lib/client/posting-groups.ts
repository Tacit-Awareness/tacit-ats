import type { clientTools } from "@tacit-ats/core";

// The Job Postings page's arithmetic (design/tats's #jobs), pure so it is
// unit-tested: which of a job's posts leads, how the jobs fall into the
// org's departments, and what each row says about its post. The read is
// lib/client/postings.ts.

export type PostingJob = {
  id: string;
  title: string;
  status: string;
  location: string | null;
  /** Null for no department, and for an interviewer, who reads none. */
  departmentId: string | null;
  /** Candidates the member can see in it; null for an interviewer. */
  inPipeline: number | null;
};

export type Posting = {
  job: PostingJob;
  /** The post an applicant would find: live first, then a draft, then a closed one; the newest of each. */
  post: clientTools.JobPost | null;
  /** How many posts the job has, the lead included. */
  posts: number;
  /** Applications through all of its posts the member can read; null for an interviewer. */
  applied: number | null;
};

export type PostingGroup = {
  /** A department id, "other" for jobs in none, or "all" when ungrouped. */
  key: string;
  /** The department's path ("Engineering > Platform"), "Other", or null when ungrouped. */
  name: string | null;
  postings: Posting[];
};

const POST_ORDER: Record<clientTools.JobPostStatus, number> = { live: 0, draft: 1, closed: 2 };
/** Open jobs first, then the ones that may open, then the ones that are done. */
const JOB_ORDER: Record<string, number> = { open: 0, pending_approval: 1, paused: 2, filled: 3, closed: 4 };

export function leadPost(posts: clientTools.JobPost[]): clientTools.JobPost | null {
  const sorted = [...posts].sort(
    (a, b) => POST_ORDER[a.status] - POST_ORDER[b.status] || Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
  return sorted[0] ?? null;
}

function byJob(a: Posting, b: Posting): number {
  return (JOB_ORDER[a.job.status] ?? 9) - (JOB_ORDER[b.job.status] ?? 9) || a.job.title.localeCompare(b.job.title);
}

/**
 * The jobs by department, in the departments' path order, with the jobs in
 * none (or in one the member cannot read) last under "Other". A department
 * with no job the member can see is left out, as on a careers page.
 * `grouped: false` (an interviewer, who reads no departments) is one list.
 */
export function groupPostings(
  input: { departments: clientTools.Department[]; jobs: PostingJob[]; posts: clientTools.JobPost[] },
  opts: { grouped: boolean },
): PostingGroup[] {
  const postsOf = new Map<string, clientTools.JobPost[]>();
  for (const p of input.posts) postsOf.set(p.jobId, [...(postsOf.get(p.jobId) ?? []), p]);
  const postings: Posting[] = input.jobs.map((job) => {
    const posts = postsOf.get(job.id) ?? [];
    const counts = posts.map((p) => p.applications).filter((n): n is number => n !== null);
    return {
      job,
      post: leadPost(posts),
      posts: posts.length,
      applied: job.inPipeline === null ? null : counts.reduce((sum, n) => sum + n, 0),
    };
  });

  if (!opts.grouped) return postings.length ? [{ key: "all", name: null, postings: postings.sort(byJob) }] : [];

  const known = new Map(input.departments.map((d) => [d.departmentId, d]));
  const groups: PostingGroup[] = [...input.departments]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((d) => ({
      key: d.departmentId,
      name: d.path,
      postings: postings.filter((p) => p.job.departmentId === d.departmentId).sort(byJob),
    }));
  groups.push({
    key: "other",
    name: "Other",
    postings: postings.filter((p) => !p.job.departmentId || !known.has(p.job.departmentId)).sort(byJob),
  });
  return groups.filter((g) => g.postings.length > 0);
}

export type PostState = { label: string; tone: "green" | "grey"; title: string };

/** What a row's pill says about the job's lead post. Green only when the public page takes applications. */
export function postState(p: Pick<Posting, "job" | "post">): PostState {
  const { job, post } = p;
  if (!post) return { label: "No post", tone: "grey", title: "Nothing on the careers page for this job yet." };
  if (post.status === "draft") return { label: "Draft", tone: "grey", title: "Not public yet." };
  if (post.status === "closed") return { label: "Closed", tone: "grey", title: "Taken down: the link answers not found." };
  if (post.accepting) return { label: "Live", tone: "green", title: "On the careers page, taking applications." };
  return {
    label: "Live",
    tone: "grey",
    title: `Published, but the job is ${job.status.replace(/_/g, " ")}, so the link answers not found until it opens.`,
  };
}

/** How many jobs are taking applications right now. */
export function liveCount(groups: PostingGroup[]): number {
  return groups.reduce((n, g) => n + g.postings.filter((p) => p.post?.accepting).length, 0);
}
