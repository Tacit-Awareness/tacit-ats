import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import type { Member } from "./interviews";
import { readAllInterviews, readSchedule } from "./schedule";
import { daysOf, departmentTones, monthCells, readWindow } from "./schedule-layout";
import { matchesSearch } from "./schedule-search";

/**
 * The Calendar's read against the local stack, on members' own tokens: the
 * policies decide which interviews come back (an interviewer's own through
 * my_interviews(), the rest through the applications they can read), the
 * window bounds them, cancelled ones never do, and department names only
 * reach whoever may read them. The member token is signed with the stack's
 * JWT secret, as in pipeline.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "e5100000-0000-4000-8000-0000000000e1";
const GLOBEX = "e5200000-0000-4000-8000-0000000000e2";
const ADMIN = "e51a0000-0000-4000-8000-0000000000e1";
const LEAD = "e51a0000-0000-4000-8000-0000000000e2";
const BEN = "e51a0000-0000-4000-8000-0000000000e3";
const IVY = "e51a0000-0000-4000-8000-0000000000e4";
const GLOBEX_ADMIN = "e52a0000-0000-4000-8000-0000000000e1";
const ENGINEER = "e51b0000-0000-4000-8000-0000000000e1";
const DESIGNER = "e51b0000-0000-4000-8000-0000000000e2";
const GLOBEX_ROLE = "e52b0000-0000-4000-8000-0000000000e1";
const ENGINEERING = "e51f0000-0000-4000-8000-0000000000e1";
const PLATFORM = "e51f0000-0000-4000-8000-0000000000e2";
const DESIGN = "e51f0000-0000-4000-8000-0000000000e3";
const app = (n: number) => `e51d0000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const person = (n: number) => `e51c0000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const iv = (n: number) => `e51e0000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const GLOBEX_APP = "e52d0000-0000-4000-8000-0000000000e1";
const GLOBEX_PERSON = "e52c0000-0000-4000-8000-0000000000e1";
const GLOBEX_IV = "e52e0000-0000-4000-8000-0000000000e1";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of ["interview_feedback", "application_events", "interviews", "applications", "hiring_team", "people", "roles", "departments", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const client = (subject: string, workosOrgId: string) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};
const ACME_WORKOS = "org_itest_schedule_acme";
const admin = { db: client("user_sc_ada", ACME_WORKOS), member: { actorId: ADMIN, orgId: ACME, accessLevel: "admin" } satisfies Member };
const lead = { db: client("user_sc_lee", ACME_WORKOS), member: { actorId: LEAD, orgId: ACME, accessLevel: "elevated" } satisfies Member };
const ivy = { db: client("user_sc_ivy", ACME_WORKOS), member: { actorId: IVY, orgId: ACME, accessLevel: "limited" } satisfies Member };
const globex = {
  db: client("user_sc_gus", "org_itest_schedule_globex"),
  member: { actorId: GLOBEX_ADMIN, orgId: GLOBEX, accessLevel: "admin" } satisfies Member,
};

const NOW = Date.now();
const H = 3_600_000;
const at = (h: number) => new Date(NOW + h * H).toISOString();
/** Three days either side of now. */
const WINDOW = { from: at(-72), to: at(72) };
const ids = (xs: { interviewId: string }[]) => xs.map((x) => x.interviewId).sort();
const read = (who: { db: ReturnType<typeof client>; member: Member }) => readSchedule(who.db, who.member, WINDOW, new Date(NOW));

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-schedule-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-schedule-globex", kind: "client", workos_org_id: "org_itest_schedule_globex" },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-sc-admin", display_name: "Ada Admin", email: "ada@sc.test", access_level: "admin", auth_subject: "user_sc_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-sc-lead", display_name: "Lee Lead", email: "lee@sc.test", access_level: "elevated", auth_subject: "user_sc_lee" },
    { id: BEN, org_id: ACME, slug: "itest-sc-ben", display_name: "Ben Builder", email: "ben@sc.test", access_level: "elevated", auth_subject: "user_sc_ben" },
    { id: IVY, org_id: ACME, slug: "itest-sc-ivy", display_name: "Ivy Interviewer", email: "ivy@sc.test", access_level: "limited", auth_subject: "user_sc_ivy" },
    { id: GLOBEX_ADMIN, org_id: GLOBEX, slug: "itest-sc-gus", display_name: "Gus Globex", email: "gus@sc.test", access_level: "admin", auth_subject: "user_sc_gus" },
  ]));
  // Engineering > Platform, and Design.
  must(await db().from("departments").insert([
    { id: ENGINEERING, org_id: ACME, name: "Engineering" },
    { id: DESIGN, org_id: ACME, name: "Design" },
  ]));
  must(await db().from("departments").insert({ id: PLATFORM, org_id: ACME, name: "Platform", parent_id: ENGINEERING }));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer", PLATFORM], [DESIGNER, "Designer", DESIGN]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role", null]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title, department_id]) => ({ id, org_id: org, company_id: company!.id, title, status: "open", department_id }))));
  }
  // Lee manages the engineer search only.
  must(await db().from("hiring_team").insert({ org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" }));

  must(await db().from("people").insert([
    ...[1, 2, 3].map((n) => ({ id: person(n), org_id: ACME, display_name: `Candidate ${n}`, email: `c${n}@sc.test` })),
    { id: GLOBEX_PERSON, org_id: GLOBEX, display_name: "Globex Candidate", email: "g@sc.test" },
  ]));
  must(await db().from("applications").insert([
    { id: app(1), org_id: ACME, person_id: person(1), role_id: ENGINEER, stage: "interviewing" },
    { id: app(2), org_id: ACME, person_id: person(2), role_id: DESIGNER, stage: "interviewing" },
    { id: app(3), org_id: ACME, person_id: person(3), role_id: ENGINEER, stage: "interviewing" },
    { id: GLOBEX_APP, org_id: GLOBEX, person_id: GLOBEX_PERSON, role_id: GLOBEX_ROLE, stage: "interviewing" },
  ]));
  must(await db().from("interviews").insert([
    // 1: Candidate 1's screen yesterday, Ivy and Ben, on Meet
    { id: iv(1), org_id: ACME, application_id: app(1), starts_at: at(-26), ends_at: at(-25), status: "done", step: "Screen", interviewer_actor_ids: [IVY, BEN], location_or_link: "https://meet.google.com/abc-defg-hij" },
    // 2: their onsite tomorrow, with Lee, in a room
    { id: iv(2), org_id: ACME, application_id: app(1), starts_at: at(24), ends_at: at(27), status: "scheduled", step: "Onsite", interviewer_actor_ids: [LEAD], location_or_link: "HQ, room 4" },
    // 3: the designer's portfolio review, Ben, in a few hours
    { id: iv(3), org_id: ACME, application_id: app(2), starts_at: at(3), ends_at: at(4), status: "scheduled", step: "Portfolio", interviewer_actor_ids: [BEN] },
    // 4: cancelled, inside the window, with Ivy: never shown
    { id: iv(4), org_id: ACME, application_id: app(3), starts_at: at(5), ends_at: at(6), status: "cancelled", step: "Screen", interviewer_actor_ids: [IVY] },
    // 5: Candidate 3's screen in two weeks, outside the window, with Ivy
    { id: iv(5), org_id: ACME, application_id: app(3), starts_at: at(14 * 24), ends_at: at(14 * 24 + 1), status: "scheduled", step: "Screen", interviewer_actor_ids: [IVY] },
    // 6: began before the window and ends inside it: shown
    { id: iv(6), org_id: ACME, application_id: app(2), starts_at: at(-73), ends_at: at(-71), status: "done", step: "Intro", interviewer_actor_ids: [BEN] },
    { id: GLOBEX_IV, org_id: GLOBEX, application_id: GLOBEX_APP, starts_at: at(2), ends_at: at(3), status: "scheduled", step: "Screen", interviewer_actor_ids: [GLOBEX_ADMIN] },
  ]));
});

afterAll(clear);

describe("the Calendar's read", () => {
  test("an admin sees every interview in the window but cancelled ones, soonest first, with department names", async () => {
    const { items, departments, truncated } = await read(admin);
    expect(items.map((i) => i.interviewId)).toEqual([iv(6), iv(1), iv(3), iv(2)]);
    expect(truncated).toBe(false);
    expect(items.find((i) => i.interviewId === iv(1))).toEqual({
      interviewId: iv(1),
      candidateName: "Candidate 1",
      jobId: ENGINEER,
      jobTitle: "Founding Engineer",
      departmentId: PLATFORM,
      startsAt: expect.any(String),
      endsAt: expect.any(String),
      step: "Screen",
      interviewers: ["Ivy Interviewer", "Ben Builder"],
      locationOrLink: "https://meet.google.com/abc-defg-hij",
    });
    expect(Date.parse(items.find((i) => i.interviewId === iv(1))!.startsAt)).toBe(Date.parse(at(-26)));
    // Platform sits in Engineering, so it is coloured and named as Engineering.
    const tones = departmentTones(departments);
    expect(tones.get(PLATFORM)).toEqual(tones.get(ENGINEERING));
    expect(tones.get(PLATFORM)!.name).toBe("Engineering");
    expect(tones.get(DESIGN)!.tone).not.toBe(tones.get(ENGINEERING)!.tone);
  });

  test("a hiring manager sees only their job's interviews", async () => {
    const { items, departments } = await read(lead);
    expect(ids(items)).toEqual([iv(1), iv(2)].sort());
    expect(items.find((i) => i.interviewId === iv(2))).toMatchObject({ candidateName: "Candidate 1", departmentId: PLATFORM, interviewers: ["Lee Lead"], locationOrLink: "HQ, room 4" });
    expect(departments.map((d) => d.name).sort()).toEqual(["Design", "Engineering", "Platform"]);
  });

  test("an interviewer sees only their own, with the job's department but no department names", async () => {
    const { items, departments } = await read(ivy);
    expect(ids(items)).toEqual([iv(1)]);
    expect(items[0]).toMatchObject({ candidateName: "Candidate 1", jobId: ENGINEER, jobTitle: "Founding Engineer", departmentId: PLATFORM, step: "Screen" });
    expect(departments).toEqual([]);

    // A wider window brings in her screen in two weeks; the cancelled one never.
    const wide = await readSchedule(ivy.db, ivy.member, { from: at(-72), to: at(15 * 24) }, new Date(NOW));
    expect(ids(wide.items)).toEqual([iv(1), iv(5)].sort());
  });

  test("cancelled interviews are left out for everyone", async () => {
    for (const who of [admin, lead, ivy]) {
      const { items } = await readSchedule(who.db, who.member, { from: at(-100 * 24), to: at(100 * 24) }, new Date(NOW));
      expect(ids(items)).not.toContain(iv(4));
    }
  });

  test("a window with more than the cap says so, past PostgREST's 1,000 rows a request", async () => {
    // 1,001 in the window: a `.limit(1001)` alone comes back with 1,000 and says nothing.
    const rows = Array.from({ length: 1001 }, (_, n) => ({
      org_id: ACME,
      application_id: app(2),
      starts_at: new Date(NOW + 30 * 24 * H + n * 60_000).toISOString(),
      ends_at: new Date(NOW + 30 * 24 * H + (n + 30) * 60_000).toISOString(),
      status: "scheduled" as const,
      step: `Bulk ${n}`,
      interviewer_actor_ids: [BEN],
    }));
    must(await db().from("interviews").insert(rows));
    const window = { from: at(29 * 24), to: at(32 * 24) };
    const full = await readSchedule(admin.db, admin.member, window, new Date(NOW));
    expect(full.items.length).toBe(1000);
    expect(full.truncated).toBe(true);
    // Exactly the cap is not short.
    must(await db().from("interviews").delete().eq("org_id", ACME).eq("step", "Bulk 1000"));
    const exact = await readSchedule(admin.db, admin.member, window, new Date(NOW));
    expect(exact.items.length).toBe(1000);
    expect(exact.truncated).toBe(false);
  });

  test("another company never appears, and theirs never reaches us", async () => {
    const theirs = await read(globex);
    expect(ids(theirs.items)).toEqual([GLOBEX_IV]);
    expect(theirs.items[0]!.departmentId).toBeNull();
    expect(theirs.departments).toEqual([]);
    for (const who of [admin, lead, ivy]) expect(ids((await read(who)).items)).not.toContain(GLOBEX_IV);
  });

  test("the month's read reaches the grid's last week, past the month's own end", async () => {
    // A grid's last cell, on a date whose grid the fixture falls in whichever day this runs.
    const onsite = new Date(Date.parse(at(24)));
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const previousMonth = ymd(new Date(Date.UTC(onsite.getUTCFullYear(), onsite.getUTCMonth() - 1, 15)));
    const inGrid = daysOf("month", previousMonth).includes(ymd(onsite));
    const anchor = inGrid ? previousMonth : ymd(onsite);
    const { items } = await readSchedule(admin.db, admin.member, readWindow("month", anchor, new Date(NOW)), new Date(NOW));
    const cell = monthCells(items.map((i) => ({ ...i, id: i.interviewId })), anchor, "UTC").find((c) => c.day === ymd(onsite))!;
    expect(cell.events.map((e) => e.id)).toContain(iv(2));
  });
});

describe("the Calendar's search", () => {
  const found = async (who: { db: ReturnType<typeof client>; member: Member }, q: string) =>
    ids((await readAllInterviews(who.db, who.member, new Date(NOW))).items.filter((i) => matchesSearch(i, q)));

  test("reaches every date, not a window, newest first, and never a cancelled one", async () => {
    const { items, truncated } = await readAllInterviews(admin.db, admin.member, new Date(NOW));
    // Candidate 3's screen in two weeks is well outside any window read above.
    expect(items.map((i) => i.interviewId)).toEqual([iv(5), iv(2), iv(3), iv(1), iv(6)]);
    expect(truncated).toBe(false);
    expect(await found(admin, "Candidate 3")).toEqual([iv(5)]);
  });

  test("finds by candidate, interviewer, job and step", async () => {
    expect(await found(admin, "candidate 1")).toEqual([iv(1), iv(2)].sort());
    expect(await found(admin, "lee lead")).toEqual([iv(2)]);
    expect(await found(admin, "designer")).toEqual([iv(3), iv(6)].sort());
    expect(await found(admin, "portfolio")).toEqual([iv(3)]);
  });

  test("a hiring manager finds only their job's interviews, even by a name on another", async () => {
    expect(await found(lead, "candidate")).toEqual([iv(1), iv(2), iv(5)].sort());
    expect(await found(lead, "Candidate 2")).toEqual([]);
    expect(await found(lead, "portfolio")).toEqual([]);
  });

  test("an interviewer finds only their own", async () => {
    expect(await found(ivy, "candidate")).toEqual([iv(1), iv(5)].sort());
    expect(await found(ivy, "Lee Lead")).toEqual([]);
    expect(await found(ivy, "designer")).toEqual([]);
  });

  test("another company's interviews are never found, by name or at all", async () => {
    for (const who of [admin, lead, ivy]) {
      expect(await found(who, "Globex")).toEqual([]);
      expect(ids((await readAllInterviews(who.db, who.member, new Date(NOW))).items)).not.toContain(GLOBEX_IV);
    }
    expect(await found(globex, "Candidate 1")).toEqual([]);
    expect(await found(globex, "Globex Candidate")).toEqual([GLOBEX_IV]);
  });

  test("past the cap it keeps the newest and says so, paging past 1,000 rows a request", async () => {
    // 3,001 on one application, on top of the fixtures: the oldest are what fall off.
    const rows = Array.from({ length: 3001 }, (_, n) => ({
      org_id: ACME,
      application_id: app(2),
      starts_at: new Date(NOW - 400 * 24 * H + n * 60_000).toISOString(),
      ends_at: new Date(NOW - 400 * 24 * H + (n + 30) * 60_000).toISOString(),
      status: "done" as const,
      step: `Bulk ${n}`,
      interviewer_actor_ids: [BEN],
    }));
    must(await db().from("interviews").insert(rows));
    const { items, truncated } = await readAllInterviews(admin.db, admin.member, new Date(NOW));
    expect(items).toHaveLength(3000);
    expect(new Set(items.map((i) => i.interviewId)).size).toBe(3000);
    expect(truncated).toBe(true);
    expect(items[0]!.interviewId).toBe(iv(5));
    expect(items.map((i) => i.step)).not.toContain("Bulk 0");
    expect(items.map((i) => i.step)).toContain("Bulk 3000");
  });
});
