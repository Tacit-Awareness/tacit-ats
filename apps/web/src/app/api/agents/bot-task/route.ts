// A company's bot reporting what it is doing, for Grokbot Activity and the
// Inbox (@tacit/core's notify/bot-tasks.ts).
//
//   POST { "ref": "<the bot's own id for the task>", "kind": "get_read",
//          "status": "waiting", "applicationId": "<uuid>", "actorId": "<uuid>",
//          "waitingOnActorId": "<uuid>", "waitingChannel": "slack",
//          "steps": [{ "label": "Asked Daniel", "at": "<iso>" }],
//          "error": null, "needsYou": false }
//   Authorization: Bearer <the company's bot secret>
//
// `ref` creates the task the first time and updates it after, and a report
// names only what changed, so a redelivered one is a no-op. Steps are opaque
// progress labels, never message text, candidate answers or feedback. The
// secret names the company, every id the body names must be in that company,
// and an org in the body is ignored. The way back is the `bot_task.command`
// event the notify tick sends.
import { agentDestinationBySecret, reportBotTask } from "@tacit/core";

import { companyBotId, notifierDb } from "@/lib/notify/notifier";

export async function POST(request: Request): Promise<Response> {
  const bearer = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1] ?? "";
  const db = notifierDb();
  const company = bearer ? await agentDestinationBySecret(db, bearer) : null;
  const agentDestinationId = company ? await companyBotId(db, company.orgId, company.channel) : null;
  if (!company || !agentDestinationId) return new Response(null, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (typeof body !== "object" || body === null) return Response.json({ error: "invalid" }, { status: 400 });

  const result = await reportBotTask(db, {
    orgId: company.orgId,
    agentDestinationId,
    ref: body.ref,
    kind: body.kind,
    status: body.status,
    applicationId: body.applicationId,
    interviewId: body.interviewId,
    actorId: body.actorId,
    waitingOnActorId: body.waitingOnActorId,
    waitingOnPersonId: body.waitingOnPersonId,
    waitingChannel: body.waitingChannel,
    steps: body.steps,
    error: body.error,
    needsYou: body.needsYou,
  });
  if (result.ok) return Response.json({ ok: true, taskId: result.taskId });
  return Response.json({ error: result.reason }, { status: result.reason === "invalid" ? 400 : 404 });
}
