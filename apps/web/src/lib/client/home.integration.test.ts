import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { readHome } from "./home";
import { bottlenecks, stageRows, workload } from "./home-metrics";

/**
 * Home's read against the local stack, on members' own tokens, as
 * pipeline.integration.test.ts: the policies decide which applications,
 * moves and interviews are counted. An admin's numbers on known fixtures, a
 * hiring manager seeing only their job, another company never counted.
 */

const db = () => getSupabaseServiceClient();

const ACME = "a7e00000-0000-4000-8000-0000000000f1";
const GLOBEX = "a7e00000-0000-4000-8000-0000000000f2";
const ADMIN = "a7ea0000-0000-4000-8000-0000000000f1";
const LEAD = "a7ea0000-0000-4000-8000-0000000000f2";
const BYSTANDER = "a7ea0000-0000-4000-8000-0000000000f3";
const IV = "a7ea0000-0000-4000-8000-0000000000f4";
const ENGINEER = "a7eb0000-0000-4000-8000-0000000000f1";
const DESIGNER = "a7eb0000-0000-4000-8000-0000000000f2";
const GLOBEX_ROLE = "a7eb0000-0000-4000-8000-0000000000f3";
const app = (n: number) => `a7ed0000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const person = (n: number) => `a7ec0000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const GLOBEX_APP = "a7ed0000-0000-4000-8000-0000000000f1";
const GLOBEX_PERSON = "a7ec0000-0000-4000-8000-0000000000f1";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of ["interview_feedback", "application_events", "interviews", "applications", "hiring_team", "people", "roles", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const member = (subject: string) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () =>
    mintClientMemberToken(signer, { subject, workosOrgId: "org_itest_home_acme" }),
  );
};
const as = (actorId: string, accessLevel: "admin" | "elevated") => ({ actorId, orgId: ACME, accessLevel });

const NOW = Date.now();
const H = 3_600_000;
const at = (h: number) => new Date(NOW + h * H).toISOString();
const daysAgo = (d: number) => at(-24 * d);

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-home-acme", kind: "client", workos_org_id: "org_itest_home_acme" },
    { id: GLOBEX, name: "Globex", slug: "itest-home-globex", kind: "client", workos_org_id: "org_itest_home_globex" },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-hm-admin", display_name: "Ada Admin", email: "ada@hm.test", access_level: "admin", auth_subject: "user_hm_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-hm-lead", display_name: "Lee Lead", email: "lee@hm.test", access_level: "elevated", auth_subject: "user_hm_lee" },
    { id: BYSTANDER, org_id: ACME, slug: "itest-hm-by", display_name: "Bo Bystander", email: "bo@hm.test", access_level: "elevated", auth_subject: "user_hm_bo" },
    { id: IV, org_id: ACME, slug: "itest-hm-iv", display_name: "Ivy Interviewer", email: "ivy@hm.test", access_level: "limited", auth_subject: "user_hm_ivy" },
  ]));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer"], [DESIGNER, "Designer"]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role"]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title]) => ({ id, org_id: org, company_id: company!.id, title, status: "open" }))));
  }
  // Lee manages the engineer search only; Bo is on no job.
  must(await db().from("hiring_team").insert({ org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" }));

  const apps = [
    // n, job, stage, added days ago
    [1, ENGINEER, "sourced", 2],
    [2, ENGINEER, "interviewing", 10],
    [3, ENGINEER, "interviewing", 6],
    [4, DESIGNER, "screening", 1],
    [5, DESIGNER, "hired", 9],
    [6, ENGINEER, "rejected", 5],
    [7, ENGINEER, "interviewing", 3],
  ] as const;
  must(await db().from("people").insert([
    ...apps.map(([n]) => ({ id: person(n), org_id: ACME, display_name: `Candidate ${n}`, email: `c${n}@hm.test` })),
    { id: GLOBEX_PERSON, org_id: GLOBEX, display_name: "Globex Candidate", email: "g@hm.test" },
  ]));
  must(await db().from("applications").insert([
    ...apps.map(([n, role, stage, d]) => ({ id: app(n), org_id: ACME, person_id: person(n), role_id: role, stage, created_at: daysAgo(d) })),
    { id: GLOBEX_APP, org_id: GLOBEX, person_id: GLOBEX_PERSON, role_id: GLOBEX_ROLE, stage: "interviewing", created_at: daysAgo(1) },
  ]));
  // 2 sat in screening for 7 days, then moved to interviewing 3 days ago.
  must(await db().from("application_events").insert([
    { org_id: ACME, application_id: app(2), kind: "stage_changed", from_stage: "screening", to_stage: "interviewing", created_at: daysAgo(3) },
    { org_id: GLOBEX, application_id: GLOBEX_APP, kind: "stage_changed", from_stage: "screening", to_stage: "interviewing", created_at: daysAgo(1) },
  ]));
  must(await db().from("interviews").insert([
    // 3: held, ended 25h ago, no feedback filed
    { org_id: ACME, application_id: app(3), starts_at: at(-26), ends_at: at(-25), status: "scheduled", step: "Screen", interviewer_actor_ids: [IV] },
    // 7: booked tomorrow, two interviewers
    { org_id: ACME, application_id: app(7), starts_at: at(24), ends_at: at(25), status: "scheduled", step: "Onsite", interviewer_actor_ids: [IV, ADMIN] },
    { org_id: GLOBEX, application_id: GLOBEX_APP, starts_at: at(-30), ends_at: at(-29), status: "scheduled", step: "Screen", interviewer_actor_ids: [] },
  ]));
});

afterAll(clear);

const column = (read: Awaited<ReturnType<typeof readHome>>) => Object.fromEntries(read.waiting.map((w) => [w.applicationId, w.column]));
const hoursOf = (read: Awaited<ReturnType<typeof readHome>>, n: number) => read.waiting.find((w) => w.applicationId === app(n))!.hours;

describe("Home's read", () => {
  test("an admin's numbers: applications against the week before, waits, workload, feedback", async () => {
    const read = await readHome(member("user_hm_ada"), as(ADMIN, "admin"), { days: 7, jobId: null }, new Date(NOW));
    expect(read.jobs.map((j) => j.id).sort()).toEqual([ENGINEER, DESIGNER].sort());

    // 1, 4, 6, 7 and 3 in the last week; 2 and 5 the week before.
    expect(read.applications).toMatchObject({ current: 5, previous: 2, change: 1.5 });
    expect(read.applications.bins.reduce((n, b) => n + b.n, 0)).toBe(5);

    expect(column(read)).toEqual({ [app(1)]: "new", [app(2)]: "scheduling", [app(3)]: "decide", [app(4)]: "screening", [app(7)]: "booked" });
    expect(hoursOf(read, 1)).toBeCloseTo(48, 0); // since added
    expect(hoursOf(read, 2)).toBeCloseTo(72, 0); // since the move to interviewing
    expect(hoursOf(read, 3)).toBeCloseTo(25, 0); // since the interview ended
    expect(stageRows(read.waiting).find((r) => r.key === "scheduling")!.segments).toEqual([0, 0, 1]);

    const load = workload(read.interviews, 7, NOW);
    expect(load).toMatchObject({ held: 1, booked: 1, hours: 3 });
    expect(read.names[IV]).toBe("Ivy Interviewer");

    expect(read.feedback).toEqual([expect.objectContaining({ userId: IV, interviews: 1, feedbackFiled: 0, notFiled: 1 })]);
    // The one not filed, with who and for which job.
    expect(read.outstanding).toEqual([expect.objectContaining({ interviewerId: IV, interviewerName: "Ivy Interviewer", candidateName: "Candidate 3", endsAt: expect.any(String) })]);
    expect(bottlenecks(read.waiting, 1, NOW).map((b) => b.key)).toEqual(["schedule", "review", "decide", "feedback"]);
    expect(read.truncated).toBe(false);
  });

  test("the average stay comes from stays that ended, for applications added in the period", async () => {
    const week = await readHome(member("user_hm_ada"), as(ADMIN, "admin"), { days: 7, jobId: null }, new Date(NOW));
    expect(week.stays.find((s) => s.stage === "screening")).toEqual({ stage: "screening", avgDays: null, stays: 0 });
    const month = await readHome(member("user_hm_ada"), as(ADMIN, "admin"), { days: 30, jobId: null }, new Date(NOW));
    expect(month.stays.find((s) => s.stage === "screening")).toEqual({ stage: "screening", avgDays: 7, stays: 1 });
    expect(month.applications).toMatchObject({ current: 7, previous: 0, change: null });
  });

  test("a job filter narrows every number to that job", async () => {
    const read = await readHome(member("user_hm_ada"), as(ADMIN, "admin"), { days: 7, jobId: DESIGNER }, new Date(NOW));
    expect(read.jobId).toBe(DESIGNER);
    expect(read.applications).toMatchObject({ current: 1, previous: 1 });
    expect(Object.keys(column(read))).toEqual([app(4)]);
    expect(read.interviews).toEqual([]);
  });

  test("a hiring manager counts only their job; another company is never counted", async () => {
    const read = await readHome(member("user_hm_lee"), as(LEAD, "elevated"), { days: 7, jobId: DESIGNER }, new Date(NOW));
    // A job they cannot see is no filter at all: their own is everything.
    expect(read.jobId).toBeNull();
    expect(read.jobs.map((j) => j.id)).toEqual([ENGINEER]);
    expect(read.applications).toMatchObject({ current: 4, previous: 1 });
    expect(Object.keys(column(read)).sort()).toEqual([app(1), app(2), app(3), app(7)].sort());
    expect(read.interviews).toHaveLength(2);
    // They manage the engineer search, so the feedback card is theirs.
    expect(read.feedback?.map((r) => r.userId)).toEqual([IV]);
    for (const w of read.waiting) expect(w.applicationId).not.toBe(GLOBEX_APP);
  });

  test("someone who manages no job sees nothing to count and no feedback card", async () => {
    const read = await readHome(member("user_hm_bo"), as(BYSTANDER, "elevated"), { days: 7, jobId: null }, new Date(NOW));
    expect(read.jobs).toEqual([]);
    expect(read.waiting).toEqual([]);
    expect(read.applications.current).toBe(0);
    expect(read.interviews).toEqual([]);
    expect(read.feedback).toBeNull();
  });
});
