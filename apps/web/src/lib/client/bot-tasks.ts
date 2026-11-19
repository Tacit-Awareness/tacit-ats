import type { Db } from "@tacit/db";
import { kindLabel, standing, statusOf, stepsOf, type TaskCommand, type TaskStatus, type TaskStep } from "./bot-task-rules";

// Tickets' read and its one write (design/tacit-tickets's Tickets), on the
// member's OWN client (never a privileged one). A ticket is one of the company
// bot's tasks, `bot_tasks`, which the bot reports through /api/agents/bot-task;
// its `client_read` policy lets a member read a task on an application they may
// read, or their own. Who it waits on comes from `org_members` and `people` on
// the same token. Telling the bot to retry, nudge or cancel is the
// `bot_task_command` definer function on the member's token: it checks the task
// is in their org, that they may act on its application and that it is still
// open, and queues the command, which the notify tick delivers to the bot.

/** Tasks the page reads at most, the newest moved first. */
export const TASKS_MAX = 500;

export type Ticket = {
  id: string;
  kind: string;
  title: string;
  status: TaskStatus;
  rawStatus: string;
  applicationId: string | null;
  personId: string | null;
  name: string;
  jobTitle: string | null;
  jobId: string | null;
  ownerName: string | null;
  standing: string;
  steps: TaskStep[];
  error: string | null;
  waitingOn: string | null;
  waitingChannel: string | null;
  updatedAt: string;
};

type Row = {
  id: string;
  kind: string;
  status: string;
  needs_you: boolean;
  application_id: string | null;
  waiting_on_actor_id: string | null;
  waiting_on_person_id: string | null;
  waiting_channel: string | null;
  steps: unknown;
  error: string | null;
  updated_at: string;
  applications: { id: string; role_id: string; person_id: string; owner_actor_id: string | null; people: { display_name: string | null } | null; roles: { title: string } | null } | null;
};

export async function readTickets(db: Db): Promise<{ tickets: Ticket[]; capped: boolean }> {
  const { data, error } = await db
    .from("bot_tasks")
    .select(
      "id, kind, status, needs_you, application_id, waiting_on_actor_id, waiting_on_person_id, waiting_channel, steps, error, updated_at, applications(id, role_id, person_id, owner_actor_id, people(display_name), roles(title))",
    )
    .order("updated_at", { ascending: false })
    .limit(TASKS_MAX)
    .overrideTypes<Row[], { merge: false }>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const actorIds = [...new Set(rows.flatMap((r) => [r.waiting_on_actor_id, r.applications?.owner_actor_id].filter((x): x is string => !!x)))];
  const personIds = [...new Set(rows.flatMap((r) => (r.waiting_on_person_id ? [r.waiting_on_person_id] : [])))];
  const [members, people] = await Promise.all([
    actorIds.length ? db.from("org_members").select("id, display_name").in("id", actorIds) : null,
    personIds.length ? db.from("people").select("id, display_name").in("id", personIds) : null,
  ]);
  if (members?.error) throw new Error(members.error.message);
  if (people?.error) throw new Error(people.error.message);
  const actorName = new Map((members?.data ?? []).flatMap((m) => (m.id ? [[m.id, m.display_name ?? ""] as const] : [])));
  const personName = new Map((people?.data ?? []).map((p) => [p.id, p.display_name ?? ""] as const));

  const tickets = rows.map((r): Ticket => {
    const steps = stepsOf(r.steps);
    const waitingOn = (r.waiting_on_actor_id ? actorName.get(r.waiting_on_actor_id) : r.waiting_on_person_id ? personName.get(r.waiting_on_person_id) : null) || null;
    return {
      id: r.id,
      kind: r.kind,
      title: kindLabel(r.kind),
      status: statusOf({ status: r.status, needsYou: r.needs_you }),
      rawStatus: r.status,
      applicationId: r.application_id,
      personId: r.applications?.person_id ?? null,
      name: r.applications?.people?.display_name ?? "No candidate",
      jobTitle: r.applications?.roles?.title ?? null,
      jobId: r.applications?.role_id ?? null,
      ownerName: (r.applications?.owner_actor_id ? actorName.get(r.applications.owner_actor_id) : null) || null,
      standing: standing({ status: r.status, error: r.error, waitingOn, waitingChannel: r.waiting_channel, steps }),
      steps,
      error: r.error,
      waitingOn,
      waitingChannel: r.waiting_channel,
      updatedAt: r.updated_at,
    };
  });
  return { tickets, capped: rows.length >= TASKS_MAX };
}

export type CommandOutcome = { ok: true } | { ok: false; error: "not_found" | "forbidden" | "closed" | "failed" };

/** Queues a command for the bot through `bot_task_command`, which decides; its refusals as codes. */
export async function commandTicket(db: Db, taskId: string, command: TaskCommand): Promise<CommandOutcome> {
  const { error } = await db.rpc("bot_task_command", { p_task_id: taskId, p_command: command });
  if (!error) return { ok: true };
  if (error.code === "P0002") return { ok: false, error: "not_found" };
  if (error.code === "42501") return { ok: false, error: "forbidden" };
  if (error.code === "22023") return { ok: false, error: "closed" };
  console.error("[client-tickets] command failed:", error.message);
  return { ok: false, error: "failed" };
}
