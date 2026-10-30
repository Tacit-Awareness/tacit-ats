import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";

import { readCandidate } from "./candidate";
import { bulkAddToPool, bulkReject, bulkTag } from "./crm-bulk";
import { rejectPlan } from "./crm-bulk-rules";
import { rowFor } from "./crm-views";
import { readCandidates } from "./crm";

/**
 * The CRM's bulk actions, and the candidate page's past applications, against
 * the local stack on members' own tokens, with the policies deciding row by
 * row. The member token is signed with the stack's JWT secret, as in
 * pipeline.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "b7000000-0000-4000-8000-0000000000e1";
const GLOBEX = "b8000000-0000-4000-8000-0000000000e2";
const ADMIN = "b7a00000-0000-4000-8000-0000000000e1";
const LEAD = "b7a00000-0000-4000-8000-0000000000e2";
const INTERVIEWER = "b7a00000-0000-4000-8000-0000000000e3";
const ENGINEER = "b7b00000-0000-4000-8000-0000000000e1";
const DESIGNER = "b7b00000-0000-4000-8000-0000000000e2";
const GLOBEX_ROLE = "b8b00000-0000-4000-8000-0000000000e1";
const person = (n: number) => `b7c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const app = (n: number) => `b7d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const GLOBEX_PERSON = "b8c00000-0000-4000-8000-0000000000e1";
const GLOBEX_APP = "b8d00000-0000-4000-8000-0000000000e1";
const REASON = "b7e00000-0000-4000-8000-0000000000e1";
const WITHDREW_REASON = "b7e00000-0000-4000-8000-0000000000e2";
const ARCHIVED_REASON = "b7e00000-0000-4000-8000-0000000000e3";
const GLOBEX_REASON = "b8e00000-0000-4000-8000-0000000000e1";
const SILVER = "b7f00000-0000-4000-8000-0000000000e1";
const OLD_TAG = "b7f00000-0000-4000-8000-0000000000e2";
const POOL = "b7f10000-0000-4000-8000-0000000000e1";
const OLD_POOL = "b7f10000-0000-4000-8000-0000000000e2";

const ACME_WORKOS = "org_itest_cbulk_acme";
const RECRUITER = "b7a00000-0000-4000-8000-0000000000e4";
const COORDINATOR = "b7a00000-0000-4000-8000-0000000000e5";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of [
    "person_tags", "tags", "pool_memberships", "talent_pools", "application_events", "interviews", "applications", "rejection_reasons", "hiring_team", "people", "roles", "companies",
  ] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("audit_log").delete().in("org_id", ids);
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const ctx = (actorId: string, accessLevel: clientTools.ClientToolCtx["accessLevel"]): clientTools.ClientToolCtx => ({ actorId, orgId: ACME, accessLevel, source: "dashboard" });
const member = (subject: string) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId: ACME_WORKOS }));
};
const ada = () => member("user_cbulk_ada");
const adaCtx = ctx(ADMIN, "admin");
const lee = () => member("user_cbulk_lee");
const leeCtx = ctx(LEAD, "elevated");

const stageOf = async (id: string) => must(await db().from("applications").select("stage, rejection_reason_id, rejection_note").eq("id", id).single()).data!;
const tagsOn = async (id: string) => must(await db().from("person_tags").select("tag_id").eq("person_id", id)).data!.map((t) => t.tag_id);
const poolsOf = async (id: string) => must(await db().from("pool_memberships").select("pool_id, stage").eq("person_id", id)).data!;
const row = (id: string, stage = "screening") => ({ applicationId: id, expectedStage: stage as "screening" });

const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-cbulk-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-cbulk-globex", kind: "client", workos_org_id: "org_itest_cbulk_globex" },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-cbulk-admin", display_name: "Ada Admin", email: "ada@cbulk.test", access_level: "admin", auth_subject: "user_cbulk_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-cbulk-lead", display_name: "Lee Lead", email: "lee@cbulk.test", access_level: "elevated", auth_subject: "user_cbulk_lee" },
    { id: INTERVIEWER, org_id: ACME, slug: "itest-cbulk-iv", display_name: "Ivy Interviewer", email: "ivy@cbulk.test", access_level: "limited", auth_subject: "user_cbulk_ivy" },
  ]));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer"], [DESIGNER, "Designer"]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role"]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title]) => ({ id, org_id: org, company_id: company!.id, title, status: "open" }))));
  }
  // Lee manages the engineer search only.
  must(await db().from("hiring_team").insert({ org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" }));
  must(await db().from("rejection_reasons").insert([
    { id: REASON, org_id: ACME, kind: "rejected", name: "Not enough experience" },
    { id: WITHDREW_REASON, org_id: ACME, kind: "withdrew", name: "Took another offer" },
    { id: ARCHIVED_REASON, org_id: ACME, kind: "rejected", name: "Old reason", archived_at: at(-1) },
    { id: GLOBEX_REASON, org_id: GLOBEX, kind: "rejected", name: "Globex reason" },
  ]));
  must(await db().from("people").insert([
    { id: person(1), org_id: ACME, display_name: "Grace Hopper", email: "grace@cbulk.test" },
    { id: person(2), org_id: ACME, display_name: "Dieter Rams", email: "dieter@cbulk.test" },
    { id: person(3), org_id: ACME, display_name: "Linus Pauling", email: "linus@cbulk.test" },
    { id: GLOBEX_PERSON, org_id: GLOBEX, display_name: "Globex Candidate", email: "g@cbulk.test" },
  ]));
  must(await db().from("applications").insert([
    { id: app(1), org_id: ACME, person_id: person(1), role_id: ENGINEER, stage: "screening" },
    { id: app(2), org_id: ACME, person_id: person(2), role_id: DESIGNER, stage: "screening" },
    { id: app(3), org_id: ACME, person_id: person(3), role_id: ENGINEER, stage: "interviewing" },
    { id: GLOBEX_APP, org_id: GLOBEX, person_id: GLOBEX_PERSON, role_id: GLOBEX_ROLE, stage: "screening" },
  ]));
  must(await db().from("tags").insert([
    { id: SILVER, org_id: ACME, name: "Silver" },
    { id: OLD_TAG, org_id: ACME, name: "Old", archived_at: at(-1) },
  ]));
  must(await db().from("talent_pools").insert([
    { id: POOL, org_id: ACME, name: "Future" },
    { id: OLD_POOL, org_id: ACME, name: "Past", archived_at: at(-1) },
  ]));
});

afterAll(clear);

describe("bulk reject", () => {
  test("each row answers for itself: another company's, a stale stage and a good one in one run", async () => {
    must(await db().from("applications").update({ stage: "interviewing" }).eq("id", app(2)));
    const answer = await bulkReject(ada(), adaCtx, { applications: [row(app(1)), row(app(2)), row(GLOBEX_APP)], reasonId: REASON, note: "Bulk note" });
    expect(answer).toEqual({
      ok: true,
      rows: [
        { id: app(1), outcome: "done" },
        { id: app(2), outcome: "changed" },
        { id: GLOBEX_APP, outcome: "not_found" },
      ],
    });
    expect(await stageOf(app(1))).toEqual({ stage: "rejected", rejection_reason_id: REASON, rejection_note: "Bulk note" });
    expect((await stageOf(app(2))).stage).toBe("interviewing");
    expect((await stageOf(GLOBEX_APP)).stage).toBe("screening");
  });

  test("a hiring manager rejects in their job and is refused in another, row by row", async () => {
    const answer = await bulkReject(lee(), leeCtx, { applications: [row(app(1)), row(app(2))], reasonId: REASON, note: null });
    // Lee cannot read Dieter's application at all: no job of theirs.
    expect(answer).toEqual({ ok: true, rows: [{ id: app(1), outcome: "done" }, { id: app(2), outcome: "not_found" }] });
    expect((await stageOf(app(2))).stage).toBe("screening");
  });

  test("the audit row is the dashboard's and carries the reason's name, never the note", async () => {
    await bulkReject(ada(), adaCtx, { applications: [row(app(1))], reasonId: REASON, note: "Private note" });
    const audits = must(await db().from("audit_log").select("source, action, before, after").eq("entity_id", app(1))).data!;
    expect(audits).toEqual([{ source: "dashboard", action: "application.stage_change", before: { stage: "screening" }, after: { stage: "rejected", rejection_reason: "Not enough experience" } }]);
    expect(JSON.stringify(audits)).not.toContain("Private note");
  });

  test("a reason that is not a live rejected one of the org's stops the run before any row", async () => {
    for (const reasonId of [WITHDREW_REASON, ARCHIVED_REASON, GLOBEX_REASON]) {
      expect(await bulkReject(ada(), adaCtx, { applications: [row(app(1))], reasonId, note: null })).toEqual({ ok: false, error: "bad_reason" });
    }
    expect((await stageOf(app(1))).stage).toBe("screening");
  });

  test("the hourly limit stops the run: the row that hits it says so, the rest were not tried, and earlier rows stay done", async () => {
    must(await db().from("audit_log").insert(
      Array.from({ length: 299 }, () => ({ org_id: ACME, actor_id: ADMIN, source: "dashboard", action: "note.add", entity: "person", created_at: new Date().toISOString() })),
    ));
    const apps = [app(1), app(2), app(3)];
    const answer = await bulkReject(ada(), adaCtx, { applications: [row(app(1)), row(app(2)), row(app(3), "interviewing")], reasonId: REASON, note: null });
    expect(answer.ok).toBe(true);
    const outcomes = answer.ok ? answer.rows.map((r) => r.outcome) : [];
    expect(outcomes.filter((o) => o === "done")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "rate_limited").length).toBeGreaterThanOrEqual(1);
    expect(outcomes.filter((o) => o === "done" || o === "rate_limited" || o === "not_tried")).toHaveLength(3);
    const stages = await Promise.all(apps.map(async (a) => (await stageOf(a)).stage));
    expect(stages.filter((s) => s === "rejected")).toHaveLength(1);
  });

  test("a run larger than the workers keeps every row in order", async () => {
    const answer = await bulkReject(ada(), adaCtx, {
      applications: [row(app(1)), row(app(2)), row(app(3), "interviewing"), row(GLOBEX_APP), row("b7d00000-0000-4000-8000-0000000000ff")],
      reasonId: REASON,
      note: null,
    });
    expect(answer.ok && answer.rows.map((r) => r.id)).toEqual([app(1), app(2), app(3), GLOBEX_APP, "b7d00000-0000-4000-8000-0000000000ff"]);
  });
});

describe("what a row offers a reject", () => {
  test("the CRM's own read, through rowFor and rejectPlan, gives the application and the stage shown", async () => {
    must(await db().from("applications").update({ stage: "offer" }).eq("id", app(3)));
    const { candidates } = await readCandidates(ada());
    const items = candidates.flatMap((c) => {
      const r = rowFor(c, "all");
      return r ? [{ candidateId: r.candidateId, name: r.name, apps: r.openApps }] : [];
    });
    const plan = rejectPlan(items);
    expect(plan.apps.map((a) => [a.applicationId, a.expectedStage]).sort()).toEqual([[app(1), "screening"], [app(2), "screening"]]);
    expect(plan.skipped).toEqual([{ id: app(3), label: "Linus Pauling · Founding Engineer", why: "at_offer" }]);
  });
});

describe("bulk tag", () => {
  test("an existing tag goes on by name, someone who has it is unchanged, and someone unseen is not_found", async () => {
    must(await db().from("person_tags").insert({ org_id: ACME, person_id: person(2), tag_id: SILVER }));
    const answer = await bulkTag(ada(), adaCtx, { candidateIds: [person(1), person(2), GLOBEX_PERSON], name: "silver" });
    expect(answer).toEqual({
      ok: true,
      rows: [
        { id: person(1), outcome: "done" },
        { id: person(2), outcome: "unchanged" },
        { id: GLOBEX_PERSON, outcome: "not_found" },
      ],
    });
    expect(await tagsOn(person(1))).toEqual([SILVER]);
    expect(await tagsOn(GLOBEX_PERSON)).toEqual([]);
  });

  test("a new name makes the tag, for whoever can add candidates", async () => {
    expect(await bulkTag(ada(), adaCtx, { candidateIds: [person(1)], name: "Brand new" })).toMatchObject({ ok: true, rows: [{ outcome: "done" }] });
    const made = must(await db().from("tags").select("id").eq("org_id", ACME).eq("name", "Brand new").single()).data!;
    expect(await tagsOn(person(1))).toEqual([made.id]);
  });

  test("an archived name is refused for a hiring manager, with nothing written", async () => {
    expect(await bulkTag(lee(), leeCtx, { candidateIds: [person(1)], name: "Old" })).toEqual({ ok: false, error: "bad_name" });
    expect(await tagsOn(person(1))).toEqual([]);
  });

  test("a name too long is refused before any row", async () => {
    expect(await bulkTag(ada(), adaCtx, { candidateIds: [person(1)], name: "x".repeat(61) })).toEqual({ ok: false, error: "bad_name" });
  });

  test("a hiring manager tags their job's people, and someone they cannot see comes back as such", async () => {
    const answer = await bulkTag(lee(), leeCtx, { candidateIds: [person(1), person(2)], name: "Silver" });
    expect(answer).toEqual({ ok: true, rows: [{ id: person(1), outcome: "done" }, { id: person(2), outcome: "not_found" }] });
    expect(await tagsOn(person(2))).toEqual([]);
  });

  test("an interviewer's run stops at the door", async () => {
    expect(await bulkTag(member("user_cbulk_ivy"), ctx(INTERVIEWER, "limited"), { candidateIds: [person(1)], name: "Silver" })).toEqual({ ok: false, error: "cannot_create" });
  });
});

describe("bulk add to pool", () => {
  test("into a pool at its first stage, someone there is unchanged and stays at their stage", async () => {
    must(await db().from("pool_memberships").insert({ org_id: ACME, pool_id: POOL, person_id: person(2), stage: "engaged" }));
    const answer = await bulkAddToPool(ada(), adaCtx, { candidateIds: [person(1), person(2)], name: "Future" });
    expect(answer).toEqual({ ok: true, rows: [{ id: person(1), outcome: "done" }, { id: person(2), outcome: "unchanged" }] });
    expect(await poolsOf(person(1))).toEqual([{ pool_id: POOL, stage: "new" }]);
    expect(await poolsOf(person(2))).toEqual([{ pool_id: POOL, stage: "engaged" }]);
  });

  test("a new name makes the pool; another company's person is not_found", async () => {
    const answer = await bulkAddToPool(ada(), adaCtx, { candidateIds: [person(1), GLOBEX_PERSON], name: "Fresh pool" });
    expect(answer).toMatchObject({ ok: true, rows: [{ outcome: "done" }, { outcome: "not_found" }] });
  });

  test("an archived pool's name is refused for a hiring manager", async () => {
    expect(await bulkAddToPool(lee(), leeCtx, { candidateIds: [person(1)], name: "Past" })).toEqual({ ok: false, error: "bad_name" });
  });
});

describe("past applications", () => {
  const closeFirst = async () => {
    // Grace's Designer application closed long ago, before her Engineer one began.
    must(await db().from("applications").update({ created_at: at(-1) }).eq("id", app(1)));
    must(await db().from("applications").insert({ id: app(9), org_id: ACME, person_id: person(1), role_id: DESIGNER, stage: "rejected", created_at: at(-60), last_touch_at: at(-30) }));
    must(await db().from("application_events").insert([
      { org_id: ACME, application_id: app(9), kind: "stage_changed", from_stage: "sourced", to_stage: "interviewing", created_at: at(-50) },
      { org_id: ACME, application_id: app(9), kind: "stage_changed", from_stage: "interviewing", to_stage: "rejected", detail: "Secret detail", created_at: at(-30) },
    ]));
  };

  test("an admin gets the dates and how far they got, from the recorded events", async () => {
    await closeFirst();
    const read = (await readCandidate(ada(), adaCtx, person(1)))!;
    expect(read.past).toHaveLength(1);
    expect(read.past[0]).toMatchObject({ applicationId: app(9), jobTitle: "Designer", stage: "rejected", reached: "interviewing" });
    expect(Date.parse(read.past[0]!.closedAt!)).toBeCloseTo(Date.parse(at(-30)), -6);
    expect(JSON.stringify(read.past)).not.toContain("Secret detail");
  });

  test("a hiring manager on the later job does not see the other job's past application, so no label", async () => {
    await closeFirst();
    const read = (await readCandidate(lee(), leeCtx, person(1)))!;
    expect(read.candidate.applications.map((a) => a.applicationId)).toEqual([app(1)]);
    expect(read.past).toEqual([]);
  });

  test("an interviewer gets none", async () => {
    await closeFirst();
    must(await db().from("interviews").insert({
      org_id: ACME, application_id: app(1), starts_at: at(1), ends_at: at(1.1), status: "scheduled", step: "Onsite", interviewer_actor_ids: [INTERVIEWER],
    }));
    const read = (await readCandidate(member("user_cbulk_ivy"), ctx(INTERVIEWER, "limited"), person(1)))!;
    expect(read.past).toEqual([]);
  });

  test("a real move closes an application the same way: moved through the tools, then they come back", async () => {
    await bulkReject(ada(), adaCtx, { applications: [row(app(2))], reasonId: REASON, note: null });
    must(await db().from("applications").insert({ id: app(8), org_id: ACME, person_id: person(2), role_id: ENGINEER, stage: "sourced", created_at: at(1) }));
    const read = (await readCandidate(ada(), adaCtx, person(2)))!;
    expect(read.past).toMatchObject([{ applicationId: app(2), stage: "rejected", reached: "screening", rejectionReason: "Not enough experience" }]);
    expect(read.past[0]!.closedAt).not.toBeNull();
  });
});

describe("the roles the page does not stop", () => {
  const rex = () => member("user_cbulk_rex");
  const rexCtx = ctx(RECRUITER, "elevated");
  const cora = () => member("user_cbulk_cora");
  const coraCtx = ctx(COORDINATOR, "elevated");

  beforeEach(async () => {
    must(await db().from("actors").insert([
      { id: RECRUITER, org_id: ACME, slug: "itest-cbulk-rex", display_name: "Rex Recruiter", email: "rex@cbulk.test", access_level: "limited", auth_subject: "user_cbulk_rex" },
      { id: COORDINATOR, org_id: ACME, slug: "itest-cbulk-cora", display_name: "Cora Coordinator", email: "cora@cbulk.test", access_level: "limited", auth_subject: "user_cbulk_cora" },
    ]));
    const { data: external } = must(await db().from("access_roles").select("id").eq("org_id", ACME).eq("name", "External Recruiter").single());
    must(await db().from("job_access").insert({ org_id: ACME, role_id: ENGINEER, actor_id: RECRUITER, access_role_id: external!.id }));
    must(await db().from("hiring_team").insert({ org_id: ACME, role_id: ENGINEER, actor_id: COORDINATOR, team_role: "coordinator" }));
    // Rex added Linus, and only Linus.
    must(await db().from("people").update({ added_by_actor_id: RECRUITER }).eq("id", person(3)));
    must(await db().from("applications").update({ added_by_actor_id: RECRUITER }).eq("id", app(3)));
  });

  test("an external recruiter's page loads, and they act on their own add alone", async () => {
    expect((await readCandidates(rex())).candidates.map((c) => c.candidateId)).toEqual([person(3)]);
    expect(await clientTools.listRejectionReasons(rex(), rexCtx)).not.toEqual([]);
    expect(await clientTools.listPools(rex(), rexCtx)).toEqual([]);
    expect(await bulkTag(rex(), rexCtx, { candidateIds: [person(1), person(3)], name: "Silver" })).toEqual({
      ok: true,
      rows: [{ id: person(1), outcome: "not_found" }, { id: person(3), outcome: "done" }],
    });
    expect(await bulkReject(rex(), rexCtx, { applications: [row(app(1)), row(app(3), "interviewing")], reasonId: REASON, note: null })).toEqual({
      ok: true,
      rows: [{ id: app(1), outcome: "not_found" }, { id: app(3), outcome: "done" }],
    });
    expect((await stageOf(app(1))).stage).toBe("screening");
  });

  test("an external recruiter makes no tag and no pool, and gets no pool they cannot read", async () => {
    expect(await bulkTag(rex(), rexCtx, { candidateIds: [person(3)], name: "Rex's own" })).toEqual({ ok: false, error: "cannot_create" });
    expect(await bulkAddToPool(rex(), rexCtx, { candidateIds: [person(3)], name: "Future" })).toEqual({ ok: false, error: "cannot_create" });
    expect(must(await db().from("tags").select("id").eq("org_id", ACME).eq("name", "Rex's own")).data).toEqual([]);
    expect(await poolsOf(person(3))).toEqual([]);
  });

  test("a hiring team member who reads but may not edit gets forbidden on every row, and makes nothing", async () => {
    expect(await bulkReject(cora(), coraCtx, { applications: [row(app(1))], reasonId: REASON, note: null })).toEqual({ ok: true, rows: [{ id: app(1), outcome: "forbidden" }] });
    expect(await bulkTag(cora(), coraCtx, { candidateIds: [person(1)], name: "Silver" })).toEqual({ ok: true, rows: [{ id: person(1), outcome: "forbidden" }] });
    expect(await bulkAddToPool(cora(), coraCtx, { candidateIds: [person(1)], name: "Future" })).toEqual({ ok: true, rows: [{ id: person(1), outcome: "forbidden" }] });
    expect(await bulkTag(cora(), coraCtx, { candidateIds: [person(1)], name: "Cora's own" })).toEqual({ ok: false, error: "cannot_create" });
    expect((await stageOf(app(1))).stage).toBe("screening");
    expect(await tagsOn(person(1))).toEqual([]);
  });
});

describe("an offer on an application that never moved to the offer stage", () => {
  // Nothing moves the stage when an offer is drafted (core's offers.ts), so the stage alone does not say who has one.
  const offer = async (id: string, ...steps: string[]) => {
    must(await db().from("applications").update({ stage: "interviewing" }).eq("id", id));
    must(await db().from("offers").insert({ org_id: ACME, application_id: id, salary: 123456, created_by_actor_id: ADMIN }));
    for (const status of steps) must(await db().from("offers").update({ status }).eq("application_id", id));
  };

  test("an offer in play is left alone and reported, and the rest of the run goes through", async () => {
    await offer(app(1), "extended");
    await offer(app(2));
    const answer = await bulkReject(ada(), adaCtx, { applications: [row(app(1), "interviewing"), row(app(2), "interviewing"), row(app(3), "interviewing")], reasonId: REASON, note: null });
    expect(answer).toEqual({
      ok: true,
      rows: [{ id: app(1), outcome: "at_offer" }, { id: app(2), outcome: "at_offer" }, { id: app(3), outcome: "done" }],
    });
    expect((await stageOf(app(1))).stage).toBe("interviewing");
    expect((await stageOf(app(2))).stage).toBe("interviewing");
  });

  test("an accepted one counts, and an id posted in capitals does not get past the check", async () => {
    await offer(app(1), "extended", "accepted");
    const answer = await bulkReject(ada(), adaCtx, { applications: [row(app(1).toUpperCase(), "interviewing")], reasonId: REASON, note: null });
    expect(answer).toEqual({ ok: true, rows: [{ id: app(1).toUpperCase(), outcome: "at_offer" }] });
    expect((await stageOf(app(1))).stage).toBe("interviewing");
  });

  test("a declined or withdrawn offer no longer stands in the way", async () => {
    await offer(app(1), "extended", "declined");
    await offer(app(2), "withdrawn");
    const answer = await bulkReject(ada(), adaCtx, { applications: [row(app(1), "interviewing"), row(app(2), "interviewing")], reasonId: REASON, note: null });
    expect(answer).toEqual({ ok: true, rows: [{ id: app(1), outcome: "done" }, { id: app(2), outcome: "done" }] });
  });

  test("nothing about an offer reaches the audit log", async () => {
    await offer(app(1), "extended");
    await bulkReject(ada(), adaCtx, { applications: [row(app(1), "interviewing"), row(app(3), "interviewing")], reasonId: REASON, note: null });
    const audits = must(await db().from("audit_log").select("action, after").eq("org_id", ACME)).data!;
    expect(JSON.stringify(audits)).not.toContain("123456");
  });
});

describe("two people at once", () => {
  const SECOND = "b7e00000-0000-4000-8000-0000000000e9";
  beforeEach(async () => {
    must(await db().from("rejection_reasons").insert({ id: SECOND, org_id: ACME, kind: "rejected", name: "Second" }));
  });

  test("a late reject does not replace the reason and note of the one that beat it", async () => {
    await bulkReject(ada(), adaCtx, { applications: [row(app(1))], reasonId: REASON, note: "First" });
    const late = await clientTools.updateStage(ada(), adaCtx, { applicationId: app(1), stage: "rejected", expectedStage: "screening", reasonId: SECOND, note: "Second" });
    expect(late.outcome).toBe("changed_since");
    expect(await stageOf(app(1))).toEqual({ stage: "rejected", rejection_reason_id: REASON, rejection_note: "First" });
  });

  test("the same call without a stage to hold to still replaces the reason, as the connector's tool says", async () => {
    await bulkReject(ada(), adaCtx, { applications: [row(app(1))], reasonId: REASON, note: "First" });
    expect((await clientTools.updateStage(ada(), adaCtx, { applicationId: app(1), stage: "rejected", reasonId: SECOND })).outcome).toBe("reason_set");
    expect((await clientTools.updateStage(ada(), adaCtx, { applicationId: app(1), stage: "rejected", expectedStage: "rejected", reasonId: REASON })).outcome).toBe("reason_set");
  });

  test("the same row rejected by two runs at once closes once: one done, one changed, the winner's reason kept", async () => {
    for (let i = 0; i < 5; i++) {
      must(await db().from("applications").update({ stage: "screening", rejection_reason_id: null, rejection_note: null }).eq("id", app(1)));
      must(await db().from("application_events").delete().eq("application_id", app(1)));
      const [a, b] = await Promise.all([
        bulkReject(ada(), adaCtx, { applications: [row(app(1))], reasonId: REASON, note: "A" }),
        bulkReject(lee(), leeCtx, { applications: [row(app(1))], reasonId: SECOND, note: "B" }),
      ]);
      const outcomes = [a, b].map((x) => (x.ok ? x.rows[0]!.outcome : x.error));
      expect(outcomes.slice().sort()).toEqual(["changed", "done"]);
      const final = await stageOf(app(1));
      expect(final.rejection_reason_id).toBe(outcomes[0] === "done" ? REASON : SECOND);
      expect(must(await db().from("application_events").select("id").eq("application_id", app(1)).eq("kind", "stage_changed")).data).toHaveLength(1);
    }
  });

  test("the same new tag made by two runs at once is one tag, on everyone", async () => {
    const [a, b] = await Promise.all([
      bulkTag(ada(), adaCtx, { candidateIds: [person(1)], name: "Raced" }),
      bulkTag(ada(), adaCtx, { candidateIds: [person(2)], name: "raced" }),
    ]);
    expect([a, b]).toMatchObject([{ ok: true, rows: [{ outcome: "done" }] }, { ok: true, rows: [{ outcome: "done" }] }]);
    expect(must(await db().from("tags").select("id").eq("org_id", ACME).ilike("name", "raced")).data).toHaveLength(1);
  });
});

describe("what a run is handed", () => {
  test("already closed and unknown ids answer row by row", async () => {
    must(await db().from("applications").update({ stage: "hired" }).eq("id", app(2)));
    const unknown = "b7d00000-0000-4000-8000-0000000000fe";
    expect(await bulkReject(ada(), adaCtx, { applications: [row(app(1)), row(app(2)), row(unknown)], reasonId: REASON, note: null })).toEqual({
      ok: true,
      rows: [{ id: app(1), outcome: "done" }, { id: app(2), outcome: "changed" }, { id: unknown, outcome: "not_found" }],
    });
    expect((await stageOf(app(2))).stage).toBe("hired");
  });

  test("markup and unicode are stored as typed", async () => {
    for (const name of ["<script>alert(1)</script>", "日本語 タグ", "🦄", "'; drop table tags; --", "%_%"]) {
      expect(await bulkTag(ada(), adaCtx, { candidateIds: [person(1)], name })).toMatchObject({ ok: true, rows: [{ outcome: "done" }] });
    }
    expect(must(await db().from("tags").select("name").eq("org_id", ACME).eq("name", "<script>alert(1)</script>")).data).toHaveLength(1);
    expect(await tagsOn(person(1))).toHaveLength(5);
  });

  test("text the database refuses fails its row and moves nothing", async () => {
    expect(await bulkReject(ada(), adaCtx, { applications: [row(app(1))], reasonId: REASON, note: "a\u0000b" })).toEqual({ ok: true, rows: [{ id: app(1), outcome: "failed" }] });
    expect((await stageOf(app(1))).stage).toBe("screening");
    await expect(bulkTag(ada(), adaCtx, { candidateIds: [person(1)], name: "a\u0000b" })).rejects.toThrow();
    expect(await tagsOn(person(1))).toEqual([]);
  });

  test("at the limit a new tag is one refusal, and an existing one is refused row by row", async () => {
    must(await db().from("audit_log").insert(
      Array.from({ length: 300 }, () => ({ org_id: ACME, actor_id: ADMIN, source: "dashboard", action: "note.add", entity: "person", created_at: new Date().toISOString() })),
    ));
    expect(await bulkTag(ada(), adaCtx, { candidateIds: [person(1), person(2)], name: "Over" })).toEqual({ ok: false, error: "rate_limited" });
    expect(must(await db().from("tags").select("id").eq("org_id", ACME).eq("name", "Over")).data).toEqual([]);
    const answer = await bulkTag(ada(), adaCtx, { candidateIds: [person(1), person(2)], name: "Silver" });
    expect(answer.ok && answer.rows.map((r) => r.outcome)).toEqual(["rate_limited", "rate_limited"]);
    expect(await tagsOn(person(1))).toEqual([]);
  });

  test("a hiring manager on both jobs reads the past application and its events", async () => {
    must(await db().from("hiring_team").insert({ org_id: ACME, role_id: DESIGNER, actor_id: LEAD, team_role: "hiring_manager" }));
    must(await db().from("applications").update({ created_at: at(-1) }).eq("id", app(1)));
    must(await db().from("applications").insert({ id: app(9), org_id: ACME, person_id: person(1), role_id: DESIGNER, stage: "rejected", created_at: at(-60), last_touch_at: at(-30) }));
    must(await db().from("application_events").insert({ org_id: ACME, application_id: app(9), kind: "stage_changed", from_stage: "screening", to_stage: "rejected", created_at: at(-30) }));
    const read = (await readCandidate(lee(), leeCtx, person(1)))!;
    expect(read.past).toMatchObject([{ applicationId: app(9), reached: "screening" }]);
  });
});
