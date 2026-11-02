import { clientTools } from "@tacit-ats/core";
import type { Db } from "@tacit/db";
import { feedbackRefusal, type FeedbackError, type FeedbackForm, type FeedbackInput, type ScorecardItem } from "./feedback-rules";

// An interviewer's own feedback, filed from the Interviews reader: the
// connector's `submit_feedback` (core's audited `submitFeedback`) on the
// member's own token with `toolCtx`, source `dashboard`. Core decides who may
// file (an interviewer on it, not cancelled, started), checks the ratings
// against the job's scorecard, replaces an earlier filing whole, and keeps the
// notes out of `audit_log`. Nothing here logs what was written.

/**
 * The form for an interview the member may file on. The scorecard is a
 * convenience: if it cannot be read the form still files notes and a
 * recommendation, keeping the attributes their own filing already rated, so a
 * second filing does not drop them unseen.
 */
export async function readFeedbackForm(
  db: Db,
  ctx: clientTools.ClientToolCtx,
  input: { interviewId: string; jobId: string; mine: clientTools.FeedbackEntry | null },
): Promise<FeedbackForm> {
  const { mine } = input;
  let attributes: ScorecardItem[] = [];
  try {
    const card = await clientTools.getScorecard(db, ctx, { jobId: input.jobId });
    attributes = card.attributes.map((a) => ({ attributeId: a.attributeId, name: a.name, description: a.description }));
  } catch (err) {
    console.error("[client-feedback] scorecard read failed:", err instanceof Error ? err.message : "read failed");
  }
  for (const r of mine?.ratings ?? []) {
    if (!attributes.some((a) => a.attributeId === r.attributeId)) attributes.push({ attributeId: r.attributeId, name: r.attribute ?? "Scorecard item", description: null });
  }
  return {
    interviewId: input.interviewId,
    attributes,
    filed: !!mine,
    draft: {
      recommendation: mine?.recommendation ?? null,
      rating: mine?.rating ?? null,
      notes: mine?.notes ?? "",
      ratings: Object.fromEntries((mine?.ratings ?? []).map((r) => [r.attributeId, r.rating])),
      ratingNotes: Object.fromEntries((mine?.ratings ?? []).flatMap((r) => (r.note ? [[r.attributeId, r.note]] : []))),
    },
  };
}

export async function fileFeedback(db: Db, ctx: clientTools.ClientToolCtx, input: FeedbackInput): Promise<{ ok: true; replaced: boolean } | { ok: false; error: FeedbackError }> {
  try {
    const { replaced } = await clientTools.submitFeedback(db, ctx, input);
    return { ok: true, replaced };
  } catch (err) {
    if (err instanceof clientTools.ClientToolError) return { ok: false, error: feedbackRefusal(err.code, err.message) };
    throw err;
  }
}
