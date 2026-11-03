"use server";

import { revalidatePath } from "next/cache";
import { addJobOpenings, changeJob, closeJobOpening } from "@/lib/client/job-settings";
import { parseAddOpenings, parseCloseOpening, parseJobForm, type JobFormState, type OpeningsFormState } from "@/lib/client/job-settings-rules";
import { parseDraft, parseSeenJob, UUID } from "@/lib/client/posting-edit-rules";
import { createRole, savePosting, type SaveResult } from "@/lib/client/posting-edits";
import { requireClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";

// The posting editor's saves: audited clientTools on the signed-in member's own
// client, source `dashboard` (lib/client/posting-edits.ts), the posted draft
// re-read by lib/client/posting-edit-rules.ts first. These answer with a result
// instead of redirecting with a code, as the bot's secret does: the editor
// holds what was typed, and a redirect would throw it away on a refusal. Only
// codes come back, and what the database said goes to the log, never the page.

function revalidate(jobId: string | undefined) {
  revalidatePath("/client/jobs");
  if (jobId) {
    revalidatePath(`/client/jobs/${jobId}`);
    revalidatePath(`/client/jobs/${jobId}/post`);
  }
}

const failed = (err: unknown, jobId?: string): SaveResult => {
  console.error("[client-postings] saving failed:", err instanceof Error ? err.message : err);
  return { ok: false, error: "failed", jobId };
};

export async function savePostingAction(input: {
  jobId: string;
  postId: string | null;
  draft: unknown;
  seenUpdatedAt: string | null;
  seenJob: unknown;
  overwrite: boolean;
  status: "live" | "closed" | null;
}): Promise<SaveResult> {
  const member = await requireClient();
  const { jobId, postId, draft, seenUpdatedAt, seenJob, overwrite, status } = input ?? {};
  if (typeof jobId !== "string" || !UUID.test(jobId)) return { ok: false, error: "not_found" };
  if (postId !== null && (typeof postId !== "string" || !UUID.test(postId))) return { ok: false, error: "not_found", jobId };
  if (status !== null && status !== "live" && status !== "closed") return { ok: false, error: "invalid", jobId };
  const parsed = parseDraft(draft);
  if (!parsed.ok) return { ...parsed, jobId };

  let result: SaveResult;
  try {
    result = await savePosting(member.db, toolCtx(member), {
      jobId,
      postId,
      draft: parsed.draft,
      seenUpdatedAt: typeof seenUpdatedAt === "string" ? seenUpdatedAt : null,
      seenJob: parseSeenJob(seenJob),
      overwrite: overwrite === true,
      status,
    });
  } catch (err) {
    result = failed(err, jobId);
  }
  // A save can stop partway, so the page is refreshed either way.
  revalidate(jobId);
  return result;
}

export async function createRoleAction(input: { draft: unknown; publish: boolean }): Promise<SaveResult> {
  const member = await requireClient();
  const parsed = parseDraft(input?.draft);
  if (!parsed.ok) return parsed;

  let result: SaveResult;
  try {
    result = await createRole(member.db, toolCtx(member), parsed.draft, { publish: input.publish === true });
  } catch (err) {
    result = failed(err);
  }
  revalidate(result.jobId);
  return result;
}

// The job's own title, status and openings, from the panel under "Only your
// team sees this" (job-settings.tsx). Each answers in place, as the interview
// feedback form does: a refusal hands back what was typed, a close reason
// never reaches a log, and core decides who may.

const settingsFailed = (err: unknown) =>
  console.error("[client-job-settings] write failed:", err instanceof Error ? err.message : "write failed");

export async function saveJobAction(_prev: JobFormState, form: FormData): Promise<JobFormState> {
  const member = await requireClient();
  const parsed = parseJobForm(form);
  if (!parsed.ok) return parsed.error === null ? {} : { error: parsed.error, draft: parsed.draft };
  if (parsed.change.title === undefined && parsed.change.status === undefined) return { notice: "unchanged" };

  let outcome: Awaited<ReturnType<typeof changeJob>>;
  try {
    outcome = await changeJob(member.db, toolCtx(member), { jobId: parsed.jobId, ...parsed.change });
  } catch (err) {
    settingsFailed(err);
    return { error: "failed", draft: parsed.draft };
  }
  if (!outcome.ok) {
    // The status moved on since the page read it: nothing was saved, and the
    // page is read again so the form opens on the status the job has now.
    if (outcome.error === "status_changed") revalidatePath("/client", "layout");
    return { error: outcome.error, draft: parsed.draft };
  }
  // Its title and status are on Job Postings, the board, Home and every page that names the job.
  revalidatePath("/client", "layout");
  return { notice: outcome.value.outcome === "updated" ? "saved" : "unchanged" };
}

export async function addOpeningsAction(_prev: OpeningsFormState, form: FormData): Promise<OpeningsFormState> {
  const member = await requireClient();
  const parsed = parseAddOpenings(form);
  if (!parsed.ok) return parsed.error === null ? {} : { error: parsed.error, draft: parsed.draft };

  const draft = { count: String(parsed.count), reason: "", openingId: null };
  let outcome: Awaited<ReturnType<typeof addJobOpenings>>;
  try {
    outcome = await addJobOpenings(member.db, toolCtx(member), { jobId: parsed.jobId, count: parsed.count });
  } catch (err) {
    settingsFailed(err);
    return { error: "failed", draft };
  }
  if (!outcome.ok) return { error: outcome.error, draft };
  revalidatePath("/client", "layout");
  return { notice: "added" };
}

export async function closeOpeningAction(_prev: OpeningsFormState, form: FormData): Promise<OpeningsFormState> {
  const member = await requireClient();
  const parsed = parseCloseOpening(form);
  if (!parsed.ok) return parsed.error === null ? {} : { error: parsed.error, draft: parsed.draft };

  const draft = { count: "", reason: parsed.reason, openingId: parsed.openingId };
  let outcome: Awaited<ReturnType<typeof closeJobOpening>>;
  try {
    outcome = await closeJobOpening(member.db, toolCtx(member), { openingId: parsed.openingId, reason: parsed.reason });
  } catch (err) {
    settingsFailed(err);
    return { error: "failed", draft };
  }
  if (!outcome.ok) return { error: outcome.error, draft };
  revalidatePath("/client", "layout");
  return { notice: outcome.value.outcome === "closed" ? "closed" : "unchanged" };
}
