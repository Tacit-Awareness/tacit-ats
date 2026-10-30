import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { groupInterviews } from "./interview-groups";
import { readInterview, readInterviews, type Member } from "./interviews";

/**
 * The Interviews page's reads against the local stack, on members' own
 * tokens: the policies decide which interviews come back and which feedback
 * is readable (the org's feedback_visibility, through can_see_feedback). The
 * member token is signed with the stack's JWT secret, as in
 * pipeline.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "d1000000-0000-4000-8000-0000000000e1";
const GLOBEX = "d2000000-0000-4000-8000-0000000000e2";
const ADMIN = "d1a00000-0000-4000-8000-0000000000e1";
const LEAD = "d1a00000-0000-4000-8000-0000000000e2";
const BEN = "d1a00000-0000-4000-8000-0000000000e3";
const IVY = "d1a00000-0000-4000-8000-0000000000e4";
const GLOBEX_ADMIN = "d2a00000-0000-4000-8000-0000000000e1";
const ENGINEER = "d1b00000-0000-4000-8000-0000000000e1";
const DESIGNER = "d1b00000-0000-4000-8000-0000000000e2";
const GLOBEX_ROLE = "d2b00000-0000-4000-8000-0000000000e1";
const app = (n: number) => `d1d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const person = (n: number) => `d1c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const iv = (n: number) => `d1e00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const GLOBEX_APP = "d2d00000-0000-4000-8000-0000000000e1";
const GLOBEX_PERSON = "d2c00000-0000-4000-8000-0000000000e1";
const GLOBEX_IV = "d2e00000-0000-4000-8000-0000000000e1";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of [
    "interview_feedback_ratings", "interview_feedback", "application_events", "interviews", "applications", "hiring_team", "people", "roles", "companies",
  ] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const client = (subject: string, workosOrgId: string) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};
const ACME_WORKOS = "org_itest_interviews_acme";
const admin = { db: client("user_iv_ada", ACME_WORKOS), member: { actorId: ADMIN, orgId: ACME, accessLevel: "admin" } satisfies Member };
const lead = { db: client("user_iv_lee", ACME_WORKOS), member: { actorId: LEAD, orgId: ACME, accessLevel: "elevated" } satisfies Member };
const ivy = { db: client("user_iv_ivy", ACME_WORKOS), member: { actorId: IVY, orgId: ACME, accessLevel: "limited" } satisfies Member };
const globex = {
  db: client("user_iv_gus", "org_itest_interviews_globex"),
  member: { actorId: GLOBEX_ADMIN, orgId: GLOBEX, accessLevel: "admin" } satisfies Member,
};

const NOW = Date.now();
const H = 3_600_000;
const at = (h: number) => new Date(NOW + h * H).toISOString();
const ids = (xs: { interviewId: string }[]) => xs.map((x) => x.interviewId).sort();

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-interviews-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-interviews-globex", kind: "client", workos_org_id: "org_itest_interviews_globex" },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-iv-admin", display_name: "Ada Admin", email: "ada@iv.test", access_level: "admin", auth_subject: "user_iv_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-iv-lead", display_name: "Lee Lead", email: "lee@iv.test", access_level: "elevated", auth_subject: "user_iv_lee" },
    { id: BEN, org_id: ACME, slug: "itest-iv-ben", display_name: "Ben Builder", email: "ben@iv.test", access_level: "elevated", auth_subject: "user_iv_ben" },
    { id: IVY, org_id: ACME, slug: "itest-iv-ivy", display_name: "Ivy Interviewer", email: "ivy@iv.test", access_level: "limited", auth_subject: "user_iv_ivy" },
    { id: GLOBEX_ADMIN, org_id: GLOBEX, slug: "itest-iv-gus", display_name: "Gus Globex", email: "gus@iv.test", access_level: "admin", auth_subject: "user_iv_gus" },
  ]));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer", ["Screen", "Onsite", "Final"]], [DESIGNER, "Designer", []]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role", []]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title, steps]) => ({
      id, org_id: org, company_id: company!.id, title, status: "open", interview_steps: [...steps],
    }))));
  }
  // Lee manages the engineer search only.
  must(await db().from("hiring_team").insert({ org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" }));

  must(await db().from("people").insert([
    ...[1, 2, 3].map((n) => ({ id: person(n), org_id: ACME, display_name: `Candidate ${n}`, email: `c${n}@iv.test` })),
    { id: GLOBEX_PERSON, org_id: GLOBEX, display_name: "Globex Candidate", email: "g@iv.test" },
  ]));
  must(await db().from("applications").insert([
    { id: app(1), org_id: ACME, person_id: person(1), role_id: ENGINEER, stage: "interviewing" },
    { id: app(2), org_id: ACME, person_id: person(2), role_id: DESIGNER, stage: "interviewing" },
    { id: app(3), org_id: ACME, person_id: person(3), role_id: ENGINEER, stage: "interviewing" },
    { id: GLOBEX_APP, org_id: GLOBEX, person_id: GLOBEX_PERSON, role_id: GLOBEX_ROLE, stage: "interviewing" },
  ]));
  must(await db().from("interviews").insert([
    // 1: Candidate 1's screen yesterday, Ivy and Ben; only Ben has filed
    { id: iv(1), org_id: ACME, application_id: app(1), starts_at: at(-26), ends_at: at(-25), status: "done", step: "Screen", interviewer_actor_ids: [IVY, BEN] },
    // 2: their onsite tomorrow, with Lee
    { id: iv(2), org_id: ACME, application_id: app(1), starts_at: at(24), ends_at: at(25), status: "scheduled", step: "Onsite", interviewer_actor_ids: [LEAD] },
    // 3: the designer's interview, Ben said no
    { id: iv(3), org_id: ACME, application_id: app(2), starts_at: at(-50), ends_at: at(-49), status: "done", step: "Portfolio", interviewer_actor_ids: [BEN] },
    // 4: cancelled, never listed
    { id: iv(4), org_id: ACME, application_id: app(3), starts_at: at(5), ends_at: at(6), status: "cancelled", step: "Screen", interviewer_actor_ids: [IVY] },
    { id: GLOBEX_IV, org_id: GLOBEX, application_id: GLOBEX_APP, starts_at: at(-5), ends_at: at(-4), status: "done", step: "Screen", interviewer_actor_ids: [GLOBEX_ADMIN] },
  ]));
  must(await db().from("interview_feedback").insert([
    { org_id: ACME, interview_id: iv(1), interviewer_actor_id: BEN, recommendation: "yes", rating: 3, notes: "Clear systems answers." },
    { org_id: ACME, interview_id: iv(3), interviewer_actor_id: BEN, recommendation: "no", notes: "Not the depth we need." },
    { org_id: GLOBEX, interview_id: GLOBEX_IV, interviewer_actor_id: GLOBEX_ADMIN, recommendation: "strong_yes", notes: "Globex only." },
  ]));
});

afterAll(clear);

describe("the Interviews page's reads", () => {
  test("an admin sees every interview but cancelled ones, grouped by the feedback filed", async () => {
    const items = await readInterviews(admin.db, admin.member, new Date(NOW));
    expect(ids(items)).toEqual([iv(1), iv(2), iv(3)].sort());
    const groups = groupInterviews(items, NOW);
    expect(groups.map((g) => [g.key, ids(g.items)])).toEqual([["upcoming", [iv(2)]], ["pass", [iv(1)]], ["fail", [iv(3)]]]);
    expect(items.find((i) => i.interviewId === iv(1))).toMatchObject({
      candidateName: "Candidate 1", jobId: ENGINEER, jobTitle: "Founding Engineer", step: "Screen", interviewers: ["Ivy Interviewer", "Ben Builder"],
    });

    const { plan, feedback } = await readInterview(admin.db, admin.member, items.find((i) => i.interviewId === iv(1))!);
    expect(plan.candidate!.seesAllInterviews).toBe(true);
    expect(plan.candidate!.steps.map((s) => [s.step, s.state])).toEqual([["Screen", "done"], ["Onsite", "scheduled"], ["Final", "not_scheduled"]]);
    expect(plan.candidate!.steps[0]!.interviews[0]!.interviewers.map((p) => [p.name, p.feedback])).toEqual([["Ivy Interviewer", "not_filed"], ["Ben Builder", "filed"]]);
    expect(feedback.feedback.map((f) => [f.interviewer, f.recommendation, f.notes])).toEqual([["Ben Builder", "yes", "Clear systems answers."]]);
  });

  test("a hiring manager sees only their job's interviews, and feedback per the org's visibility", async () => {
    const items = await readInterviews(lead.db, lead.member, new Date(NOW));
    expect(ids(items)).toEqual([iv(1), iv(2)].sort());
    // after_submit: Lee's own onsite is outstanding on this application, so Ben's read is held back
    const screen = items.find((i) => i.interviewId === iv(1))!;
    expect(screen.recommendations).toEqual([]);
    const held = await readInterview(lead.db, lead.member, screen);
    expect(held.feedback.feedback).toEqual([]);
    expect(held.plan.candidate!.steps[0]!.interviews[0]!.interviewers.find((p) => p.userId === BEN)!.feedback).toBe("hidden");

    must(await db().from("orgs").update({ feedback_visibility: "always" }).eq("id", ACME));
    const open = await readInterviews(lead.db, lead.member, new Date(NOW));
    expect(open.find((i) => i.interviewId === iv(1))!.recommendations).toEqual(["yes"]);
    const read = await readInterview(lead.db, lead.member, screen);
    expect(read.feedback.feedback.map((f) => f.notes)).toEqual(["Clear systems answers."]);
  });

  test("an interviewer sees only their own interviews and only their own feedback", async () => {
    const items = await readInterviews(ivy.db, ivy.member, new Date(NOW));
    expect(ids(items)).toEqual([iv(1)]);
    expect(items[0]).toMatchObject({ candidateName: "Candidate 1", jobId: ENGINEER, jobTitle: "Founding Engineer", recommendations: [] });
    expect(groupInterviews(items, NOW).map((g) => g.key)).toEqual(["pending"]);

    const before = await readInterview(ivy.db, ivy.member, items[0]!);
    expect(before.plan.candidate!.seesAllInterviews).toBe(false);
    expect(before.plan.candidate!.steps.map((s) => s.state)).toEqual(["done", "not_visible", "not_visible"]);
    expect(before.feedback.feedback).toEqual([]);
    expect(before.feedback.yoursOutstanding).toBe(true);

    // Filing her own does not open Ben's to an interviewer, even with the org's visibility at always.
    must(await db().from("orgs").update({ feedback_visibility: "always" }).eq("id", ACME));
    must(await db().from("interview_feedback").insert({ org_id: ACME, interview_id: iv(1), interviewer_actor_id: IVY, recommendation: "no", notes: "Mine." }));
    const after = await readInterviews(ivy.db, ivy.member, new Date(NOW));
    expect(after[0]!.recommendations).toEqual(["no"]);
    const read = await readInterview(ivy.db, ivy.member, after[0]!);
    expect(read.feedback.feedback.map((f) => [f.notes, f.mine])).toEqual([["Mine.", true]]);
  });

  test("another company never appears, and theirs never reaches us", async () => {
    const theirs = await readInterviews(globex.db, globex.member, new Date(NOW));
    expect(ids(theirs)).toEqual([GLOBEX_IV]);
    for (const who of [admin, lead, ivy]) {
      expect(ids(await readInterviews(who.db, who.member, new Date(NOW)))).not.toContain(GLOBEX_IV);
    }
    await expect(readInterview(admin.db, admin.member, { interviewId: GLOBEX_IV, applicationId: GLOBEX_APP, jobId: GLOBEX_ROLE })).rejects.toThrow();
  });
});
