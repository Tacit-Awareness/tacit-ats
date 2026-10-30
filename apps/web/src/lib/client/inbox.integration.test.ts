import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { clearOverdueAction, readInbox, readIssue, touchApplication } from "./inbox";

/**
 * The Inbox against the local stack, on members' own tokens: the policies
 * decide which issues exist for whom, a draft is its author's alone, and the
 * two writes land or are refused. The member token is signed with the stack's
 * JWT secret, as in analytics.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "e7000000-0000-4000-8000-0000000000f1";
const GLOBEX = "e7100000-0000-4000-8000-0000000000f2";
const ADMIN = "e7a00000-0000-4000-8000-0000000000f1";
const LEAD = "e7a00000-0000-4000-8000-0000000000f2";
const INTERVIEWER = "e7a00000-0000-4000-8000-0000000000f3";
const GLOBEX_ADMIN = "e7a10000-0000-4000-8000-0000000000f1";
const ENGINEER = "e7b00000-0000-4000-8000-0000000000f1";
const DESIGNER = "e7b00000-0000-4000-8000-0000000000f2";
const GLOBEX_ROLE = "e7b10000-0000-4000-8000-0000000000f1";
const app = (n: number) => `e7d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const person = (n: number) => `e7c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const iv = (n: number) => `e7e00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const GLOBEX_APP = "e7d10000-0000-4000-8000-0000000000f1";
const GLOBEX_PERSON = "e7c10000-0000-4000-8000-0000000000f1";
const ADA_DRAFT = "e7f00000-0000-4000-8000-0000000000f1";
const LEE_DRAFT = "e7f00000-0000-4000-8000-0000000000f3";
const REQUEST = "e7f10000-0000-4000-8000-0000000000f1";

const ACME_WORKOS = "org_itest_inbox_acme";
const GLOBEX_WORKOS = "org_itest_inbox_globex";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of [
    "approval_decisions", "approval_requests", "approval_flow_approvers", "approval_flows", "candidate_emails", "interview_feedback",
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
const ivan = { actorId: INTERVIEWER, orgId: ACME, accessLevel: "limited" as const };

const NOW = new Date();
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
const dayAgo = (d: number) => at(-24 * d).slice(0, 10);

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-inbox-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-inbox-globex", kind: "client", workos_org_id: GLOBEX_WORKOS },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-ib-admin", display_name: "Ada Admin", email: "ada@ib.test", access_level: "admin", auth_subject: "user_ib_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-ib-lead", display_name: "Lee Lead", email: "lee@ib.test", access_level: "elevated", auth_subject: "user_ib_lee" },
    { id: INTERVIEWER, org_id: ACME, slug: "itest-ib-ivan", display_name: "Ivan Interviewer", email: "ivan@ib.test", access_level: "limited", auth_subject: "user_ib_ivan" },
    { id: GLOBEX_ADMIN, org_id: GLOBEX, slug: "itest-ib-gina", display_name: "Gina Globex", email: "gina@ib.test", access_level: "admin", auth_subject: "user_ib_gina" },
  ]));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer"], [DESIGNER, "Designer"]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role"]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title]) => ({ id, org_id: org, company_id: company!.id, title, status: "open" }))));
  }
  // Lee manages the engineer search only; Ivan interviews for it.
  must(await db().from("hiring_team").insert([
    { org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" },
    { org_id: ACME, role_id: ENGINEER, actor_id: INTERVIEWER, team_role: "interviewer" },
  ]));

  // 1 interviewed, Ivan's feedback missing; 2 interviewed, feedback in: the team's call;
  // 3 a designer overdue; 4 an engineer gone quiet; 5 a healthy designer; 6 rejected, feedback missing (no issue).
  const apps: [number, string, string, Record<string, unknown>][] = [
    [1, ENGINEER, "interviewing", {}],
    [2, ENGINEER, "interviewing", {}],
    [3, DESIGNER, "screening", { next_action: "Send the brief", next_action_due: dayAgo(3) }],
    [4, ENGINEER, "screening", { last_touch_at: at(-9 * 24) }],
    [5, DESIGNER, "sourced", {}],
    [6, ENGINEER, "rejected", {}],
  ];
  must(await db().from("people").insert([
    ...apps.map(([n]) => ({ id: person(n), org_id: ACME, display_name: `Candidate ${n}`, email: `c${n}@ib.test` })),
    { id: GLOBEX_PERSON, org_id: GLOBEX, display_name: "Globex Candidate", email: "g@ib.test" },
  ]));
  for (const [n, role, stage, extra] of apps) {
    must(await db().from("applications").insert({ id: app(n), org_id: ACME, person_id: person(n), role_id: role, stage, source: "sourced", ...extra }));
  }
  must(await db().from("applications").insert({
    id: GLOBEX_APP, org_id: GLOBEX, person_id: GLOBEX_PERSON, role_id: GLOBEX_ROLE, stage: "screening", source: "sourced", next_action: "Globex's", next_action_due: dayAgo(3),
  }));
  must(await db().from("interviews").insert([1, 2, 6].map((n) => ({
    id: iv(n), org_id: ACME, application_id: app(n), starts_at: at(-49), ends_at: at(-48), status: "scheduled", step: "Onsite", interviewer_actor_ids: [INTERVIEWER],
  }))));
  must(await db().from("interview_feedback").insert({ org_id: ACME, interview_id: iv(2), interviewer_actor_id: INTERVIEWER, recommendation: "yes", notes: "Private." }));

  must(await db().from("candidate_emails").insert([
    { id: ADA_DRAFT, org_id: ACME, person_id: person(1), application_id: app(1), author_actor_id: ADMIN, to_email: "c1@ib.test", subject: "Next steps", body: "Hello", status: "draft" },
    { id: LEE_DRAFT, org_id: ACME, person_id: person(1), author_actor_id: LEAD, to_email: "c1@ib.test", subject: "Lee's", body: "Hello", status: "draft" },
  ]));

  // The designer job's opening waits on Ada alone.
  const { data: flow } = must(await db().from("approval_flows").insert({ org_id: ACME, role_id: DESIGNER, kind: "job_open" }).select("id").single());
  must(await db().from("approval_flow_approvers").insert({ org_id: ACME, flow_id: flow!.id, step: 1, actor_id: ADMIN }));
  must(await db().from("approval_requests").insert({ id: REQUEST, org_id: ACME, role_id: DESIGNER, kind: "job_open", current_step: 1, requested_by_actor_id: LEAD }));
});

afterAll(clear);

const summary = async (client: ReturnType<typeof token>, member: Parameters<typeof readInbox>[1]) => {
  const { issues } = await readInbox(client, member, NOW);
  return issues.map((i) => [i.key, i.reason]);
};

describe("the Inbox", () => {
  test("an admin's queue: feedback, overdue, quiet, the team's call, their approval", async () => {
    const { issues, truncated } = await readInbox(token("user_ib_ada"), ada, NOW);
    expect(truncated).toBe(false);
    expect(issues.map((i) => i.key).sort()).toEqual(
      [`app-${app(1)}`, `app-${app(2)}`, `app-${app(3)}`, `app-${app(4)}`, `appr-${REQUEST}`].sort(),
    );
    const of = (key: string) => issues.find((i) => i.key === key)!;
    expect(of(`app-${app(1)}`)).toMatchObject({ reason: "feedback", what: "Ivan hasn't sent feedback", who: "Ivan Interviewer", interviewId: iv(1) });
    expect(of(`app-${app(2)}`)).toMatchObject({ reason: "decide", what: "Decide on Candidate 2" });
    expect(of(`app-${app(3)}`)).toMatchObject({ reason: "overdue", what: "Overdue: Send the brief" });
    expect(of(`app-${app(4)}`)).toMatchObject({ reason: "quiet" });
    expect(of(`appr-${REQUEST}`)).toMatchObject({ reason: "approval", what: "Approve opening Designer", who: "Lee Lead" });
    // No feedback text anywhere in the queue.
    expect(JSON.stringify(issues)).not.toContain("Private.");
  });

  test("a hiring manager on one job: only that job, nobody else's approval", async () => {
    expect((await summary(token("user_ib_lee"), lee)).sort()).toEqual(
      [[`app-${app(1)}`, "feedback"], [`app-${app(2)}`, "decide"], [`app-${app(4)}`, "quiet"]].sort(),
    );
  });

  test("a draft counts once it has sat for two hours, and only for its author", async () => {
    // The table's trigger stamps updated_at, so the clock moves instead.
    const later = new Date(NOW.getTime() + 3 * 3_600_000);
    const drafts = async (client: ReturnType<typeof token>, member: Parameters<typeof readInbox>[1]) =>
      (await readInbox(client, member, later)).issues.filter((i) => i.reason === "draft");
    const mine = await drafts(token("user_ib_ada"), ada);
    expect(mine.map((i) => i.key)).toEqual([`draft-${ADA_DRAFT}`]);
    expect(mine[0]).toMatchObject({ job: { title: "Founding Engineer" }, candidate: { name: "Candidate 1" }, draft: { subject: "Next steps", body: "Hello" } });
    expect((await drafts(token("user_ib_lee"), lee)).map((i) => i.key)).toEqual([`draft-${LEE_DRAFT}`]);
  });

  test("an interviewer is refused", async () => {
    await expect(readInbox(token("user_ib_ivan"), ivan, NOW)).rejects.toThrow(/home page/);
  });

  test("another company sees only its own", async () => {
    const gina = token("user_ib_gina", GLOBEX_WORKOS);
    expect(await summary(gina, { actorId: GLOBEX_ADMIN, orgId: GLOBEX, accessLevel: "admin" })).toEqual([[`app-${GLOBEX_APP}`, "overdue"]]);
  });

  test("the reader: the story, and whether they may edit the job", async () => {
    const client = token("user_ib_lee");
    const { issues } = await readInbox(client, lee, NOW);
    const issue = issues.find((i) => i.key === `app-${app(1)}`)!;
    const read = await readIssue(client, lee, issue);
    expect(read.canEdit).toBe(true);
    expect(read.story.some((e) => e.kind === "interview.scheduled")).toBe(true);
    const designer = (await readInbox(token("user_ib_ada"), ada, NOW)).issues.find((i) => i.key === `app-${app(3)}`)!;
    expect((await readIssue(client, lee, designer)).canEdit).toBe(false);
  });

  test("Mark it done clears an overdue next action and the issue leaves; a second try changes nothing", async () => {
    const client = token("user_ib_ada");
    expect(await clearOverdueAction(client, ADMIN, { applicationId: app(3), nextAction: "Send the brief" }, NOW)).toMatchObject({ ok: true, changed: true });
    const { data } = must(await db().from("applications").select("next_action, next_action_due").eq("id", app(3)).single());
    expect(data).toEqual({ next_action: null, next_action_due: null });
    expect((await readInbox(client, ada, NOW)).issues.some((i) => i.key === `app-${app(3)}`)).toBe(false);
    expect(await clearOverdueAction(client, ADMIN, { applicationId: app(3), nextAction: "Send the brief" }, NOW)).toMatchObject({ ok: true, changed: false });
  });

  test("a next action moved to a later date is left alone", async () => {
    must(await db().from("applications").update({ next_action_due: at(72).slice(0, 10) }).eq("id", app(3)));
    expect(await clearOverdueAction(token("user_ib_ada"), ADMIN, { applicationId: app(3), nextAction: "Send the brief" }, NOW)).toMatchObject({ ok: true, changed: false });
    const { data } = must(await db().from("applications").select("next_action").eq("id", app(3)).single());
    expect(data?.next_action).toBe("Send the brief");
  });

  test("a next action someone replaced is left alone, even overdue", async () => {
    must(await db().from("applications").update({ next_action: "Call the reference" }).eq("id", app(3)));
    expect(await clearOverdueAction(token("user_ib_ada"), ADMIN, { applicationId: app(3), nextAction: "Send the brief" }, NOW)).toMatchObject({ ok: true, changed: false });
    const { data } = must(await db().from("applications").select("next_action").eq("id", app(3)).single());
    expect(data?.next_action).toBe("Call the reference");
  });

  test("feedback missing for more than 90 days is not listed", async () => {
    must(await db().from("interviews").update({ starts_at: at(-92 * 24), ends_at: at(-91 * 24) }).eq("id", iv(1)));
    const issues = (await readInbox(token("user_ib_ada"), ada, NOW)).issues;
    expect(issues.some((i) => i.reason === "feedback")).toBe(false);
  });

  test("Log a touch clears a quiet candidate", async () => {
    const client = token("user_ib_lee");
    expect(await touchApplication(client, LEAD, app(4))).toMatchObject({ ok: true });
    expect((await readInbox(client, lee, NOW)).issues.some((i) => i.key === `app-${app(4)}`)).toBe(false);
  });

  test("a hiring manager can't reach another job, and another company's application is nobody's", async () => {
    expect(await clearOverdueAction(token("user_ib_lee"), LEAD, { applicationId: app(3), nextAction: "Send the brief" }, NOW)).toEqual({ ok: false, error: "not_found" });
    expect(await touchApplication(token("user_ib_lee"), LEAD, app(3))).toEqual({ ok: false, error: "not_found" });
    expect(await clearOverdueAction(token("user_ib_ada"), ADMIN, { applicationId: GLOBEX_APP, nextAction: "Globex's" }, NOW)).toEqual({ ok: false, error: "not_found" });
  });
});
