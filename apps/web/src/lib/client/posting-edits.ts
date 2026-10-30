import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import type { PostingError, PostingNotice } from "@/app/client/jobs/messages";
import type { PostingDraft } from "./posting-edit-rules";

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
  /** Saves over whatever is there now. */
  overwrite: boolean;
  /** After the save, publish (`live`) or take down (`closed`). */
  status: "live" | "closed" | null;
};

/**
 * Saves the editor: the post, then the job's department and hiring steps,
 * then the status. It stops at the first refusal, so a post someone else
 * changed is not half overwritten and never goes live with text the member
 * did not see.
 */
export async function savePosting(db: Db, ctx: clientTools.ClientToolCtx, input: SaveInput): Promise<SaveResult> {
  const { jobId, draft, status } = input;
  let postId = input.postId ?? undefined;
  try {
    if (input.postId) {
      const id = input.postId;
      const posts = await step("post", () => clientTools.listJobPosts(db, ctx, { jobId }));
      const current = posts.find((p) => p.postId === id);
      if (!current) return { ok: false, error: "not_found", jobId };
      if (!input.overwrite && input.seenUpdatedAt && current.updatedAt !== input.seenUpdatedAt) return { ok: false, error: "changed", jobId, postId };
      const saved = await step("post", () => clientTools.updateJobPost(db, ctx, { postId: id, ...postFields(draft) }));
      if (saved.outcome === "changed_since") return { ok: false, error: "changed", jobId, postId };
    } else {
      postId = (await step("post", () => clientTools.createJobPost(db, ctx, { jobId, ...postFields(draft) }))).postId;
    }
    const target = postId!;
    await step("job", () => clientTools.updateJob(db, ctx, { jobId, department: draft.departmentId }));
    const plan = await step("plan", () => clientTools.setInterviewPlan(db, ctx, { jobId, steps: draft.steps }));
    if (status) {
      const moved = await step("status", () => clientTools.setJobPostStatus(db, ctx, { postId: target, status }));
      if (moved.outcome === "changed_since") return { ok: false, error: "changed", jobId, postId };
    }
    return {
      ok: true,
      jobId,
      postId: target,
      notice: status === "live" ? "published" : status === "closed" ? "closed" : "saved",
      keptOnInterviews: plan.keptOnInterviews.reduce((n, k) => n + k.interviews, 0),
    };
  } catch (err) {
    if (err instanceof Stopped) return { ok: false, error: err.code, jobId, postId };
    throw err;
  }
}
