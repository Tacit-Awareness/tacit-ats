import type { Db, Json } from "@tacit/db";
import { attentionOf, needsAttention, type BotCommandName, type BotStep, type BotTask } from "./bot-activity";

// Grokbot Activity's reads and its one write, on the member's OWN client
// (never a privileged one), so the policy decides: a task on an application is
// readable exactly where the application is, and one with no application by
// the member it serves and by admins (tacit-internal's can_read_bot_task). A
// member never writes `bot_tasks`: Retry and Nudge go through the
// bot_task_command definer, which checks the same rule and, on an application,
// the right to change it, audits as `dashboard` with no text, and queues the
// command. Nothing here calls a bot: the notify tick delivers what is queued.
// lib/client/bot-activity.ts says what the rows mean.

/** Tasks the log reads, newest first; past it the page says so. Search covers these. */
export const LOG_MAX = 500;
/** Tasks that may need a member, newest first; past it the page says so. */
export const NEEDS_MAX = 100;

const COLUMNS =
  "id, kind, status, needs_you, error, steps, created_at, updated_at, application_id, actor_id, waiting_on_actor_id, waiting_on_person_id, waiting_channel, " +
  "applications(id, role_id, added_by_actor_id, people(id, display_name), roles(title)), " +
  "waiting_person:people!bot_tasks_waiting_on_person_id_fkey(id, display_name), " +
  "bot_task_commands(command, status, error, created_at)";

type TaskRow = {
  id: string;
  kind: string;
  status: string;
  needs_you: boolean;
  error: string | null;
  steps: Json;
  created_at: string;
  updated_at: string;
  application_id: string | null;
  actor_id: string | null;
  waiting_on_actor_id: string | null;
  waiting_on_person_id: string | null;
  waiting_channel: string | null;
  applications: {
    id: string;
    role_id: string;
    added_by_actor_id: string | null;
    people: { id: string; display_name: string | null } | null;
    roles: { title: string } | null;
  } | null;
  waiting_person: { id: string; display_name: string | null } | null;
  bot_task_commands: { command: string; status: string; error: string | null; created_at: string }[] | null;
};

/** `steps` is the bot's own jsonb: anything that isn't a label is no step. */
export function parseSteps(raw: Json): BotStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((s) => {
    if (typeof s !== "object" || s === null || Array.isArray(s) || typeof s.label !== "string" || !s.label) return [];
    return [{ label: s.label, at: typeof s.at === "string" && !Number.isNaN(Date.parse(s.at)) ? s.at : null }];
  });
}

async function memberNames(db: Db, ids: string[]): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 150) {
    const { data, error } = await db.from("org_members").select("id, display_name").in("id", unique.slice(i, i + 150));
    if (error) throw new Error(error.message);
    for (const m of data ?? []) if (m.id) names.set(m.id, m.display_name);
  }
  return names;
}

const person = (id: string | null, names: Map<string, string | null>) => (id ? { id, name: names.get(id) ?? null } : null);

function toTask(r: TaskRow, names: Map<string, string | null>): BotTask {
  const app = r.applications;
  const candidate = app?.people ?? r.waiting_person;
  const waitingMember = person(r.waiting_on_actor_id, names);
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    needsYou: r.needs_you,
    error: r.error,
    steps: parseSteps(r.steps),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    actor: person(r.actor_id, names),
    waitingOn: waitingMember
      ? { ...waitingMember, type: "member" }
      : r.waiting_on_person_id
        ? { id: r.waiting_on_person_id, name: r.waiting_person?.display_name ?? null, type: "candidate" }
        : null,
    channel: r.waiting_channel,
    // can_read_bot_task doesn't look at merging, and the applications policy hides a merged one from everyone: the task reads, its application doesn't.
    application: !r.application_id ? null : app ? { id: app.id, roleId: app.role_id, addedBy: app.added_by_actor_id, merged: false } : { id: r.application_id, roleId: null, addedBy: null, merged: true },
    candidate: candidate ? { id: candidate.id, name: candidate.display_name ?? "this candidate" } : null,
    jobTitle: app?.roles?.title ?? null,
    commands: (r.bot_task_commands ?? []).map((c) => ({ command: c.command, status: c.status, error: c.error, createdAt: c.created_at })),
  };
}

async function toTasks(db: Db, rows: TaskRow[]): Promise<BotTask[]> {
  const names = await memberNames(db, rows.flatMap((r) => [r.actor_id, r.waiting_on_actor_id].filter((id): id is string => !!id)));
  return rows.map((r) => toTask(r, names));
}

export type BotLogRead = { tasks: BotTask[]; capped: boolean };

/** The log: every task the member can read, newest first (`bot_tasks_org_recent` carries the sort). */
export async function readBotLog(db: Db): Promise<BotLogRead> {
  const { data, error } = await db
    .from("bot_tasks")
    .select(COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(LOG_MAX)
    .overrideTypes<TaskRow[], { merge: false }>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return { tasks: await toTasks(db, rows), capped: rows.length >= LOG_MAX };
}

/** What needs a member now, newest first: the Inbox's bot issues and Activity's "Needs you". */
export async function readBotNeedsYou(db: Db, now: Date): Promise<BotLogRead> {
  const { data, error } = await db
    .from("bot_tasks")
    .select(COLUMNS)
    .or("needs_you.eq.true,status.eq.failed")
    .order("updated_at", { ascending: false })
    .limit(NEEDS_MAX)
    .overrideTypes<TaskRow[], { merge: false }>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return { tasks: (await toTasks(db, rows)).filter((t) => needsAttention(t, now.getTime())), capped: rows.length >= NEEDS_MAX };
}

/**
 * Who may press the fix, before they press it. bot_task_command refuses
 * otherwise, and this is the same rule: anyone who can read a task with no
 * application, and on an application whoever can_edit_application says.
 */
export async function canCommandTask(db: Db, application: BotTask["application"]): Promise<boolean> {
  if (!application) return true;
  if (!application.roleId) return false;
  const { data, error } = await db.rpc("can_edit_application", { p_role: application.roleId, p_added_by: application.addedBy as string });
  if (error) throw new Error(error.message);
  return data === true;
}

/** The tasks of `tasks` this member may command, asking once per job and adder. */
export async function commandableTasks(db: Db, tasks: BotTask[]): Promise<Set<string>> {
  const scope = (t: BotTask) => (t.application ? `${t.application.roleId}:${t.application.addedBy ?? ""}` : "");
  const asks = new Map<string, Promise<boolean>>();
  for (const t of tasks) if (!asks.has(scope(t))) asks.set(scope(t), canCommandTask(db, t.application));
  const answers = new Map(await Promise.all([...asks].map(async ([key, ask]) => [key, await ask] as const)));
  return new Set(tasks.filter((t) => answers.get(scope(t))).map((t) => t.id));
}

export type BotCommandOutcome = { ok: true; changed: boolean } | { ok: false; error: "not_found" | "forbidden" | "closed" };

/**
 * Retry or Nudge: queues the command, only while the task still needs what the
 * page offered. The re-read is what stops a stale page: a retry someone already
 * asked for and the bot already took, or a task that has moved on, would make
 * the bot act twice, and a retry on a rejection emails the candidate.
 */
export async function sendBotCommand(db: Db, me: string, input: { taskId: string; command: BotCommandName }, now: Date): Promise<BotCommandOutcome> {
  const { data, error } = await db.from("bot_tasks").select(COLUMNS).eq("id", input.taskId).overrideTypes<TaskRow[], { merge: false }>();
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) return { ok: false, error: "not_found" };
  const [task] = await toTasks(db, [row]);
  if (!needsAttention(task!, now.getTime())) return { ok: true, changed: false };
  const attention = attentionOf(task!, me, now.getTime());
  if (attention.fix.command !== input.command || attention.queued) return { ok: true, changed: false };

  const sent = await db.rpc("bot_task_command", { p_task_id: input.taskId, p_command: input.command });
  if (!sent.error) return { ok: true, changed: true };
  if (sent.error.code === "P0002") return { ok: false, error: "not_found" };
  if (sent.error.code === "42501") return { ok: false, error: "forbidden" };
  if (sent.error.code === "22023") return { ok: false, error: "closed" };
  throw new Error(sent.error.message);
}
