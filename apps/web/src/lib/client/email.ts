import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import type { SendError } from "./email-messages";

// Candidate email in the web app: clientTools' draftEmail and sendEmail on the
// member's OWN client, the connector's draft_email and send_email, so the
// policies decide and the same rules hold (the draft's author only, once, at
// most 30 an hour). The mailer is passed in (lib/client/mailer.ts in the app,
// a fake in the tests). Drafting and sending are always two calls: a page shows
// the stored draft, and only a press of Send reaches sendDraft. A subject or
// body is the member's own text: it goes on their page and nowhere else, not in
// a URL, a log or (core keeps it out) an audit row.

export type DraftSender = { from: string; replyTo: string };
export type ShownDraft = { draftId: string; to: string; subject: string; body: string };
export type LastEmail = { at: string; subject: string; by: string };

export type ReplyRead = {
  /** can_edit_person: anyone else gets no reply box. */
  canEmail: boolean;
  /** The member's newest email on this application, when that is an unsent draft. */
  draft: ShownDraft | null;
  /** The member's newest email here, when it failed: its words, to write again. */
  failed: { subject: string; body: string } | null;
  /** The newest email anyone sent on this application, so nobody replies twice. */
  sent: LastEmail | null;
  sender: DraftSender | null;
};

/** Who a draft goes out as, or null when that can't be said (core then refuses the send, and says why). */
export async function readSender(db: Db, ctx: clientTools.ClientToolCtx, mailer: clientTools.ClientMailer | null): Promise<DraftSender | null> {
  if (!mailer) return null;
  try {
    const { from, replyTo } = await clientTools.senderFor(db, ctx, mailer);
    return { from, replyTo };
  } catch (err) {
    if (err instanceof clientTools.ClientToolError) return null;
    throw err;
  }
}

export async function readReply(
  db: Db,
  ctx: clientTools.ClientToolCtx,
  mailer: clientTools.ClientMailer | null,
  input: { candidateId: string; applicationId: string },
): Promise<ReplyRead> {
  const allowed = await db.rpc("can_edit_person", { p_person: input.candidateId });
  if (allowed.error) throw new Error(allowed.error.message);
  if (allowed.data !== true) return { canEmail: false, draft: null, failed: null, sent: null, sender: null };

  // Newest first, and the policy shows a draft to its author alone.
  const emails = (await clientTools.listEmails(db, ctx, { candidateId: input.candidateId })).filter((e) => e.applicationId === input.applicationId);
  const mine = emails.find((e) => e.mine) ?? null;
  // Only their newest: a draft can't be discarded, so an older one sits under whatever replaced it, sent or refused.
  const draft = mine?.status === "draft" ? mine : null;
  const sent = emails.find((e) => e.status === "sent" || e.status === "sending") ?? null;
  return {
    canEmail: true,
    draft: draft ? { draftId: draft.emailId, to: draft.to, subject: draft.subject, body: draft.body } : null,
    failed: mine?.status === "failed" ? { subject: mine.subject, body: mine.body } : null,
    sent: sent ? { at: sent.sentAt ?? sent.createdAt, subject: sent.subject, by: sent.mine ? "You" : (sent.author ?? "Someone") } : null,
    sender: await readSender(db, ctx, mailer),
  };
}

export type DraftOutcome = { ok: true; draftId: string } | { ok: false; error: string };

const NOT_THEIRS = "That application isn't one you can see any more. No draft was written.";

/**
 * Writes a draft and sends nothing. A refusal comes back as core's sentence
 * for the form to show: none of them carries a name, and the ones that name a
 * connector tool are the ones a page only meets on a stale or tampered post, so
 * they get the page's own.
 */
export async function draftReply(
  db: Db,
  ctx: clientTools.ClientToolCtx,
  mailer: clientTools.ClientMailer | null,
  input: { candidateId: string; applicationId: string; subject: string; body: string },
): Promise<DraftOutcome> {
  if (!mailer) return { ok: false, error: "Sending isn't set up on this deployment, so no draft was written." };
  try {
    const { draftId } = await clientTools.draftEmail(db, ctx, mailer, input);
    return { ok: true, draftId };
  } catch (err) {
    if (!(err instanceof clientTools.ClientToolError)) throw err;
    if (err.code === "not_found" || err.message.includes("application_id")) return { ok: false, error: NOT_THEIRS };
    return { ok: false, error: err.message };
  }
}

/** Core's refusal as a code. The words are core's own: email.integration.test.ts holds them to these codes. */
function sendError(err: clientTools.ClientToolError): SendError {
  if (err.code === "not_found") return "send_gone";
  if (err.code === "rate_limited") return "send_rate";
  if (err.code === "forbidden") return "send_forbidden";
  if (/already/.test(err.message)) return "send_already";
  if (/on file has changed/.test(err.message)) return "send_address";
  if (/Your email address/.test(err.message)) return "send_no_reply_to";
  if (/provider refused|failed to send/.test(err.message)) return "send_refused";
  return "send_failed";
}

export type SendOutcome = { ok: true } | { ok: false; error: SendError };

/**
 * Has this member written to this application since that draft? The pages stop
 * offering such a draft (readReply, inbox-issues.ts's currentDrafts), but a tab
 * left open still shows it, and a Send there would deliver what they replaced.
 * The policies hide a draft from all but its author, so anyone else gets false
 * here and core's refusal. A draft on no application is never out of date.
 */
async function replaced(db: Db, ctx: clientTools.ClientToolCtx, draftId: string): Promise<boolean> {
  const { data: draft, error } = await db.from("candidate_emails").select("application_id, created_at").eq("id", draftId).eq("status", "draft").maybeSingle();
  if (error) throw new Error(error.message);
  if (!draft?.application_id) return false;
  const { data: newer, error: newerError } = await db
    .from("candidate_emails")
    .select("id")
    .eq("application_id", draft.application_id)
    .eq("author_actor_id", ctx.actorId)
    .gt("created_at", draft.created_at)
    .limit(1);
  if (newerError) throw new Error(newerError.message);
  return (newer?.length ?? 0) > 0;
}

/** Sends one stored draft, exactly as stored. Only after the member pressed Send on it. */
export async function sendDraft(db: Db, ctx: clientTools.ClientToolCtx, mailer: clientTools.ClientMailer | null, draftId: string): Promise<SendOutcome> {
  if (!mailer?.send) return { ok: false, error: "send_off" };
  try {
    if (await replaced(db, ctx, draftId)) return { ok: false, error: "send_stale" };
    await clientTools.sendEmail(db, ctx, mailer, { draftId });
    return { ok: true };
  } catch (err) {
    if (err instanceof clientTools.ClientToolError) return { ok: false, error: sendError(err) };
    throw err;
  }
}
