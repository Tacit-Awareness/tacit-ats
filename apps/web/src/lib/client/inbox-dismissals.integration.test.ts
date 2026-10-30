import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { dismissIssue, noteResolved, readDone, readInbox, restoreIssue } from "./inbox";
import { instanceId, type Issue, type IssueInstance } from "./inbox-issues";

/**
 * The Inbox's Done tab and Dismiss against the local stack, on members' own
 * tokens: a dismissal is one member's and one instance's, the policies stop
 * everyone else, and Done shows only what the member can still read. Needs
 * tacit-internal's `20261030140000_inbox_dismissals`.
 */

const db = () => getSupabaseServiceClient();

const ACME = "e9000000-0000-4000-8000-0000000000f1";
const GLOBEX = "e9100000-0000-4000-8000-0000000000f2";
const ADMIN = "e9a00000-0000-4000-8000-0000000000f1";
const LEAD = "e9a00000-0000-4000-8000-0000000000f2";
const INTERVIEWER = "e9a00000-0000-4000-8000-0000000000f3";
const FINANCE = "e9a00000-0000-4000-8000-0000000000f4";
const GLOBEX_ADMIN = "e9a10000-0000-4000-8000-0000000000f1";
const ENGINEER = "e9b00000-0000-4000-8000-0000000000f1";
const DESIGNER = "e9b00000-0000-4000-8000-0000000000f2";
const GLOBEX_ROLE = "e9b10000-0000-4000-8000-0000000000f1";
const app = (n: number) => `e9d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const person = (n: number) => `e9c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const INTERVIEW = "e9e00000-0000-4000-8000-0000000000f1";
const DRAFT = "e9f00000-0000-4000-8000-0000000000f1";
const REQUEST = "e9f10000-0000-4000-8000-0000000000f1";

const ACME_WORKOS = "org_itest_dismiss_acme";
const GLOBEX_WORKOS = "org_itest_dismiss_globex";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of [
    "inbox_dismissals", "approval_decisions", "approval_requests", "approval_flow_approvers", "approval_flows", "candidate_emails", "interview_feedback",
    "application_events", "interviews", "applications", "hiring_team", "people", "roles", "companies",
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
const fin = { actorId: FINANCE, orgId: ACME, accessLevel: "elevated" as const };
const adaDb = () => token("user_dm_ada");
const leeDb = () => token("user_dm_lee");

const NOW = new Date();
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
const dayAgo = (d: number) => at(-24 * d).slice(0, 10);

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-dismiss-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-dismiss-globex", kind: "client", workos_org_id: GLOBEX_WORKOS },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-dm-admin", display_name: "Ada Admin", email: "ada@dm.test", access_level: "admin", auth_subject: "user_dm_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-dm-lead", display_name: "Lee Lead", email: "lee@dm.test", access_level: "elevated", auth_subject: "user_dm_lee" },
    { id: INTERVIEWER, org_id: ACME, slug: "itest-dm-ivan", display_name: "Ivan Interviewer", email: "ivan@dm.test", access_level: "limited", auth_subject: "user_dm_ivan" },
    { id: FINANCE, org_id: ACME, slug: "itest-dm-fin", display_name: "Fin Finance", email: "fin@dm.test", access_level: "elevated", auth_subject: "user_dm_fin" },
    { id: GLOBEX_ADMIN, org_id: GLOBEX, slug: "itest-dm-gina", display_name: "Gina Globex", email: "gina@dm.test", access_level: "admin", auth_subject: "user_dm_gina" },
  ]));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer"], [DESIGNER, "Designer"]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role"]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title]) => ({ id, org_id: org, company_id: company!.id, title, status: "open" }))));
  }
  must(await db().from("hiring_team").insert([
    { org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" },
    { org_id: ACME, role_id: ENGINEER, actor_id: INTERVIEWER, team_role: "interviewer" },
  ]));

  // 1 has two things wrong: feedback missing and an overdue next action. 2 an engineer gone quiet. 3 a designer overdue.
  const apps: [number, string, string, Record<string, unknown>][] = [
    [1, ENGINEER, "interviewing", { next_action: "Call the reference", next_action_due: dayAgo(3) }],
    [2, ENGINEER, "screening", { last_touch_at: at(-9 * 24) }],
    [3, DESIGNER, "screening", { next_action: "Send the brief", next_action_due: dayAgo(3) }],
  ];
  must(await db().from("people").insert(apps.map(([n]) => ({ id: person(n), org_id: ACME, display_name: `Candidate ${n}`, email: `c${n}@dm.test` }))));
  for (const [n, role, stage, extra] of apps) {
    must(await db().from("applications").insert({ id: app(n), org_id: ACME, person_id: person(n), role_id: role, stage, source: "sourced", ...extra }));
  }
  must(await db().from("interviews").insert({
    id: INTERVIEW, org_id: ACME, application_id: app(1), starts_at: at(-49), ends_at: at(-48), status: "scheduled", step: "Onsite", interviewer_actor_ids: [INTERVIEWER],
  }));
  must(await db().from("candidate_emails").insert({ id: DRAFT, org_id: ACME, person_id: person(1), application_id: app(1), author_actor_id: ADMIN, to_email: "c1@dm.test", subject: "Private subject", body: "Hello", status: "draft" }));

  // Opening the designer job waits on Fin, who is on no job, and on Ada after her.
  const { data: flow } = must(await db().from("approval_flows").insert({ org_id: ACME, role_id: DESIGNER, kind: "job_open" }).select("id").single());
  must(await db().from("approval_flow_approvers").insert([
    { org_id: ACME, flow_id: flow!.id, step: 1, actor_id: FINANCE },
    { org_id: ACME, flow_id: flow!.id, step: 2, actor_id: ADMIN },
  ]));
  must(await db().from("approval_requests").insert({ id: REQUEST, org_id: ACME, role_id: DESIGNER, kind: "job_open", current_step: 1, requested_by_actor_id: LEAD }));
});

afterAll(clear);

const instance = (i: Issue): IssueInstance => ({ key: i.key, reason: i.reason, at: i.at });
const queue = async (client: ReturnType<typeof token>, member: Parameters<typeof readInbox>[1], when = NOW) => (await readInbox(client, member, when)).issues;
const issueOn = async (client: ReturnType<typeof token>, member: Parameters<typeof readInbox>[1], key: string) => (await queue(client, member)).find((i) => i.key === key)!;
const done = async (client: ReturnType<typeof token>, member: Parameters<typeof readInbox>[1], when = NOW) => {
  const { standing } = await readInbox(client, member, when);
  return (await readDone(client, member.actorId, standing)).items;
};

describe("Dismiss", () => {
  test("it leaves this member's queue for Done, and a teammate's queue doesn't move", async () => {
    const quiet = await issueOn(adaDb(), ada, `app-${app(2)}`);
    expect(await dismissIssue(adaDb(), instance(quiet))).toMatchObject({ ok: true, changed: true });

    expect((await queue(adaDb(), ada)).some((i) => i.key === quiet.key)).toBe(false);
    expect((await queue(leeDb(), lee)).some((i) => i.key === quiet.key)).toBe(true);
    expect(await done(adaDb(), ada)).toMatchObject([{ what: "Nobody has been in touch", how: "dismissed", stands: true, canMoveBack: true, candidate: { name: "Candidate 2" } }]);
    expect(await done(leeDb(), lee)).toEqual([]);
  });

  test("the row is ids and timestamps, stamped with the member and the org by the database", async () => {
    await dismissIssue(adaDb(), instance(await issueOn(adaDb(), ada, `app-${app(3)}`)));
    const { data } = must(await db().from("inbox_dismissals").select("*").eq("org_id", ACME));
    expect(data).toMatchObject([{ actor_id: ADMIN, org_id: ACME, issue_key: `app-${app(3)}`, reason: "overdue", how: "dismissed" }]);
    expect(JSON.stringify(data)).not.toContain("Send the brief");
  });

  test("a member can't name another actor or org", async () => {
    const row = { issue_key: `app-${app(3)}`, reason: "overdue", issue_at: at(0), actor_id: LEAD };
    expect((await adaDb().from("inbox_dismissals").insert(row).select("id").maybeSingle()).error?.code).toBe("42501");
    const { actor_id: _, ...own } = row;
    expect((await adaDb().from("inbox_dismissals").insert({ ...own, org_id: GLOBEX }).select("id").maybeSingle()).error?.code).toBe("42501");
  });

  test("the next thing wrong with them takes its place", async () => {
    const feedback = await issueOn(adaDb(), ada, `app-${app(1)}`);
    expect(feedback.reason).toBe("feedback");
    await dismissIssue(adaDb(), instance(feedback));
    const next = await issueOn(adaDb(), ada, `app-${app(1)}`);
    expect(next).toMatchObject({ reason: "overdue", what: "Overdue: Call the reference" });
  });

  test("a later issue of the same kind on the same application stays in the queue", async () => {
    const first = await issueOn(adaDb(), ada, `app-${app(3)}`);
    await dismissIssue(adaDb(), instance(first));
    // A new due date, in the past as real dates can be: before the dismissal, and still a new issue.
    must(await db().from("applications").update({ next_action_due: dayAgo(1) }).eq("id", app(3)));
    expect(await issueOn(adaDb(), ada, first.key)).toMatchObject({ reason: "overdue" });
    expect(await done(adaDb(), ada)).toMatchObject([{ stands: false, canMoveBack: false, what: "Next action overdue" }]);
  });

  test("a draft's microseconds survive the round trip", async () => {
    const later = new Date(NOW.getTime() + 3 * 3_600_000);
    const draft = (await queue(adaDb(), ada, later)).find((i) => i.key === `draft-${DRAFT}`)!;
    await dismissIssue(adaDb(), instance(draft));
    expect(draft.at).toMatch(/\.\d{4,6}\+00:00$/);
    expect((await queue(adaDb(), ada, later)).some((i) => i.key === draft.key)).toBe(false);
  });

  test("a dismissed approval gives its place back, and an approver not on the job can still get it back", async () => {
    const finDb = token("user_dm_fin");
    const approval = await issueOn(finDb, fin, `appr-${REQUEST}`);
    const made = await dismissIssue(finDb, instance(approval));
    expect(await queue(finDb, fin)).toEqual([]);
    const items = await done(finDb, fin);
    expect(items).toMatchObject([{ what: "Approve opening Designer", canMoveBack: true, candidate: null }]);
    expect(made.ok && made.changed && (await restoreIssue(finDb, made.id))).toEqual({ key: approval.key });
    expect((await queue(finDb, fin)).map((i) => i.key)).toEqual([approval.key]);
  });

  test("twenty presses at once make one row and one Done item", async () => {
    const quiet = instance(await issueOn(adaDb(), ada, `app-${app(2)}`));
    const all = await Promise.all(Array.from({ length: 20 }, () => dismissIssue(adaDb(), quiet)));
    expect(all.every((o) => o.ok)).toBe(true);
    expect(all.filter((o) => o.ok && o.changed)).toHaveLength(1);
    expect((await done(adaDb(), ada)).length).toBe(1);
  });

  test("an interviewer is refused by the policy", async () => {
    expect(await dismissIssue(token("user_dm_ivan"), { key: `app-${app(2)}`, reason: "quiet", at: at(0) })).toEqual({ ok: false, error: "refused" });
  });

  test("another company's key is only a row of their own, and hides nothing here", async () => {
    const quiet = instance(await issueOn(adaDb(), ada, `app-${app(2)}`));
    const gina = token("user_dm_gina", GLOBEX_WORKOS);
    expect(await dismissIssue(gina, quiet)).toMatchObject({ ok: true, changed: true });
    expect((await queue(adaDb(), ada)).some((i) => i.key === quiet.key)).toBe(true);
    expect(await done(gina, { actorId: GLOBEX_ADMIN, orgId: GLOBEX, accessLevel: "admin" })).toEqual([]);
  });
});

describe("Move back and Undo", () => {
  test("the issue comes straight back", async () => {
    const quiet = await issueOn(adaDb(), ada, `app-${app(2)}`);
    const made = await dismissIssue(adaDb(), instance(quiet));
    if (!made.ok || !made.changed) throw new Error("not dismissed");
    expect(await restoreIssue(adaDb(), made.id)).toEqual({ key: quiet.key });
    expect((await queue(adaDb(), ada)).some((i) => i.key === quiet.key)).toBe(true);
    expect(await done(adaDb(), ada)).toEqual([]);
    expect(await restoreIssue(adaDb(), made.id)).toBeNull();
  });

  test("someone else's row isn't there for them", async () => {
    const made = await dismissIssue(adaDb(), instance(await issueOn(adaDb(), ada, `app-${app(2)}`)));
    if (!made.ok || !made.changed) throw new Error("not dismissed");
    expect(await restoreIssue(leeDb(), made.id)).toBeNull();
    expect(await restoreIssue(token("user_dm_gina", GLOBEX_WORKOS), made.id)).toBeNull();
    expect(await done(adaDb(), ada)).toHaveLength(1);
  });
});

describe("Done", () => {
  test("a resolved row says so, offers no way back, and hides nothing when the issue returns", async () => {
    const quiet = instance(await issueOn(leeDb(), lee, `app-${app(2)}`));
    await noteResolved(leeDb(), quiet);
    expect(await done(leeDb(), lee)).toMatchObject([{ how: "resolved", stands: true, canMoveBack: false }]);
    expect((await queue(leeDb(), lee)).some((i) => i.key === quiet.key)).toBe(true);
    // Back again, and still dismissable: the resolved row gives way.
    expect(await dismissIssue(leeDb(), quiet)).toMatchObject({ ok: true, changed: true });
    expect(await done(leeDb(), lee)).toMatchObject([{ how: "dismissed", canMoveBack: true }]);
    expect((await queue(leeDb(), lee)).some((i) => i.key === quiet.key)).toBe(false);
  });

  test("a second record of the same fix is nothing", async () => {
    const quiet = instance(await issueOn(leeDb(), lee, `app-${app(2)}`));
    await noteResolved(leeDb(), quiet);
    await noteResolved(leeDb(), quiet);
    expect(await done(leeDb(), lee)).toHaveLength(1);
  });

  test("what they can no longer read drops off, and comes back with access", async () => {
    await dismissIssue(leeDb(), instance(await issueOn(leeDb(), lee, `app-${app(2)}`)));
    must(await db().from("hiring_team").delete().eq("actor_id", LEAD));
    expect(await done(leeDb(), lee)).toEqual([]);
    must(await db().from("hiring_team").insert({ org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" }));
    expect(await done(leeDb(), lee)).toHaveLength(1);
  });

  test("a closed application stays worded by what is left, with no way back; a merged one drops off", async () => {
    await dismissIssue(adaDb(), instance(await issueOn(adaDb(), ada, `app-${app(2)}`)));
    must(await db().from("applications").update({ stage: "rejected" }).eq("id", app(2)));
    expect(await done(adaDb(), ada)).toMatchObject([{ what: "Nobody had been in touch", line: "Candidate 2 · Founding Engineer", stands: false, canMoveBack: false }]);
    must(await db().from("applications").update({ merged_into_id: app(1) }).eq("id", app(2)));
    expect(await done(adaDb(), ada)).toEqual([]);
  });

  test("a draft is worded for its author without its subject", async () => {
    const later = new Date(NOW.getTime() + 3 * 3_600_000);
    await dismissIssue(adaDb(), instance((await queue(adaDb(), ada, later)).find((i) => i.key === `draft-${DRAFT}`)!));
    must(await db().from("candidate_emails").update({ status: "sending" }).eq("id", DRAFT));
    const items = await done(adaDb(), ada, later);
    expect(items).toMatchObject([{ what: "Draft to Candidate 1", stands: false }]);
    expect(JSON.stringify(items)).not.toContain("Private subject");
  });

  test("the same instant sent in another format still matches", async () => {
    const quiet = await issueOn(adaDb(), ada, `app-${app(2)}`);
    const sent = new Date(quiet.at).toISOString();
    expect(sent).not.toBe(quiet.at);
    await dismissIssue(adaDb(), { ...instance(quiet), at: sent });
    const { data } = must(await db().from("inbox_dismissals").select("issue_key, reason, issue_at").eq("org_id", ACME).single());
    expect(instanceId({ key: data!.issue_key, reason: "quiet", at: data!.issue_at })).toBe(instanceId(quiet));
    expect((await queue(adaDb(), ada)).some((i) => i.key === quiet.key)).toBe(false);
  });

  test("a queue past one read of keys still hides what was dismissed", async () => {
    const n = 160;
    const ids = Array.from({ length: n }, (_, i) => `e9d10000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const people = ids.map((_, i) => `e9c10000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    must(await db().from("people").insert(people.map((id, i) => ({ id, org_id: ACME, display_name: `Quiet ${i}`, email: `q${i}@dm.test` }))));
    must(await db().from("applications").insert(ids.map((id, i) => ({ id, org_id: ACME, person_id: people[i]!, role_id: ENGINEER, stage: "screening", source: "sourced", last_touch_at: at(-9 * 24) }))));
    const all = await queue(adaDb(), ada);
    expect(all.length).toBeGreaterThan(n);
    const sample = all.filter((i) => i.reason === "quiet").slice(-3);
    for (const i of sample) await dismissIssue(adaDb(), instance(i));
    const left = await queue(adaDb(), ada);
    expect(left.length).toBe(all.length - 3);
    expect(left.some((i) => sample.some((s) => s.key === i.key))).toBe(false);
  });
});
