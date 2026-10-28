// A company's bot telling Tacit which Slack thread it opened with an
// interviewer about an interview, when it could not say so in its answer to
// the webhook (@tacit/core's notify/agent-webhook.ts). Every later event about
// that interview (the check-in, a cancellation) then carries the thread.
//
//   POST { "interviewId": "<uuid>", "interviewerUserId": "<uuid>",
//          "slack": { "channel": "D...", "threadTs": "123.456" } }
//   Authorization: Bearer <the company's bot secret>
//
// The secret names the company (agentDestinationBySecret), and only an
// interviewer on one of that company's interviews can have a thread
// recorded. tacit-internal's /api/agents/grok/interview-thread is the same
// for Tacit's own bot.
import { agentDestinationBySecret, recordInterviewThread } from "@tacit/core";

import { notifierDb } from "@/lib/notify/notifier";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<Response> {
  const bearer = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1] ?? "";
  const db = notifierDb();
  const company = bearer ? await agentDestinationBySecret(db, bearer) : null;
  if (!company) return new Response(null, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    interviewId?: unknown; interviewerUserId?: unknown; slack?: { channel?: unknown; threadTs?: unknown };
  } | null;
  const interviewId = typeof body?.interviewId === "string" ? body.interviewId : "";
  const actorId = typeof body?.interviewerUserId === "string" ? body.interviewerUserId : "";
  const channel = typeof body?.slack?.channel === "string" ? body.slack.channel : "";
  const threadTs = typeof body?.slack?.threadTs === "string" ? body.slack.threadTs : "";
  if (!UUID.test(interviewId) || !UUID.test(actorId)) return Response.json({ error: "invalid" }, { status: 400 });

  const result = await recordInterviewThread(db, {
    interviewId, actorId, channel: company.channel, slackChannelId: channel, threadTs, orgId: company.orgId,
  });
  if (result.ok) return Response.json({ ok: true });
  return Response.json({ error: result.reason }, { status: result.reason === "invalid" ? 400 : 404 });
}
