import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";
import type { clientTools } from "@tacit-ats/core";

import { fakeGoogle } from "../../../../../packages/core/src/test-helpers/fake-google";
import { memberCalendar } from "../member-calendar/grants";
import { readSchedule } from "./schedule";
import { readBookingChoices, schedulableRoles } from "./schedule-choices";
import { runScheduleRequest } from "./schedule-ops";
import type { BookRequest, CancelRequest, MoveRequest } from "./schedule-requests";

/**
 * The Calendar's writes against the local stack, on members' own tokens with
 * source `dashboard`: the policies decide who may, the grants come out of the
 * real calendar_connections through lib/member-calendar, and Google is
 * fake-google.ts, so nothing here reaches a real calendar. The row, the audit
 * and the calls to Google are each read back.
 */

const db = () => getSupabaseServiceClient();

const ACME = "d3000000-0000-4000-8000-0000000000e1";
const GLOBEX = "d4000000-0000-4000-8000-0000000000e2";
const ADMIN = "d3a00000-0000-4000-8000-0000000000e1";
const LEAD = "d3a00000-0000-4000-8000-0000000000e2";
const IVY = "d3a00000-0000-4000-8000-0000000000e3";
const HANA = "d3a00000-0000-4000-8000-0000000000e4";
const GUS = "d4a00000-0000-4000-8000-0000000000e1";
const ENGINEER = "d3b00000-0000-4000-8000-0000000000e1";
const DESIGNER = "d3b00000-0000-4000-8000-0000000000e2";
const APP = "d3d00000-0000-4000-8000-0000000000e1";
const DESIGN_APP = "d3d00000-0000-4000-8000-0000000000e2";
const ONSITE = "d3e00000-0000-4000-8000-0000000000e1";
const NEW_ID = "d3e00000-0000-4000-8000-0000000000ee";
const ACME_WORKOS = "org_itest_schedule_writes_acme";
const GLOBEX_WORKOS = "org_itest_schedule_writes_globex";
const ACTORS = [ADMIN, LEAD, IVY, HANA, GUS];

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  await db().from("audit_log").delete().in("actor_id", ACTORS);
  await db().from("calendar_connections").delete().in("org_id", ids);
  for (const table of ["interviews", "applications", "hiring_team", "people", "roles", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const client = (subject: string, workosOrgId: string) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};
const who = (actorId: string, orgId: string, accessLevel: clientTools.ClientToolCtx["accessLevel"]): clientTools.ClientToolCtx => ({ actorId, orgId, accessLevel, source: "dashboard" });
const admin = { db: client("user_sw_ada", ACME_WORKOS), ctx: who(ADMIN, ACME, "admin") };
const lead = { db: client("user_sw_lee", ACME_WORKOS), ctx: who(LEAD, ACME, "elevated") };
const ivy = { db: client("user_sw_ivy", ACME_WORKOS), ctx: who(IVY, ACME, "limited") };
const gus = { db: client("user_sw_gus", GLOBEX_WORKOS), ctx: who(GUS, GLOBEX, "admin") };

const NOW = new Date("2031-03-03T12:00:00Z");
const now = () => NOW;

/** Google as a fake, the grants as the real module reads them from the real table. */
function calendarOf(google: ReturnType<typeof fakeGoogle>): clientTools.ClientCalendar {
  const real = memberCalendar("https://ats.test", { ...process.env, CLIENT_GOOGLE_CLIENT_ID: "cid", CLIENT_GOOGLE_CLIENT_SECRET: "secret" })!;
  return { ...real, google: { ...real.google, fetch: google.fetchImpl } };
}

const free = { "at-ada": { "ada@sw.test": [], "ivy@sw.test": [] }, "at-hana": { "ivy@sw.test": [], "ada@sw.test": [] } };

const book = (over: Partial<BookRequest> = {}): BookRequest => ({
  op: "book", confirmed: false, interviewId: NEW_ID, applicationId: APP, startsAt: "2031-03-05T15:00:00Z", endsAt: "2031-03-05T16:00:00Z",
  interviewerIds: [ADMIN, IVY], step: "Screen", locationOrLink: null, timezone: "America/New_York", bookDespiteConflicts: false, recordOnly: false, ...over,
});
const move = (over: Partial<MoveRequest> = {}): MoveRequest => ({
  op: "move", confirmed: false, interviewId: ONSITE, startsAt: "2031-03-06T15:00:00Z", endsAt: "2031-03-06T16:00:00Z", timezone: "UTC", bookDespiteConflicts: false, recordOnly: false, ...over,
});
const cancel = (over: Partial<CancelRequest> = {}): CancelRequest => ({ op: "cancel", confirmed: false, interviewId: ONSITE, timezone: "UTC", recordOnly: false, ...over });

const row = async (id: string) => must(await db().from("interviews").select("status, starts_at, ends_at, calendar_actor_id, google_event_id, google_event_link, location_or_link, interviewer_actor_ids").eq("id", id).maybeSingle()).data;
const audit = async (actorId: string) => must(await db().from("audit_log").select("action, source, after").eq("actor_id", actorId).order("created_at")).data!;
const finished = async (actorId: string) => (await audit(actorId)).filter((a) => a.after !== null);

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-sw-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-sw-globex", kind: "client", workos_org_id: GLOBEX_WORKOS },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-sw-ada", display_name: "Ada Admin", email: "ada@sw.test", access_level: "admin", auth_subject: "user_sw_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-sw-lee", display_name: "Lee Lead", email: "lee@sw.test", access_level: "elevated", auth_subject: "user_sw_lee" },
    { id: IVY, org_id: ACME, slug: "itest-sw-ivy", display_name: "Ivy Interviewer", email: "ivy@sw.test", access_level: "limited", auth_subject: "user_sw_ivy" },
    { id: HANA, org_id: ACME, slug: "itest-sw-hana", display_name: "Hana Holder", email: "hana@sw.test", access_level: "elevated", auth_subject: "user_sw_hana" },
    { id: GUS, org_id: GLOBEX, slug: "itest-sw-gus", display_name: "Gus Globex", email: "gus@sw.test", access_level: "admin", auth_subject: "user_sw_gus" },
  ]));
  const { data: company } = must(await db().from("companies").insert({ org_id: ACME, name: "Acme" }).select("id").single());
  must(await db().from("roles").insert([
    { id: ENGINEER, org_id: ACME, company_id: company!.id, title: "Founding Engineer", status: "open", interview_steps: ["Screen", "Onsite"] },
    { id: DESIGNER, org_id: ACME, company_id: company!.id, title: "Designer", status: "open", interview_steps: [] },
  ]));
  // Lee manages the engineer search only.
  must(await db().from("hiring_team").insert({ org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" }));
  const { data: people } = must(await db().from("people").insert([
    { org_id: ACME, display_name: "Pat Lee", email: "Pat@sw.test" },
    { org_id: ACME, display_name: "Dee Signer", email: null },
  ]).select("id, display_name"));
  const pat = people!.find((p) => p.display_name === "Pat Lee")!.id;
  const dee = people!.find((p) => p.display_name === "Dee Signer")!.id;
  must(await db().from("applications").insert([
    { id: APP, org_id: ACME, person_id: pat, role_id: ENGINEER, stage: "interviewing" },
    { id: DESIGN_APP, org_id: ACME, person_id: dee, role_id: DESIGNER, stage: "interviewing" },
  ]));
  must(await db().from("calendar_connections").insert([
    { actor_id: ADMIN, org_id: ACME, provider: "google", account_email: "ada@sw.test", refresh_token: "rt-ada", scopes: "calendar.events" },
    { actor_id: HANA, org_id: ACME, provider: "google", account_email: "hana@sw.test", refresh_token: "rt-hana", scopes: "calendar.events" },
  ]));
  // Onsite on Hana's calendar, with Ivy.
  must(await db().from("interviews").insert({
    id: ONSITE, org_id: ACME, application_id: APP, starts_at: "2031-03-04T15:00:00Z", ends_at: "2031-03-04T16:00:00Z", status: "scheduled", step: "Onsite",
    interviewer_actor_ids: [IVY], calendar_actor_id: HANA, google_event_id: ONSITE.replace(/-/g, ""),
  }));
});

afterAll(clear);

describe("a dry run", () => {
  test("a book's says what would happen, and leaves no row, audit or event", async () => {
    const google = fakeGoogle({ busy: free });
    const answer = await runScheduleRequest(admin.db, admin.ctx, book(), { calendar: calendarOf(google), now });
    expect(answer).toMatchObject({
      ok: true, kind: "book_preview",
      preview: { calendar: { status: "would_invite", organizer: { userId: ADMIN }, candidateEmail: "pat@sw.test", invited: [{ userId: IVY }], meetLink: true } },
    });
    expect(await row(NEW_ID)).toBeNull();
    expect(await audit(ADMIN)).toEqual([]);
    expect(google.eventCalls()).toEqual([]);
  });

  test("a move's and a cancel's name the holder, and change nothing", async () => {
    const google = fakeGoogle({ busy: free });
    expect(await runScheduleRequest(admin.db, admin.ctx, move(), { calendar: calendarOf(google), now })).toMatchObject({
      ok: true, kind: "change_preview", preview: { calendar: { status: "would_follow", action: "move", organizer: { userId: HANA } } },
    });
    expect(await runScheduleRequest(admin.db, admin.ctx, cancel(), { calendar: calendarOf(google), now })).toMatchObject({
      ok: true, kind: "change_preview", preview: { calendar: { status: "would_follow", action: "cancel" } },
    });
    expect(await row(ONSITE)).toMatchObject({ status: "scheduled" });
    expect(Date.parse((await row(ONSITE))!.starts_at)).toBe(Date.parse("2031-03-04T15:00:00Z"));
    expect(await audit(ADMIN)).toEqual([]);
    expect(google.eventCalls()).toEqual([]);
  });
});

describe("booking", () => {
  test("on the member's calendar: the row, one event, an audit row labelled dashboard", async () => {
    const google = fakeGoogle({ busy: free });
    const answer = await runScheduleRequest(admin.db, admin.ctx, book({ confirmed: true }), { calendar: calendarOf(google), now });
    expect(answer).toMatchObject({ ok: true, kind: "booked", interviewId: NEW_ID, calendar: { status: "invited", organizer: { userId: ADMIN }, candidateInvited: true } });
    expect(await row(NEW_ID)).toMatchObject({ status: "scheduled", calendar_actor_id: ADMIN, google_event_id: NEW_ID.replace(/-/g, ""), interviewer_actor_ids: [ADMIN, IVY] });
    const events = google.eventCalls();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ method: "POST", token: "at-ada", body: { attendees: [{ email: "ada@sw.test" }, { email: "ivy@sw.test" }, { email: "pat@sw.test" }] } });
    expect(await finished(ADMIN)).toMatchObject([{ action: "interview.schedule", source: "dashboard" }]);
  });

  test("twice with one id books once and puts one event on a calendar", async () => {
    const google = fakeGoogle({ busy: free });
    const deps = { calendar: calendarOf(google), now };
    expect(await runScheduleRequest(admin.db, admin.ctx, book({ confirmed: true }), deps)).toMatchObject({ ok: true, kind: "booked" });
    expect(await runScheduleRequest(admin.db, admin.ctx, book({ confirmed: true }), deps)).toEqual({ ok: true, kind: "already_booked" });
    expect(google.eventCalls()).toHaveLength(1);
    expect(must(await db().from("interviews").select("id").eq("id", NEW_ID)).data).toHaveLength(1);
    expect(await row(NEW_ID)).toMatchObject({ status: "scheduled" });
  });

  test("two tabs racing: one interview, however the two land", async () => {
    const google = fakeGoogle({ busy: free });
    const deps = { calendar: calendarOf(google), now };
    const answers = await Promise.all([1, 2].map(() => runScheduleRequest(admin.db, admin.ctx, book({ confirmed: true }), deps)));
    expect(answers.filter((a) => a.ok && a.kind === "booked")).toHaveLength(1);
    expect(google.eventCalls()).toHaveLength(1);
  });

  test("someone rejected since the dialog opened is told nothing: no row, no event, no audit", async () => {
    const google = fakeGoogle({ busy: free });
    const deps = { calendar: calendarOf(google), now };
    must(await db().from("applications").update({ stage: "rejected" }).eq("id", APP));
    for (const request of [book(), book({ confirmed: true })]) {
      expect(await runScheduleRequest(admin.db, admin.ctx, request, deps)).toMatchObject({ ok: false, code: "stale" });
    }
    expect(google.calls).toEqual([]);
    expect(await row(NEW_ID)).toBeNull();
    expect(await audit(ADMIN)).toEqual([]);
  });

  test("a job that closed since, or a record merged away, is the same", async () => {
    const google = fakeGoogle({ busy: free });
    const deps = { calendar: calendarOf(google), now };
    must(await db().from("roles").update({ status: "closed" }).eq("id", DESIGNER));
    const closed = await runScheduleRequest(admin.db, admin.ctx, book({ applicationId: DESIGN_APP, step: null, confirmed: true }), deps);
    expect(closed).toMatchObject({ ok: false, code: "stale", message: expect.stringContaining("no longer open") });
    expect(google.eventCalls()).toEqual([]);
  });

  test("what the audit row keeps of a booking: no address, no token", async () => {
    const google = fakeGoogle({ busy: free });
    await runScheduleRequest(admin.db, admin.ctx, book({ confirmed: true }), { calendar: calendarOf(google), now });
    const kept = JSON.stringify(await audit(ADMIN));
    expect(kept).toContain("interview.schedule");
    for (const secret of ["pat@sw.test", "Pat@sw.test", "ivy@sw.test", "rt-ada", "at-ada"]) expect(kept).not.toContain(secret);
  });

  test("the same step of the same candidate again is refused in the Calendar's words", async () => {
    const google = fakeGoogle({ busy: free });
    const answer = await runScheduleRequest(admin.db, admin.ctx, book({ step: "Onsite", confirmed: true }), { calendar: calendarOf(google), now });
    expect(answer).toMatchObject({ ok: false, code: "invalid" });
    expect(answer).toMatchObject({ message: expect.stringContaining("on the Calendar") });
    expect(google.eventCalls()).toEqual([]);
  });

  test("someone busy: nothing written until it is pressed on with", async () => {
    const google = fakeGoogle({ busy: { "at-ada": { "ada@sw.test": [["2031-03-05T15:30:00Z", "2031-03-05T16:30:00Z"]], "ivy@sw.test": [] } } });
    const deps = { calendar: calendarOf(google), now };
    expect(await runScheduleRequest(admin.db, admin.ctx, book({ confirmed: true }), deps)).toMatchObject({ ok: true, kind: "conflicts", conflicts: { busy: [{ userId: ADMIN }] } });
    expect(await row(NEW_ID)).toBeNull();
    expect(await audit(ADMIN)).toEqual([]);
    expect(await runScheduleRequest(admin.db, admin.ctx, book({ confirmed: true, bookDespiteConflicts: true }), deps)).toMatchObject({ ok: true, kind: "booked" });
  });

  test("Google refusing leaves no interview, and the step can be booked again", async () => {
    const refused = fakeGoogle({ busy: free, eventStatus: 500 });
    const answer = await runScheduleRequest(admin.db, admin.ctx, book({ confirmed: true }), { calendar: calendarOf(refused), now });
    expect(answer).toMatchObject({ ok: false, code: "forbidden", message: expect.stringContaining("Nothing was scheduled") });
    expect(await row(NEW_ID)).toBeNull();
    expect(await finished(ADMIN)).toEqual([]);
    const google = fakeGoogle({ busy: free });
    expect(await runScheduleRequest(admin.db, admin.ctx, book({ confirmed: true }), { calendar: calendarOf(google), now })).toMatchObject({ ok: true, kind: "booked" });
  });

  test("the deployment with no Google app records it and says nobody was invited", async () => {
    const answer = await runScheduleRequest(admin.db, admin.ctx, book({ confirmed: true }), { calendar: null, now });
    expect(answer).toMatchObject({ ok: true, kind: "booked", calendar: { status: "not_sent", reason: "not_set_up" } });
    expect(await row(NEW_ID)).toMatchObject({ google_event_id: null, calendar_actor_id: null });
  });

  test("a connector the admin set read-only does not stop the web app", async () => {
    must(await db().from("orgs").update({ connector_access: "read_only" }).eq("id", ACME));
    const google = fakeGoogle({ busy: free });
    expect(await runScheduleRequest(admin.db, admin.ctx, book({ confirmed: true }), { calendar: calendarOf(google), now })).toMatchObject({ ok: true, kind: "booked" });
  });

  test("Tacit's record only never touches Google", async () => {
    const google = fakeGoogle({ busy: free });
    const answer = await runScheduleRequest(admin.db, admin.ctx, book({ confirmed: true, recordOnly: true }), { calendar: calendarOf(google), now });
    expect(answer).toMatchObject({ ok: true, kind: "booked", calendar: { status: "not_sent", reason: "not_asked" } });
    expect(google.calls).toEqual([]);
  });
});

describe("moving and cancelling", () => {
  test("a move follows to the event with the holder's grant, not the member's", async () => {
    const google = fakeGoogle({ busy: { "at-hana": { "ivy@sw.test": [] } } });
    const answer = await runScheduleRequest(admin.db, admin.ctx, move({ confirmed: true }), { calendar: calendarOf(google), now });
    expect(answer).toEqual({ ok: true, kind: "changed", op: "move", calendar: "moved" });
    expect(Date.parse((await row(ONSITE))!.starts_at)).toBe(Date.parse("2031-03-06T15:00:00Z"));
    const [patch] = google.eventCalls();
    expect(patch).toMatchObject({ method: "PATCH", token: "at-hana" });
    expect(patch!.url).toContain(ONSITE.replace(/-/g, ""));
    expect(await finished(ADMIN)).toMatchObject([{ action: "interview.update", source: "dashboard" }]);
  });

  test("Google refusing a move puts the row back", async () => {
    const google = fakeGoogle({ busy: { "at-hana": { "ivy@sw.test": [] } }, eventStatus: 500 });
    const answer = await runScheduleRequest(admin.db, admin.ctx, move({ confirmed: true }), { calendar: calendarOf(google), now });
    expect(answer).toMatchObject({ ok: false, code: "forbidden", message: expect.stringContaining("Nothing was changed") });
    expect(Date.parse((await row(ONSITE))!.starts_at)).toBe(Date.parse("2031-03-04T15:00:00Z"));
  });

  test("a cancel deletes the event, and the Calendar stops showing it", async () => {
    const google = fakeGoogle();
    const answer = await runScheduleRequest(admin.db, admin.ctx, cancel({ confirmed: true }), { calendar: calendarOf(google), now });
    expect(answer).toEqual({ ok: true, kind: "changed", op: "cancel", calendar: "cancelled" });
    expect(await row(ONSITE)).toMatchObject({ status: "cancelled" });
    expect(google.eventCalls()).toMatchObject([{ method: "DELETE", token: "at-hana" }]);
    const { items } = await readSchedule(admin.db, admin.ctx, { from: "2031-03-01T00:00:00Z", to: "2031-03-10T00:00:00Z" }, NOW);
    expect(items.map((i) => i.interviewId)).toEqual([]);
  });

  test("someone else moved it since the page was read: the event stays where they put it", async () => {
    const google = fakeGoogle({ busy: free });
    const deps = { calendar: calendarOf(google), now };
    must(await db().from("interviews").update({ starts_at: "2031-03-04T17:00:00Z", ends_at: "2031-03-04T18:00:00Z" }).eq("id", ONSITE));
    const answer = await runScheduleRequest(admin.db, admin.ctx, move({ confirmed: true, was: "2031-03-04T15:00:00Z" }), deps);
    expect(answer).toMatchObject({ ok: false, code: "stale" });
    expect(await row(ONSITE)).toMatchObject({ starts_at: expect.stringContaining("2031-03-04T17:00") });
    expect(google.eventCalls()).toEqual([]);
  });

  test("the confirmation says whether the candidate has anyone to hear from", async () => {
    const google = fakeGoogle({ busy: free });
    const deps = { calendar: calendarOf(google), now };
    const withAddress = await runScheduleRequest(admin.db, admin.ctx, cancel(), deps);
    expect(withAddress).toMatchObject({ ok: true, preview: { calendar: { status: "would_follow", candidateEmail: "pat@sw.test" } } });
    must(await db().from("interviews").update({ application_id: DESIGN_APP }).eq("id", ONSITE));
    const without = await runScheduleRequest(admin.db, admin.ctx, cancel(), deps);
    expect(without).toMatchObject({ ok: true, preview: { calendar: { status: "would_follow", candidateEmail: null } } });
  });

  test("a second cancel is told it is already cancelled, and Google is not called again", async () => {
    const google = fakeGoogle();
    const deps = { calendar: calendarOf(google), now };
    await runScheduleRequest(admin.db, admin.ctx, cancel({ confirmed: true }), deps);
    expect(await runScheduleRequest(admin.db, admin.ctx, cancel({ confirmed: true }), deps)).toMatchObject({ ok: false, code: "stale" });
    expect(await runScheduleRequest(admin.db, admin.ctx, move({ confirmed: true }), deps)).toMatchObject({ ok: false, code: "stale" });
    expect(google.eventCalls()).toHaveLength(1);
  });

  test("the holder gone: the dry run says whose it is; record only leaves the event and says so", async () => {
    must(await db().from("calendar_connections").delete().eq("actor_id", HANA));
    const google = fakeGoogle();
    const deps = { calendar: calendarOf(google), now };
    expect(await runScheduleRequest(admin.db, admin.ctx, cancel(), deps)).toMatchObject({
      ok: true, kind: "change_preview", preview: { calendar: { status: "blocked", reason: "not_connected", organizer: { userId: HANA, name: "Hana Holder" }, yours: false } },
    });
    expect(await runScheduleRequest(admin.db, admin.ctx, cancel({ confirmed: true }), deps)).toMatchObject({ ok: false, code: "forbidden", message: expect.stringContaining("Hana Holder") });
    expect(await row(ONSITE)).toMatchObject({ status: "scheduled" });
    expect(await runScheduleRequest(admin.db, admin.ctx, cancel({ confirmed: true, recordOnly: true }), deps)).toEqual({ ok: true, kind: "changed", op: "cancel", calendar: "left_alone" });
    expect(await row(ONSITE)).toMatchObject({ status: "cancelled" });
    expect(google.eventCalls()).toEqual([]);
  });
});

describe("who may", () => {
  const every = (id = ONSITE) => [
    book({ confirmed: true, interviewId: NEW_ID }), move({ confirmed: true, interviewId: id }), cancel({ confirmed: true, interviewId: id }),
    book(), move({ interviewId: id }), cancel({ interviewId: id }),
  ];

  test("an interviewer changes nothing, even on their own interview, and no event is touched", async () => {
    const google = fakeGoogle({ busy: free });
    for (const request of every()) {
      expect(await runScheduleRequest(ivy.db, ivy.ctx, request, { calendar: calendarOf(google), now })).toMatchObject({ ok: false });
    }
    expect(await runScheduleRequest(ivy.db, ivy.ctx, { op: "find", interviewerIds: [IVY], durationMinutes: 60, windowStart: "2031-03-04T00:00:00Z", windowEnd: "2031-03-10T00:00:00Z", timezone: "UTC", applicationId: APP }, { calendar: calendarOf(google), now })).toMatchObject({ ok: false, code: "forbidden" });
    expect(google.eventCalls()).toEqual([]);
    expect(await row(ONSITE)).toMatchObject({ status: "scheduled" });
    expect(await row(NEW_ID)).toBeNull();
    expect(await finished(IVY)).toEqual([]);
  });

  test("a hiring manager schedules on their job and not another", async () => {
    const google = fakeGoogle({ busy: { "at-ada": { "ada@sw.test": [], "lee@sw.test": [] } } });
    const deps = { calendar: calendarOf(google), now };
    expect(await runScheduleRequest(lead.db, lead.ctx, book({ confirmed: true, applicationId: DESIGN_APP, step: null, interviewerIds: [ADMIN] }), deps)).toMatchObject({ ok: false });
    expect(await row(NEW_ID)).toBeNull();
    expect(await runScheduleRequest(lead.db, lead.ctx, book({ confirmed: true, interviewerIds: [ADMIN] }), deps)).toMatchObject({ ok: true, kind: "booked", calendar: { organizer: { userId: ADMIN } } });
  });

  test("another company's admin reads nothing and changes nothing, and no Acme grant is asked for", async () => {
    const google = fakeGoogle({ busy: free });
    const asked: string[][] = [];
    const calendar = calendarOf(google);
    const watched = { ...calendar, connections: async (org: string, ids: string[]) => (asked.push([org, ...ids]), calendar.connections(org, ids)) };
    for (const request of every()) {
      expect(await runScheduleRequest(gus.db, gus.ctx, request, { calendar: watched, now })).toMatchObject({ ok: false });
    }
    expect(asked.flat()).not.toContain(HANA);
    expect(asked.flat()).not.toContain(ACME);
    expect(google.eventCalls()).toEqual([]);
    expect(await row(ONSITE)).toMatchObject({ status: "scheduled" });
  });

  test("a member cannot name another company's interviewer", async () => {
    const google = fakeGoogle({ busy: free });
    expect(await runScheduleRequest(admin.db, admin.ctx, book({ confirmed: true, interviewerIds: [GUS] }), { calendar: calendarOf(google), now })).toMatchObject({ ok: false, code: "not_found" });
    expect(await row(NEW_ID)).toBeNull();
  });
});

describe("Find a time", () => {
  test("around the interviewers' busy times, with whoever could not be read named", async () => {
    const google = fakeGoogle({ busy: { "at-ada": { "ada@sw.test": [["2031-03-05T14:00:00Z", "2031-03-05T15:00:00Z"]] } } });
    const answer = await runScheduleRequest(admin.db, admin.ctx, {
      op: "find", interviewerIds: [ADMIN, IVY], durationMinutes: 60, windowStart: "2031-03-05T00:00:00Z", windowEnd: "2031-03-06T00:00:00Z", timezone: "UTC", applicationId: APP,
    }, { calendar: calendarOf(google), now });
    if (!answer.ok || answer.kind !== "times") throw new Error("expected times");
    expect(answer.found.checked).toEqual(["Ada Admin"]);
    expect(answer.found.unknown.map((u) => u.name)).toEqual(["Ivy Interviewer"]);
    const starts = answer.found.slots.map((s) => s.startsAt);
    expect(starts).toContain("2031-03-05T09:00:00.000Z");
    expect(starts).not.toContain("2031-03-05T14:00:00.000Z");
    expect(google.eventCalls()).toEqual([]);
  });

  test("a member who schedules on no job reads nobody's times, and no grant is read for them", async () => {
    const google = fakeGoogle({ busy: free });
    const asked: string[][] = [];
    const real = calendarOf(google);
    const calendar = { ...real, connections: (org: string, ids: string[]) => (asked.push(ids), real.connections(org, ids)) };
    const hana = { db: client("user_sw_hana", ACME_WORKOS), ctx: who(HANA, ACME, "elevated") };
    const answer = await runScheduleRequest(hana.db, hana.ctx, {
      op: "find", interviewerIds: [ADMIN], durationMinutes: 60, windowStart: "2031-03-05T00:00:00Z", windowEnd: "2031-03-06T00:00:00Z", timezone: "UTC", applicationId: APP,
    }, { calendar, now });
    expect(answer).toMatchObject({ ok: false });
    expect(asked).toEqual([]);
    expect(google.calls).toEqual([]);
  });

  test("no calendars at all is a sentence, not a failure", async () => {
    const answer = await runScheduleRequest(admin.db, admin.ctx, {
      op: "find", interviewerIds: [ADMIN], durationMinutes: 60, windowStart: "2031-03-05T00:00:00Z", windowEnd: "2031-03-06T00:00:00Z", timezone: "UTC", applicationId: APP,
    }, { calendar: null, now });
    expect(answer).toMatchObject({ ok: false, code: "forbidden", message: expect.stringContaining("not set up") });
  });
});

describe("the dialogs' choices and the Calendar's own marks", () => {
  test("an admin chooses from everyone in process, with each job's plan", async () => {
    const choices = await readBookingChoices(admin.db, admin.ctx);
    expect(choices.applications.map((a) => [a.candidate, a.jobTitle, a.steps]).sort()).toEqual([
      ["Dee Signer", "Designer", []],
      ["Pat Lee", "Founding Engineer", ["Screen", "Onsite"]],
    ]);
    expect(choices.interviewers.map((p) => p.name)).toEqual(["Ada Admin", "Hana Holder", "Ivy Interviewer", "Lee Lead"]);
  });

  test("a hiring manager only their own job; an interviewer nothing", async () => {
    expect((await readBookingChoices(lead.db, lead.ctx)).applications.map((a) => a.candidate)).toEqual(["Pat Lee"]);
    expect(await readBookingChoices(ivy.db, ivy.ctx)).toMatchObject({ applications: [], interviewers: [] });
  });

  test("someone closed, or on a job that closed, is not offered", async () => {
    must(await db().from("applications").update({ stage: "rejected" }).eq("id", APP));
    must(await db().from("roles").update({ status: "closed" }).eq("id", DESIGNER));
    expect((await readBookingChoices(admin.db, admin.ctx)).applications).toEqual([]);
  });

  test("schedulableRoles asks what a write asks", async () => {
    expect(await schedulableRoles(admin.db, [ENGINEER, DESIGNER])).toEqual(new Set([ENGINEER, DESIGNER]));
    expect(await schedulableRoles(lead.db, [ENGINEER, DESIGNER])).toEqual(new Set([ENGINEER]));
    expect(await schedulableRoles(ivy.db, [ENGINEER])).toEqual(new Set());
  });

  test("the Calendar's read carries what the card needs", async () => {
    const { items } = await readSchedule(admin.db, admin.ctx, { from: "2031-03-01T00:00:00Z", to: "2031-03-10T00:00:00Z" }, NOW);
    expect(items).toMatchObject([{ interviewId: ONSITE, applicationId: APP, status: "scheduled", interviewerIds: [IVY], eventLink: null }]);
  });
});
