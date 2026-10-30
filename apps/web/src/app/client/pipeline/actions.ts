"use server";

import { revalidatePath } from "next/cache";
import { candidateOf } from "@/lib/client/candidate-edit-rules";
import { moveCandidate, type EditOutcome } from "@/lib/client/candidate-edits";
import { parseBoardMove } from "@/lib/client/pipeline-moves";
import { requireClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import type { CandidateError } from "../candidates/[id]/messages";

// The Pipeline board's one write: the candidate page's move (lib/client/
// candidate-edits.ts's moveCandidate, on the member's own client, through the
// audited clientTools), so can_edit_pipeline, the stage the board showed and
// the hourly limit all decide as they do there. Unlike that page's actions it
// answers instead of redirecting: the board stays where it is, and says so.

export type BoardMoveResult = { ok: true; changed: boolean } | { ok: false; error: CandidateError };

export async function moveCardAction(form: FormData): Promise<BoardMoveResult> {
  const member = await requireClient();
  const input = parseBoardMove(form);
  if (!input) return { ok: false, error: "not_found" };

  let outcome: EditOutcome;
  try {
    outcome = await moveCandidate(member.db, toolCtx(member), input);
  } catch (err) {
    console.error("[client-pipeline] move failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "failed" };
  }
  if (!outcome.ok) {
    // Someone else's move: show where they are now.
    if (outcome.error === "changed") revalidatePath("/client/pipeline");
    return { ok: false, error: outcome.error };
  }
  if (outcome.changed) {
    const candidateId = candidateOf(form);
    if (candidateId) revalidatePath(`/client/candidates/${candidateId}`);
    revalidatePath(`/client/jobs/${outcome.roleId}`);
    revalidatePath("/client/candidates");
    revalidatePath("/client/pipeline");
    revalidatePath("/client");
  }
  return { ok: true, changed: outcome.changed };
}
