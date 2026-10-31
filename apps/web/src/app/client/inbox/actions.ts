"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sendDraft } from "@/lib/client/email";
import { clearOverdueAction, decideInboxApplication, decideInboxApproval, dismissIssue, noteResolved, restoreIssue, touchApplication } from "@/lib/client/inbox";
import { approvalNotice, parseDecision } from "@/lib/client/inbox-decisions";
import { DEFAULT_RANGE, parseMark, parseRange, seenBy, type DigestRange } from "@/lib/client/inbox-digest";
import { isInstant, isIssueKey, parseInstance } from "@/lib/client/inbox-done";
import { markRead, readDigest } from "@/lib/client/inbox-feed";
import { webMailer } from "@/lib/client/mailer";
import { requireClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import type { InboxError, InboxNotice } from "./messages";

// The Inbox's writes, on the member's own client, so the policies decide again.
// Two are the candidate page's: clear an overdue next action, through the
// audited clientTools, or log a touch, core's pipeline function. A decision is
// clientTools' too: approve or reject an approval, or move the team's call to
// offer or rejected. Send here is clientTools' sendEmail, on the draft the
// dialog showed. A fix that changed something also leaves a `resolved` row for
// Done. E and Undo are the member's own inbox_dismissals row, which nothing else
// reads, and a digest row's read mark is one too. Posted fields are request
// data, so they are re-read. A reason, a note, an offer's terms and an email's
// words never go in the URL or the log. Every form posts its range, so what
// closes a pop-up still lands on the range it opened from. `was` names what a
// pop-up just dealt with, by key, for the toast (page.tsx reads its name).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only codes and ids go in the URL, never a name or a message.
const back = (params: { tab?: "done"; range?: DigestRange; i?: string | null; was?: string | null; notice?: InboxNotice; error?: InboxError; undo?: string }): never => {
  const qs = new URLSearchParams();
  if (params.range && params.range !== DEFAULT_RANGE) qs.set("range", String(params.range));
  if (params.tab) qs.set("tab", params.tab);
  if (params.i) qs.set("i", params.i);
  if (params.was) qs.set("was", params.was);
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
  const range = parseRange(form.get("range"));
  if (typeof applicationId !== "string" || !UUID.test(applicationId) || (write !== "done" && write !== "touch")) return back({ range, error: "not_found" });
  const i = nextKey(form);
  const expected = form.get("expected");

  let outcome: Awaited<ReturnType<typeof touchApplication>>;
  try {
    outcome = write === "done" ? await clearOverdueAction(db, toolCtx(member), { applicationId, nextAction: typeof expected === "string" ? expected : null }, new Date()) : await touchApplication(db, actorId, applicationId);
  } catch (err) {
    console.error("[client-inbox] fix failed:", err instanceof Error ? err.message : err);
    return back({ range, i: `app-${applicationId}`, error: "failed" });
  }
  if (!outcome.ok) {
    const { error } = outcome;
    return back({ range, i: `app-${applicationId}`, error: error === "forbidden" || error === "rate_limited" ? error : "not_found" });
  }

  if (outcome.changed) await noteResolved(db, parseInstance(form, `app-${applicationId}`));
  revalidatePath("/client/inbox");
  revalidatePath("/client/pipeline");
  // On to the next issue: the one below it in the list, as the page sent it.
  return back({ range, i, was: outcome.changed ? `app-${applicationId}` : null, notice: !outcome.changed ? "unchanged" : write === "done" ? "done" : "touched" });
}

/** A, O or R, once the member has confirmed: the dialog posts here. */
export async function decideIssueAction(form: FormData): Promise<void> {
  const member = await requireClient();
  const { db } = member;
  const decision = parseDecision(form);
  const range = parseRange(form.get("range"));
  if (!decision) return back({ range, error: "not_found" });
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
  if ("error" in done) return back({ range, i: here, error: done.error });

  if (settled) await noteResolved(db, parseInstance(form, here));
  revalidatePath("/client/inbox");
  revalidatePath("/client/pipeline");
  // On to the next issue, as the page sent it.
  return back({ range, i: nextKey(form), was: settled ? here : null, notice: done.notice });
}

/** E: this one instance leaves this member's queue and shows under Done. A stale page's names one that has gone, and that row hides nothing. */
export async function dismissIssueAction(form: FormData): Promise<void> {
  const { db } = await requireClient();
  const instance = parseInstance(form);
  const range = parseRange(form.get("range"));
  if (!instance) return back({ range, error: "not_found" });
  // From a row on the card: stay on the card, with no pop-up to open.
  const onCard = form.get("from") === "row";

  let outcome: Awaited<ReturnType<typeof dismissIssue>>;
  try {
    outcome = await dismissIssue(db, instance);
  } catch (err) {
    console.error("[client-inbox] dismiss failed:", err instanceof Error ? err.message : err);
    return back({ range, i: onCard ? null : instance.key, error: "dismiss_failed" });
  }
  if (!outcome.ok) return back({ range, i: onCard ? null : instance.key, error: "dismiss_refused" });

  revalidatePath("/client/inbox");
  // With nothing below it, what takes its place on this application.
  const i = onCard ? null : (nextKey(form) ?? instance.key);
  return outcome.changed ? back({ range, i, was: onCard ? null : instance.key, notice: "dismissed", undo: outcome.id }) : back({ range, i, notice: "unchanged" });
}

/** The check on a digest row: this member's read mark, never an issue. */
export async function markDigestReadAction(form: FormData): Promise<void> {
  const { db } = await requireClient();
  const range = parseRange(form.get("range"));
  const mark = parseMark(form);
  if (!mark) return back({ range, error: "read_refused" });

  let outcome: Awaited<ReturnType<typeof markRead>>;
  try {
    outcome = await markRead(db, [mark]);
  } catch (err) {
    console.error("[client-inbox] mark read failed:", err instanceof Error ? err.message : err);
    return back({ range, error: "read_failed" });
  }
  if (!outcome.ok) return back({ range, error: "read_refused" });
  revalidatePath("/client/inbox");
  return back({ range, notice: "read" });
}

/** Mark all as read: read again on the member's token, so a form can't name rows, and only what the page had shown (`asOf`). Needs you stays. */
export async function markAllDigestReadAction(form: FormData): Promise<void> {
  const { db } = await requireClient();
  const range = parseRange(form.get("range"));
  const asOf = form.get("asOf");
  if (!isInstant(asOf)) return back({ range, error: "read_refused" });

  let outcome: Awaited<ReturnType<typeof markRead>>;
  try {
    const { unread } = await readDigest(db, range, new Date(), 0);
    outcome = await markRead(db, seenBy(unread, asOf));
  } catch (err) {
    console.error("[client-inbox] mark all read failed:", err instanceof Error ? err.message : err);
    return back({ range, error: "read_failed" });
  }
  if (!outcome.ok) return back({ range, error: "read_refused" });
  revalidatePath("/client/inbox");
  return back({ range, notice: form.get("needs") === "1" ? "all_read_needs" : "all_read" });
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
  const range = parseRange(form.get("range"));
  if (!restored) return back({ range, notice: "restore_gone" });

  revalidatePath("/client/inbox");
  return back({ range, i: isIssueKey(restored.key) ? restored.key : null, notice: "restored" });
}

/** Send, in the dialog that showed the draft: that stored draft, exactly as stored, and only its author's. */
export async function sendDraftAction(form: FormData): Promise<void> {
  const member = await requireClient();
  const draftId = form.get("draftId");
  const range = parseRange(form.get("range"));
  if (typeof draftId !== "string" || !UUID.test(draftId)) return back({ range, error: "send_gone" });
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
  if ("error" in done) return back({ range, i: here, error: done.error });

  await noteResolved(member.db, parseInstance(form, here));
  revalidatePath("/client/applicants");
  revalidatePath("/client/pipeline");
  // On to the next issue, as the page sent it.
  return back({ range, i: nextKey(form), was: here, notice: done.notice });
}
