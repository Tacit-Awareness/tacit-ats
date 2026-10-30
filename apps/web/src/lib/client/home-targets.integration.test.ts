import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";

import { readHome } from "./home";
import { parseTarget, targetField } from "./home-target-rules";
import { readHomeTargets, saveHomeTarget } from "./home-targets";

/**
 * Home's targets against the local stack, on members' own tokens, as
 * member-access.integration.test.ts: the policies decide who may write and who
 * may read. The member token is signed with the stack's JWT secret. `ctx`'s
 * level is what the page thinks; a test that lies about it reaches the policies
 * past the code's own check.
 */

const db = () => getSupabaseServiceClient();

const ACME = "e7000000-0000-4000-8000-0000000000a1";
const GLOBEX = "e7000000-0000-4000-8000-0000000000a2";
const ADA = "e7a00000-0000-4000-8000-0000000000a1";
const LEE = "e7a00000-0000-4000-8000-0000000000a2";
const IVY = "e7a00000-0000-4000-8000-0000000000a3";
const REX = "e7a00000-0000-4000-8000-0000000000a4";
const GIL = "e7a00000-0000-4000-8000-0000000000a5";
const JOB = "e7b00000-0000-4000-8000-0000000000a1";
const CANDIDATE = "e7c00000-0000-4000-8000-0000000000a1";
const APPLICATION = "e7d00000-0000-4000-8000-0000000000a1";
const INTERVIEW = "e7e00000-0000-4000-8000-0000000000a1";
const INTERVIEW_2 = "e7e00000-0000-4000-8000-0000000000a2";

const ACME_WORKOS = "org_itest_targets_acme";
const GLOBEX_WORKOS = "org_itest_targets_globex";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of ["interview_feedback", "interviews", "applications", "hiring_team", "people", "roles", "companies", "audit_log"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("actors").delete().in("org_id", ids);
  // home_targets goes with the org: on delete cascade.
  await db().from("orgs").delete().in("id", ids);
}

const member = (subject: string, workosOrgId = ACME_WORKOS) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};
const ada = () => member("user_targets_ada");
const ctx = (actorId: string, accessLevel: clientTools.ClientToolCtx["accessLevel"], orgId = ACME): clientTools.ClientToolCtx => ({ actorId, orgId, accessLevel, source: "dashboard" });
const ADMIN = ctx(ADA, "admin");

/** The dialog's post, through the same rules the action runs. */
const parsed = (metric: string, value: string, unit: string | null = null, clear: string | null = null) => {
  const r = parseTarget({ metric, value, unit, clear });
  if (!r.ok) throw new Error(`fixture: ${r.error}`);
  return r;
};

const stored = async (org = ACME) => {
  const { data } = must(await db().from("home_targets").select("metric, value").eq("org_id", org));
  return Object.fromEntries((data ?? []).map((r) => [r.metric, Number(r.value)]));
};
const audit = async () =>
  must(await db().from("audit_log").select("action, entity, entity_id, source, before, after").eq("org_id", ACME).like("action", "home_target.%").order("created_at")).data ?? [];
const claims = async () => (must(await db().from("audit_log").select("id").eq("org_id", ACME)).data ?? []).length;

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-targets-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-targets-globex", kind: "client", workos_org_id: GLOBEX_WORKOS },
  ]));
  must(await db().from("actors").insert([
    { id: ADA, org_id: ACME, slug: "itest-targets-ada", display_name: "Ada Admin", email: "ada@targets.test", access_level: "admin", auth_subject: "user_targets_ada" },
    { id: LEE, org_id: ACME, slug: "itest-targets-lee", display_name: "Lee Lead", email: "lee@targets.test", access_level: "elevated", auth_subject: "user_targets_lee" },
    { id: IVY, org_id: ACME, slug: "itest-targets-ivy", display_name: "Ivy Interviewer", email: "ivy@targets.test", access_level: "limited", auth_subject: "user_targets_ivy" },
    { id: REX, org_id: ACME, slug: "itest-targets-rex", display_name: "Rex Recruiter", email: "rex@targets.test", access_level: "elevated", auth_subject: "user_targets_rex" },
    { id: GIL, org_id: GLOBEX, slug: "itest-targets-gil", display_name: "Gil Globex", email: "gil@targets.test", access_level: "admin", auth_subject: "user_targets_gil" },
  ]));
});

afterAll(clear);

describe("setting a target", () => {
  test("an admin sets one, and the audit row says what and from where", async () => {
    expect(await saveHomeTarget(ada(), ADMIN, parsed("review", "2", "d"))).toEqual({ ok: true, changed: true });
    expect(await stored()).toEqual({ review: 48 });
    expect(await audit()).toEqual([
      { action: "home_target.set", entity: "home_target", entity_id: null, source: "dashboard", before: { metric: "review", value: null }, after: { metric: "review", value: 48 } },
    ]);
  });

  test("changing one keeps a single row, and the audit row has the number before", async () => {
    await saveHomeTarget(ada(), ADMIN, parsed("review", "2", "d"));
    expect(await saveHomeTarget(ada(), ADMIN, parsed("review", "5", "h"))).toEqual({ ok: true, changed: true });
    expect(await stored()).toEqual({ review: 5 });
    expect((await audit()).at(-1)).toMatchObject({ before: { metric: "review", value: 48 }, after: { metric: "review", value: 5 } });
  });

  test("the same number again changes nothing and leaves no audit row, nor an open claim", async () => {
    await saveHomeTarget(ada(), ADMIN, parsed("workload", "40"));
    expect(await saveHomeTarget(ada(), ADMIN, parsed("workload", "40"))).toEqual({ ok: true, changed: false });
    expect(await audit()).toHaveLength(1);
    expect(await claims()).toBe(1);
  });

  test("every card that takes one, and 0 is a target", async () => {
    for (const [m, v, u] of [["new_applications", "0", null], ["review", "1.5", "d"], ["schedule", "3", "d"], ["feedback", "12", "h"], ["workload", "40", null]] as const) {
      expect(await saveHomeTarget(ada(), ADMIN, parsed(m, v, u))).toEqual({ ok: true, changed: true });
    }
    expect(await stored()).toEqual({ new_applications: 0, review: 36, schedule: 72, feedback: 12, workload: 40 });
    expect(await readHomeTargets(ada())).toEqual({ new_applications: 0, review: 36, schedule: 72, feedback: 12, workload: 40 });
  });

  test("the top of the range lands and two places of hours survive a round trip", async () => {
    await saveHomeTarget(ada(), ADMIN, parsed("workload", "1000000"));
    await saveHomeTarget(ada(), ADMIN, parsed("review", "1.333", "d"));
    expect(await stored()).toEqual({ workload: 1_000_000, review: 31.99 });
    const field = targetField("review", (await readHomeTargets(ada()))!.review!);
    expect(await saveHomeTarget(ada(), ADMIN, parsed("review", field.value, field.unit))).toEqual({ ok: true, changed: false });
  });

  test("a number the column would not keep never reaches it", async () => {
    await expect(clientTools.setHomeTarget(ada(), ADMIN, { metric: "review", value: Number.NaN })).rejects.toMatchObject({ code: "invalid" });
    await expect(clientTools.setHomeTarget(ada(), ADMIN, { metric: "review", value: 1_000_001 })).rejects.toMatchObject({ code: "invalid" });
    await expect(clientTools.setHomeTarget(ada(), ADMIN, { metric: "candidates_in_process" as "review", value: 1 })).rejects.toMatchObject({ code: "invalid" });
    expect(await stored()).toEqual({});
    expect(await claims()).toBe(0);
  });

  test("a read-only connector does not stop the page", async () => {
    must(await db().from("orgs").update({ connector_access: "read_only" }).eq("id", ACME));
    expect(await saveHomeTarget(ada(), ADMIN, parsed("review", "2", "d"))).toEqual({ ok: true, changed: true });
  });

  test("the hourly limit is said, and nothing lands", async () => {
    must(await db().from("audit_log").insert(Array.from({ length: 300 }, () => ({ org_id: ACME, actor_id: ADA, source: "dashboard", action: "x.y", entity: "z", after: {} }))));
    expect(await saveHomeTarget(ada(), ADMIN, parsed("review", "2", "d"))).toEqual({ ok: false, error: "rate_limited" });
    expect(await stored()).toEqual({});
  });
});

describe("removing a target", () => {
  test("an admin removes one, with an audit row", async () => {
    await saveHomeTarget(ada(), ADMIN, parsed("review", "2", "d"));
    expect(await saveHomeTarget(ada(), ADMIN, parsed("review", "", "d"))).toEqual({ ok: true, changed: true });
    expect(await stored()).toEqual({});
    expect((await audit()).at(-1)).toEqual({
      action: "home_target.clear", entity: "home_target", entity_id: null, source: "dashboard", before: { metric: "review", value: 48 }, after: { metric: "review", value: null },
    });
  });

  test("Remove takes the row whatever the field says; nothing to remove leaves no row", async () => {
    await saveHomeTarget(ada(), ADMIN, parsed("workload", "40"));
    expect(await saveHomeTarget(ada(), ADMIN, parsed("workload", "99", null, "on"))).toEqual({ ok: true, changed: true });
    expect(await saveHomeTarget(ada(), ADMIN, parsed("workload", "99", null, "on"))).toEqual({ ok: true, changed: false });
    expect(await audit()).toHaveLength(2);
    expect(await claims()).toBe(2);
  });
});

describe("who may", () => {
  test("the hiring team and an interviewer are refused before any claim", async () => {
    expect(await saveHomeTarget(member("user_targets_lee"), ctx(LEE, "elevated"), parsed("review", "2", "d"))).toEqual({ ok: false, error: "forbidden" });
    expect(await saveHomeTarget(member("user_targets_ivy"), ctx(IVY, "limited"), parsed("review", "2", "d"))).toEqual({ ok: false, error: "forbidden" });
    expect(await saveHomeTarget(member("user_targets_lee"), ctx(LEE, "elevated"), parsed("review", ""))).toEqual({ ok: false, error: "forbidden" });
    expect(await stored()).toEqual({});
    expect(await claims()).toBe(0);
  });

  test("past the code's check, the policies refuse the same people, and the claim is given back", async () => {
    for (const [subject, id] of [["user_targets_lee", LEE], ["user_targets_ivy", IVY]] as const) {
      expect(await saveHomeTarget(member(subject), ctx(id, "admin"), parsed("review", "2", "d"))).toEqual({ ok: false, error: "forbidden" });
    }
    expect(await stored()).toEqual({});
    expect(await claims()).toBe(0);
  });

  test("past the code's check, a delete removes nothing and says nothing changed", async () => {
    await saveHomeTarget(ada(), ADMIN, parsed("review", "2", "d"));
    expect(await saveHomeTarget(member("user_targets_lee"), ctx(LEE, "admin"), parsed("review", ""))).toEqual({ ok: true, changed: false });
    expect(await stored()).toEqual({ review: 48 });
    expect(await audit()).toHaveLength(1);
  });

  test("an admin stepped down is refused on the same token, whatever the page thought", async () => {
    await saveHomeTarget(ada(), ADMIN, parsed("review", "2", "d"));
    const token = ada();
    must(await db().from("actors").update({ access_level: "elevated" }).eq("id", ADA));
    expect(await saveHomeTarget(token, ADMIN, parsed("review", "9", "h"))).toEqual({ ok: false, error: "forbidden" });
    expect(await stored()).toEqual({ review: 48 });
  });

  test("the hiring team reads them and an interviewer reads none, without an error", async () => {
    await saveHomeTarget(ada(), ADMIN, parsed("review", "2", "d"));
    expect(await readHomeTargets(member("user_targets_lee"))).toEqual({ review: 48 });
    expect(await readHomeTargets(member("user_targets_ivy"))).toEqual({});
  });

  test("another company's are never read, written or removed", async () => {
    const gil = () => member("user_targets_gil", GLOBEX_WORKOS);
    const globex = ctx(GIL, "admin", GLOBEX);
    await saveHomeTarget(ada(), ADMIN, parsed("review", "2", "d"));
    expect(await readHomeTargets(gil())).toEqual({});
    expect(await saveHomeTarget(gil(), globex, parsed("review", ""))).toEqual({ ok: true, changed: false });
    expect(await saveHomeTarget(gil(), globex, parsed("review", "1", "h"))).toEqual({ ok: true, changed: true });
    expect(await stored(ACME)).toEqual({ review: 48 });
    expect(await stored(GLOBEX)).toEqual({ review: 1 });
    expect(await readHomeTargets(ada())).toEqual({ review: 48 });
  });
});

describe("at once", () => {
  test("ten saves of one card leave one row, on one of the numbers sent", async () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const results = await Promise.all(values.map((v) => saveHomeTarget(ada(), ADMIN, parsed("review", String(v), "h"))));
    expect(results.every((r) => r.ok)).toBe(true);
    const { review } = await stored();
    expect(values).toContain(review);
    expect(Object.keys(await stored())).toEqual(["review"]);
  });

  test("the same save ten times leaves one row", async () => {
    await Promise.all(Array.from({ length: 10 }, () => saveHomeTarget(ada(), ADMIN, parsed("workload", "40"))));
    expect(await stored()).toEqual({ workload: 40 });
  });

  test("every card saved at once all land", async () => {
    await Promise.all(clientTools.HOME_TARGET_METRICS.map((m, i) => saveHomeTarget(ada(), ADMIN, parsed(m, String(i + 1), "h"))));
    expect(Object.keys(await stored()).sort()).toEqual([...clientTools.HOME_TARGET_METRICS].sort());
  });

  test("a remove racing a save ends as one or the other, never an error", async () => {
    await saveHomeTarget(ada(), ADMIN, parsed("review", "2", "d"));
    const results = await Promise.all([saveHomeTarget(ada(), ADMIN, parsed("review", "")), saveHomeTarget(ada(), ADMIN, parsed("review", "5", "h"))]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect([{}, { review: 5 }]).toContainEqual(await stored());
  });
});

describe("on Home", () => {
  beforeEach(async () => {
    const { data: company } = must(await db().from("companies").insert({ org_id: ACME, name: "Acme" }).select("id").single());
    must(await db().from("roles").insert({ id: JOB, org_id: ACME, company_id: company!.id, title: "Engineer", status: "open" }));
    must(await db().from("hiring_team").insert({ org_id: ACME, role_id: JOB, actor_id: LEE, team_role: "hiring_manager" }));
    must(await db().from("people").insert({ id: CANDIDATE, org_id: ACME, display_name: "Cass Candidate", email: "cass@targets.test" }));
    must(await db().from("applications").insert({ id: APPLICATION, org_id: ACME, person_id: CANDIDATE, role_id: JOB, stage: "interviewing" }));
    const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
    must(await db().from("interviews").insert([
      { id: INTERVIEW, org_id: ACME, application_id: APPLICATION, starts_at: at(21), ends_at: at(20), status: "scheduled", step: "Screen", interviewer_actor_ids: [REX] },
      { id: INTERVIEW_2, org_id: ACME, application_id: APPLICATION, starts_at: at(11), ends_at: at(10), status: "scheduled", step: "Onsite", interviewer_actor_ids: [REX] },
    ]));
    must(await db().from("interview_feedback").insert([
      { org_id: ACME, interview_id: INTERVIEW, interviewer_actor_id: REX, recommendation: "yes", notes: "Filed.", submitted_at: at(14) },
      { org_id: ACME, interview_id: INTERVIEW_2, interviewer_actor_id: REX, recommendation: "yes", notes: "Filed.", submitted_at: at(8) },
    ]));
  });

  const home = (subject: string, actorId: string, accessLevel: "admin" | "elevated", filters: { jobId?: string | null; days?: number } = {}) =>
    readHome(member(subject), { actorId, orgId: ACME, accessLevel }, { days: filters.days ?? 7, jobId: filters.jobId ?? null }, new Date());

  test("the read carries the company's targets, the same under a filter and a period", async () => {
    await saveHomeTarget(ada(), ADMIN, parsed("review", "2", "d"));
    expect((await home("user_targets_ada", ADA, "admin")).targets).toEqual({ review: 48 });
    expect((await home("user_targets_ada", ADA, "admin", { jobId: JOB, days: 30 })).targets).toEqual({ review: 48 });
    expect((await home("user_targets_lee", LEE, "elevated")).targets).toEqual({ review: 48 });
  });

  test("the typical time to feedback is the report's, over every filing", async () => {
    const read = await home("user_targets_ada", ADA, "admin");
    // Filed 6h and 2h after: the median of two is their middle.
    expect(read.feedbackMedianHours).toBe(4);
  });
});
