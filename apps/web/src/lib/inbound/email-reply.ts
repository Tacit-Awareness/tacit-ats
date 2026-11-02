import { connector } from "@tacit/core";
import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";

// A candidate's reply arriving at the webhook, for every company at once, so on
// the service role and outside the client area: never imported from it. The
// address names the email it answers, and nothing else says whose it is. Kept
// first, then forwarded to the email's author, so a member still gets the reply
// in their own mailbox as they did when Reply-To was theirs, and a failed
// forward costs nothing the Inbox doesn't have. The words go nowhere else: not
// in a log, not in audit_log.

export type ReceivedEmail = { providerId: string; from?: string | null; to?: string[] | null; cc?: string[] | null; subject?: string | null; text?: string | null; html?: string | null };
export type ReplyForwarder = { send: connector.EmailSender; fromAddress: string };
export type ReplyOutcome = "not_a_reply" | "no_email" | "duplicate" | "kept" | "forwarded";

export async function keepReply(db: Db, mail: ReceivedEmail, forward: ReplyForwarder | null): Promise<ReplyOutcome> {
  const emailId = clientTools.repliedEmailId([...(mail.to ?? []), ...(mail.cc ?? [])]);
  if (!emailId) return "not_a_reply";
  const { data, error } = await db.from("candidate_emails").select("id, subject, author_actor_id, status, people(display_name)").eq("id", emailId).maybeSingle();
  if (error) throw new Error(error.message);
  const email = data as unknown as { id: string; subject: string; author_actor_id: string | null; status: string; people: { display_name: string | null } | null } | null;
  if (!email || email.status !== "sent") return "no_email";

  const fromEmail = clientTools.addressOf(mail.from ?? "");
  const { subject, body } = clientTools.readableReply(mail);
  const { data: made, error: madeError } = await db
    .from("candidate_email_replies")
    .upsert({ email_id: email.id, from_email: fromEmail, subject, body, provider_id: mail.providerId }, { onConflict: "provider_id", ignoreDuplicates: true })
    .select("id");
  if (madeError) throw new Error(madeError.message);
  const replyId = made?.[0]?.id;
  if (!replyId) return "duplicate";

  if (!forward || !email.author_actor_id) return "kept";
  const { data: author, error: authorError } = await db.from("actors").select("email").eq("id", email.author_actor_id).maybeSingle();
  if (authorError) throw new Error(authorError.message);
  if (!connector.isPlainEmail(author?.email)) return "kept";
  const name = email.people?.display_name?.trim() || fromEmail;
  try {
    await forward.send({
      from: connector.fromHeader(`${name} via Tacit`, forward.fromAddress),
      replyTo: fromEmail,
      to: author.email,
      subject: subject || `Re: ${email.subject}`,
      text: `${name} replied. This is also in your Tacit Inbox.\n\n${body}`,
      idempotencyKey: `reply-${replyId}`,
    });
    return "forwarded";
  } catch (err) {
    console.error("[inbound-email] reply kept, forward failed:", err instanceof Error ? err.message.slice(0, 200) : "send failed");
    return "kept";
  }
}
