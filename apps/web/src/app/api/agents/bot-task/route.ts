// A company's bot reporting progress on one of its tasks (bot_tasks): the
// rows behind the dashboard's Grokbot Activity, Inbox and the pipeline's
// whose-move-it-is. Upserts on the bot's own ref, so a retried report is a
// no-op; every id it names is checked against its own org.
//
//   POST { "ref": "...", "kind": "schedule_interview", "status": "waiting",
//          "applicationId": "...", "actorId": "...",
//          "waitingOnActorId": "...", "waitingOnPersonId": "...",
//          "waitingChannel": "slack", "steps": [{"label": "..."}],
//          "error": "...", "needsYou": true }
//   Authorization: Bearer <the company's bot secret>
//
// The secret names the company (agentDestinationBySecret), like
// /api/agents/interview-thread. Steps are opaque labels, never message text.
import { agentDestinationBySecret, reportBotTask } from "@tacit/core";
import { getSupabaseServiceClient } from "@tacit/db";

export async function POST(request: Request): Promise<Response> {
  const bearer = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1] ?? "";
  const db = getSupabaseServiceClient();
  const company = bearer ? await agentDestinationBySecret(db, bearer) : null;
  if (!company) return new Response(null, { status: 401 });

  const { data: destination, error } = await db
    .from("agent_destinations").select("id")
    .eq("org_id", company.orgId).eq("channel", company.channel).eq("enabled", true)
    .maybeSingle();
  if (error || !destination) return Response.json({ error: "no_destination" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return Response.json({ error: "invalid" }, { status: 400 });

  const result = await reportBotTask(db, { orgId: company.orgId, agentDestinationId: destination.id, ...body } as Parameters<typeof reportBotTask>[1]);
  if (result.ok) return Response.json({ ok: true, taskId: result.taskId });
  return Response.json({ error: result.reason }, { status: result.reason === "invalid" ? 400 : 404 });
}
