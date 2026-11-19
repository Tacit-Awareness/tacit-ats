import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { commandTicket, readTickets } from "./bot-tasks";

/**
 * Tickets against the local stack, on members' own tokens: the company bot's
 * tasks as `bot_tasks`' client_read policy lets each member read them, and a
 * command queued through `bot_task_command`, which decides who may and when.
 */

const db = () => getSupabaseServiceClient();

const ACME = "e8000000-0000-4000-8000-0000000000b1";
const GLOBEX = "e8000000-0000-4000-8000-0000000000b2";
const ADMIN = "e8a00000-0000-4000-8000-0000000000b1";
const LEAD = "e8a00000-0000-4000-8000-0000000000b2";
const ENGINEER = "e8b00000-0000-4000-8000-0000000000b1";
const DESIGNER = "e8b00000-0000-4000-8000-0000000000b2";
const GLOBEX_ROLE = "e8b00000-0000-4000-8000-0000000000b3";
const DEST = "e8f00000-0000-4000-8000-0000000000b1";
const GLOBEX_DEST = "e8f00000-0000-4000-8000-0000000000b2";
const app = (n: number) => `e8d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const person = (n: number) => `e8c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const task = (n: number) => `e8e00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of ["bot_task_commands", "bot_tasks", "agent_destinations", "application_events", "applications", "hiring_team", "people", "roles", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const member = (subject: string, workosOrgId: string) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};
const ada = () => member("user_bt_ada", "org_itest_bt_acme");
const lee = () => member("user_bt_lee", "org_itest_bt_acme");

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-bt-acme", kind: "client", workos_org_id: "org_itest_bt_acme" },
    { id: GLOBEX, name: "Globex", slug: "itest-bt-globex", kind: "client", workos_org_id: "org_itest_bt_globex" },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-bt-admin", display_name: "Ada Admin", email: "ada@bt.test", access_level: "admin", auth_subject: "user_bt_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-bt-lead", display_name: "Lee Lead", email: "lee@bt.test", access_level: "elevated", auth_subject: "user_bt_lee" },
  ]));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer"], [DESIGNER, "Designer"]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role"]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title]) => ({ id, org_id: org, company_id: company!.id, title, status: "open" }))));
  }
  must(await db().from("hiring_team").insert({ org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" }));
  must(await db().from("people").insert([
    { id: person(1), org_id: ACME, display_name: "Candidate One", email: "c1@bt.test" },
    { id: person(2), org_id: ACME, display_name: "Candidate Two", email: "c2@bt.test" },
    { id: person(9), org_id: GLOBEX, display_name: "Globex Candidate", email: "g@bt.test" },
  ]));
  must(await db().from("applications").insert([
    { id: app(1), org_id: ACME, person_id: person(1), role_id: ENGINEER, stage: "interviewing", owner_actor_id: LEAD },
    { id: app(2), org_id: ACME, person_id: person(2), role_id: DESIGNER, stage: "screening" },
    { id: app(9), org_id: GLOBEX, person_id: person(9), role_id: GLOBEX_ROLE, stage: "interviewing" },
  ]));
  must(await db().from("agent_destinations").insert([
    { id: DEST, org_id: ACME, url: "https://bot.example.com/acme", secret: "acme-secret-0123456789" },
    { id: GLOBEX_DEST, org_id: GLOBEX, url: "https://bot.example.com/globex", secret: "globex-secret-0123456789" },
  ]));
  // Every row names every column: a bulk insert sends null for one a row leaves out, past its default.
  must(await db().from("bot_tasks").insert([
    { id: task(1), org_id: ACME, agent_destination_id: DEST, ref: "t1", kind: "schedule_interview", status: "waiting", needs_you: true, application_id: app(1), waiting_on_actor_id: LEAD, waiting_channel: "slack", steps: [{ label: "Asked Lee for times" }] },
    { id: task(2), org_id: ACME, agent_destination_id: DEST, ref: "t2", kind: "send_rejection", status: "failed", needs_you: false, error: "Mailbox not connected", application_id: app(2), steps: [] },
    { id: task(3), org_id: ACME, agent_destination_id: DEST, ref: "t3", kind: "get_read", status: "done", needs_you: false, application_id: app(1), steps: [{ label: "Read filed" }] },
    { id: task(9), org_id: GLOBEX, agent_destination_id: GLOBEX_DEST, ref: "t9", kind: "get_read", status: "running", needs_you: false, application_id: app(9), steps: [] },
  ]));
});

afterAll(clear);

describe("Tickets' read", () => {
  test("an admin reads every task in their company, with who and where it waits, and never another company's", async () => {
    const { tickets } = await readTickets(ada());
    expect(tickets.map((t) => t.id).sort()).toEqual([task(1), task(2), task(3)].sort());
    const waiting = tickets.find((t) => t.id === task(1))!;
    expect(waiting).toMatchObject({ status: "needs", name: "Candidate One", jobTitle: "Founding Engineer", ownerName: "Lee Lead", waitingOn: "Lee Lead", standing: "Lee Lead on Slack", title: "Schedule Interview" });
    expect(tickets.find((t) => t.id === task(2))).toMatchObject({ status: "failed", standing: "Mailbox not connected" });
  });

  test("a hiring manager reads only the tasks on their job", async () => {
    const { tickets } = await readTickets(lee());
    expect(tickets.map((t) => t.id).sort()).toEqual([task(1), task(3)].sort());
  });
});

describe("telling the bot", () => {
  test("a command on an open task is queued for the bot", async () => {
    expect(await commandTicket(ada(), task(1), "nudge")).toEqual({ ok: true });
    const { data } = must(await db().from("bot_task_commands").select("task_id, command, created_by_actor_id").eq("org_id", ACME));
    expect(data).toEqual([{ task_id: task(1), command: "nudge", created_by_actor_id: ADMIN }]);
  });

  test("a finished task, a task elsewhere and one off the member's jobs are refused", async () => {
    expect(await commandTicket(ada(), task(3), "cancel")).toEqual({ ok: false, error: "closed" });
    expect(await commandTicket(ada(), task(9), "cancel")).toEqual({ ok: false, error: "not_found" });
    expect(await commandTicket(lee(), task(2), "retry")).toEqual({ ok: false, error: "not_found" });
    const { data } = must(await db().from("bot_task_commands").select("id").in("org_id", [ACME, GLOBEX]));
    expect(data).toEqual([]);
  });
});
