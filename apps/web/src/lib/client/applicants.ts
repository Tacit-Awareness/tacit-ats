import type { Db } from "@tacit/db";
import { moveStage } from "@tacit/core";
import { clientTools } from "@tacit-ats/core";
import type { AccessLevel } from "./session";
import type { QueueEntry } from "./applicant-queue";

// Applicant Tickets' read and its one write, on the member's OWN client (never
// a privileged one). The queue is core's listApplicationsInbox, the client
// connector's list_applications_inbox: job-board applications and referrals
// still at the first stage, with their answers, exactly the ones the policies
// let the member read. Routing one is core's moveStage, as the job board's actions,
// so the policies decide again; the checks before it only answer with a code.

/** Who is reading, as listApplicationsInbox needs it. */
export type QueueReader = { actorId: string; orgId: string; accessLevel: AccessLevel };

export async function readApplicantQueue(db: Db, who: QueueReader): Promise<QueueEntry[]> {
  // `source` names the caller in audit rows; a read writes none.
  const ctx: clientTools.ClientToolCtx = { ...who, source: "claude" };
  return clientTools.listApplicationsInbox(db, ctx, { limit: clientTools.LIST_MAX });
}

/** Notes kept on one application, as many as a ticket shows. */
const NOTES_MAX = 20;

/** The team's notes on an application, oldest first: a referral's note is the first of them. */
export async function readApplicationNotes(db: Db, applicationId: string): Promise<string[]> {
  const { data, error } = await db
    .from("application_events").select("detail").eq("application_id", applicationId).eq("kind", "note")
    .order("created_at").limit(NOTES_MAX);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((e) => (e.detail ? [e.detail] : []));
}

export type RejectReason = { reasonId: string; name: string };

/** What the routing bar needs for one application's job: whether the member may move it, and the org's rejection reasons. */
export async function readRouting(db: Db, jobId: string): Promise<{ canEdit: boolean; reasons: RejectReason[] }> {
  const [canEdit, reasons] = await Promise.all([
    db.rpc("can_on_role", { p_role: jobId, perm: "can_edit_pipeline" }),
    db.from("rejection_reasons").select("id, name").eq("kind", "rejected").is("archived_at", null).order("position").order("name"),
  ]);
  if (canEdit.error) throw new Error(canEdit.error.message);
  if (reasons.error) throw new Error(reasons.error.message);
  return { canEdit: canEdit.data === true, reasons: (reasons.data ?? []).map((r) => ({ reasonId: r.id, name: r.name })) };
}

/** Where the routing bar sends someone. */
export const ROUTES = { screening: "screening", interview: "interviewing", decline: "rejected" } as const;
export type Route = keyof typeof ROUTES;
export const isRoute = (v: unknown): v is Route => typeof v === "string" && Object.hasOwn(ROUTES, v);

export type RouteOutcome =
  | { ok: true; route: Route }
  | { ok: false; error: "not_found" | "forbidden" | "changed" | "reason_required" };

/**
 * Moves a queued applicant on: screening, interviewing, or rejected with one
 * of the org's rejected reasons. Only from the stage the queue showed them at,
 * so a ticket someone else already routed is not moved twice.
 */
export async function routeApplicant(
  db: Db,
  actorId: string,
  input: { applicationId: string; route: Route; reasonId?: string | null },
): Promise<RouteOutcome> {
  const { data: app, error } = await db.from("applications").select("id, role_id, stage").eq("id", input.applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!app) return { ok: false, error: "not_found" };
  if (!(clientTools.INBOX_STAGES as readonly string[]).includes(app.stage)) return { ok: false, error: "changed" };

  const allowed = await db.rpc("can_on_role", { p_role: app.role_id, perm: "can_edit_pipeline" });
  if (allowed.error) throw new Error(allowed.error.message);
  if (allowed.data !== true) return { ok: false, error: "forbidden" };

  let closeReason: { reasonId: string; reasonName: string; note: null } | undefined;
  if (input.route === "decline") {
    if (!input.reasonId) return { ok: false, error: "reason_required" };
    const { data: reason, error: reasonError } = await db
      .from("rejection_reasons").select("id, name, kind, archived_at").eq("id", input.reasonId).maybeSingle();
    if (reasonError) throw new Error(reasonError.message);
    if (!reason || reason.kind !== "rejected" || reason.archived_at) return { ok: false, error: "reason_required" };
    closeReason = { reasonId: reason.id, reasonName: reason.name, note: null };
  }

  const moved = await moveStage(db, { applicationId: app.id, stage: ROUTES[input.route], actorId, expectedStage: app.stage, closeReason });
  return moved.status === "updated" ? { ok: true, route: input.route } : { ok: false, error: "changed" };
}
