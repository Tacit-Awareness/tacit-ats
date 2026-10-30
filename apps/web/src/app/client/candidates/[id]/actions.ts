"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { candidateOf, parseMove, parseNextAction, parseOwner, parseTouch } from "@/lib/client/candidate-edit-rules";
import {
  logCandidateTouch,
  moveCandidate,
  setCandidateNextAction,
  setCandidateOwner,
  type EditOutcome,
} from "@/lib/client/candidate-edits";
import { requireClient } from "@/lib/client/session";
import type { CandidateError, CandidateNotice } from "./messages";

// The candidate page's writes, one form each per job: move the stage, change
// the owner, set or clear the next action, log a touch. lib/client/
// candidate-edits.ts runs core's pipeline functions on the signed-in member's
// own client, as the job board's actions do, so the policies decide whether
// each lands (can_edit_pipeline on the job). Posted fields are request data,
// so every id and choice is re-checked (lib/client/candidate-edit-rules.ts).

// Only codes and ids go in the URL, never a name or a message.
const back = (candidateId: string | null, params: { notice?: CandidateNotice; error?: CandidateError }): never => {
  if (!candidateId) return redirect("/client/candidates");
  const qs = new URLSearchParams();
  if (params.notice) qs.set("notice", params.notice);
  if (params.error) qs.set("error", params.error);
  return redirect(`/client/candidates/${candidateId}?${qs}`);
};

async function run(candidateId: string | null, notice: CandidateNotice, write: () => Promise<EditOutcome>): Promise<never> {
  let outcome: EditOutcome;
  try {
    outcome = await write();
  } catch (err) {
    console.error("[client-candidate] edit failed:", err instanceof Error ? err.message : err);
    return back(candidateId, { error: "failed" });
  }
  if (!outcome.ok) return back(candidateId, { error: outcome.error });
  if (outcome.changed) {
    if (candidateId) revalidatePath(`/client/candidates/${candidateId}`);
    revalidatePath(`/client/jobs/${outcome.roleId}`);
    revalidatePath("/client/candidates");
    revalidatePath("/client/pipeline");
    revalidatePath("/client");
  }
  return back(candidateId, { notice: outcome.changed ? notice : "unchanged" });
}

export async function moveCandidateAction(form: FormData): Promise<void> {
  const { db, actorId } = await requireClient();
  const candidateId = candidateOf(form);
  const input = parseMove(form);
  if (!input) return back(candidateId, { error: "not_found" });
  return run(candidateId, "moved", () => moveCandidate(db, actorId, input));
}

export async function setOwnerAction(form: FormData): Promise<void> {
  const { db, actorId } = await requireClient();
  const candidateId = candidateOf(form);
  const input = parseOwner(form);
  if (!input) return back(candidateId, { error: "not_member" });
  return run(candidateId, "owner", () => setCandidateOwner(db, actorId, input));
}

export async function setNextActionAction(form: FormData): Promise<void> {
  const { db, actorId } = await requireClient();
  const candidateId = candidateOf(form);
  const parsed = parseNextAction(form);
  if (!parsed.ok) return back(candidateId, { error: parsed.error });
  return run(candidateId, "next_action", () => setCandidateNextAction(db, actorId, parsed.input));
}

export async function logTouchAction(form: FormData): Promise<void> {
  const { db, actorId } = await requireClient();
  const candidateId = candidateOf(form);
  const input = parseTouch(form);
  if (!input) return back(candidateId, { error: "not_found" });
  return run(candidateId, "touched", () => logCandidateTouch(db, actorId, input));
}
