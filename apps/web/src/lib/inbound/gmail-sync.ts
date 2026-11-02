import {
  extractBodyText, getMessageFull, getMessageMetadata, getProfile, getThreadFull, isMachineMail, listHistoryMessages, parseAddresses,
  refreshGoogleAccessToken, stripQuotes, type GmailClientDeps, type GmailHistoryMessage, type GmailMessageFull,
} from "@tacit/core";
import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { keepReplyTo, type ReplyPing } from "./email-reply";

// The Gmail sync, as Ashby does it, run by the notify cron for every company
// at once, on the service role and outside the client area, like
// email-reply.ts: never imported from it.
//
// Whose mailboxes: every signed-in member above interviewer of a company whose
// Google Workspace is connected (google_workspace_connections) whose own
// address is at that domain, as them through Tacit's service account; and every
// member who connected their own Gmail with leave to read. Not a member who
// turned their sync off (mailbox_sync_optouts).
//
// What it keeps, from what each mailbox's history added since its place
// (mailbox_sync_state):
//   - a reply in a thread a member's Tacit email started (candidate_emails
//     sent_via 'gmail'): a candidate_email_replies row, as the Resend webhook
//     keeps one, so it reaches the Inbox and the company's bot;
//   - any other email between the member and someone on file as a candidate in
//     their company: a candidate_mail row on each such candidate, in or out.
// Every other message is looked at only by its headers and never kept, and
// nothing about it is logged. Merged and erased candidates, and the company's
// own members, are never matched.
//
// A mailbox with no place yet, or one Google no longer has, starts from now,
// and catches up on its Tacit threads from the last 30 days.

export type GmailSyncDeps = {
  /** Tacit's service account, for companies on Workspace. */
  serviceAccount: clientTools.GoogleServiceAccount | null;
  /** The OAuth client members' own connections were made to. */
  google: { clientId: string; clientSecret: string } | null;
  fetch?: typeof fetch;
  ping?: ReplyPing;
  now?: () => number;
};

export type GmailSyncRun = { mailboxes: number; replies: number; synced: number; failed: number };

const CATCH_UP_DAYS = 30;
const SKIP_LABELS = ["DRAFT", "SPAM", "TRASH"];

type Mailbox = { actorId: string; orgId: string; email: string; token: () => Promise<string> };
type SentEmail = { id: string; thread_id: string; sent_at: string | null; provider_id: string | null };

/** Every mailbox the sync may read, once each: a member's company Workspace first, then their own connection. */
async function mailboxes(db: Db, deps: GmailSyncDeps): Promise<Mailbox[]> {
  const out = new Map<string, Mailbox>();
  const { data: off, error: offError } = await db.from("mailbox_sync_optouts").select("actor_id");
  if (offError) throw new Error(`mailbox_sync_optouts: ${offError.message}`);
  const optedOut = new Set((off ?? []).map((o) => o.actor_id));

  const sa = deps.serviceAccount;
  if (sa) {
    const { data: workspaces, error } = await db.from("google_workspace_connections").select("org_id, domain");
    if (error) throw new Error(`google_workspace_connections: ${error.message}`);
    const domains = new Map((workspaces ?? []).map((w) => [w.org_id, w.domain]));
    if (domains.size) {
      const { data: members, error: membersError } = await db
        .from("actors")
        .select("id, org_id, email, access_level, auth_subject, archived_at, tacit_agency")
        .in("org_id", [...domains.keys()]);
      if (membersError) throw new Error(`actors: ${membersError.message}`);
      for (const m of members ?? []) {
        const email = m.email?.trim().toLowerCase();
        // Signed in (so the address is one they proved), active, above interviewer, at the company's domain.
        if (!email || !m.auth_subject || m.archived_at || m.tacit_agency || m.access_level === "limited" || optedOut.has(m.id)) continue;
        if (clientTools.domainOf(email) !== domains.get(m.org_id!)) continue;
        out.set(m.id, {
          actorId: m.id, orgId: m.org_id!, email,
          token: () => clientTools.delegatedAccessToken(sa, email, [clientTools.GMAIL_READ_SCOPE], deps.fetch),
        });
      }
    }
  }

  const google = deps.google;
  if (google) {
    const { data, error } = await db.from("mailbox_connections").select("actor_id, org_id, account_email, refresh_token, scopes").eq("provider", "google");
    if (error) throw new Error(`mailbox_connections: ${error.message}`);
    for (const c of data ?? []) {
      if (out.has(c.actor_id) || optedOut.has(c.actor_id) || !clientTools.grantsScope(c, clientTools.GMAIL_READ_SCOPE)) continue;
      out.set(c.actor_id, {
        actorId: c.actor_id, orgId: c.org_id, email: c.account_email,
        token: () => refreshGoogleAccessToken({ clientId: google.clientId, clientSecret: google.clientSecret, refreshToken: c.refresh_token, fetchImpl: deps.fetch }),
      });
    }
  }
  return [...out.values()];
}

export async function syncGmail(db: Db, deps: GmailSyncDeps): Promise<GmailSyncRun> {
  const run: GmailSyncRun = { mailboxes: 0, replies: 0, synced: 0, failed: 0 };
  for (const mailbox of await mailboxes(db, deps)) {
    run.mailboxes++;
    try {
      const got = await syncMailbox(db, mailbox, deps);
      run.replies += got.replies;
      run.synced += got.synced;
    } catch (err) {
      run.failed++;
      // The message is ours (Google's status, a table's), never the mail's.
      console.error(`[gmail-sync] actor ${mailbox.actorId}:`, err instanceof Error ? err.message.slice(0, 200) : "failed");
    }
  }
  return run;
}

async function syncMailbox(db: Db, mailbox: Mailbox, deps: GmailSyncDeps): Promise<{ replies: number; synced: number }> {
  const gmail: GmailClientDeps = { accessToken: await mailbox.token(), refreshAccessToken: mailbox.token, fetchImpl: deps.fetch };
  const { data: state, error: stateError } = await db.from("mailbox_sync_state").select("history_id").eq("actor_id", mailbox.actorId).maybeSingle();
  if (stateError) throw new Error(`mailbox_sync_state: ${stateError.message}`);
  const place = state?.history_id ?? null;

  let replies = 0;
  let synced = 0;
  let next: string;
  const history = place ? await listHistoryMessages(gmail, place) : "expired";
  if (history === "expired") {
    // Where to start next time first, so nothing arriving during the catch-up is missed.
    next = (await getProfile(gmail)).historyId;
    const since = new Date((deps.now ?? Date.now)() - CATCH_UP_DAYS * 86_400_000).toISOString();
    for (const email of await sentEmails(db, mailbox, { since })) {
      for (const message of (await getThreadFull(gmail, email.thread_id)) ?? []) {
        if (await keepReply(db, mailbox, email, message, deps.ping)) replies++;
      }
    }
  } else {
    next = history.historyId;
    const added = history.messages.filter((m) => !m.labelIds.some((l) => SKIP_LABELS.includes(l)));
    const tacit = new Map((await sentEmails(db, mailbox, { threads: [...new Set(added.map((m) => m.threadId).filter(Boolean))] })).map((e) => [e.thread_id, e]));
    const others: GmailHistoryMessage[] = [];
    for (const m of added) {
      const email = tacit.get(m.threadId);
      if (email && !m.labelIds.includes("SENT")) {
        const full = await getMessageFull(gmail, m.id);
        if (full && (await keepReply(db, mailbox, email, full, deps.ping))) replies++;
      } else if (!email || m.id !== email.provider_id) {
        others.push(m);
      }
    }
    synced = await syncCandidateMail(db, gmail, mailbox, others);
  }

  // Conditional on the place read, so a run that overlapped this one cannot move it backwards.
  if (place) {
    const { error } = await db.from("mailbox_sync_state").update({ history_id: next, updated_at: new Date().toISOString() })
      .eq("actor_id", mailbox.actorId).eq("history_id", place);
    if (error) throw new Error(`mailbox_sync_state: ${error.message}`);
  } else {
    const { error } = await db.from("mailbox_sync_state")
      .upsert({ actor_id: mailbox.actorId, org_id: mailbox.orgId, history_id: next }, { onConflict: "actor_id", ignoreDuplicates: true });
    if (error) throw new Error(`mailbox_sync_state: ${error.message}`);
  }
  return { replies, synced };
}

/** The member's sent Gmail emails, by the threads given, or every one since a time. */
async function sentEmails(db: Db, mailbox: Mailbox, by: { threads: string[] } | { since: string }): Promise<SentEmail[]> {
  if ("threads" in by && !by.threads.length) return [];
  const found: SentEmail[] = [];
  for (const threads of "threads" in by ? chunks(by.threads, 100) : [null]) {
    let q = db
      .from("candidate_emails")
      .select("id, thread_id, sent_at, provider_id")
      .eq("org_id", mailbox.orgId)
      .eq("author_actor_id", mailbox.actorId)
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

/** A message in a thread a member's Tacit email started, kept when it is someone writing back. */
async function keepReply(db: Db, mailbox: Mailbox, email: SentEmail, message: GmailMessageFull, ping?: ReplyPing): Promise<boolean> {
  if (message.labelIds.some((l) => l === "SENT" || SKIP_LABELS.includes(l))) return false;
  const from = clientTools.addressOf(message.headers.from ?? "");
  // The member's own (from another device, or an alias), an auto-reply, or older than the email: not a reply.
  if (!from || from === mailbox.email || isMachineMail(message.headers)) return false;
  if (email.sent_at && Number(message.internalDate) < Date.parse(email.sent_at) - 60_000) return false;
  const outcome = await keepReplyTo(
    db,
    email.id,
    { providerId: `gmail:${mailbox.actorId}:${message.id}`, from: message.headers.from, subject: message.headers.subject ?? null, text: stripQuotes(extractBodyText(message.payload)) },
    null,
    ping,
  );
  return outcome === "kept" || outcome === "forwarded";
}

/**
 * Every other new message: its headers say who it was between; one with
 * someone on file as a candidate in the member's company is read in full and
 * kept on each such candidate. The rest are never fetched past their headers.
 */
async function syncCandidateMail(db: Db, gmail: GmailClientDeps, mailbox: Mailbox, messages: GmailHistoryMessage[]): Promise<number> {
  const heads: Array<{ id: string; threadId: string; out: boolean; from: string; to: string[]; others: string[] }> = [];
  for (const m of messages) {
    const meta = await getMessageMetadata(gmail, m.id);
    if (!meta || isMachineMail(meta.headers)) continue;
    const from = clientTools.addressOf(meta.headers.from ?? "");
    const to = [...parseAddresses(meta.headers.to), ...parseAddresses(meta.headers.cc)].map((a) => a.toLowerCase());
    const out = meta.labelIds.includes("SENT") || from === mailbox.email;
    heads.push({ id: m.id, threadId: m.threadId, out, from, to, others: out ? to : [from] });
  }
  const addresses = [...new Set(heads.flatMap((h) => h.others))].filter((a) => a && a !== mailbox.email);
  if (!addresses.length) return 0;
  const candidates = await candidatesByAddress(db, mailbox.orgId, addresses);
  if (!candidates.size) return 0;

  let kept = 0;
  for (const h of heads) {
    const people = [...new Set(h.others.flatMap((a) => candidates.get(a) ?? []))];
    if (!people.length) continue;
    const full = await getMessageFull(gmail, h.id);
    if (!full) continue;
    const { subject, body } = clientTools.readableReply({ subject: full.headers.subject ?? "", text: stripQuotes(extractBodyText(full.payload)) });
    const rows = people.map((personId) => ({
      person_id: personId,
      actor_id: mailbox.actorId,
      direction: h.out ? "out" : "in",
      from_email: h.from || mailbox.email,
      to_emails: h.to.slice(0, 100),
      subject,
      body,
      provider_id: `gmail:${mailbox.actorId}:${h.id}`,
      thread_id: h.threadId || null,
      sent_at: new Date(Number(full.internalDate) || Date.now()).toISOString(),
    }));
    const { data, error } = await db.from("candidate_mail").upsert(rows, { onConflict: "provider_id,person_id", ignoreDuplicates: true }).select("id");
    if (error) throw new Error(`candidate_mail: ${error.message}`);
    kept += data?.length ?? 0;
  }
  return kept;
}

/** Live candidates in the company, by each address on file for them; never one of the company's own members. */
async function candidatesByAddress(db: Db, orgId: string, addresses: string[]): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  const { data: members, error: membersError } = await db.from("actors").select("email").eq("org_id", orgId);
  if (membersError) throw new Error(`actors: ${membersError.message}`);
  const own = new Set((members ?? []).map((m) => m.email?.trim().toLowerCase()).filter(Boolean));
  for (const batch of chunks(addresses.filter((a) => !own.has(a)), 100)) {
    const { data, error } = await db
      .from("person_identifiers")
      .select("value, person_id, people!inner(merged_into_id, anonymized_at)")
      .eq("org_id", orgId)
      .eq("kind", "email")
      .in("value", batch)
      .is("people.merged_into_id", null)
      .is("people.anonymized_at", null);
    if (error) throw new Error(`person_identifiers: ${error.message}`);
    for (const r of data ?? []) {
      const key = r.value.toLowerCase();
      found.set(key, [...new Set([...(found.get(key) ?? []), r.person_id])]);
    }
  }
  return found;
}
