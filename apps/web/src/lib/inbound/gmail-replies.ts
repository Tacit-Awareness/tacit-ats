import {
  extractBodyText, getMessageFull, getProfile, getThreadFull, isMachineMail, listHistoryMessages, refreshGoogleAccessToken, stripQuotes,
  type GmailClientDeps, type GmailMessageFull,
} from "@tacit/core";
import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { keepReplyTo, type ReplyPing } from "./email-reply";

// A candidate's replies to email a member sent from their own Gmail (core's
// sendEmail, sent_via 'gmail'): the reply lands in the member's mailbox, not at
// Tacit, so the notify cron reads it from there. Every company at once, on the
// service role and outside the client area, like email-reply.ts: never
// imported from it.
//
// Only with the member's leave (gmail.readonly granted; a send-only grant is
// passed over), and only the threads Tacit started: each run lists what the
// mailbox's history added since the last (mailbox_connections.history_id) and
// keeps a message only when its thread is one a sent candidate_emails row of
// that member names. Nothing else in the mailbox is fetched, kept or logged.
// A history Google no longer has (a new connection, or more than a week
// quiet) is caught up by reading those threads from the last 30 days.
//
// What is kept is what the Resend webhook keeps: one row per message
// (provider_id gmail:<actor>:<message id>, so a second run is a duplicate), the
// company's bot told. No forward: the member already has it. The words go
// nowhere else, not in a log, not in audit_log.

export type GmailReplyDeps = {
  google: { clientId: string; clientSecret: string };
  fetch?: typeof fetch;
  ping?: ReplyPing;
  now?: () => number;
};

export type GmailReplyRun = { mailboxes: number; kept: number; failed: number };

/** How far back a catch-up reads a member's threads. The Inbox shows 30 days of replies. */
const CATCH_UP_DAYS = 30;

type Mailbox = { actor_id: string; org_id: string; account_email: string; refresh_token: string; scopes: string; history_id: string | null };
type SentEmail = { id: string; thread_id: string; sent_at: string | null };

export async function readGmailReplies(db: Db, deps: GmailReplyDeps): Promise<GmailReplyRun> {
  const { data, error } = await db
    .from("mailbox_connections")
    .select("actor_id, org_id, account_email, refresh_token, scopes, history_id")
    .eq("provider", "google");
  if (error) throw new Error(`mailbox_connections: ${error.message}`);
  const run: GmailReplyRun = { mailboxes: 0, kept: 0, failed: 0 };
  for (const mailbox of (data ?? []) as Mailbox[]) {
    if (!clientTools.grantsScope(mailbox, clientTools.GMAIL_READ_SCOPE)) continue;
    run.mailboxes++;
    try {
      run.kept += await readMailbox(db, mailbox, deps);
    } catch (err) {
      run.failed++;
      // The message is ours (Google's status, a table's), never the mail's.
      console.error(`[gmail-replies] actor ${mailbox.actor_id}:`, err instanceof Error ? err.message.slice(0, 200) : "failed");
    }
  }
  return run;
}

async function readMailbox(db: Db, mailbox: Mailbox, deps: GmailReplyDeps): Promise<number> {
  const token = () =>
    refreshGoogleAccessToken({
      clientId: deps.google.clientId, clientSecret: deps.google.clientSecret, refreshToken: mailbox.refresh_token, fetchImpl: deps.fetch,
    });
  const gmail: GmailClientDeps = { accessToken: await token(), refreshAccessToken: token, fetchImpl: deps.fetch };

  let kept = 0;
  let next: string;
  const history = mailbox.history_id ? await listHistoryMessages(gmail, mailbox.history_id) : "expired";
  if (history === "expired") {
    // Where to start next time first, so nothing arriving during the catch-up is missed.
    next = (await getProfile(gmail)).historyId;
    const since = new Date((deps.now ?? Date.now)() - CATCH_UP_DAYS * 86_400_000).toISOString();
    for (const email of await sentEmails(db, mailbox, { since })) {
      for (const message of (await getThreadFull(gmail, email.thread_id)) ?? []) {
        if (await keep(db, mailbox, email, message, deps.ping)) kept++;
      }
    }
  } else {
    next = history.historyId;
    const theirs = history.messages.filter((m) => m.threadId && !m.labelIds.includes("SENT") && !m.labelIds.includes("DRAFT"));
    const emails = new Map((await sentEmails(db, mailbox, { threads: [...new Set(theirs.map((m) => m.threadId))] })).map((e) => [e.thread_id, e]));
    for (const added of theirs) {
      const email = emails.get(added.threadId);
      if (!email) continue;
      const message = await getMessageFull(gmail, added.id);
      if (message && (await keep(db, mailbox, email, message, deps.ping))) kept++;
    }
  }

  // Conditional on the place read, so a run that overlapped this one cannot be moved backwards.
  const moved = db.from("mailbox_connections").update({ history_id: next }).eq("actor_id", mailbox.actor_id);
  const { error } = await (mailbox.history_id ? moved.eq("history_id", mailbox.history_id) : moved.is("history_id", null));
  if (error) throw new Error(`mailbox_connections: ${error.message}`);
  return kept;
}

/** The member's sent Gmail emails, by the threads given, or every one since a time. */
async function sentEmails(db: Db, mailbox: Mailbox, by: { threads: string[] } | { since: string }): Promise<SentEmail[]> {
  if ("threads" in by && !by.threads.length) return [];
  const found: SentEmail[] = [];
  const batches = "threads" in by ? chunks(by.threads, 100) : [null];
  for (const threads of batches) {
    let q = db
      .from("candidate_emails")
      .select("id, thread_id, sent_at")
      .eq("org_id", mailbox.org_id)
      .eq("author_actor_id", mailbox.actor_id)
      .eq("sent_via", "gmail")
      .eq("status", "sent")
      .not("thread_id", "is", null);
    q = threads ? q.in("thread_id", threads) : q.gte("sent_at", (by as { since: string }).since);
    const { data, error } = await q;
    if (error) throw new Error(`candidate_emails: ${error.message}`);
    found.push(...((data ?? []) as SentEmail[]));
  }
  return found;
}

const chunks = <T>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** One message in a thread Tacit started, kept when it is someone writing back. */
async function keep(db: Db, mailbox: Mailbox, email: SentEmail, message: GmailMessageFull, ping?: ReplyPing): Promise<boolean> {
  if (message.labelIds.includes("SENT") || message.labelIds.includes("DRAFT")) return false;
  const from = clientTools.addressOf(message.headers.from ?? "");
  // The member's own (from another device, or an alias), an auto-reply, or older than the email: not a reply.
  if (!from || from === mailbox.account_email || isMachineMail(message.headers)) return false;
  if (email.sent_at && Number(message.internalDate) < Date.parse(email.sent_at) - 60_000) return false;
  const outcome = await keepReplyTo(
    db,
    email.id,
    {
      providerId: `gmail:${mailbox.actor_id}:${message.id}`,
      from: message.headers.from,
      subject: message.headers.subject ?? null,
      text: stripQuotes(extractBodyText(message.payload)),
    },
    null,
    ping,
  );
  return outcome === "kept" || outcome === "forwarded";
}
