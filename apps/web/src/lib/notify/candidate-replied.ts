import { listAgentDestinations, signAgentWebhook, wrapUntrusted, AGENT_WEBHOOK_TIMEOUT_MS } from "@tacit/core";
import type { Db } from "@tacit/db";

// Telling a company's bot a candidate replied, so it can ping whoever sent the
// email: "they can do 5pm or 7pm". On the service role, outside the client area,
// as the rest of the notifier: the bot's secret is granted to no member. In the
// format of the interview events (@tacit/core's notify/agent-webhook.ts), posted
// directly because the hub knows only those. This is the one event carrying a
// candidate's words, fenced, since the bot has to show them: they are a stranger's
// text, for a person to read, so the bot acts on none of it. Best-effort: the
// reply is already kept and forwarded.

const REPLY_MAX = 4_000;
const ATTEMPTS = 2;

export type CandidateReply = {
  replyId: string;
  candidateId: string;
  applicationId: string | null;
  candidateName: string;
  roleTitle: string | null;
  subject: string;
  body: string;
  member: { userId: string; name: string | null; email: string };
};

export function candidateRepliedEvent(r: CandidateReply, origin: string) {
  return {
    event: "candidate.replied" as const,
    eventId: `evt_reply_${r.replyId}`,
    replyId: r.replyId,
    candidateId: r.candidateId,
    applicationId: r.applicationId,
    candidateName: r.candidateName,
    roleTitle: r.roleTitle,
    subject: r.subject,
    text: `${r.candidateName} replied to your email${r.roleTitle ? ` about ${r.roleTitle}` : ""}.`,
    reply: wrapUntrusted("candidate email", r.body.slice(0, REPLY_MAX)),
    member: r.member,
    inboxUrl: `${origin}/client/inbox?i=reply-${r.replyId}`,
  };
}

/** Posts to the company's verified, enabled bot, if it has one. Throws when it could not be told: the caller logs that. */
export async function pingCompanyBot(db: Db, orgId: string, reply: CandidateReply, origin: string): Promise<void> {
  const bot = (await listAgentDestinations(db)).find((d) => d.orgId === orgId && d.verifiedAt !== null);
  if (!bot) return;
  const event = candidateRepliedEvent(reply, origin);
  const raw = JSON.stringify(event);
  let failure = "";
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    try {
      const res = await fetch(bot.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${bot.secret}`,
          "x-tacit-event": event.event,
          "x-tacit-event-id": event.eventId,
          "x-tacit-timestamp": timestamp,
          "x-tacit-signature": await signAgentWebhook(bot.secret, timestamp, raw),
        },
        body: raw,
        // A company sets its own bot's URL: a redirect elsewhere is not followed.
        redirect: "manual",
        signal: AbortSignal.timeout(AGENT_WEBHOOK_TIMEOUT_MS),
      });
      if (res.ok) return;
      failure = `http_${res.status}`;
    } catch (err) {
      failure = err instanceof Error ? err.name : "network";
    }
  }
  throw new Error(`bot refused: ${failure}`);
}
