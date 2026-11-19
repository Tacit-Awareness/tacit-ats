import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { readHomeTickets } from "./home-tickets";

/**
 * Home's read (Tacit Tickets' day map and funnel) against the local stack, on
 * members' own tokens, as pipeline.integration.test.ts does: the policies decide
 * which applications come back, the ways in come from each one's source, and a
 * dot's colour from its computed column and core's `stalled`.
 */

const db = () => getSupabaseServiceClient();

const ACME = "e7000000-0000-4000-8000-0000000000a1";
const GLOBEX = "e7000000-0000-4000-8000-0000000000a2";
const ADMIN = "e7a00000-0000-4000-8000-0000000000a1";
const LEAD = "e7a00000-0000-4000-8000-0000000000a2";
const ENGINEER = "e7b00000-0000-4000-8000-0000000000a1";
const DESIGNER = "e7b00000-0000-4000-8000-0000000000a2";
const GLOBEX_ROLE = "e7b00000-0000-4000-8000-0000000000a3";
const app = (n: number) => `e7d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const person = (n: number) => `e7c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

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
const day = (d: number) => new Date(NOW - d * 24 * H).toISOString().slice(0, 10);

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-hometix-acme", kind: "client", workos_org_id: "org_itest_hometix_acme" },
    { id: GLOBEX, name: "Globex", slug: "itest-hometix-globex", kind: "client", workos_org_id: "org_itest_hometix_globex" },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-ht-admin", display_name: "Ada Admin", email: "ada@ht.test", access_level: "admin", auth_subject: "user_ht_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-ht-lead", display_name: "Lee Lead", email: "lee@ht.test", access_level: "elevated", auth_subject: "user_ht_lee" },
  ]));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer"], [DESIGNER, "Designer"]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role"]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title]) => ({ id, org_id: org, company_id: company!.id, title, status: "open" }))));
  }
  must(await db().from("hiring_team").insert({ org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" }));

  const apps = [
    [1, ENGINEER, "sourced", "job_board", null],
    [2, ENGINEER, "interviewing", "referral", day(5)],
    [3, ENGINEER, "screening", "sourced", day(2)],
    [4, DESIGNER, "rejected", "agency", null],
  ] as const;
  must(await db().from("people").insert([
    ...apps.map(([n]) => ({ id: person(n), org_id: ACME, display_name: `Candidate ${n}`, email: `c${n}@ht.test` })),
    { id: person(9), org_id: GLOBEX, display_name: "Globex Candidate", email: "g@ht.test" },
  ]));
  must(await db().from("applications").insert([
    ...apps.map(([n, role, stage, source, due]) => ({
      id: app(n),
      org_id: ACME,
      person_id: person(n),
      role_id: role,
      stage,
      source,
      ...(due ? { next_action: "Call them back", next_action_due: due } : {}),
    })),
    { id: app(9), org_id: GLOBEX, person_id: person(9), role_id: GLOBEX_ROLE, stage: "interviewing", source: "job_board" },
  ]));
  // 2: an interview held yesterday and nothing booked, so it is the team's call
  must(await db().from("interviews").insert({ org_id: ACME, application_id: app(2), starts_at: at(-26), ends_at: at(-25), status: "done", step: "Screen" }));
});

afterAll(clear);

const ada = { actorId: ADMIN, orgId: ACME, accessLevel: "admin" as const };
const lee = { actorId: LEAD, orgId: ACME, accessLevel: "elevated" as const };

describe("Home's read", () => {
  test("an admin's map has every application in the org with its way in, and never another company's", async () => {
    const read = await readHomeTickets(member("user_ht_ada", "org_itest_hometix_acme"), ada, new Date(NOW));
    const byName = Object.fromEntries(read.arrivals.map((a) => [a.name, a]));
    expect(Object.keys(byName).sort()).toEqual(["Candidate 1", "Candidate 2", "Candidate 3", "Candidate 4"]);
    expect(byName["Candidate 1"]).toMatchObject({ way: "inbound", job: "Founding Engineer", stage: "sourced" });
    expect(byName["Candidate 2"]!.way).toBe("referred");
    expect(byName["Candidate 3"]!.way).toBe("outreach");
    expect(byName["Candidate 4"]).toMatchObject({ way: "other", tone: "failed" });
    expect(read.truncated).toBe(false);
  });

  test("the funnel's dots are the live applications, coloured by where they stand", async () => {
    const read = await readHomeTickets(member("user_ht_ada", "org_itest_hometix_acme"), ada, new Date(NOW));
    const live = Object.fromEntries(read.live.map((l) => [l.applicationId, l]));
    expect(Object.keys(live).sort()).toEqual([app(1), app(2), app(3)].sort());
    expect(live[app(1)]).toMatchObject({ column: "new" });
    // Overdue wins over the team's call.
    expect(live[app(2)]).toMatchObject({ column: "decide", tone: "failed", next: "Call them back" });
    expect(live[app(3)]).toMatchObject({ column: "screening" });
  });

  test("a hiring manager sees only the job they are on", async () => {
    const read = await readHomeTickets(member("user_ht_lee", "org_itest_hometix_acme"), lee, new Date(NOW));
    expect(read.arrivals.map((a) => a.name).sort()).toEqual(["Candidate 1", "Candidate 2", "Candidate 3"]);
    expect(read.live.map((l) => l.applicationId).sort()).toEqual([app(1), app(2), app(3)].sort());
  });
});
