import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { readPipeline } from "./pipeline";

/**
 * The Pipeline board's read against the local stack, on members' own tokens:
 * the policies decide which jobs and applications come back, and the columns
 * are computed from real stages and interviews. The member token is signed
 * with the stack's JWT secret, as in apps/mcp's client.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "c1000000-0000-4000-8000-0000000000f1";
const GLOBEX = "c2000000-0000-4000-8000-0000000000f2";
const ADMIN = "c1a00000-0000-4000-8000-0000000000f1";
const LEAD = "c1a00000-0000-4000-8000-0000000000f2";
const ENGINEER = "c1b00000-0000-4000-8000-0000000000f1";
const DESIGNER = "c1b00000-0000-4000-8000-0000000000f2";
const PAUSED = "c1b00000-0000-4000-8000-0000000000f3";
const GLOBEX_ROLE = "c2b00000-0000-4000-8000-0000000000f1";
const app = (n: number) => `c1d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const person = (n: number) => `c1c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const GLOBEX_APP = "c2d00000-0000-4000-8000-0000000000f1";
const GLOBEX_PERSON = "c2c00000-0000-4000-8000-0000000000f1";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of ["application_events", "interviews", "applications", "hiring_team", "people", "roles", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const member = (subject: string, workosOrgId: string) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};

const NOW = Date.now();
const H = 3_600_000;
const at = (h: number) => new Date(NOW + h * H).toISOString();

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-pipeline-acme", kind: "client", workos_org_id: "org_itest_pipeline_acme" },
    { id: GLOBEX, name: "Globex", slug: "itest-pipeline-globex", kind: "client", workos_org_id: "org_itest_pipeline_globex" },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-pl-admin", display_name: "Ada Admin", email: "ada@pl.test", access_level: "admin", auth_subject: "user_pl_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-pl-lead", display_name: "Lee Lead", email: "lee@pl.test", access_level: "elevated", auth_subject: "user_pl_lee" },
  ]));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer", "open"], [DESIGNER, "Designer", "open"], [PAUSED, "Paused Role", "paused"]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role", "open"]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title, status]) => ({ id, org_id: org, company_id: company!.id, title, status }))));
  }
  // Lee manages the engineer search only.
  must(await db().from("hiring_team").insert({ org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" }));

  const apps = [
    [1, ENGINEER, "sourced"],
    [2, ENGINEER, "interviewing"],
    [3, ENGINEER, "interviewing"],
    [4, ENGINEER, "interviewing"],
    [5, DESIGNER, "offer"],
    [6, DESIGNER, "hired"],
    [7, PAUSED, "screening"],
  ] as const;
  must(await db().from("people").insert([
    ...apps.map(([n]) => ({ id: person(n), org_id: ACME, display_name: `Candidate ${n}`, email: `c${n}@pl.test` })),
    { id: GLOBEX_PERSON, org_id: GLOBEX, display_name: "Globex Candidate", email: "g@pl.test" },
  ]));
  must(await db().from("applications").insert([
    ...apps.map(([n, role, stage]) => ({ id: app(n), org_id: ACME, person_id: person(n), role_id: role, stage })),
    { id: GLOBEX_APP, org_id: GLOBEX, person_id: GLOBEX_PERSON, role_id: GLOBEX_ROLE, stage: "interviewing" },
  ]));
  must(await db().from("interviews").insert([
    // 2: booked tomorrow
    { org_id: ACME, application_id: app(2), starts_at: at(24), ends_at: at(25), status: "scheduled", step: "Onsite" },
    // 3: held yesterday, never marked done
    { org_id: ACME, application_id: app(3), starts_at: at(-26), ends_at: at(-25), status: "scheduled", step: "Screen" },
    // 4: only a cancelled one, so still being scheduled
    { org_id: ACME, application_id: app(4), starts_at: at(48), ends_at: at(49), status: "cancelled", step: "Screen" },
    { org_id: GLOBEX, application_id: GLOBEX_APP, starts_at: at(24), ends_at: at(25), status: "scheduled", step: "Screen" },
  ]));
});

afterAll(clear);

describe("the Pipeline board's read", () => {
  test("an admin sees every open job's live applications, each in its computed column", async () => {
    const { jobs, entries } = await readPipeline(member("user_pl_ada", "org_itest_pipeline_acme"), new Date(NOW));
    expect(jobs.map((j) => j.id).sort()).toEqual([ENGINEER, DESIGNER].sort());
    const columns = Object.fromEntries(entries.map((e) => [e.applicationId, e.column]));
    expect(columns).toEqual({
      [app(1)]: "new",
      [app(2)]: "booked",
      [app(3)]: "decide",
      [app(4)]: "scheduling",
      [app(5)]: "offer",
    });
    // the cancelled interview is not read at all
    expect(entries.find((e) => e.applicationId === app(4))!.interviews).toEqual([]);
    expect(entries.find((e) => e.applicationId === app(2))).toMatchObject({ roleId: ENGINEER, roleTitle: "Founding Engineer", personName: "Candidate 2" });
  });

  test("a hiring manager sees only the job they are on; another company never appears", async () => {
    const { jobs, entries } = await readPipeline(member("user_pl_lee", "org_itest_pipeline_acme"), new Date(NOW));
    expect(jobs.map((j) => j.id)).toEqual([ENGINEER]);
    expect(entries.map((e) => e.applicationId).sort()).toEqual([app(1), app(2), app(3), app(4)].sort());
    expect(entries.find((e) => e.applicationId === app(2))!.column).toBe("booked");
  });
});
