"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearOverdueAction, decideInboxApplication, decideInboxApproval, dismissIssue, noteResolved, restoreIssue, touchApplication } from "@/lib/client/inbox";
import { approvalNotice, parseDecision } from "@/lib/client/inbox-decisions";
import { isIssueKey, parseInstance } from "@/lib/client/inbox-done";
import { requireClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import type { InboxError, InboxNotice } from "./messages";

// The Inbox's writes, on the member's own client, so the policies decide again.
// Two are the candidate page's: clear an overdue next action, through the
// audited clientTools, or log a touch, core's pipeline function. A decision is
// clientTools' too: approve or reject an approval, or move the team's call to
// offer or rejected. A fix that changed something also leaves a `resolved` row
// for the Done tab. E and Undo are the member's own inbox_dismissals row, which
// nothing else reads. Posted fields are request data, so they are re-read. A
// reason, a note and an offer's terms never go in the URL or the log.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only codes and ids go in the URL, never a name or a message.
const back = (params: { tab?: "done"; i?: string | null; notice?: InboxNotice; error?: InboxError; undo?: string }): never => {
  const qs = new URLSearchParams();
  if (params.tab) qs.set("tab", params.tab);
  if (params.i) qs.set("i", params.i);
  if (params.notice) qs.set("notice", params.notice);
  if (params.error) qs.set("error", params.error);
  if (params.undo) qs.set("undo", params.undo);
  return redirect(`/client/inbox?${qs}`);
};

const nextKey = (form: FormData) => {
  const next = form.get("next");
  return isIssueKey(next) ? next : null;
};

export async function fixIssueAction(form: FormData): Promise<void> {
  const member = await requireClient();
  const { db, actorId } = member;
  const applicationId = form.get("applicationId");
  const write = form.get("write");
  if (typeof applicationId !== "string" || !UUID.test(applicationId) || (write !== "done" && write !== "touch")) return back({ error: "not_found" });
  const i = nextKey(form);
  const expected = form.get("expected");

  let outcome: Awaited<ReturnType<typeof touchApplication>>;
  try {
    outcome = write === "done" ? await clearOverdueAction(db, toolCtx(member), { applicationId, nextAction: typeof expected === "string" ? expected : null }, new Date()) : await touchApplication(db, actorId, applicationId);
  } catch (err) {
    console.error("[client-inbox] fix failed:", err instanceof Error ? err.message : err);
    return back({ i: `app-${applicationId}`, error: "failed" });
  }
  if (!outcome.ok) {
    const { error } = outcome;
    return back({ i: `app-${applicationId}`, error: error === "forbidden" || error === "rate_limited" ? error : "not_found" });
  }

  if (outcome.changed) await noteResolved(db, parseInstance(form, `app-${applicationId}`));
  revalidatePath("/client/inbox");
  revalidatePath("/client/pipeline");
  // On to the next issue: the one below it in the list, as the page sent it.
  return back({ i, notice: !outcome.changed ? "unchanged" : write === "done" ? "done" : "touched" });
}

/** A, O or R, once the member has confirmed: the dialog posts here. */
export async function decideIssueAction(form: FormData): Promise<void> {
  const member = await requireClient();
  const { db } = member;
  const decision = parseDecision(form);
  if (!decision) return back({ error: "not_found" });
  const here = decision.on === "approval" ? `appr-${decision.requestId}` : `app-${decision.move.applicationId}`;

  let done: { notice: InboxNotice } | { error: InboxError };
  let settled = false;
  try {
    if (decision.on === "approval") {
      const outcome = await decideInboxApproval(db, toolCtx(member), decision);
      done = outcome.ok ? { notice: approvalNotice(outcome.outcome, outcome.kind) } : { error: outcome.error };
      settled = outcome.ok && outcome.outcome !== "not_pending" && outcome.outcome !== "reset";
    } else {
      const outcome = await decideInboxApplication(db, toolCtx(member), decision.move);
      settled = outcome.ok && outcome.changed;
      if (outcome.ok) done = { notice: !outcome.changed ? "unchanged" : decision.move.stage === "offer" ? "moved_offer" : "closed" };
      else done = { error: outcome.error === "not_member" ? "not_found" : outcome.error };
    }
  } catch (err) {
    console.error("[client-inbox] decision failed:", err instanceof Error ? err.message : err);
    done = { error: "failed" };
  }
  if ("error" in done) return back({ i: here, error: done.error });

  if (settled) await noteResolved(db, parseInstance(form, here));
  revalidatePath("/client/inbox");
  revalidatePath("/client/pipeline");
  // On to the next issue, as the page sent it.
  return back({ i: nextKey(form), notice: done.notice });
}

/** E: this one instance leaves this member's queue and shows under Done. A stale page's names one that has gone, and that row hides nothing. */
export async function dismissIssueAction(form: FormData): Promise<void> {
  const { db } = await requireClient();
  const instance = parseInstance(form);
  if (!instance) return back({ error: "not_found" });

  let outcome: Awaited<ReturnType<typeof dismissIssue>>;
  try {
    outcome = await dismissIssue(db, instance);
  } catch (err) {
    console.error("[client-inbox] dismiss failed:", err instanceof Error ? err.message : err);
    return back({ i: instance.key, error: "dismiss_failed" });
  }
  if (!outcome.ok) return back({ i: instance.key, error: "dismiss_refused" });

  revalidatePath("/client/inbox");
  return outcome.changed ? back({ i: nextKey(form), notice: "dismissed", undo: outcome.id }) : back({ i: nextKey(form), notice: "unchanged" });
}

/** Undo, and Move back to Inbox. By the row's id: the policy finds only the member's own, so anyone else's is simply not there. */
export async function restoreIssueAction(form: FormData): Promise<void> {
  const { db } = await requireClient();
  const id = form.get("id");
  if (typeof id !== "string" || !UUID.test(id)) return back({ tab: "done", notice: "restore_gone" });

  let restored: Awaited<ReturnType<typeof restoreIssue>>;
  try {
    restored = await restoreIssue(db, id);
  } catch (err) {
    console.error("[client-inbox] restore failed:", err instanceof Error ? err.message : err);
    return back({ tab: "done", i: id, error: "restore_failed" });
  }
  if (!restored) return back({ notice: "restore_gone" });

  revalidatePath("/client/inbox");
  return back({ i: isIssueKey(restored.key) ? restored.key : null, notice: "restored" });
}
