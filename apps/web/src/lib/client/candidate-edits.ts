import type { Db } from "@tacit/db";
import { logTouch, moveStage, setNextAction, setOwner } from "@tacit/core";
import { closeReasonKind, type MoveInput, type NextActionInput } from "./candidate-edit-rules";

// The candidate page's writes, and what its controls need to read, on the
// member's OWN client (never a privileged one). Each write is core's pipeline
// function, exactly as the job board's actions, so the policies decide again;
// the checks before it (can the member read the application, may they edit
// its job's pipeline) only answer with a code. A move carries the stage the
// page showed, so one someone else already made is reported, not overwritten.
// Nothing here writes audit_log: core's pipeline writes are not audited, and
// clientTools' audited writes take a `source` with no value for the web app.

export type CloseReason = { reasonId: string; name: string; kind: "rejected" | "withdrew" };
export type OwnerChoice = { actorId: string; name: string };

/** Per application: whether the member may edit it, and its owner's id for the picker. */
export type EditingRead = {
  editable: Map<string, { ownerActorId: string | null }>;
  owners: OwnerChoice[];
  reasons: CloseReason[];
};

const NONE: EditingRead = { editable: new Map(), owners: [], reasons: [] };

/** What the edit controls need, for the applications the page shows. Empty when the member may edit none of them. */
export async function readEditing(db: Db, applicationIds: string[]): Promise<EditingRead> {
  if (!applicationIds.length) return NONE;
  const { data: apps, error } = await db.from("applications").select("id, role_id, owner_actor_id").in("id", applicationIds);
  if (error) throw new Error(error.message);
  const roles = [...new Set((apps ?? []).map((a) => a.role_id))];
  const allowed = new Map<string, boolean>();
  await Promise.all(
    roles.map(async (role) => {
      const r = await db.rpc("can_on_role", { p_role: role, perm: "can_edit_pipeline" });
      if (r.error) throw new Error(r.error.message);
      allowed.set(role, r.data === true);
    }),
  );
  const editable = new Map<string, { ownerActorId: string | null }>();
  for (const a of apps ?? []) if (allowed.get(a.role_id)) editable.set(a.id, { ownerActorId: a.owner_actor_id });
  if (!editable.size) return NONE;

  const [members, reasons] = await Promise.all([
    db.from("org_members").select("id, display_name").order("display_name"),
    db
      .from("rejection_reasons")
      .select("id, name, kind")
      .in("kind", ["rejected", "withdrew"])
      .is("archived_at", null)
      .order("position")
      .order("name"),
  ]);
  if (members.error) throw new Error(members.error.message);
  if (reasons.error) throw new Error(reasons.error.message);
  return {
    editable,
    owners: (members.data ?? []).filter((m) => m.id).map((m) => ({ actorId: m.id!, name: m.display_name ?? "" })),
    reasons: (reasons.data ?? []).map((r) => ({ reasonId: r.id, name: r.name, kind: r.kind as CloseReason["kind"] })),
  };
}

export type EditError = "not_found" | "forbidden" | "changed" | "reason_required" | "not_member";
export type EditOutcome = { ok: true; changed: boolean; roleId: string } | { ok: false; error: EditError };

type Gate = { ok: true; app: { id: string; role_id: string; stage: string } } | { ok: false; error: "not_found" | "forbidden" };

/** The application as the member reads it, and whether they may edit its job's pipeline. */
async function gate(db: Db, applicationId: string): Promise<Gate> {
  const { data: app, error } = await db.from("applications").select("id, role_id, stage").eq("id", applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!app) return { ok: false, error: "not_found" };
  const allowed = await db.rpc("can_on_role", { p_role: app.role_id, perm: "can_edit_pipeline" });
  if (allowed.error) throw new Error(allowed.error.message);
  return allowed.data === true ? { ok: true, app } : { ok: false, error: "forbidden" };
}

/** Moves the application from the stage the page showed; a close needs one of the org's reasons of the matching kind. */
export async function moveCandidate(db: Db, actorId: string, input: MoveInput): Promise<EditOutcome> {
  const g = await gate(db, input.applicationId);
  if (!g.ok) return g;
  if (g.app.stage !== input.expectedStage) return { ok: false, error: "changed" };
  if (input.stage === input.expectedStage) return { ok: true, changed: false, roleId: g.app.role_id };

  let closeReason: { reasonId: string; reasonName: string; note: string | null } | undefined;
  const kind = closeReasonKind(input.stage);
  if (kind) {
    if (!input.reasonId) return { ok: false, error: "reason_required" };
    const { data: reason, error } = await db
      .from("rejection_reasons")
      .select("id, name, kind, archived_at")
      .eq("id", input.reasonId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!reason || reason.kind !== kind || reason.archived_at) return { ok: false, error: "reason_required" };
    closeReason = { reasonId: reason.id, reasonName: reason.name, note: input.note };
  }

  const moved = await moveStage(db, {
    applicationId: g.app.id,
    stage: input.stage,
    actorId,
    expectedStage: input.expectedStage,
    closeReason,
  });
  return moved.status === "updated" ? { ok: true, changed: true, roleId: g.app.role_id } : { ok: false, error: "changed" };
}

/** Hands the application to one of the org's members, or to nobody. */
export async function setCandidateOwner(
  db: Db,
  actorId: string,
  input: { applicationId: string; ownerActorId: string | null },
): Promise<EditOutcome> {
  const g = await gate(db, input.applicationId);
  if (!g.ok) return g;
  if (input.ownerActorId) {
    const { data: m, error } = await db.from("org_members").select("id").eq("id", input.ownerActorId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!m) return { ok: false, error: "not_member" };
  }
  const r = await setOwner(db, { applicationId: g.app.id, ownerActorId: input.ownerActorId, actorId });
  if (r.status === "not_found") return { ok: false, error: "not_found" };
  return { ok: true, changed: r.status === "updated", roleId: g.app.role_id };
}

/** Sets or clears the next action and its due date. */
export async function setCandidateNextAction(db: Db, actorId: string, input: NextActionInput): Promise<EditOutcome> {
  const g = await gate(db, input.applicationId);
  if (!g.ok) return g;
  const r = await setNextAction(db, { applicationId: g.app.id, nextAction: input.nextAction, due: input.due, actorId });
  if (r.status === "not_found") return { ok: false, error: "not_found" };
  return { ok: true, changed: r.status === "updated", roleId: g.app.role_id };
}

/** Records contact with the candidate, with an optional note of what happened. */
export async function logCandidateTouch(
  db: Db,
  actorId: string,
  input: { applicationId: string; note: string | null },
): Promise<EditOutcome> {
  const g = await gate(db, input.applicationId);
  if (!g.ok) return g;
  const r = await logTouch(db, { applicationId: g.app.id, actorId, note: input.note });
  if (r.status === "not_found") return { ok: false, error: "not_found" };
  return { ok: true, changed: true, roleId: g.app.role_id };
}
