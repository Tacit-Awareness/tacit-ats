"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sendDraft } from "@/lib/client/email";
import { clearOverdueAction, decideInboxApplication, decideInboxApproval, touchApplication } from "@/lib/client/inbox";
import { approvalNotice, parseDecision } from "@/lib/client/inbox-decisions";
import { webMailer } from "@/lib/client/mailer";
import { requireClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import type { InboxError, InboxNotice } from "./messages";

// The Inbox's writes, on the member's own client, so the policies decide again.
// Two are the candidate page's: clear an overdue next action, through the
// audited clientTools, or log a touch, core's pipeline function. A decision is
// clientTools' too: approve or reject an approval, or move the team's call to
// offer or rejected. Send here is clientTools' sendEmail, on the draft the
// dialog showed. Posted fields are request data, so they are re-read. A reason,
// a note, an offer's terms and an email's words never go in the URL or the log.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISSUE_KEY = /^(app|appr|draft)-[0-9a-f-]{36}$/i;

// Only codes and ids go in the URL, never a name or a message.
const back = (params: { i?: string | null; notice?: InboxNotice; error?: InboxError }): never => {
  const qs = new URLSearchParams();
  if (params.i) qs.set("i", params.i);
  if (params.notice) qs.set("notice", params.notice);
  if (params.error) qs.set("error", params.error);
  return redirect(`/client/inbox?${qs}`);
};

const nextKey = (form: FormData) => {
  const next = form.get("next");
  return typeof next === "string" && ISSUE_KEY.test(next) ? next : null;
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
  try {
    if (decision.on === "approval") {
      const outcome = await decideInboxApproval(db, toolCtx(member), decision);
      done = outcome.ok ? { notice: approvalNotice(outcome.outcome, outcome.kind) } : { error: outcome.error };
    } else {
      const outcome = await decideInboxApplication(db, toolCtx(member), decision.move);
      if (outcome.ok) done = { notice: !outcome.changed ? "unchanged" : decision.move.stage === "offer" ? "moved_offer" : "closed" };
      else done = { error: outcome.error === "not_member" ? "not_found" : outcome.error };
    }
  } catch (err) {
    console.error("[client-inbox] decision failed:", err instanceof Error ? err.message : err);
    done = { error: "failed" };
  }
  if ("error" in done) return back({ i: here, error: done.error });

  revalidatePath("/client/inbox");
  revalidatePath("/client/pipeline");
  // On to the next issue, as the page sent it.
  return back({ i: nextKey(form), notice: done.notice });
}

/** Send, in the dialog that showed the draft: that stored draft, exactly as stored, and only its author's. */
export async function sendDraftAction(form: FormData): Promise<void> {
  const member = await requireClient();
  const draftId = form.get("draftId");
  if (typeof draftId !== "string" || !UUID.test(draftId)) return back({ error: "send_gone" });
  const here = `draft-${draftId}`;

  let done: { notice: InboxNotice } | { error: InboxError };
  try {
    const outcome = await sendDraft(member.db, toolCtx(member), webMailer(), draftId);
    done = outcome.ok ? { notice: "sent" } : { error: outcome.error };
  } catch (err) {
    console.error("[client-inbox] send failed:", err instanceof Error ? err.message : err);
    done = { error: "send_failed" };
  }
  revalidatePath("/client/inbox");
  if ("error" in done) return back({ i: here, error: done.error });

  revalidatePath("/client/applicants");
  revalidatePath("/client/pipeline");
  // On to the next issue, as the page sent it.
  return back({ i: nextKey(form), notice: done.notice });
}
