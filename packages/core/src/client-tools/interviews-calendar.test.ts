import { describe, expect, test } from "vitest";

import { fakeGoogle } from "../test-helpers/fake-google.js";
import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { scheduleInterview, updateInterview } from "./interviews.js";

/** Booking on a calendar: schedule_interview and update_interview with a ClientCalendar. */

const ctx: ClientToolCtx = { actorId: "actor-1", orgId: "org-1", accessLevel: "admin", source: "claude" };
const NOW = new Date("2026-10-19T12:00:00Z");
const now = () => NOW;

async function refusal(promise: Promise<unknown>): Promise<ClientToolError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ClientToolError);
  return err as ClientToolError;
}

const ME = { accountEmail: "me@co.test", refreshToken: "rt-me" };
const ALICE = { accountEmail: "alice@co.test", refreshToken: "rt-alice" };
const base = {
  applicationId: "app-1", startsAt: "2026-10-21T15:00:00-04:00", endsAt: "2026-10-21T16:00:00-04:00",
  interviewerIds: ["actor-1", "actor-2"], timezone: "America/New_York",
};
const PEOPLE = [
  { id: "actor-1", display_name: "Me", email: "me@co.test" },
  { id: "actor-2", display_name: "Alice", email: "Alice@co.test" },
];
const before = (...more: Array<{ data?: unknown; error?: unknown }>) => new FakeSupabase([
  { data: { id: "app-1", role_id: "role-1" } }, { data: true }, { data: [{ id: "actor-1" }, { id: "actor-2" }] }, { data: PEOPLE },
  ...more,
]);
const APP = { data: { person_id: "p-1", people: { display_name: "Pat Lee" }, roles: { title: "Engineer" } } };

describe("scheduleInterview on a calendar", () => {
  test("books on the caller's calendar: the row names it, the event invites the others and has a Meet link", async () => {
    const google = fakeGoogle({ busy: { "at-me": { "me@co.test": [], "alice@co.test": [] } } });
    const fake = before(APP, { data: "audit-1" }, { data: null }, { data: null }, { data: null });
    const r = await scheduleInterview(fake.asDb(), ctx, { ...base, step: undefined }, {
      calendar: google.calendarWith({ "actor-1": ME }), mailer: null, now,
    });
    if (r.outcome !== "scheduled") throw new Error("expected scheduled");
    expect(r.calendar).toMatchObject({
      status: "invited", organizer: { userId: "actor-1", name: "Me" },
      meetLink: "https://meet.google.com/abc-defg-hij", invited: [{ userId: "actor-2", name: "Alice" }], notInvited: [],
    });
    expect(fake.calls.find((c) => c.op === "insert")?.args).toMatchObject({ id: r.interviewId, calendar_actor_id: "actor-1" });
    const [created] = google.eventCalls();
    expect(created).toMatchObject({ method: "POST", token: "at-me" });
    expect(created.url).toContain("/calendars/primary/events?sendUpdates=all&conferenceDataVersion=1");
    expect(created.body).toMatchObject({
      id: r.interviewId.replace(/-/g, ""),
      summary: "Interview: Pat Lee for Engineer",
      attendees: [{ email: "alice@co.test" }],
      start: { dateTime: "2026-10-21T19:00:00.000Z", timeZone: "America/New_York" },
    });
    // The candidate is on nothing Google sends.
    expect(JSON.stringify(created.body)).not.toMatch(/p-1/);
    const linked = fake.calls.find((c) => c.op === "update");
    expect(linked?.args).toMatchObject({ google_event_id: r.interviewId.replace(/-/g, ""), location_or_link: "https://meet.google.com/abc-defg-hij" });
    expect(r.noDraftBecause).toMatch(/turned off/);
  });

  test("an interviewer's calendar holds the event when the caller is not interviewing: they organize it", async () => {
    const people = [PEOPLE[1], { id: "actor-3", display_name: "Bob", email: "bob@co.test" }];
    const google = fakeGoogle({ busy: { "at-alice": { "alice@co.test": [] }, "at-me": { "bob@co.test": [] } } });
    const fake = new FakeSupabase([
      { data: { id: "app-1", role_id: "role-1" } }, { data: true }, { data: [{ id: "actor-2" }, { id: "actor-3" }] }, { data: people },
      APP, { data: "audit-1" }, { data: null }, { data: null }, { data: null },
    ]);
    const r = await scheduleInterview(fake.asDb(), ctx, { ...base, interviewerIds: ["actor-3", "actor-2"] }, {
      calendar: google.calendarWith({ "actor-1": ME, "actor-2": ALICE }), mailer: null, now,
    });
    if (r.outcome !== "scheduled") throw new Error("expected scheduled");
    expect(r.calendar).toMatchObject({
      status: "invited", organizer: { userId: "actor-2", name: "Alice" }, invited: [{ userId: "actor-3", name: "Bob" }], notInvited: [],
    });
    expect(fake.calls.find((c) => c.op === "insert")?.args).toMatchObject({ calendar_actor_id: "actor-2" });
    const [created] = google.eventCalls();
    expect(created).toMatchObject({ method: "POST", token: "at-alice", body: { attendees: [{ email: "bob@co.test" }] } });
  });

  test("an interviewing caller holds the event when connected; when not, a connected interviewer does", async () => {
    const both = fakeGoogle({ busy: { "at-me": { "me@co.test": [] }, "at-alice": { "alice@co.test": [] } } });
    await scheduleInterview(before(APP, { data: "audit-1" }, { data: null }, { data: null }, { data: null }).asDb(), ctx, base, {
      calendar: both.calendarWith({ "actor-1": ME, "actor-2": ALICE }), now,
    });
    expect(both.eventCalls()[0]).toMatchObject({ token: "at-me", body: { attendees: [{ email: "alice@co.test" }] } });

    const aliceOnly = fakeGoogle({ busy: { "at-alice": { "alice@co.test": [] } } });
    const fake = before(APP, { data: "audit-1" }, { data: null }, { data: null }, { data: null });
    const r = await scheduleInterview(fake.asDb(), ctx, base, { calendar: aliceOnly.calendarWith({ "actor-2": ALICE }), now });
    expect(r).toMatchObject({
      outcome: "scheduled", conflicts: { unknown: [{ userId: "actor-1", reason: "not_connected" }] },
      calendar: { status: "invited", organizer: { userId: "actor-2" }, invited: [{ userId: "actor-1", name: "Me" }] },
    });
    expect(fake.calls.find((c) => c.op === "insert")?.args).toMatchObject({ calendar_actor_id: "actor-2" });
    expect(aliceOnly.eventCalls()[0]).toMatchObject({ token: "at-alice", body: { attendees: [{ email: "me@co.test" }] } });
  });

  test("the candidate gets a draft with the time in the zone given and the Meet link, never an invite", async () => {
    const google = fakeGoogle({ busy: { "at-me": { "me@co.test": [], "alice@co.test": [] } } });
    const fake = before(
      APP, { data: "audit-1" }, { data: null }, { data: null }, { data: null },
      // draftEmail: the person, can_edit_person, the application, addresses on file, the sender, the claim, the insert, the finish.
      { data: { id: "p-1", display_name: "Pat Lee", email: "pat@example.com" } }, { data: true },
      { data: { id: "app-1", person_id: "p-1", roles: { title: "Engineer" } } }, { data: [] },
      { data: { display_name: "Me Member", email: "me@co.test" } }, { data: { name: "Acme" } },
      { data: "audit-2" }, { data: null }, { data: null },
    );
    const r = await scheduleInterview(fake.asDb(), ctx, { ...base, step: undefined }, {
      calendar: google.calendarWith({ "actor-1": ME }), mailer: { send: null, fromAddress: "hiring@tacit.test" }, now,
    });
    if (r.outcome !== "scheduled") throw new Error("expected scheduled");
    expect(r.noDraftBecause).toBeNull();
    expect(r.candidateDraft).toMatchObject({ to: "pat@example.com", subject: "Your interview for Engineer" });
    expect(r.candidateDraft?.body).toMatch(/When: Wed, Oct 21, 3:00\sPM EDT \(60 minutes\)/);
    expect(r.candidateDraft?.body).toMatch(/Where: https:\/\/meet.google.com\/abc-defg-hij/);
    expect(r.candidateDraft?.body).toMatch(/With: Me, Alice/);
    expect(google.calls.some((c) => c.method === "POST" && c.url.includes("/send"))).toBe(false);
  });

  test("a place instead of Meet goes on the event as its location", async () => {
    const google = fakeGoogle({ busy: { "at-me": { "me@co.test": [], "alice@co.test": [] } } });
    const fake = before(APP, { data: "audit-1" }, { data: null }, { data: null }, { data: null });
    await scheduleInterview(fake.asDb(), ctx, { ...base, locationOrLink: "Office, room 4" }, { calendar: google.calendarWith({ "actor-1": ME }), now });
    expect(google.eventCalls()[0].body).toMatchObject({ location: "Office, room 4" });
    expect(google.eventCalls()[0].body).not.toHaveProperty("conferenceData");
    expect(fake.calls.find((c) => c.op === "update")?.args).not.toHaveProperty("location_or_link");
  });

  test("an interviewer busy then: conflicts, and nothing is written or claimed", async () => {
    const google = fakeGoogle({ busy: { "at-me": { "me@co.test": [], "alice@co.test": [["2026-10-21T19:30:00Z", "2026-10-21T20:30:00Z"]] } } });
    const fake = before();
    const r = await scheduleInterview(fake.asDb(), ctx, base, { calendar: google.calendarWith({ "actor-1": ME }), now });
    expect(r).toMatchObject({ outcome: "conflicts", interviewId: null, conflicts: { busy: [{ userId: "actor-2", name: "Alice" }] } });
    expect(fake.calls.map((c) => c.table)).not.toContain("client_claim_write");
    expect(google.eventCalls()).toEqual([]);
  });

  test("book_despite_conflicts books anyway and reports who is busy", async () => {
    const google = fakeGoogle({ busy: { "at-me": { "me@co.test": [], "alice@co.test": [["2026-10-21T19:30:00Z", "2026-10-21T20:30:00Z"]] } } });
    const fake = before(APP, { data: "audit-1" }, { data: null }, { data: null }, { data: null });
    const r = await scheduleInterview(fake.asDb(), ctx, { ...base, bookDespiteConflicts: true }, { calendar: google.calendarWith({ "actor-1": ME }), now });
    expect(r).toMatchObject({ outcome: "scheduled", conflicts: { busy: [{ userId: "actor-2" }] }, calendar: { status: "invited" } });
  });

  test("not connected: recorded in Tacit only, saying where to connect; send_invites true refuses instead", async () => {
    const google = fakeGoogle();
    const fake = before({ data: "audit-1" }, { data: null }, { data: null });
    const r = await scheduleInterview(fake.asDb(), ctx, base, { calendar: google.calendarWith({}), now });
    expect(r).toMatchObject({
      outcome: "scheduled", calendar: { status: "not_sent", reason: "not_connected", connectUrl: "https://app.test/client/calendar" },
    });
    expect(fake.calls.find((c) => c.op === "insert")?.args).not.toHaveProperty("calendar_actor_id");

    const strict = before();
    const err = await refusal(scheduleInterview(strict.asDb(), ctx, { ...base, sendInvites: true }, { calendar: google.calendarWith({}), now }));
    expect(err.message).toMatch(/Neither your calendar nor any interviewer's is connected. Connect it at https:\/\/app.test\/client\/calendar/);
    expect(strict.calls.map((c) => c.table)).not.toContain("client_claim_write");
  });

  test("an expired connection is refused, not quietly recorded without invites", async () => {
    const google = fakeGoogle({ expired: ["rt-me"] });
    const err = await refusal(scheduleInterview(before().asDb(), ctx, base, { calendar: google.calendarWith({ "actor-1": ME }), now }));
    expect(err.message).toMatch(/connection has expired/);
  });

  test("send_invites true with no calendar set up refuses before any read", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(scheduleInterview(fake.asDb(), ctx, { ...base, sendInvites: true }))).message).toMatch(/not set up/);
    expect(fake.calls).toEqual([]);
  });

  test("Google refuses: the row is removed and the claim given back", async () => {
    const google = fakeGoogle({ eventStatus: 500, busy: { "at-me": { "me@co.test": [], "alice@co.test": [] } } });
    const fake = before(APP, { data: "audit-1" }, { data: null }, { data: null }, { data: null });
    const err = await refusal(scheduleInterview(fake.asDb(), ctx, base, { calendar: google.calendarWith({ "actor-1": ME }), now }));
    expect(err.message).toMatch(/Google Calendar refused the change. Nothing was scheduled./);
    expect(fake.calls.find((c) => c.op === "delete")?.table).toBe("interviews");
    expect(fake.calls.at(-1)?.args).toMatchObject({ p_keep: false });
  });

  test("an interview in the past is recorded without invites or a draft; asking to invite to one is refused", async () => {
    const google = fakeGoogle();
    const pastTimes = { startsAt: "2026-10-18T15:00:00Z", endsAt: "2026-10-18T16:00:00Z" };
    const fake = new FakeSupabase([
      { data: { id: "app-1", role_id: "role-1" } }, { data: true }, { data: [{ id: "actor-1" }, { id: "actor-2" }] },
      { data: "audit-1" }, { data: null }, { data: null },
    ]);
    const r = await scheduleInterview(fake.asDb(), ctx, { ...base, ...pastTimes }, {
      calendar: google.calendarWith({ "actor-1": ME }), mailer: { send: null, fromAddress: "hiring@tacit.test" }, now,
    });
    expect(r).toMatchObject({ outcome: "scheduled", calendar: { status: "not_sent", reason: "in_the_past" }, candidateDraft: null });
    expect(google.calls).toEqual([]);

    const err = await refusal(scheduleInterview(new FakeSupabase().asDb(), ctx, { ...base, ...pastTimes, sendInvites: true }, {
      calendar: google.calendarWith({ "actor-1": ME }), now,
    }));
    expect(err.message).toMatch(/in the past, so there is nobody to invite/);
  });
});

describe("updateInterview on a calendar", () => {
  const booked = {
    id: "int-1", application_id: "app-1", starts_at: "2026-10-21T19:00:00+00:00", ends_at: "2026-10-21T20:00:00+00:00",
    status: "scheduled", step: "Onsite", interviewer_actor_ids: ["actor-2"], location_or_link: "https://meet.google.com/x",
    google_event_id: "evt1", calendar_actor_id: "actor-9",
  };
  const HOLDER = { accountEmail: "hana@co.test", refreshToken: "rt-hana" };
  const people = [{ id: "actor-9", display_name: "Hana", email: "hana@co.test" }, { id: "actor-2", display_name: "Alice", email: "alice@co.test" }];
  const loaded = (...more: Array<{ data?: unknown; error?: unknown }>) =>
    new FakeSupabase([{ data: booked }, { data: "role-1" }, { data: true }, ...more]);

  test("cancelling deletes the event with the grant of whoever booked it", async () => {
    const google = fakeGoogle();
    const fake = loaded({ data: people }, { data: "audit-1" }, { data: [{ id: "int-1" }] }, { data: null });
    const r = await updateInterview(fake.asDb(), ctx, { interviewId: "int-1", status: "cancelled" }, {
      calendar: google.calendarWith({ "actor-9": HOLDER }), now,
    });
    expect(r).toMatchObject({ outcome: "updated", changed: ["status"], calendar: "cancelled" });
    expect(google.eventCalls()).toMatchObject([{ method: "DELETE", token: "at-hana" }]);
    expect(google.eventCalls()[0].url).toContain("/events/evt1?sendUpdates=all");
  });

  test("the holder's calendar no longer connected: refused naming them, unless update_calendar is false", async () => {
    const google = fakeGoogle();
    const err = await refusal(updateInterview(loaded({ data: people }).asDb(), ctx, { interviewId: "int-1", status: "cancelled" }, {
      calendar: google.calendarWith({}), now,
    }));
    expect(err.message).toMatch(/on Hana's calendar, which is not connected now/);

    const fake = loaded({ data: "audit-1" }, { data: [{ id: "int-1" }] }, { data: null });
    const r = await updateInterview(fake.asDb(), ctx, { interviewId: "int-1", status: "cancelled", updateCalendar: false }, {
      calendar: google.calendarWith({}), now,
    });
    expect(r).toMatchObject({ outcome: "updated", calendar: "left_alone" });
    expect(google.eventCalls()).toEqual([]);
  });

  test("moving checks the interviewers at the new time, ignoring the interview itself, then moves the event", async () => {
    const google = fakeGoogle({
      busy: { "at-hana": { "alice@co.test": [["2026-10-21T19:00:00Z", "2026-10-21T20:00:00Z"]] } },
    });
    const fake = loaded({ data: people }, { data: "audit-1" }, { data: [{ id: "int-1" }] }, { data: null });
    const r = await updateInterview(fake.asDb(), ctx, {
      interviewId: "int-1", startsAt: "2026-10-21T19:30:00Z", endsAt: "2026-10-21T20:30:00Z",
    }, { calendar: google.calendarWith({ "actor-9": HOLDER }), now });
    expect(r).toMatchObject({ outcome: "updated", calendar: "moved", conflicts: { busy: [] } });
    expect(google.eventCalls()).toMatchObject([{ method: "PATCH", token: "at-hana", body: { start: { dateTime: "2026-10-21T19:30:00.000Z" } } }]);
  });

  test("a clash at the new time is reported and nothing changes", async () => {
    const google = fakeGoogle({ busy: { "at-hana": { "alice@co.test": [["2026-10-22T19:00:00Z", "2026-10-22T21:00:00Z"]] } } });
    const fake = loaded({ data: people });
    const r = await updateInterview(fake.asDb(), ctx, {
      interviewId: "int-1", startsAt: "2026-10-22T19:00:00Z", endsAt: "2026-10-22T20:00:00Z",
    }, { calendar: google.calendarWith({ "actor-9": HOLDER }), now });
    expect(r).toMatchObject({ outcome: "conflicts", conflicts: { busy: [{ userId: "actor-2", name: "Alice" }] } });
    expect(fake.calls.map((c) => c.table)).not.toContain("client_claim_write");
  });

  test("new interviewers are set on the event, the holder left off", async () => {
    const google = fakeGoogle();
    const more = [...people, { id: "actor-3", display_name: "Bo", email: "bo@co.test" }];
    const fake = loaded({ data: [{ id: "actor-2" }, { id: "actor-3" }] }, { data: more }, { data: "audit-1" }, { data: [{ id: "int-1" }] }, { data: null });
    const r = await updateInterview(fake.asDb(), ctx, { interviewId: "int-1", interviewerIds: ["actor-2", "actor-3"] }, {
      calendar: google.calendarWith({ "actor-9": HOLDER, "actor-3": { accountEmail: "bo@gmail.test", refreshToken: "rt-bo" } }), now,
    });
    expect(r).toMatchObject({ calendar: "updated", changed: ["interviewer_actor_ids"] });
    expect(google.eventCalls()).toMatchObject([{ method: "PATCH", body: { attendees: [{ email: "alice@co.test" }, { email: "bo@gmail.test" }] } }]);
  });

  test("Google refuses the move: the row is put back and the claim given back", async () => {
    const google = fakeGoogle({ eventStatus: 403, busy: { "at-hana": { "alice@co.test": [] } } });
    const fake = loaded({ data: people }, { data: "audit-1" }, { data: [{ id: "int-1" }] }, { data: null }, { data: null });
    const err = await refusal(updateInterview(fake.asDb(), ctx, {
      interviewId: "int-1", startsAt: "2026-10-21T19:30:00Z", endsAt: "2026-10-21T20:30:00Z",
    }, { calendar: google.calendarWith({ "actor-9": HOLDER }), now }));
    expect(err.message).toMatch(/does not allow calendar changes/);
    const updates = fake.calls.filter((c) => c.op === "update");
    expect(updates[1].args).toMatchObject({ starts_at: booked.starts_at, ends_at: booked.ends_at });
    expect(fake.calls.at(-1)?.args).toMatchObject({ p_keep: false });
  });

  test("marking it done leaves the event alone", async () => {
    const google = fakeGoogle();
    const fake = loaded({ data: "audit-1" }, { data: [{ id: "int-1" }] }, { data: null });
    const r = await updateInterview(fake.asDb(), ctx, { interviewId: "int-1", status: "done" }, { calendar: google.calendarWith({}), now });
    expect(r).toMatchObject({ outcome: "updated", calendar: "none" });
    expect(google.calls).toEqual([]);
  });
});
