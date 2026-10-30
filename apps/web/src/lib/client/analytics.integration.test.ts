import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { readCareers, readExplorer } from "./analytics";
import { explore, periodTotals } from "./analytics-metrics";

/**
 * Analytics against the local stack, on members' own tokens: the policies
 * decide whose applications count, both on the careers page and in the
 * Pipeline explorer, and the channels come from what the database records.
 * The member token is signed with the stack's JWT secret, as in
 * pipeline.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "e6000000-0000-4000-8000-0000000000f1";
const GLOBEX = "e6100000-0000-4000-8000-0000000000f2";
const ADMIN = "e6a00000-0000-4000-8000-0000000000f1";
const LEAD = "e6a00000-0000-4000-8000-0000000000f2";
const INTERVIEWER = "e6a00000-0000-4000-8000-0000000000f3";
const ENG_DEPT = "e6e00000-0000-4000-8000-0000000000f1";
const ENGINEER = "e6b00000-0000-4000-8000-0000000000f1";
const DESIGNER = "e6b00000-0000-4000-8000-0000000000f2";
const GLOBEX_ROLE = "e6b10000-0000-4000-8000-0000000000f1";
const app = (n: number) => `e6d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const person = (n: number) => `e6c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const GLOBEX_APP = "e6d10000-0000-4000-8000-0000000000f1";
const GLOBEX_PERSON = "e6c10000-0000-4000-8000-0000000000f1";

const ACME_WORKOS = "org_itest_analytics_acme";
const GLOBEX_WORKOS = "org_itest_analytics_globex";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  // Merged applications point at their survivor: drop the pointer first.
  await db().from("applications").update({ merged_into_id: null }).in("org_id", ids);
  for (const table of ["application_events", "interviews", "applications", "hiring_team", "people", "roles", "departments", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("audit_log").delete().in("org_id", ids);
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const member = (subject: string, workosOrgId = ACME_WORKOS) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};

const NOW = new Date();
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-analytics-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-analytics-globex", kind: "client", workos_org_id: GLOBEX_WORKOS },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-an-admin", display_name: "Ada Admin", email: "ada@an.test", access_level: "admin", auth_subject: "user_an_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-an-lead", display_name: "Lee Lead", email: "lee@an.test", access_level: "elevated", auth_subject: "user_an_lee" },
    { id: INTERVIEWER, org_id: ACME, slug: "itest-an-ivan", display_name: "Ivan Interviewer", email: "ivan@an.test", access_level: "limited", auth_subject: "user_an_ivan" },
  ]));
  must(await db().from("departments").insert({ id: ENG_DEPT, org_id: ACME, name: "Engineering" }));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer", ENG_DEPT], [DESIGNER, "Designer", null]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role", null]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title, department_id]) => ({ id, org_id: org, company_id: company!.id, title, status: "open", department_id }))));
  }
  // Lee manages the engineer search only; Ivan interviews for it.
  must(await db().from("hiring_team").insert([
    { org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" },
    { org_id: ACME, role_id: ENGINEER, actor_id: INTERVIEWER, team_role: "interviewer" },
  ]));

  // 1-3 engineer this week (a referral, a careers applicant, Tacit's submission), 4 a designer applicant,
  // 5 an engineer hire from 40 days ago (the month before), 6 merged into 1 (never counted).
  const apps = [
    [1, ENGINEER, "screening", "referral", "Priya", -1],
    [2, ENGINEER, "interviewing", "job_board", null, -2],
    [3, ENGINEER, "sourced", "agency", "Tacit · Kim", -30],
    [4, DESIGNER, "sourced", "job_board", null, -3],
    [5, ENGINEER, "hired", "referral", "Marco", -40 * 24],
    [6, ENGINEER, "sourced", "job_board", null, -4],
  ] as const;
  must(await db().from("people").insert([
    ...apps.map(([n]) => ({ id: person(n), org_id: ACME, display_name: `Candidate ${n}`, email: `c${n}@an.test` })),
    { id: GLOBEX_PERSON, org_id: GLOBEX, display_name: "Globex Candidate", email: "g@an.test" },
  ]));
  must(await db().from("applications").insert([
    ...apps.map(([n, role, stage, source, detail, h]) => ({
      id: app(n), org_id: ACME, person_id: person(n), role_id: role, stage, source, source_detail: detail, created_at: at(h),
    })),
    { id: GLOBEX_APP, org_id: GLOBEX, person_id: GLOBEX_PERSON, role_id: GLOBEX_ROLE, stage: "interviewing", source: "referral", created_at: at(-1) },
  ]));
  must(await db().from("applications").update({ merged_into_id: app(1) }).eq("id", app(6)));
  must(await db().from("interviews").insert([
    { org_id: ACME, application_id: app(2), starts_at: at(24), ends_at: at(25), status: "scheduled", step: "Onsite", interviewer_actor_ids: [INTERVIEWER] },
    { org_id: ACME, application_id: app(2), starts_at: at(48), ends_at: at(49), status: "cancelled", step: "Onsite", interviewer_actor_ids: [ADMIN] },
    { org_id: GLOBEX, application_id: GLOBEX_APP, starts_at: at(24), ends_at: at(25), status: "scheduled", step: "Screen", interviewer_actor_ids: [] },
  ]));
});

afterAll(clear);

describe("Analytics", () => {
  test("an admin's careers page: this month's applications by channel and job, the hire 40 days ago in the month before", async () => {
    const read = await readCareers(member("user_an_ada"), { range: "month", departmentId: null }, NOW);
    expect(read.truncated).toBe(false);
    expect(read.jobs[ENGINEER]).toBe("Founding Engineer");
    expect(read.departments.map((d) => d.id)).toEqual([ENG_DEPT]);
    const { current, previous } = periodTotals(read.apps, "month", NOW.getTime());
    expect(current.applications).toBe(4);
    expect(current.bySource).toMatchObject({ referral: 1, tacit: 1, careers: 2 });
    expect(current.warm).toBe(2);
    expect(Object.fromEntries(current.byJob)).toEqual({ [ENGINEER]: 3, [DESIGNER]: 1 });
    expect(previous.applications).toBe(1);
  });

  test("a department narrows the careers page to its jobs", async () => {
    const read = await readCareers(member("user_an_ada"), { range: "week", departmentId: ENG_DEPT }, NOW);
    expect(read.departmentId).toBe(ENG_DEPT);
    expect(new Set(read.apps.map((a) => a.roleId))).toEqual(new Set([ENGINEER]));
  });

  test("an admin's explorer: live candidates by stage and source, interviews by interviewer, cancelled ones never", async () => {
    const read = await readExplorer(member("user_an_ada"), { departmentId: null }, NOW);
    expect(read.apps.map((a) => a.applicationId).sort()).toEqual([app(1), app(2), app(3), app(4)].sort());
    const byStage = explore(read.apps, read.names, "applicants", "stage", "source");
    expect(byStage.rows.find((r) => r.key === "booked")?.total).toBe(1);
    expect(byStage.rows.find((r) => r.key === "new")?.total).toBe(2);
    const byDept = explore(read.apps, read.names, "applicants", "department", "source");
    expect(byDept.rows.map((r) => [r.label, r.total])).toEqual([["Engineering", 3], ["No department", 1]]);
    const byInterviewer = explore(read.apps, read.names, "interviews", "interviewer", "stage");
    expect(byInterviewer.rows.map((r) => [r.label, r.total])).toEqual([["Ivan Interviewer", 1]]);
  });

  test("a hiring manager counts only their job", async () => {
    const lee = member("user_an_lee");
    const careers = await readCareers(lee, { range: "month", departmentId: null }, NOW);
    expect(new Set(careers.apps.map((a) => a.roleId))).toEqual(new Set([ENGINEER]));
    expect(periodTotals(careers.apps, "month", NOW.getTime()).current.applications).toBe(3);
    const explorer = await readExplorer(lee, { departmentId: null }, NOW);
    expect(explorer.apps.map((a) => a.applicationId).sort()).toEqual([app(1), app(2), app(3)].sort());
    expect(explorer.names.jobs.map((j) => j.id)).toEqual([ENGINEER]);
  });

  test("an interviewer's token reads no applications", async () => {
    const ivan = member("user_an_ivan");
    expect((await readCareers(ivan, { range: "month", departmentId: null }, NOW)).apps).toEqual([]);
  });

  test("another company's applications never count", async () => {
    const ada = member("user_an_ada");
    expect((await readCareers(ada, { range: "month", departmentId: null }, NOW)).jobs[GLOBEX_ROLE]).toBeUndefined();
    const explorer = await readExplorer(ada, { departmentId: null }, NOW);
    expect(explorer.apps.map((a) => a.applicationId)).not.toContain(GLOBEX_APP);
  });
});
