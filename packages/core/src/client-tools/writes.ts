import type { Db } from "@tacit/db";

import { addCandidateToRole, type AddCandidateResult as CandidateOutcome } from "../pipeline/candidate.js";
import {
  NEXT_ACTION_MAX, isApplicationStage, moveStage, parseDueDate, setNextAction, type ApplicationStage,
} from "../pipeline/pipeline.js";
import { withAudit } from "./audit.js";
import { ClientToolError, NOTE_MAX, type ClientToolCtx } from "./context.js";

/**
 * The client connector's writes, each one core's pipeline function on the
 * member's own client. The permission check before each write is the same
 * helper the policy uses, asked first so the answer is a sentence rather than
 * a write that silently changed nothing; the policy still decides the write.
 */

async function can(db: Db, fn: "can_add_people" | "can_on_role" | "can_edit_application", args?: Record<string, string>): Promise<boolean> {
  const { data, error } = await (args ? db.rpc(fn as "can_on_role", args as never) : db.rpc(fn as "can_add_people"));
  if (error) throw new Error(error.message);
  return data === true;
}

export type AddCandidateResult = {
  outcome: "added" | "already_in_pipeline";
  applicationId: string;
  candidateId: string;
  /** False when someone already in the company's records was reused. */
  newCandidate: boolean;
  stage: string;
};

export async function addCandidate(
  db: Db,
  ctx: ClientToolCtx,
  input: { jobId: string; name: string; email?: string | null; linkedinUrl?: string | null },
): Promise<AddCandidateResult> {
  // Adding someone new makes their person row first, which needs both.
  if (!(await can(db, "can_on_role", { p_role: input.jobId, perm: "can_edit_pipeline" })) || !(await can(db, "can_add_people"))) {
    throw new ClientToolError("forbidden", "You can't add candidates to that job. Ask an admin at your company for hiring-team access to it.");
  }
  const result = await withAudit<CandidateOutcome>(db, ctx, { action: "application.add", entity: "application" }, async () => {
    const r = await addCandidateToRole(db, {
      orgId: ctx.orgId, roleId: input.jobId, actorId: ctx.actorId,
      name: input.name, email: input.email, linkedinUrl: input.linkedinUrl,
    });
    if (r.status === "invalid") return { result: r, entityId: null, changed: false };
    return {
      result: r,
      entityId: r.applicationId,
      after: { job_id: input.jobId, candidate_id: r.personId, new_candidate: r.personCreated },
      changed: r.status === "added",
    };
  });
  if (result.status === "invalid") {
    const what = { name: "a name", email: "a valid email address", linkedin: "a linkedin.com profile link" }[result.field];
    throw new ClientToolError("invalid", `That needs ${what}.`);
  }
  return {
    outcome: result.status === "added" ? "added" : "already_in_pipeline",
    applicationId: result.applicationId,
    candidateId: result.personId,
    newCandidate: result.personCreated,
    stage: result.status === "exists" ? result.stage : "sourced",
  };
}

type ApplicationRef = { id: string; stage: string; role_id: string; added_by_actor_id: string | null };

/** The application, if the member can read it, and whether they may change it. */
async function editableApplication(db: Db, applicationId: string): Promise<ApplicationRef> {
  const { data, error } = await db
    .from("applications").select("id, stage, role_id, added_by_actor_id").eq("id", applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new ClientToolError("not_found", "No application with that id that you can see. get_pipeline and get_candidate list them.");
  }
  // The policy's own check; added_by may be null for an application its adder no longer exists for.
  const allowed = await can(db, "can_edit_application", { p_role: data.role_id, p_added_by: data.added_by_actor_id as string });
  if (!allowed) throw new ClientToolError("forbidden", "You can see that candidate but not change their place in this job.");
  return data;
}

export type StageResult = { outcome: "moved" | "unchanged" | "changed_since"; stage: string };

export async function updateStage(
  db: Db,
  ctx: ClientToolCtx,
  input: { applicationId: string; stage: string; expectedStage?: string },
): Promise<StageResult> {
  if (!isApplicationStage(input.stage)) throw new ClientToolError("invalid", "Unknown stage.");
  const stage: ApplicationStage = input.stage;
  const app = await editableApplication(db, input.applicationId);
  if (app.stage === stage) return { outcome: "unchanged", stage };
  if (input.expectedStage && app.stage !== input.expectedStage) return { outcome: "changed_since", stage: app.stage };
  return withAudit(db, ctx, { action: "application.stage_change", entity: "application" }, async () => {
    const r = await moveStage(db, { applicationId: app.id, stage, actorId: ctx.actorId, expectedStage: app.stage });
    const moved = r.status === "updated";
    return {
      result: moved ? { outcome: "moved" as const, stage } : { outcome: "changed_since" as const, stage: app.stage },
      entityId: app.id,
      before: { stage: app.stage },
      after: { stage },
      changed: moved,
    };
  });
}

export type NextActionResult = { outcome: "set" | "cleared" | "unchanged"; nextAction: string | null; due: string | null };

export async function setApplicationNextAction(
  db: Db,
  ctx: ClientToolCtx,
  input: { applicationId: string; nextAction: string | null; due?: string | null },
): Promise<NextActionResult> {
  const text = input.nextAction?.trim() || null;
  if (text && text.length > NEXT_ACTION_MAX) throw new ClientToolError("invalid", `A next action is at most ${NEXT_ACTION_MAX} characters.`);
  const due = input.due ? parseDueDate(input.due) : null;
  if (input.due && !due) throw new ClientToolError("invalid", "The due date must be YYYY-MM-DD.");
  const app = await editableApplication(db, input.applicationId);
  return withAudit(db, ctx, { action: "application.next_action", entity: "application" }, async () => {
    const r = await setNextAction(db, { applicationId: app.id, nextAction: text, due: text ? due : null, actorId: ctx.actorId });
    const changed = r.status === "updated";
    return {
      result: { outcome: !changed ? ("unchanged" as const) : text ? ("set" as const) : ("cleared" as const), nextAction: text, due: text ? due : null },
      entityId: app.id,
      after: { next_action: text, due: text ? due : null },
      changed,
    };
  });
}

export async function addNote(
  db: Db,
  ctx: ClientToolCtx,
  input: { candidateId: string; text: string },
): Promise<{ noteId: string }> {
  const text = input.text.trim();
  if (!text) throw new ClientToolError("invalid", "The note is empty.");
  if (text.length > NOTE_MAX) throw new ClientToolError("invalid", `A note is at most ${NOTE_MAX} characters.`);

  // A member notes on candidates they can see; an interviewer on the ones they interview.
  let visible: boolean;
  if (ctx.accessLevel === "limited") {
    const { data, error } = await db.rpc("my_interview_candidates");
    if (error) throw new Error(error.message);
    visible = (data ?? []).some((c) => c.person_id === input.candidateId);
  } else {
    const { data, error } = await db.from("people").select("id").eq("id", input.candidateId).maybeSingle();
    if (error) throw new Error(error.message);
    visible = !!data;
  }
  if (!visible) throw new ClientToolError("not_found", "No candidate with that id that you can see. Call search_candidates for the ids.");

  return withAudit(db, ctx, { action: "note.add", entity: "person" }, async () => {
    const { data, error } = await db
      .from("person_notes")
      .insert({ person_id: input.candidateId, actor_id: ctx.actorId, text })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { result: { noteId: data.id }, entityId: input.candidateId, after: { note_id: data.id }, changed: true };
  });
}
