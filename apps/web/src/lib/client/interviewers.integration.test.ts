import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { weekBounds } from "./interviewer-load";
import { readInterviewers } from "./interviewers";

/**
 * The Interviewers page's read against the local stack, on members' own
 * tokens: the policies decide which interviews, hiring teams, departments and
 * feedback come back. The member token is signed with the stack's JWT
 * secret, as in pipeline.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "e5000000-0000-4000-8000-0000000000f1";
const GLOBEX = "e5000000-0000-4000-8000-0000000000f2";
const ADMIN = "e5a00000-0000-4000-8000-0000000000f1";
const LEAD = "e5a00000-0000-4000-8000-0000000000f2";
const IVY = "e5a00000-0000-4000-8000-0000000000f3";
const IAN = "e5a00000-0000-4000-8000-0000000000f4";
const IRIS = "e5a00000-0000-4000-8000-0000000000f5";
const GLOBEX_IV = "e5a00000-0000-4000-8000-0000000000f6";
const ENGINEER = "e5b00000-0000-4000-8000-0000000000f1";
const DESIGNER = "e5b00000-0000-4000-8000-0000000000f2";
const GLOBEX_ROLE = "e5b00000-0000-4000-8000-0000000000f3";
const ENGINEERING = "e5e00000-0000-4000-8000-0000000000f1";
const person = (n: number) => `e5c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const app = (n: number) => `e5d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const interview = (n: number) => `e5f00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of ["interview_feedback", "interviews", "application_events", "applications", "hiring_team", "people", "roles", "departments", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const member = (subject: string, workosOrgId = "org_itest_ivers_acme") => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};

const NOW = Date.now();
const H = 3_600_000;
const D = 24 * H;
const iso = (t: number) => new Date(t).toISOString();
const { nextWeek } = weekBounds(new Date(NOW));

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    // every filing visible to whoever reads the job, so the hiring manager's counts are exact
    { id: ACME, name: "Acme", slug: "itest-ivers-acme", kind: "client", workos_org_id: "org_itest_ivers_acme", feedback_visibility: "always" },
    { id: GLOBEX, name: "Globex", slug: "itest-ivers-globex", kind: "client", workos_org_id: "org_itest_ivers_globex", feedback_visibility: "after_submit" },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-ivers-ada", display_name: "Ada Admin", email: "ada@ivers.test", access_level: "admin", auth_subject: "user_ivers_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-ivers-lee", display_name: "Lee Lead", email: "lee@ivers.test", access_level: "elevated", auth_subject: "user_ivers_lee" },
    { id: IVY, org_id: ACME, slug: "itest-ivers-ivy", display_name: "Ivy Interviewer", email: "ivy@ivers.test", access_level: "limited", auth_subject: "user_ivers_ivy" },
    { id: IAN, org_id: ACME, slug: "itest-ivers-ian", display_name: "Ian Interviewer", email: "ian@ivers.test", access_level: "limited", auth_subject: "user_ivers_ian" },
    { id: IRIS, org_id: ACME, slug: "itest-ivers-iris", display_name: "Iris Interviewer", email: "iris@ivers.test", access_level: "limited", auth_subject: "user_ivers_iris" },
    { id: GLOBEX_IV, org_id: GLOBEX, slug: "itest-ivers-gus", display_name: "Gus Globex", email: "gus@ivers.test", access_level: "admin", auth_subject: "user_ivers_gus" },
  ]));
  must(await db().from("departments").insert({ id: ENGINEERING, org_id: ACME, name: "Engineering" }));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer", ENGINEERING], [DESIGNER, "Designer", null]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role", null]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title, department]) => ({ id, org_id: org, company_id: company!.id, title, status: "open", department_id: department }))));
  }
  must(await db().from("hiring_team").insert([
    // Lee manages the engineer search only; Ivy interviews for it, Iris for the designer one.
    { org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" },
    { org_id: ACME, role_id: ENGINEER, actor_id: IVY, team_role: "interviewer" },
    { org_id: ACME, role_id: DESIGNER, actor_id: IRIS, team_role: "interviewer" },
    { org_id: GLOBEX, role_id: GLOBEX_ROLE, actor_id: GLOBEX_IV, team_role: "interviewer" },
  ]));
  must(await db().from("people").insert([
    { id: person(1), org_id: ACME, display_name: "Candidate 1", email: "c1@ivers.test" },
    { id: person(2), org_id: ACME, display_name: "Candidate 2", email: "c2@ivers.test" },
    { id: person(3), org_id: GLOBEX, display_name: "Globex Candidate", email: "g@ivers.test" },
  ]));
  must(await db().from("applications").insert([
    { id: app(1), org_id: ACME, person_id: person(1), role_id: ENGINEER, stage: "interviewing" },
    { id: app(2), org_id: ACME, person_id: person(2), role_id: DESIGNER, stage: "interviewing" },
    { id: app(3), org_id: GLOBEX, person_id: person(3), role_id: GLOBEX_ROLE, stage: "interviewing" },
  ]));
  const iv = (n: number, org: string, application: string, start: number, ids: string[], status = "scheduled") => ({
    id: interview(n),
    org_id: org,
    application_id: application,
    starts_at: iso(start),
    ends_at: iso(start + H),
    status,
    step: `Round ${n}`,
    interviewer_actor_ids: ids,
  });
  must(await db().from("interviews").insert([
    iv(1, ACME, app(1), nextWeek + D, [IVY]), // next week
    iv(2, ACME, app(1), nextWeek - H, [IVY]), // the last hour of this week
    iv(3, ACME, app(1), NOW - 10 * D, [IVY, IAN]), // a panel, before this Monday
    iv(4, ACME, app(2), NOW - 12 * D, [IAN]),
    iv(5, ACME, app(2), NOW - 40 * D, [IAN]), // outside every column
    iv(6, ACME, app(2), nextWeek + D, [IAN], "cancelled"),
    iv(7, GLOBEX, app(3), nextWeek + D, [GLOBEX_IV]),
  ]));
  must(await db().from("interview_feedback").insert([
    // Ivy files two hours after the panel; Ian never does. Ian files the designer round two days late.
    { org_id: ACME, interview_id: interview(3), interviewer_actor_id: IVY, recommendation: "yes", notes: "private", submitted_at: iso(NOW - 10 * D + 3 * H) },
    { org_id: ACME, interview_id: interview(4), interviewer_actor_id: IAN, recommendation: "no", notes: "private", submitted_at: iso(NOW - 12 * D + 49 * H) },
  ]));
});

afterAll(clear);

const flat = (read: Awaited<ReturnType<typeof readInterviewers>>) =>
  Object.fromEntries(read.groups.flatMap((g) => g.interviewers.map((i) => [i.actorId, { group: g.label, ...i }])));

describe("the Interviewers page's read", () => {
  test("an admin counts every interview by week, with feedback, grouped by the jobs' departments", async () => {
    const read = await readInterviewers(member("user_ivers_ada"), { actorId: ADMIN, orgId: ACME, accessLevel: "admin" }, new Date(NOW));
    expect(read.feedback).toBe(true);
    expect(read.groups.map((g) => [g.label, g.interviewers.map((i) => i.actorId)])).toEqual([
      ["Engineering", [IAN, IVY]],
      ["No department", [IRIS]],
    ]);
    const rows = flat(read);
    expect(rows[IVY]).toMatchObject({
      name: "Ivy Interviewer",
      load: { thisWeek: 1, nextWeek: 1, last30: 1 },
      feedback: { onTime: 1, late: 0, notFiled: 0, notVisible: 0 },
      jobs: [{ id: ENGINEER, title: "Founding Engineer" }],
    });
    expect(rows[IAN]).toMatchObject({
      load: { thisWeek: 0, nextWeek: 0, last30: 2 },
      feedback: { onTime: 0, late: 1, notFiled: 1, notVisible: 0 },
      jobs: [{ id: DESIGNER, title: "Designer" }, { id: ENGINEER, title: "Founding Engineer" }],
    });
    // on a hiring team, nothing scheduled
    expect(rows[IRIS]).toMatchObject({ load: { thisWeek: 0, nextWeek: 0, last30: 0 }, feedback: null, jobs: [{ id: DESIGNER, title: "Designer" }] });
    // the hiring manager does not interview; another company never appears
    expect(Object.keys(rows).sort()).toEqual([IAN, IRIS, IVY].sort());
    expect(JSON.stringify(read)).not.toContain("private");
  });

  test("a hiring manager counts only their job's interviews", async () => {
    const read = await readInterviewers(member("user_ivers_lee"), { actorId: LEAD, orgId: ACME, accessLevel: "elevated" }, new Date(NOW));
    expect(read.feedback).toBe(true);
    const rows = flat(read);
    expect(Object.keys(rows).sort()).toEqual([IAN, IVY].sort());
    expect(rows[IVY]).toMatchObject({ group: "Engineering", load: { thisWeek: 1, nextWeek: 1, last30: 1 }, feedback: { onTime: 1, late: 0, notFiled: 0 } });
    // Ian's designer round is not theirs to see: one interview, the panel, unfiled
    expect(rows[IAN]).toMatchObject({
      load: { thisWeek: 0, nextWeek: 0, last30: 1 },
      feedback: { onTime: 0, late: 0, notFiled: 1, notVisible: 0 },
      jobs: [{ id: ENGINEER, title: "Founding Engineer" }],
    });
  });

  test("an interviewer is refused", async () => {
    await expect(readInterviewers(member("user_ivers_ivy"), { actorId: IVY, orgId: ACME, accessLevel: "limited" }, new Date(NOW))).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  test("another company's admin sees only their own", async () => {
    const read = await readInterviewers(member("user_ivers_gus", "org_itest_ivers_globex"), { actorId: GLOBEX_IV, orgId: GLOBEX, accessLevel: "admin" }, new Date(NOW));
    const rows = flat(read);
    expect(Object.keys(rows)).toEqual([GLOBEX_IV]);
    expect(rows[GLOBEX_IV]).toMatchObject({ group: null, load: { nextWeek: 1 }, jobs: [{ id: GLOBEX_ROLE, title: "Globex Role" }] });
  });
});
