"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { candidateOf, idOf, parseLabel, parseMove, parseNextAction, parseNote, parseOffer, parseOfferMove, parseOwner, parseTouch } from "@/lib/client/candidate-edit-rules";
import {
  addCandidateNote,
  logCandidateTouch,
  moveCandidate,
  setCandidateLabel,
  setCandidateNextAction,
  setCandidateOwner,
  type EditOutcome,
  type LabelOutcome,
  type NoteOutcome,
} from "@/lib/client/candidate-edits";
import { addCandidateFile, FILE_KINDS, uploadFile, type AddFileOutcome } from "@/lib/client/candidate-files";
import { webFileStore } from "@/lib/client/file-store";
import type { FileUploadState } from "@/lib/client/file-view-rules";
import { askOfferApproval, moveOffer, saveOffer, type OfferOutcome } from "@/lib/client/offers";
import { requireClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import type { CandidateError, CandidateNotice, NoteState, OfferAnswer } from "./messages";

// The candidate page's writes, one form each per job: move the stage, change
// the owner, set or clear the next action, log a touch. lib/client/
// candidate-edits.ts runs them on the signed-in member's own client, the move
// and the next action through the audited clientTools, so the policies decide
// whether each lands (can_edit_pipeline on the job). Posted fields are request
// data, so every id and choice is re-checked (lib/client/candidate-edit-rules.ts).
// A note is one form for the candidate, not per job, and it answers in place
// rather than by redirect (NoteState), so a refusal keeps what was typed.

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
  const member = await requireClient();
  const candidateId = candidateOf(form);
  const input = parseMove(form);
  if (!input) return back(candidateId, { error: "not_found" });
  return run(candidateId, "moved", () => moveCandidate(member.db, toolCtx(member), input));
}

export async function setOwnerAction(form: FormData): Promise<void> {
  const { db, actorId } = await requireClient();
  const candidateId = candidateOf(form);
  const input = parseOwner(form);
  if (!input) return back(candidateId, { error: "not_member" });
  return run(candidateId, "owner", () => setCandidateOwner(db, actorId, input));
}

export async function setNextActionAction(form: FormData): Promise<void> {
  const member = await requireClient();
  const candidateId = candidateOf(form);
  const parsed = parseNextAction(form);
  if (!parsed.ok) return back(candidateId, { error: parsed.error });
  return run(candidateId, "next_action", () => setCandidateNextAction(member.db, toolCtx(member), parsed.input));
}

export async function logTouchAction(form: FormData): Promise<void> {
  const { db, actorId } = await requireClient();
  const candidateId = candidateOf(form);
  const input = parseTouch(form);
  if (!input) return back(candidateId, { error: "not_found" });
  return run(candidateId, "touched", () => logCandidateTouch(db, actorId, input));
}

export type LabelResult = { ok: true; changed: boolean } | { ok: false; error: CandidateError };

/** A label on or off (label-menu.tsx). Answers rather than redirecting, so the Pipeline's pop-up stays open. */
export async function setLabelAction(form: FormData): Promise<LabelResult> {
  const member = await requireClient();
  const input = parseLabel(form);
  if (!input) return { ok: false, error: "label_gone" };

  let outcome: LabelOutcome;
  try {
    outcome = await setCandidateLabel(member.db, toolCtx(member), input);
  } catch (err) {
    console.error("[client-candidate] label failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "failed" };
  }
  // Even with nothing changed: a teammate got there first, and the page should show it.
  if (outcome.ok) {
    revalidatePath(`/client/candidates/${input.candidateId}`);
    revalidatePath("/client/candidates");
    revalidatePath("/client/pipeline");
  }
  return outcome.ok ? { ok: true, changed: outcome.changed } : outcome;
}

/** An offer's answer, in place: the block is in the Pipeline's and the Inbox's pop-ups too. A log gets no message, since terms stay out of logs. */
async function offerAnswer(candidateId: string | null, write: () => Promise<OfferOutcome>): Promise<OfferAnswer> {
  let outcome: OfferOutcome;
  try {
    outcome = await write();
  } catch {
    console.error("[client-candidate] offer write failed");
    return { ok: false, error: "failed" };
  }
  if (outcome.ok && outcome.notice !== "unchanged") {
    if (candidateId) revalidatePath(`/client/candidates/${candidateId}`);
    revalidatePath("/client/candidates");
    revalidatePath("/client/pipeline");
    revalidatePath("/client/inbox");
    revalidatePath("/client");
  }
  return outcome;
}

export async function saveOfferAction(form: FormData): Promise<OfferAnswer> {
  const member = await requireClient();
  const parsed = parseOffer(form);
  if (!parsed.ok) return parsed;
  return offerAnswer(candidateOf(form), () => saveOffer(member.db, toolCtx(member), parsed.input));
}

export async function moveOfferAction(form: FormData): Promise<OfferAnswer> {
  const member = await requireClient();
  const input = parseOfferMove(form);
  if (!input) return { ok: false, error: "offer_gone" };
  return offerAnswer(candidateOf(form), () => moveOffer(member.db, toolCtx(member), input));
}

export async function askOfferApprovalAction(form: FormData): Promise<OfferAnswer> {
  const member = await requireClient();
  const offerId = idOf(form, "offerId");
  if (!offerId) return { ok: false, error: "offer_gone" };
  return offerAnswer(candidateOf(form), () => askOfferApproval(member.db, toolCtx(member), offerId));
}

export async function addNoteAction(prev: NoteState, form: FormData): Promise<NoteState> {
  const member = await requireClient();
  const candidateId = candidateOf(form);
  if (!candidateId) return back(null, {});
  const parsed = parseNote(form);
  const refuse = (error: CandidateError): NoteState => ({ added: prev.added, error, text: parsed.text });
  if (!parsed.ok) return refuse(parsed.error);

  let outcome: NoteOutcome;
  try {
    outcome = await addCandidateNote(member.db, toolCtx(member), { candidateId, text: parsed.text });
  } catch (err) {
    console.error("[client-candidate] note failed:", err instanceof Error ? err.message : err);
    return refuse("failed");
  }
  if (!outcome.ok) return refuse(outcome.error);
  revalidatePath(`/client/candidates/${candidateId}`);
  // The Pipeline's pop-up holds this box too, and its feed is that page's.
  revalidatePath("/client/pipeline");
  return { added: prev.added + 1 };
}

/**
 * A file added to the candidate (file-upload.tsx), answering in place. The
 * kind and the file are request data, checked again here and by core's
 * addFile; a log names neither the file nor the candidate's text.
 */
export async function addFileAction(prev: FileUploadState, form: FormData): Promise<FileUploadState> {
  const member = await requireClient();
  const candidateId = candidateOf(form);
  const refuse = (error: FileUploadState["error"]): FileUploadState => ({ added: prev.added, error });
  if (!candidateId) return refuse("file_gone");
  const kind = FILE_KINDS.find((k) => k === form.get("kind")) ?? "attachment";
  const file = await uploadFile(form.get("file"), kind === "resume" ? "Resume" : "Attachment");
  if (typeof file === "string") return refuse(file);

  let outcome: AddFileOutcome;
  try {
    outcome = await addCandidateFile(member.db, toolCtx(member), { candidateId, kind, file }, webFileStore());
  } catch (err) {
    console.error("[client-candidate] file failed:", err instanceof Error ? err.message : err);
    return refuse("failed");
  }
  if (!outcome.ok) return refuse(outcome.error);
  revalidatePath(`/client/candidates/${candidateId}`);
  // The Pipeline's pop-up and New Applicants' tickets show the same files.
  revalidatePath("/client/pipeline");
  revalidatePath("/client/applicants");
  return { added: prev.added + 1 };
}
