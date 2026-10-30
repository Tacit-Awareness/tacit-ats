import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { addReferral, readAddForm, readReferrals } from "./referrals";

/**
 * Referrals against the local stack, on members' own tokens: the policies
 * decide whose referrals come back and whether one can be added, and an added
 * one lands with source `referral` and the referrer in `source_detail`. The
 * member token is signed with the stack's JWT secret, as in
 * pipeline.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "e5000000-0000-4000-8000-0000000000f1";
const GLOBEX = "e5100000-0000-4000-8000-0000000000f2";
const ADMIN = "e5a00000-0000-4000-8000-0000000000f1";
const LEAD = "e5a00000-0000-4000-8000-0000000000f2";
const INTERVIEWER = "e5a00000-0000-4000-8000-0000000000f3";
const ENGINEER = "e5b00000-0000-4000-8000-0000000000f1";
const DESIGNER = "e5b00000-0000-4000-8000-0000000000f2";
const GLOBEX_ROLE = "e5b10000-0000-4000-8000-0000000000f1";
const app = (n: number) => `e5d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const person = (n: number) => `e5c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const GLOBEX_APP = "e5d10000-0000-4000-8000-0000000000f1";
const GLOBEX_PERSON = "e5c10000-0000-4000-8000-0000000000f1";

const ACME_WORKOS = "org_itest_referrals_acme";
const GLOBEX_WORKOS = "org_itest_referrals_globex";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of ["application_events", "applications", "hiring_team", "people", "roles", "companies"] as const) {
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

const NOW = Date.now();
const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-referrals-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-referrals-globex", kind: "client", workos_org_id: GLOBEX_WORKOS },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-rf-admin", display_name: "Ada Admin", email: "ada@rf.test", access_level: "admin", auth_subject: "user_rf_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-rf-lead", display_name: "Lee Lead", email: "lee@rf.test", access_level: "elevated", auth_subject: "user_rf_lee" },
    { id: INTERVIEWER, org_id: ACME, slug: "itest-rf-ivan", display_name: "Ivan Interviewer", email: "ivan@rf.test", access_level: "limited", auth_subject: "user_rf_ivan" },
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

  // 1-3: engineer referrals, live, hired, rejected; 4: a designer referral; 5: an engineer applicant, not a referral.
  const apps = [
    [1, ENGINEER, "screening", "referral", "Priya Shah", -1],
    [2, ENGINEER, "hired", "referral", "Marco", -50],
    [3, ENGINEER, "rejected", "referral", null, -30],
    [4, DESIGNER, "sourced", "referral", "Priya Shah", -5],
    [5, ENGINEER, "screening", "job_board", "Careers page", -2],
  ] as const;
  must(await db().from("people").insert([
    ...apps.map(([n]) => ({ id: person(n), org_id: ACME, display_name: `Candidate ${n}`, email: `c${n}@rf.test` })),
    { id: GLOBEX_PERSON, org_id: GLOBEX, display_name: "Globex Candidate", email: "g@rf.test" },
  ]));
  must(await db().from("applications").insert([
    ...apps.map(([n, role, stage, source, detail, h]) => ({
      id: app(n), org_id: ACME, person_id: person(n), role_id: role, stage, source, source_detail: detail, created_at: at(h),
    })),
    { id: GLOBEX_APP, org_id: GLOBEX, person_id: GLOBEX_PERSON, role_id: GLOBEX_ROLE, stage: "sourced", source: "referral", source_detail: "Someone", created_at: at(0) },
  ]));
});

afterAll(clear);

const ids = (rs: { applicationId: string }[]) => rs.map((r) => r.applicationId).sort();

describe("Referrals", () => {
  test("an admin sees every referral in the org, open and closed, with the referrer, job and stage", async () => {
    const { referrals, truncated } = await readReferrals(member("user_rf_ada"));
    expect(truncated).toBe(false);
    expect(ids(referrals)).toEqual([app(1), app(2), app(3), app(4)]);
    expect(referrals.find((r) => r.applicationId === app(1))).toMatchObject({
      candidateId: person(1), name: "Candidate 1", referredBy: "Priya Shah", jobId: ENGINEER, jobTitle: "Founding Engineer", stage: "screening",
    });
    expect(referrals.find((r) => r.applicationId === app(3))!.referredBy).toBeNull();

    const form = await readAddForm(member("user_rf_ada"));
    expect(form.jobs.map((j) => j.jobId).sort()).toEqual([DESIGNER, ENGINEER].sort());
    expect(form.teammates).toEqual(expect.arrayContaining(["Ada Admin", "Lee Lead"]));
  });

  test("a hiring manager sees only their job's referrals, and may add only to it", async () => {
    const lee = member("user_rf_lee");
    expect(ids((await readReferrals(lee)).referrals)).toEqual([app(1), app(2), app(3)]);
    expect((await readAddForm(lee)).jobs).toEqual([{ jobId: ENGINEER, title: "Founding Engineer" }]);
    expect(await addReferral(lee, { orgId: ACME, actorId: LEAD }, {
      jobId: DESIGNER, name: "Dana Designer", email: "dana@rf.test", linkedinUrl: null, referredBy: "Lee", note: null,
    })).toEqual({ ok: false, error: "forbidden" });
    // refused before anyone was created
    const { data } = must(await db().from("people").select("id").eq("email", "dana@rf.test"));
    expect(data).toEqual([]);
  });

  test("an interviewer reads no referrals and is refused an add", async () => {
    const ivan = member("user_rf_ivan");
    expect((await readReferrals(ivan)).referrals).toEqual([]);
    expect((await readAddForm(ivan)).jobs).toEqual([]);
    expect(await addReferral(ivan, { orgId: ACME, actorId: INTERVIEWER }, {
      jobId: ENGINEER, name: "Ivy", email: null, linkedinUrl: null, referredBy: "Ivan", note: null,
    })).toEqual({ ok: false, error: "forbidden" });
  });

  test("another company's referrals never appear, and its jobs cannot be added to", async () => {
    const ada = member("user_rf_ada");
    expect(ids((await readReferrals(ada)).referrals)).not.toContain(GLOBEX_APP);
    expect((await readAddForm(ada)).jobs.map((j) => j.jobId)).not.toContain(GLOBEX_ROLE);
    expect(await addReferral(ada, { orgId: ACME, actorId: ADMIN }, {
      jobId: GLOBEX_ROLE, name: "Gus", email: null, linkedinUrl: null, referredBy: "Ada", note: null,
    })).toEqual({ ok: false, error: "forbidden" });
  });

  test("an added referral lands with source referral, the referrer, and the note", async () => {
    const ada = member("user_rf_ada");
    const added = await addReferral(ada, { orgId: ACME, actorId: ADMIN }, {
      jobId: DESIGNER, name: "  Rita   Referral ", email: "rita@rf.test", linkedinUrl: null, referredBy: "  Priya  Shah ", note: "Worked with her at Stripe.",
    });
    expect(added).toMatchObject({ ok: true, status: "added" });
    if (!added.ok) throw new Error("not added");

    const { data: row } = must(await db().from("applications").select("org_id, person_id, role_id, stage, source, source_detail, added_by_actor_id").eq("id", added.applicationId).single());
    expect(row).toEqual({ org_id: ACME, person_id: added.personId, role_id: DESIGNER, stage: "sourced", source: "referral", source_detail: "Priya Shah", added_by_actor_id: ADMIN });
    const { data: who } = must(await db().from("people").select("org_id, display_name, email").eq("id", added.personId).single());
    expect(who).toEqual({ org_id: ACME, display_name: "Rita Referral", email: "rita@rf.test" });
    const { data: events } = must(await db().from("application_events").select("kind, detail").eq("application_id", added.applicationId).order("created_at"));
    expect(events).toEqual([{ kind: "added", detail: "referral" }, { kind: "note", detail: "Worked with her at Stripe." }]);

    // on the table, newest
    expect((await readReferrals(ada)).referrals.find((r) => r.applicationId === added.applicationId)).toMatchObject({ name: "Rita Referral", referredBy: "Priya Shah", stage: "sourced" });

    // asked again: nothing changes, no second note
    expect(await addReferral(ada, { orgId: ACME, actorId: ADMIN }, {
      jobId: DESIGNER, name: "Rita Referral", email: "rita@rf.test", linkedinUrl: null, referredBy: "Someone else", note: "again",
    })).toMatchObject({ ok: true, status: "exists", applicationId: added.applicationId });
    const { data: after } = must(await db().from("application_events").select("kind").eq("application_id", added.applicationId));
    expect(after).toHaveLength(2);
  });

  test("an email already on someone the member can see adds that person; bad input is a code", async () => {
    const ada = member("user_rf_ada");
    expect(await addReferral(ada, { orgId: ACME, actorId: ADMIN }, {
      jobId: DESIGNER, name: "Candidate 1", email: "c1@rf.test", linkedinUrl: null, referredBy: "Marco", note: null,
    })).toMatchObject({ ok: true, status: "added_existing", personId: person(1) });
    const base = { jobId: DESIGNER, name: "X Y", email: null, linkedinUrl: null, referredBy: "Marco", note: null };
    expect(await addReferral(ada, { orgId: ACME, actorId: ADMIN }, { ...base, referredBy: "  " })).toEqual({ ok: false, error: "invalid_referrer" });
    expect(await addReferral(ada, { orgId: ACME, actorId: ADMIN }, { ...base, name: " " })).toEqual({ ok: false, error: "invalid_name" });
    expect(await addReferral(ada, { orgId: ACME, actorId: ADMIN }, { ...base, email: "not-an-email" })).toEqual({ ok: false, error: "invalid_email" });
    expect(await addReferral(ada, { orgId: ACME, actorId: ADMIN }, { ...base, linkedinUrl: "https://example.com/me" })).toEqual({ ok: false, error: "invalid_linkedin" });
  });
});
