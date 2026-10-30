import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { commandableTasks, readBotLog, readBotNeedsYou, sendBotCommand } from "./bot-tasks";
import { readInbox, readIssue } from "./inbox";

/**
 * Grokbot Activity against the local stack, on members' own tokens: the policy
 * decides which tasks exist for whom, and bot_task_command queues or refuses.
 * Every fixture is written with the service role, as the bot's callback would.
 * Nothing here delivers: no notify tick runs, the destination's URL goes
 * nowhere, and a queued command stays `pending`, which the tests pin. The member
 * token is signed with the stack's JWT secret, as in inbox.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "e8000000-0000-4000-8000-0000000000f1";
const GLOBEX = "e8100000-0000-4000-8000-0000000000f2";
const ADMIN = "e8a00000-0000-4000-8000-0000000000f1";
const LEAD = "e8a00000-0000-4000-8000-0000000000f2";
const INTERVIEWER = "e8a00000-0000-4000-8000-0000000000f3";
const OTHER_LEAD = "e8a00000-0000-4000-8000-0000000000f4";
const GLOBEX_ADMIN = "e8a10000-0000-4000-8000-0000000000f1";
const ENGINEER = "e8b00000-0000-4000-8000-0000000000f1";
const DESIGNER = "e8b00000-0000-4000-8000-0000000000f2";
const GLOBEX_ROLE = "e8b10000-0000-4000-8000-0000000000f1";
const BOT = "e8f00000-0000-4000-8000-0000000000f1";
const GLOBEX_BOT = "e8f10000-0000-4000-8000-0000000000f1";
const app = (n: number) => `e8d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const person = (n: number) => `e8c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const task = (n: number) => `e8e00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const GLOBEX_APP = "e8d10000-0000-4000-8000-0000000000f1";
const GLOBEX_PERSON = "e8c10000-0000-4000-8000-0000000000f1";
const GLOBEX_TASK = "e8e10000-0000-4000-8000-0000000000f1";

const ACME_WORKOS = "org_itest_bots_acme";
const GLOBEX_WORKOS = "org_itest_bots_globex";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of [
    "bot_task_commands", "bot_tasks", "agent_destinations", "application_events", "interviews", "applications", "hiring_team", "people", "roles", "companies",
  ] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("audit_log").delete().in("org_id", ids);
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const token = (subject: string, workosOrgId = ACME_WORKOS) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};

const ada = { actorId: ADMIN, orgId: ACME, accessLevel: "admin" as const };
const lee = { actorId: LEAD, orgId: ACME, accessLevel: "elevated" as const };

const NOW = new Date();
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

type TaskFixture = Record<string, unknown> & { id: string; kind: string; status: string };

const bot = (t: TaskFixture) => ({ org_id: ACME, agent_destination_id: BOT, ref: t.id, ...t });

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-bots-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-bots-globex", kind: "client", workos_org_id: GLOBEX_WORKOS },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-bt-admin", display_name: "Ada Admin", email: "ada@bt.test", access_level: "admin", auth_subject: "user_bt_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-bt-lead", display_name: "Lee Lead", email: "lee@bt.test", access_level: "elevated", auth_subject: "user_bt_lee" },
    { id: INTERVIEWER, org_id: ACME, slug: "itest-bt-ivan", display_name: "Ivan Interviewer", email: "ivan@bt.test", access_level: "limited", auth_subject: "user_bt_ivan" },
    { id: OTHER_LEAD, org_id: ACME, slug: "itest-bt-omar", display_name: "Omar Other", email: "omar@bt.test", access_level: "elevated", auth_subject: "user_bt_omar" },
    { id: GLOBEX_ADMIN, org_id: GLOBEX, slug: "itest-bt-gina", display_name: "Gina Globex", email: "gina@bt.test", access_level: "admin", auth_subject: "user_bt_gina" },
  ]));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer"], [DESIGNER, "Designer"]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role"]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title]) => ({ id, org_id: org, company_id: company!.id, title, status: "open" }))));
  }
  // Lee manages the engineer search only, Omar the designer's; Ivan interviews for the engineer.
  must(await db().from("hiring_team").insert([
    { org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" },
    { org_id: ACME, role_id: DESIGNER, actor_id: OTHER_LEAD, team_role: "hiring_manager" },
    { org_id: ACME, role_id: ENGINEER, actor_id: INTERVIEWER, team_role: "interviewer" },
  ]));

  must(await db().from("people").insert([
    ...[1, 2, 3, 4].map((n) => ({ id: person(n), org_id: ACME, display_name: `Candidate ${n}`, email: `c${n}@bt.test` })),
    { id: GLOBEX_PERSON, org_id: GLOBEX, display_name: "Globex Candidate", email: "g@bt.test" },
  ]));
  for (const row of [
    { id: app(1), org_id: ACME, person_id: person(1), role_id: ENGINEER, stage: "interviewing" },
    { id: app(2), org_id: ACME, person_id: person(2), role_id: ENGINEER, stage: "screening", next_action: "Call", next_action_due: at(-72).slice(0, 10) },
    { id: app(3), org_id: ACME, person_id: person(3), role_id: DESIGNER, stage: "screening" },
    { id: app(4), org_id: ACME, person_id: person(4), role_id: ENGINEER, stage: "rejected" },
    { id: GLOBEX_APP, org_id: GLOBEX, person_id: GLOBEX_PERSON, role_id: GLOBEX_ROLE, stage: "screening" },
  ]) {
    must(await db().from("applications").insert({ ...row, source: "sourced" }));
  }
  must(await db().from("agent_destinations").insert([
    { id: BOT, org_id: ACME, url: "https://bot.invalid/hook", secret: `tbs_${"c".repeat(64)}`, enabled: false, verified_at: null },
    { id: GLOBEX_BOT, org_id: GLOBEX, url: "https://bot.invalid/globex", secret: `tbs_${"d".repeat(64)}`, enabled: false, verified_at: null },
  ]));
  for (const row of [
    bot({ id: task(1), kind: "send_rejection", status: "failed", application_id: app(4), error: "Gmail refused it", steps: [{ label: "Wrote the note", at: at(-3) }, { nonsense: true }], updated_at: at(-2) }),
    bot({ id: task(2), kind: "get_read", status: "waiting", application_id: app(2), actor_id: INTERVIEWER, waiting_on_actor_id: INTERVIEWER, waiting_channel: "slack", needs_you: true, updated_at: at(-30) }),
    bot({ id: task(3), kind: "schedule_interview", status: "failed", application_id: app(3), error: "No calendar", updated_at: at(-5) }),
    bot({ id: task(4), kind: "other", status: "failed", actor_id: LEAD, error: "Lee's own", updated_at: at(-6) }),
    bot({ id: task(5), kind: "find_interviewer", status: "running", application_id: app(1), updated_at: at(-1) }),
    bot({ id: task(6), kind: "send_testbench", status: "done", application_id: app(1), updated_at: at(-4) }),
  ]) {
    must(await db().from("bot_tasks").insert(row as never));
  }
  must(await db().from("bot_tasks").insert({ id: GLOBEX_TASK, org_id: GLOBEX, agent_destination_id: GLOBEX_BOT, ref: "g", kind: "other", status: "failed", application_id: GLOBEX_APP, error: "Globex's" }));
});

afterAll(clear);

const ids = (tasks: { id: string }[]) => tasks.map((t) => t.id).sort();

describe("reading", () => {
  test("an admin reads the whole company, and only theirs", async () => {
    const { tasks, capped } = await readBotLog(token("user_bt_ada"));
    expect(ids(tasks)).toEqual([1, 2, 3, 4, 5, 6].map(task).sort());
    expect(capped).toBe(false);
  });

  test("newest first, with names, the job, and steps cleaned of what isn't one", async () => {
    const { tasks } = await readBotLog(token("user_bt_ada"));
    expect(tasks[0]!.id).toBe(task(5));
    const t = tasks.find((x) => x.id === task(1))!;
    expect(t).toMatchObject({ kind: "send_rejection", candidate: { id: person(4), name: "Candidate 4" }, jobTitle: "Founding Engineer", error: "Gmail refused it" });
    expect(t.steps.map((s) => s.label)).toEqual(["Wrote the note"]);
    const read = tasks.find((x) => x.id === task(2))!;
    expect(read.waitingOn).toEqual({ id: INTERVIEWER, name: "Ivan Interviewer", type: "member" });
  });

  test("a hiring manager reads their job's tasks, and their own with no application", async () => {
    const { tasks } = await readBotLog(token("user_bt_lee"));
    expect(ids(tasks)).toEqual([1, 2, 4, 5, 6].map(task).sort());
  });

  test("a task with no application is for the member it serves and admins, no one else", async () => {
    expect(ids((await readBotLog(token("user_bt_omar"))).tasks)).toEqual([task(3)]);
  });

  test("another company's member reads only theirs", async () => {
    expect(ids((await readBotLog(token("user_bt_gina", GLOBEX_WORKOS))).tasks)).toEqual([GLOBEX_TASK]);
  });

  test("Needs you: failed or flagged, nothing healthy, nothing done", async () => {
    const { tasks } = await readBotNeedsYou(token("user_bt_ada"), NOW);
    expect(ids(tasks)).toEqual([1, 2, 3, 4].map(task).sort());
  });

  test("a task on a merged application stays in the log and leaves Needs you", async () => {
    must(await db().from("applications").update({ merged_into_id: app(2) }).eq("id", app(3)));
    const client = token("user_bt_ada");
    expect(ids((await readBotNeedsYou(client, NOW)).tasks)).not.toContain(task(3));
    const read = (await readBotLog(client)).tasks.find((t) => t.id === task(3))!;
    expect(read.application).toEqual({ id: app(3), roleId: null, addedBy: null, merged: true });
    expect(await commandableTasks(client, [read])).toEqual(new Set());
    expect(await sendBotCommand(client, ADMIN, { taskId: task(3), command: "retry" }, NOW)).toEqual({ ok: true, changed: false });
  });

  test("a failed command's delivery note never reaches an unrelated field", async () => {
    must(await db().from("bot_task_commands").insert({ org_id: ACME, task_id: task(3), command: "retry", status: "failed", error: "stale", attempts: 5 }));
    const t = (await readBotNeedsYou(token("user_bt_ada"), NOW)).tasks.find((x) => x.id === task(3))!;
    expect(t.commands).toEqual([expect.objectContaining({ command: "retry", status: "failed", error: "stale" })]);
    expect(t.error).toBe("No calendar");
  });
});

describe("who may press", () => {
  test("an admin, anything; a hiring manager, their job's and their own", async () => {
    const all = (await readBotNeedsYou(token("user_bt_ada"), NOW)).tasks;
    expect([...(await commandableTasks(token("user_bt_ada"), all))].sort()).toEqual([1, 2, 3, 4].map(task).sort());
    const lees = (await readBotNeedsYou(token("user_bt_lee"), NOW)).tasks;
    expect([...(await commandableTasks(token("user_bt_lee"), lees))].sort()).toEqual([1, 2, 4].map(task).sort());
  });

  test("an interviewer reads only a task of theirs with no application: the policy hides the rest, their own interviews' too", async () => {
    must(await db().from("bot_tasks").insert(bot({ id: task(7), kind: "other", status: "failed", actor_id: INTERVIEWER, error: "Ivan's own" }) as never));
    const client = token("user_bt_ivan");
    const { tasks } = await readBotLog(client);
    expect(ids(tasks)).toEqual([task(7)]);
    expect([...(await commandableTasks(client, tasks))]).toEqual([task(7)]);
    expect(await sendBotCommand(client, INTERVIEWER, { taskId: task(2), command: "nudge" }, NOW)).toEqual({ ok: false, error: "not_found" });
    expect((await db().from("bot_task_commands").select("id").eq("task_id", task(2))).data).toEqual([]);
  });
});

describe("Retry and Nudge", () => {
  const commands = async (id: string) => (await db().from("bot_task_commands").select("command, status, created_by_actor_id, attempts").eq("task_id", id)).data;

  test("a retry queues one command, pending, by the member, delivered by no one here", async () => {
    expect(await sendBotCommand(token("user_bt_ada"), ADMIN, { taskId: task(1), command: "retry" }, NOW)).toEqual({ ok: true, changed: true });
    expect(await commands(task(1))).toEqual([{ command: "retry", status: "pending", created_by_actor_id: ADMIN, attempts: 0 }]);
  });

  test("the audit row says dashboard and which command, and no text of the task's", async () => {
    await sendBotCommand(token("user_bt_ada"), ADMIN, { taskId: task(1), command: "retry" }, NOW);
    const { data } = await db().from("audit_log").select("source, action, after").eq("org_id", ACME).eq("action", "bot_task.command");
    expect(data).toEqual([{ source: "dashboard", action: "bot_task.command", after: { task_id: task(1), command: "retry" } }]);
    expect(JSON.stringify(data)).not.toContain("Gmail refused it");
  });

  test("a nudge clears the flag, so it leaves Needs you and the Inbox", async () => {
    const client = token("user_bt_lee");
    expect(await sendBotCommand(client, LEAD, { taskId: task(2), command: "nudge" }, NOW)).toEqual({ ok: true, changed: true });
    expect((await db().from("bot_tasks").select("needs_you").eq("id", task(2)).single()).data).toEqual({ needs_you: false });
    expect(ids((await readBotNeedsYou(client, new Date())).tasks)).not.toContain(task(2));
  });

  test("a retry takes a failed task out, though it stays failed until the bot reports", async () => {
    const client = token("user_bt_ada");
    await sendBotCommand(client, ADMIN, { taskId: task(1), command: "retry" }, NOW);
    expect((await db().from("bot_tasks").select("status").eq("id", task(1)).single()).data).toEqual({ status: "failed" });
    expect(ids((await readBotNeedsYou(client, new Date())).tasks)).not.toContain(task(1));
    // The bot says it failed again: back it comes.
    must(await db().from("bot_tasks").update({ updated_at: new Date(Date.now() + 1000).toISOString() }).eq("id", task(1)));
    expect(ids((await readBotNeedsYou(client, new Date(Date.now() + 2000))).tasks)).toContain(task(1));
  });

  test("a second press changes nothing: the task already left the list", async () => {
    const client = token("user_bt_ada");
    await sendBotCommand(client, ADMIN, { taskId: task(1), command: "retry" }, NOW);
    expect(await sendBotCommand(client, ADMIN, { taskId: task(1), command: "retry" }, new Date())).toEqual({ ok: true, changed: false });
    expect(await commands(task(1))).toHaveLength(1);
  });

  test("twenty presses at once queue one command and one audit row", async () => {
    const client = token("user_bt_ada");
    const results = await Promise.all(Array.from({ length: 20 }, () => sendBotCommand(client, ADMIN, { taskId: task(1), command: "retry" }, NOW)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await commands(task(1))).toHaveLength(1);
    const { data } = await db().from("audit_log").select("id").eq("org_id", ACME).eq("action", "bot_task.command");
    expect(data).toHaveLength(1);
  });

  test("a stale page: the task moved on, so nothing is queued", async () => {
    must(await db().from("bot_tasks").update({ status: "done" }).eq("id", task(1)));
    expect(await sendBotCommand(token("user_bt_ada"), ADMIN, { taskId: task(1), command: "retry" }, NOW)).toEqual({ ok: true, changed: false });
    expect(await commands(task(1))).toEqual([]);
  });

  test("the command the page didn't offer is not sent: a nudge on a failed task", async () => {
    expect(await sendBotCommand(token("user_bt_ada"), ADMIN, { taskId: task(1), command: "nudge" }, NOW)).toEqual({ ok: true, changed: false });
    expect(await commands(task(1))).toEqual([]);
  });

  test("a hiring manager on another job is refused, and no command lands", async () => {
    expect(await sendBotCommand(token("user_bt_lee"), LEAD, { taskId: task(3), command: "retry" }, NOW)).toEqual({ ok: false, error: "not_found" });
    expect(await commands(task(3))).toEqual([]);
  });

  test("another company's task is not found", async () => {
    expect(await sendBotCommand(token("user_bt_ada"), ADMIN, { taskId: GLOBEX_TASK, command: "retry" }, NOW)).toEqual({ ok: false, error: "not_found" });
    expect(await commands(GLOBEX_TASK)).toEqual([]);
  });

  test("the member's token can't write the tables around the definer", async () => {
    const client = token("user_bt_ada");
    const insert = await client.from("bot_task_commands").insert({ org_id: ACME, task_id: task(1), command: "retry" });
    expect(insert.error).not.toBeNull();
    await client.from("bot_tasks").update({ status: "done" }).eq("id", task(1));
    expect((await db().from("bot_tasks").select("status").eq("id", task(1)).single()).data).toEqual({ status: "failed" });
  });

  test("an erased candidate's task is cancelled and blank, and nothing can be sent", async () => {
    must(await db().from("people").update({ anonymized_at: at(0) }).eq("id", person(2)));
    const client = token("user_bt_ada");
    expect(ids((await readBotNeedsYou(client, NOW)).tasks)).not.toContain(task(2));
    const t = (await readBotLog(client)).tasks.find((x) => x.id === task(2))!;
    expect(t).toMatchObject({ status: "cancelled", steps: [], error: null, needsYou: false });
    expect(await sendBotCommand(client, ADMIN, { taskId: task(2), command: "nudge" }, NOW)).toEqual({ ok: true, changed: false });
  });
});

describe("the Inbox", () => {
  test("a bot issue comes first and takes the place of its application's issue", async () => {
    const { issues } = await readInbox(token("user_bt_ada"), ada, NOW);
    const of = (key: string) => issues.find((i) => i.key === key);
    expect(issues[0]?.kind).toBe("bot");
    // Application 2 has an overdue next action too: the stuck read is its one issue.
    expect(of(`app-${app(2)}`)).toBeUndefined();
    expect(of(`bot-${task(2)}`)).toMatchObject({ kind: "late", reason: "bot_waiting", what: "Ivan hasn't sent a read on Candidate 2", who: "Ivan Interviewer" });
    expect(of(`bot-${task(1)}`)).toMatchObject({ kind: "bot", reason: "bot_failed", what: "The rejection to Candidate 4 didn't send", why: "Gmail refused it" });
    expect(of(`bot-${task(4)}`)).toMatchObject({ kind: "bot", candidate: null, applicationId: null });
  });

  test("a hiring manager sees their job's, may press them, and never sees another job's", async () => {
    const client = token("user_bt_lee");
    const { issues } = await readInbox(client, lee, NOW);
    expect(issues.map((i) => i.key)).not.toContain(`bot-${task(3)}`);
    const mine = issues.find((i) => i.key === `bot-${task(2)}`)!;
    expect((await readIssue(client, lee, mine)).canEdit).toBe(true);
  });

  test("an issue with no candidate reads no story, and its member may press it", async () => {
    const client = token("user_bt_ada");
    const { issues } = await readInbox(client, ada, NOW);
    const own = issues.find((i) => i.key === `bot-${task(4)}`)!;
    const detail = await readIssue(client, ada, own);
    expect(detail.story).toEqual([]);
    expect(detail.canEdit).toBe(true);
  });
});
