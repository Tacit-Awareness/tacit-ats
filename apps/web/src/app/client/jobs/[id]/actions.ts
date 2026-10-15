"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addCandidateToRole, isApplicationStage, logTouch, moveStage, removeFromPipeline, setNextAction, setOwner, type AddCandidateResult,
} from "@tacit/core";
import { requireClient } from "@/lib/client/session";
import type { JobError, JobNotice } from "../messages";

// The client job board's writes. Each runs core's pipeline function on the
// signed-in member's own database client, so the policies decide whether it
// lands (can_edit_pipeline on the job); nothing here widens what they allow.
// Bound and posted arguments arrive as request data, so every id and enum is
// re-checked. Core leaves the Tacit funnel alone for a client org's people.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  return typeof v === "string" && UUID.test(v) ? v : null;
}

function text(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function refresh(roleId: string | null) {
  if (roleId) revalidatePath(`/client/jobs/${roleId}`);
  revalidatePath("/client/jobs");
}

/** Back to the job with a code, never a name or an address. */
const back = (roleId: string, params: { notice?: JobNotice; error?: JobError }): never =>
  redirect(`/client/jobs/${roleId}?${new URLSearchParams(params)}`);

/** Someone new, or already in the org's records by email, into this job's pipeline. */
export async function addCandidateAction(formData: FormData): Promise<void> {
  const { db, actorId, org } = await requireClient();
  const roleId = id(formData, "roleId");
  if (!roleId) redirect("/client/jobs");

  // Checked first so a refused add does not leave a person row behind with no
  // application. The policies check it again on the insert.
  const allowed = await db.rpc("can_on_role", { p_role: roleId, perm: "can_edit_pipeline" });
  if (allowed.error || !allowed.data) back(roleId, { error: "forbidden" });

  let result: AddCandidateResult;
  try {
    result = await addCandidateToRole(db, {
      orgId: org.id,
      roleId,
      actorId,
      name: text(formData, "name") ?? "",
      email: text(formData, "email"),
      linkedinUrl: text(formData, "linkedinUrl"),
    });
  } catch (err) {
    console.error("[client] adding a candidate failed:", err instanceof Error ? err.message : err);
    return back(roleId, { error: "failed" });
  }
  if (result.status === "invalid") return back(roleId, { error: `invalid_${result.field}` });
  refresh(roleId);
  if (result.status === "exists") return back(roleId, { notice: "exists" });
  return back(roleId, { notice: result.personCreated ? "added" : "added_existing" });
}

/** Called directly by the board when a card is dropped on a column. */
export async function moveStageAction(applicationId: string, stage: string, roleId: string): Promise<void> {
  const { db, actorId } = await requireClient();
  if (!UUID.test(applicationId) || !UUID.test(roleId) || !isApplicationStage(stage)) return;
  await moveStage(db, { applicationId, stage, actorId });
  refresh(roleId);
}

/** The card's edit form: stage, owner, next action and its deadline in one save. */
export async function updateCardAction(formData: FormData): Promise<void> {
  const { db, actorId } = await requireClient();
  const applicationId = id(formData, "applicationId");
  if (!applicationId) return;

  const stage = formData.get("stage");
  if (isApplicationStage(stage)) await moveStage(db, { applicationId, stage, actorId });
  await setOwner(db, { applicationId, ownerActorId: id(formData, "ownerActorId"), actorId });
  await setNextAction(db, { applicationId, nextAction: text(formData, "nextAction"), due: text(formData, "due"), actorId });
  refresh(id(formData, "roleId"));
}

export async function logTouchAction(formData: FormData): Promise<void> {
  const { db, actorId } = await requireClient();
  const applicationId = id(formData, "applicationId");
  if (!applicationId) return;
  await logTouch(db, { applicationId, actorId, note: text(formData, "note") });
  refresh(id(formData, "roleId"));
}

export async function removeFromPipelineAction(formData: FormData): Promise<void> {
  const { db } = await requireClient();
  const applicationId = id(formData, "applicationId");
  if (!applicationId) return;
  await removeFromPipeline(db, applicationId);
  refresh(id(formData, "roleId"));
}
