import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { countPastMatches } from "./past-matches";

/**
 * The Pipeline's past-candidate count against the local stack, on members' own
 * tokens: the policies decide who counts. An admin's whole company, a hiring
 * manager's own job, another company never; the filters and a search that
 * holds LIKE's or PostgREST's own characters.
 */

const db = () => getSupabaseServiceClient();

const ACME = "a8e00000-0000-4000-8000-0000000000f1";
const GLOBEX = "a8e00000-0000-4000-8000-0000000000f2";
const ADMIN = "a8ea0000-0000-4000-8000-0000000000f1";
const LEAD = "a8ea0000-0000-4000-8000-0000000000f2";
const ENGINEER = "a8eb0000-0000-4000-8000-0000000000f1";
const DESIGNER = "a8eb0000-0000-4000-8000-0000000000f2";
const GLOBEX_ROLE = "a8eb0000-0000-4000-8000-0000000000f3";
const ENG_DEPT = "a8ee0000-0000-4000-8000-0000000000f1";
const app = (n: number) => `a8ed0000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const person = (n: number) => `a8ec0000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  await db().from("people").update({ merged_into_id: null }).in("org_id", ids);
  for (const table of ["applications", "hiring_team", "people", "roles", "departments", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const member = (subject: string, workosOrgId = "org_itest_past_acme") => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};
const admin = () => member("user_pm_ada");
const lead = () => member("user_pm_lee");
const everywhere = { jobId: null, departmentIds: null };

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-past-acme", kind: "client", workos_org_id: "org_itest_past_acme" },
    { id: GLOBEX, name: "Globex", slug: "itest-past-globex", kind: "client", workos_org_id: "org_itest_past_globex" },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-pm-admin", display_name: "Ada Admin", email: "ada@pm.test", access_level: "admin", auth_subject: "user_pm_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-pm-lead", display_name: "Lee Lead", email: "lee@pm.test", access_level: "elevated", auth_subject: "user_pm_lee" },
  ]));
  must(await db().from("departments").insert({ id: ENG_DEPT, org_id: ACME, name: "Engineering" }));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Engineer", ENG_DEPT], [DESIGNER, "Designer", null]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role", null]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title, department_id]) => ({ id, org_id: org, company_id: company!.id, title, status: "open", department_id }))));
  }
  must(await db().from("hiring_team").insert({ org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" }));

  const people = [
    // n, org, name, title
    [1, ACME, "Jane Rustacean", "Engineer"],
    [2, ACME, "Rusty Designer", null],
    [3, ACME, "Mo Live", "Rust engineer"],
    [4, ACME, "Pat Twice", "Rust lead"],
    [5, GLOBEX, "Rust Elsewhere", null],
    [6, ACME, "Rust Merged", null],
    [7, ACME, "Rust Anon", null],
    [8, ACME, "Rust Prospect", null],
    [9, ACME, "Doe, Rue (100%)", "a_b"],
    [10, ACME, "Rob 100 percent", "axb"],
  ] as const;
  must(await db().from("people").insert(people.map(([n, org_id, display_name, current_title]) => ({ id: person(n), org_id, display_name, current_title, email: `p${n}@pm.test` }))));
  must(await db().from("people").update({ anonymized_at: new Date().toISOString() }).eq("id", person(7)));
  must(await db().from("people").update({ merged_into_id: person(1), merged_at: new Date().toISOString() }).eq("id", person(6)));

  const apps = [
    // n, person, org, job, stage
    [1, 1, ACME, ENGINEER, "rejected"],
    [2, 2, ACME, DESIGNER, "withdrawn"],
    [3, 3, ACME, ENGINEER, "interviewing"],
    [4, 4, ACME, ENGINEER, "hired"],
    [5, 4, ACME, DESIGNER, "rejected"],
    [6, 5, GLOBEX, GLOBEX_ROLE, "rejected"],
    [7, 6, ACME, ENGINEER, "rejected"],
    [8, 7, ACME, ENGINEER, "rejected"],
    [9, 9, ACME, DESIGNER, "rejected"],
    [10, 10, ACME, DESIGNER, "rejected"],
  ] as const;
  must(await db().from("applications").insert(apps.map(([n, p, org_id, role_id, stage]) => ({ id: app(n), org_id, person_id: person(p), role_id, stage }))));
});

afterAll(clear);

describe("past candidates who match", () => {
  test("an admin counts people with a closed application, each once", async () => {
    // Jane, Rusty, Pat (twice closed). Not Mo, still live; not the prospect, the merged, the anonymized, or Globex's.
    expect(await countPastMatches(admin(), "rust", everywhere)).toBe(3);
  });

  test("a hiring manager counts only what their token reads", async () => {
    // Jane and Pat are on their job; Rusty is on another.
    expect(await countPastMatches(lead(), "rust", everywhere)).toBe(2);
    expect(await countPastMatches(lead(), "rust", { jobId: DESIGNER, departmentIds: null })).toBe(0);
  });

  test("another company's token counts its own", async () => {
    const outsider = "a8ea0000-0000-4000-8000-0000000000f3";
    must(await db().from("actors").insert({ id: outsider, org_id: GLOBEX, slug: "itest-pm-out", display_name: "Gil", email: "gil@pm.test", access_level: "admin", auth_subject: "user_pm_gil" }));
    expect(await countPastMatches(member("user_pm_gil", "org_itest_past_globex"), "rust", everywhere)).toBe(1);
    expect(await countPastMatches(member("user_pm_gil", "org_itest_past_globex"), "jane", everywhere)).toBe(0);
  });

  test("the job and the department narrow it", async () => {
    expect(await countPastMatches(admin(), "rust", { jobId: ENGINEER, departmentIds: null })).toBe(2);
    expect(await countPastMatches(admin(), "rust", { jobId: null, departmentIds: [ENG_DEPT] })).toBe(2);
    expect(await countPastMatches(admin(), "rusty", { jobId: null, departmentIds: [ENG_DEPT] })).toBe(0);
  });

  test("it reads the title too, and nothing matching is nothing", async () => {
    expect(await countPastMatches(admin(), "lead", everywhere)).toBe(1);
    expect(await countPastMatches(admin(), "nobody at all", everywhere)).toBe(0);
  });

  test("% and _ mean themselves", async () => {
    expect(await countPastMatches(admin(), "100%", everywhere)).toBe(1);
    expect(await countPastMatches(admin(), "%", everywhere)).toBe(1);
    expect(await countPastMatches(admin(), "a_b", everywhere)).toBe(1);
    expect(await countPastMatches(admin(), "_", everywhere)).toBe(1);
  });

  test("a comma, a bracket or a quote stays part of the search", async () => {
    expect(await countPastMatches(admin(), "Doe, Rue (", everywhere)).toBe(1);
    expect(await countPastMatches(admin(), 'x" OR "', everywhere)).toBe(0);
  });

  test("* is no wider than one character", async () => {
    expect(await countPastMatches(admin(), "a*b", everywhere)).toBe(2);
    expect(await countPastMatches(admin(), "D*e, R", everywhere)).toBe(1);
    expect(await countPastMatches(admin(), "J*e", everywhere)).toBe(0);
  });
});
