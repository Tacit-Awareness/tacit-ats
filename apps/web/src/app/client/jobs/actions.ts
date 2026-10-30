"use server";

import { revalidatePath } from "next/cache";
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
