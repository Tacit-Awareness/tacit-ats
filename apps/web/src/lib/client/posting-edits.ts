import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import type { PostingError, PostingNotice } from "@/app/client/jobs/messages";
import { cleanLine, type PostingDraft, type SeenJob } from "./posting-edit-rules";

// The posting editor's writes, on the member's OWN client, through the same
// audited clientTools the connector calls, with lib/client/tool-ctx.ts's
// source `dashboard`, so the page cannot do what the connector could not:
// createJob is an admin's, the post and the plan need can_manage_job, and the
// policies decide again. One save is several writes and each is its own audit
// row (a write that changes nothing leaves none); a post's description stays
// out of them. Nothing here is atomic, so each outcome says how far it got and
// the editor, which keeps what was typed, can save again.

export type SaveResult =
  | { ok: true; jobId: string; postId: string; notice: PostingNotice; keptOnInterviews: number }
  | { ok: false; error: PostingError; jobId?: string; postId?: string };

/** What an `invalid` from each write means. */
const INVALID: Record<"job" | "post" | "plan" | "status", PostingError> = {
  job: "invalid_department",
  post: "invalid_post",
  plan: "invalid_steps",
  status: "job_not_open",
};

class Stopped extends Error {
  constructor(readonly code: PostingError) {
    super(code);
  }
}

/** Runs one write, turning a clientTools refusal into the page's code. Anything else stays a failure. */
async function step<T>(kind: keyof typeof INVALID, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (err instanceof clientTools.ClientToolError) {
      if (err.code === "forbidden" || err.code === "rate_limited" || err.code === "not_found") throw new Stopped(err.code);
      if (err.code === "invalid") throw new Stopped(INVALID[kind]);
    }
    throw err;
  }
}

const postFields = (draft: PostingDraft) => ({
  title: draft.title,
  location: draft.location,
  description: draft.description,
  questions: draft.questions,
});

/**
 * "Add a role": the job (an admin's), its post as a draft, its hiring steps,
 * then live when `publish`. The rules checked everything they can before the
 * job is made, so a stop here is a limit or a failed request, and the answer
 * carries how far it got for the next save to carry on from.
 */
export async function createRole(db: Db, ctx: clientTools.ClientToolCtx, draft: PostingDraft, opts: { publish: boolean }): Promise<SaveResult> {
  let jobId: string | undefined;
  let postId: string | undefined;
  try {
    const job = await step("job", () =>
      clientTools.createJob(db, ctx, { title: draft.title, location: draft.location, department: draft.departmentId }),
    );
    const madeJob = (jobId = job.jobId);
    const post = await step("post", () => clientTools.createJobPost(db, ctx, { jobId: madeJob, ...postFields(draft) }));
    const madePost = (postId = post.postId);
    if (draft.steps.length) await step("plan", () => clientTools.setInterviewPlan(db, ctx, { jobId: madeJob, steps: draft.steps }));
    if (opts.publish) await step("status", () => clientTools.setJobPostStatus(db, ctx, { postId: madePost, status: "live" }));
    return { ok: true, jobId: madeJob, postId: madePost, notice: opts.publish ? "posted" : "drafted", keptOnInterviews: 0 };
  } catch (err) {
    if (err instanceof Stopped) return { ok: false, error: err.code, jobId, postId };
    // A failed request after the job exists must not read as nothing having happened.
    if (jobId) {
      console.error("[client-postings] adding a role stopped partway:", err instanceof Error ? err.message : err);
      return { ok: false, error: "failed", jobId, postId };
    }
    throw err;
  }
}

export type SaveInput = {
  jobId: string;
  /** Null makes the job's first post. */
  postId: string | null;
  draft: PostingDraft;
  /** The version the editor opened; a post saved since then comes back `changed`. Null skips the check. */
  seenUpdatedAt: string | null;
  /**
   * The job's department and steps as the editor opened them, which the post's
   * version says nothing about. Only what differs from this is written, so
   * saving a post never puts back what someone else changed on the job. Left
   * out, or null for a job this editor has only just made, both are written.
   */
  seenJob?: SeenJob | null;
  /** Saves over whatever is there now. */
  overwrite: boolean;
  /** After the save, publish (`live`) or take down (`closed`). */
  status: "live" | "closed" | null;
};

const sameSteps = (a: string[], b: string[]) => a.length === b.length && a.every((s, n) => s === b[n]);

/**
 * Which of the job's two fields this save writes: the ones the member changed,
 * and `changed` if someone else moved one of those to something else since.
 * Equal to the draft is this member's own save that stopped partway.
 */
async function jobWrites(db: Db, input: SaveInput): Promise<{ department: boolean; steps: boolean }> {
  const { draft, seenJob: seen } = input;
  if (!seen) return { department: true, steps: true };
  const writes = { department: draft.departmentId !== seen.departmentId, steps: !sameSteps(draft.steps, seen.steps) };
  if (input.overwrite || (!writes.department && !writes.steps)) return writes;
  const { data, error } = await db.from("roles").select("department_id, interview_steps").eq("id", input.jobId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Stopped("not_found");
  const steps = clientTools.stepsOf(data.interview_steps).map(cleanLine);
  const theirs =
    (writes.department && data.department_id !== seen.departmentId && data.department_id !== draft.departmentId) ||
    (writes.steps && !sameSteps(steps, seen.steps) && !sameSteps(steps, draft.steps));
  if (theirs) throw new Stopped("changed");
  return writes;
}

/**
 * Saves the editor: the post, then what the member changed of the job's
 * department and hiring steps, then the status. It stops at the first refusal,
 * so a post someone else changed is not half overwritten and never goes live
 * with text the member did not see.
 */
export async function savePosting(db: Db, ctx: clientTools.ClientToolCtx, input: SaveInput): Promise<SaveResult> {
  const { jobId, draft, status } = input;
  let postId = input.postId ?? undefined;
  // updateJobPost would say the same, later: this also tells them nothing about the post.
  if (ctx.accessLevel === "limited") return { ok: false, error: "forbidden", jobId, postId };
  try {
    if (input.postId) {
      const id = input.postId;
      const posts = await step("post", () => clientTools.listJobPosts(db, ctx, { jobId }));
      const current = posts.find((p) => p.postId === id);
      if (!current) return { ok: false, error: "not_found", jobId };
      if (!input.overwrite && input.seenUpdatedAt && current.updatedAt !== input.seenUpdatedAt) return { ok: false, error: "changed", jobId, postId };
    }
    const writes = await jobWrites(db, input);
    if (input.postId) {
      const id = input.postId;
      const saved = await step("post", () => clientTools.updateJobPost(db, ctx, { postId: id, ...postFields(draft) }));
      if (saved.outcome === "changed_since") return { ok: false, error: "changed", jobId, postId };
    } else {
      postId = (await step("post", () => clientTools.createJobPost(db, ctx, { jobId, ...postFields(draft) }))).postId;
    }
    const target = postId!;
    if (writes.department) await step("job", () => clientTools.updateJob(db, ctx, { jobId, department: draft.departmentId }));
    const plan = writes.steps ? await step("plan", () => clientTools.setInterviewPlan(db, ctx, { jobId, steps: draft.steps })) : null;
    if (status) {
      const moved = await step("status", () => clientTools.setJobPostStatus(db, ctx, { postId: target, status }));
      if (moved.outcome === "changed_since") return { ok: false, error: "changed", jobId, postId };
    }
    return {
      ok: true,
      jobId,
      postId: target,
      notice: status === "live" ? "published" : status === "closed" ? "closed" : "saved",
      keptOnInterviews: plan?.keptOnInterviews.reduce((n, k) => n + k.interviews, 0) ?? 0,
    };
  } catch (err) {
    if (err instanceof Stopped) return { ok: false, error: err.code, jobId, postId };
    // As in createRole: a first post that now exists has to be named, or the next save makes a second.
    if (postId && !input.postId) {
      console.error("[client-postings] saving stopped partway:", err instanceof Error ? err.message : err);
      return { ok: false, error: "failed", jobId, postId };
    }
    throw err;
  }
}
