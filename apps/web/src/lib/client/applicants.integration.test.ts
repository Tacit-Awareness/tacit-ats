import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { readApplicantQueue, readApplicationNotes, readRouting, routeApplicant, type QueueReader } from "./applicants";

/**
 * New Applicants against the local stack, on members' own tokens: the
 * policies decide whose applicants come back and whether a ticket can be
 * routed, and a routed one leaves its event in application_events. The member
 * token is signed with the stack's JWT secret, as in pipeline.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "a7000000-0000-4000-8000-0000000000f1";
const GLOBEX = "a7100000-0000-4000-8000-0000000000f2";
const ADMIN = "a7a00000-0000-4000-8000-0000000000f1";
const LEAD = "a7a00000-0000-4000-8000-0000000000f2";
const INTERVIEWER = "a7a00000-0000-4000-8000-0000000000f3";
const ENGINEER = "a7b00000-0000-4000-8000-0000000000f1";
const DESIGNER = "a7b00000-0000-4000-8000-0000000000f2";
const GLOBEX_ROLE = "a7b10000-0000-4000-8000-0000000000f1";
const REJECTED_REASON = "a7e00000-0000-4000-8000-0000000000f1";
const WITHDREW_REASON = "a7e00000-0000-4000-8000-0000000000f2";
const app = (n: number) => `a7d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const person = (n: number) => `a7c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const GLOBEX_APP = "a7d10000-0000-4000-8000-0000000000f1";
const GLOBEX_PERSON = "a7c10000-0000-4000-8000-0000000000f1";

const ACME_WORKOS = "org_itest_applicants_acme";
const GLOBEX_WORKOS = "org_itest_applicants_globex";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of [
    "application_answers", "application_events", "applications", "rejection_reasons", "hiring_team", "people", "roles", "companies",
  ] as const) {
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
const reader = (actorId: string, accessLevel: QueueReader["accessLevel"], orgId = ACME): QueueReader => ({ actorId, orgId, accessLevel });

const NOW = Date.now();
const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-applicants-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-applicants-globex", kind: "client", workos_org_id: GLOBEX_WORKOS },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-ap-admin", display_name: "Ada Admin", email: "ada@ap.test", access_level: "admin", auth_subject: "user_ap_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-ap-lead", display_name: "Lee Lead", email: "lee@ap.test", access_level: "elevated", auth_subject: "user_ap_lee" },
    { id: INTERVIEWER, org_id: ACME, slug: "itest-ap-ivan", display_name: "Ivan Interviewer", email: "ivan@ap.test", access_level: "limited", auth_subject: "user_ap_ivan" },
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
  must(await db().from("rejection_reasons").insert([
    { id: REJECTED_REASON, org_id: ACME, kind: "rejected", name: "Not enough experience" },
    { id: WITHDREW_REASON, org_id: ACME, kind: "withdrew", name: "Took another offer" },
  ]));

  // 1, 2: engineer applicants from the board; 3: designer; 4: the board, but already screening; 5: added by hand (New Applicants' "Add applicant"); 6: a referral.
  const apps = [
    [1, ENGINEER, "sourced", "job_board", -1],
    [2, ENGINEER, "sourced", "job_board", -5],
    [3, DESIGNER, "sourced", "job_board", -3],
    [4, ENGINEER, "screening", "job_board", -2],
    [5, ENGINEER, "sourced", "sourced", -6],
    [6, DESIGNER, "sourced", "referral", -4],
  ] as const;
  must(await db().from("people").insert([
    ...apps.map(([n]) => ({ id: person(n), org_id: ACME, display_name: `Applicant ${n}`, email: `a${n}@ap.test` })),
    { id: GLOBEX_PERSON, org_id: GLOBEX, display_name: "Globex Applicant", email: "g@ap.test" },
  ]));
  must(await db().from("applications").insert([
    ...apps.map(([n, role, stage, source, h]) => ({
      id: app(n), org_id: ACME, person_id: person(n), role_id: role, stage, source, source_detail: source === "referral" ? "Priya Shah" : "Careers page", created_at: at(h),
    })),
    { id: GLOBEX_APP, org_id: GLOBEX, person_id: GLOBEX_PERSON, role_id: GLOBEX_ROLE, stage: "sourced", source: "job_board", created_at: at(0) },
  ]));
  must(await db().from("application_answers").insert({
    org_id: ACME,
    application_id: app(1),
    answers: [
      { id: "name", type: "name", label: "Full name", value: "Applicant 1" },
      { id: "linkedin", type: "linkedin", label: "LinkedIn profile", value: "linkedin.com/in/applicant1" },
    ],
  }));
});

afterAll(clear);

describe("New Applicants", () => {
  test("an admin sees every applicant, referral and person added by hand still at the first stage, newest first, with their answers", async () => {
    const queue = await readApplicantQueue(member("user_ap_ada"), reader(ADMIN, "admin"));
    expect(queue.map((e) => e.applicationId)).toEqual([app(1), app(3), app(6), app(2), app(5)]);
    expect(queue[0]).toMatchObject({ jobId: ENGINEER, jobTitle: "Founding Engineer", name: "Applicant 1", post: "Careers page" });
    expect(queue[0]!.answers.map((a) => a.value)).toEqual(["Applicant 1", "linkedin.com/in/applicant1"]);
  });

  test("a referral is a ticket: who referred them, the note, and routing takes it out", async () => {
    const ada = member("user_ap_ada");
    must(await db().from("application_events").insert({ org_id: ACME, application_id: app(6), kind: "note", detail: "Worked with her at Stripe.", actor_id: ADMIN }));
    const entry = (await readApplicantQueue(ada, reader(ADMIN, "admin"))).find((e) => e.applicationId === app(6));
    expect(entry).toMatchObject({ source: "referral", referredBy: "Priya Shah", post: null, answers: [] });
    expect(await readApplicationNotes(ada, app(6))).toEqual(["Worked with her at Stripe."]);
    expect(await routeApplicant(ada, ADMIN, { applicationId: app(6), route: "interview" })).toEqual({ ok: true, route: "interview" });
    expect((await readApplicantQueue(ada, reader(ADMIN, "admin"))).map((e) => e.applicationId)).not.toContain(app(6));
  });

  test("a hiring manager sees only their job's applicants", async () => {
    const queue = await readApplicantQueue(member("user_ap_lee"), reader(LEAD, "elevated"));
    expect(queue.map((e) => e.applicationId)).toEqual([app(1), app(2), app(5)]);
    expect((await readRouting(member("user_ap_lee"), ENGINEER)).canEdit).toBe(true);
    expect((await readRouting(member("user_ap_lee"), DESIGNER)).canEdit).toBe(false);
  });

  test("an interviewer is refused", async () => {
    await expect(readApplicantQueue(member("user_ap_ivan"), reader(INTERVIEWER, "limited"))).rejects.toMatchObject({ code: "forbidden" });
    // and cannot route one either
    expect(await routeApplicant(member("user_ap_ivan"), INTERVIEWER, { applicationId: app(1), route: "interview" })).toMatchObject({ ok: false });
  });

  test("another company's applicants never appear, and cannot be routed", async () => {
    const queue = await readApplicantQueue(member("user_ap_ada"), reader(ADMIN, "admin"));
    expect(queue.map((e) => e.applicationId)).not.toContain(GLOBEX_APP);
    expect(await routeApplicant(member("user_ap_ada"), ADMIN, { applicationId: GLOBEX_APP, route: "interview" })).toEqual({ ok: false, error: "not_found" });
  });

  test("routing moves the stage, lands in application_events, and only once", async () => {
    const ada = member("user_ap_ada");
    expect(await routeApplicant(ada, ADMIN, { applicationId: app(1), route: "interview" })).toEqual({ ok: true, route: "interview" });
    const { data: events } = must(await db().from("application_events").select("kind, from_stage, to_stage, actor_id").eq("application_id", app(1)));
    expect(events).toEqual([{ kind: "stage_changed", from_stage: "sourced", to_stage: "interviewing", actor_id: ADMIN }]);
    // out of the queue, and a second click changes nothing
    expect((await readApplicantQueue(ada, reader(ADMIN, "admin"))).map((e) => e.applicationId)).not.toContain(app(1));
    expect(await routeApplicant(ada, ADMIN, { applicationId: app(1), route: "interview" })).toEqual({ ok: false, error: "changed" });
  });

  test("declining needs one of the org's rejected reasons", async () => {
    const ada = member("user_ap_ada");
    expect(await routeApplicant(ada, ADMIN, { applicationId: app(2), route: "decline" })).toEqual({ ok: false, error: "reason_required" });
    expect(await routeApplicant(ada, ADMIN, { applicationId: app(2), route: "decline", reasonId: WITHDREW_REASON })).toEqual({
      ok: false, error: "reason_required",
    });
    // the org's seeded reasons come too; a withdrew reason never does
    const { reasons } = await readRouting(ada, ENGINEER);
    expect(reasons).toContainEqual({ reasonId: REJECTED_REASON, name: "Not enough experience" });
    expect(reasons.map((r) => r.reasonId)).not.toContain(WITHDREW_REASON);
    expect(await routeApplicant(ada, ADMIN, { applicationId: app(2), route: "decline", reasonId: REJECTED_REASON })).toEqual({ ok: true, route: "decline" });
    const { data } = must(await db().from("applications").select("stage, rejection_reason_id").eq("id", app(2)).single());
    expect(data).toEqual({ stage: "rejected", rejection_reason_id: REJECTED_REASON });
    const { data: events } = must(await db().from("application_events").select("to_stage, detail").eq("application_id", app(2)));
    expect(events).toEqual([{ to_stage: "rejected", detail: "Not enough experience" }]);
  });

  test("a hiring manager cannot route an applicant in a job they are not on", async () => {
    // Lee cannot even read the designer's application, so it is not found.
    expect(await routeApplicant(member("user_ap_lee"), LEAD, { applicationId: app(3), route: "interview" })).toEqual({ ok: false, error: "not_found" });
  });
});
