import { describe, expect, test } from "vitest";

import { fakeGoogle } from "../test-helpers/fake-google.js";
import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { scheduleInterview, updateInterview } from "./interviews.js";

/**
 * `dryRun`, which the web app's Confirm card shows: what the real call would
 * do, with nothing written. The rule each test holds: no audit claim, no row,
 * no event, whatever it says.
 */

const ctx: ClientToolCtx = { actorId: "actor-1", orgId: "org-1", accessLevel: "admin", source: "dashboard" };
const NOW = new Date("2026-10-19T12:00:00Z");
const now = () => NOW;

const ME = { accountEmail: "me@co.test", refreshToken: "rt-me" };
const base = {
  applicationId: "app-1", startsAt: "2026-10-21T15:00:00-04:00", endsAt: "2026-10-21T16:00:00-04:00",
  interviewerIds: ["actor-1", "actor-2"], timezone: "America/New_York",
};
const PEOPLE = [
  { id: "actor-1", display_name: "Me", email: "me@co.test" },
  { id: "actor-2", display_name: "Alice", email: "Alice@co.test" },
];
const APP = { data: { person_id: "p-1", people: { display_name: "Pat Lee", email: "Pat@Example.com" }, roles: { title: "Engineer" } } };
const before = (...more: Array<{ data?: unknown; error?: unknown }>) => new FakeSupabase([
  { data: { id: "app-1", role_id: "role-1" } }, { data: true }, { data: [{ id: "actor-1" }, { id: "actor-2" }] }, { data: PEOPLE },
  ...more,
]);

const wroteNothing = (fake: FakeSupabase) => {
  expect(fake.calls.filter((c) => ["insert", "update", "upsert", "delete"].includes(c.op))).toEqual([]);
  expect(fake.calls.filter((c) => c.op === "rpc" && c.table === "client_claim_write")).toEqual([]);
};

async function refusal(promise: Promise<unknown>): Promise<ClientToolError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ClientToolError);
  return err as ClientToolError;
}

describe("scheduleInterview, dry run", () => {
  test("says whose calendar and who hears from Google, and writes nothing", async () => {
    const google = fakeGoogle({ busy: { "at-me": { "me@co.test": [], "alice@co.test": [] } } });
    const fake = before(APP);
    const r = await scheduleInterview(fake.asDb(), ctx, { ...base, dryRun: true }, { calendar: google.calendarWith({ "actor-1": ME }), now });
    expect(r).toMatchObject({
      outcome: "preview",
      calendar: {
        status: "would_invite", organizer: { userId: "actor-1", name: "Me" }, candidateEmail: "pat@example.com",
        invited: [{ userId: "actor-2", name: "Alice" }], notInvited: [], meetLink: true,
      },
      conflicts: { busy: [], unknown: [] },
    });
    wroteNothing(fake);
    expect(google.eventCalls()).toEqual([]);
  });

  test("someone busy does not stop it: the card has to show them", async () => {
    const google = fakeGoogle({ busy: { "at-me": { "me@co.test": [], "alice@co.test": [["2026-10-21T19:15:00Z", "2026-10-21T19:45:00Z"]] } } });
    const fake = before(APP);
    const r = await scheduleInterview(fake.asDb(), ctx, { ...base, dryRun: true }, { calendar: google.calendarWith({ "actor-1": ME }), now });
    expect(r.outcome).toBe("preview");
    expect(r.conflicts.busy).toEqual([{ userId: "actor-2", name: "Alice" }]);
    wroteNothing(fake);
  });

  test("a place given means no Meet link", async () => {
    const google = fakeGoogle({ busy: { "at-me": { "me@co.test": [], "alice@co.test": [] } } });
    const r = await scheduleInterview(before(APP).asDb(), ctx, { ...base, locationOrLink: "Room 2", dryRun: true }, { calendar: google.calendarWith({ "actor-1": ME }), now });
    expect(r.calendar).toMatchObject({ status: "would_invite", meetLink: false });
  });

  test("nobody connected: says it would be Tacit's record only", async () => {
    const google = fakeGoogle();
    const fake = before();
    const r = await scheduleInterview(fake.asDb(), ctx, { ...base, dryRun: true }, { calendar: google.calendarWith({}), now });
    expect(r.calendar).toMatchObject({ status: "not_sent", reason: "not_connected" });
    wroteNothing(fake);
  });

  test("no calendars on this deployment: says so", async () => {
    const fake = new FakeSupabase([{ data: { id: "app-1", role_id: "role-1" } }, { data: true }, { data: [{ id: "actor-1" }, { id: "actor-2" }] }]);
    const r = await scheduleInterview(fake.asDb(), ctx, { ...base, dryRun: true }, { calendar: null, now });
    expect(r.calendar).toMatchObject({ status: "not_sent", reason: "not_set_up" });
    wroteNothing(fake);
  });

  test("an expired grant is named, where the real call refuses with a sentence with no connector parameter in it", async () => {
    const google = fakeGoogle({ expired: ["rt-me"] });
    const r = await scheduleInterview(before().asDb(), ctx, { ...base, dryRun: true }, { calendar: google.calendarWith({ "actor-1": ME }), now });
    expect(r.calendar).toMatchObject({ status: "not_sent", reason: "connection_expired" });

    const err = await refusal(scheduleInterview(before().asDb(), ctx, base, { calendar: google.calendarWith({ "actor-1": ME }), now }));
    expect(err.message).toMatch(/expired/);
    expect(err.message).not.toMatch(/send_invites/);
  });

  test("the connector's sentence still names the parameter its model can pass", async () => {
    const google = fakeGoogle({ expired: ["rt-me"] });
    const err = await refusal(scheduleInterview(before().asDb(), { ...ctx, source: "claude" }, base, { calendar: google.calendarWith({ "actor-1": ME }), now }));
    expect(err.message).toMatch(/send_invites: false/);
  });

  test("a time that has passed: recorded only, and nothing asks Google", async () => {
    const google = fakeGoogle();
    const fake = new FakeSupabase([{ data: { id: "app-1", role_id: "role-1" } }, { data: true }, { data: [{ id: "actor-1" }, { id: "actor-2" }] }]);
    const r = await scheduleInterview(fake.asDb(), ctx, { ...base, startsAt: "2026-10-01T15:00:00Z", endsAt: "2026-10-01T16:00:00Z", dryRun: true }, {
      calendar: google.calendarWith({ "actor-1": ME }), now,
    });
    expect(r.calendar).toMatchObject({ status: "not_sent", reason: "in_the_past" });
    expect(google.calls).toEqual([]);
  });
});

describe("a booking's own id", () => {
  const idle = () => fakeGoogle({ busy: { "at-me": { "me@co.test": [], "alice@co.test": [] } } });

  test("names the row and the event", async () => {
    const google = idle();
    const id = "12345678-1234-4234-8234-123456789012";
    const fake = before(APP, { data: "audit-1" }, { data: null }, { data: null }, { data: null });
    const r = await scheduleInterview(fake.asDb(), ctx, { ...base, interviewId: id }, { calendar: google.calendarWith({ "actor-1": ME }), now });
    expect(r).toMatchObject({ outcome: "scheduled", interviewId: id });
    expect(google.eventCalls()[0].body).toMatchObject({ id: id.replace(/-/g, "") });
  });

  test("a retry of one that went through books nothing and puts no second event on a calendar", async () => {
    const google = idle();
    const fake = before(APP, { data: "audit-1" }, { error: { code: "23505", message: 'duplicate key value violates unique constraint "interviews_pkey"' } }, { data: null });
    const err = await refusal(scheduleInterview(fake.asDb(), ctx, { ...base, interviewId: "12345678-1234-4234-8234-123456789012" }, { calendar: google.calendarWith({ "actor-1": ME }), now }));
    expect(err.message).toBe("This interview is already booked.");
    expect(err.field).toBe("interview_id");
    expect(google.eventCalls()).toEqual([]);
  });

  test("the same step twice still says so, in the Calendar's words here", async () => {
    const google = idle();
    const fake = new FakeSupabase([
      { data: { id: "app-1", role_id: "role-1" } }, { data: true }, { data: { interview_steps: [] } }, { data: [{ id: "actor-1" }, { id: "actor-2" }] }, { data: PEOPLE },
      APP, { data: "audit-1" }, { error: { code: "23505", message: 'duplicate key value violates unique constraint "interviews_one_active_per_step"' } }, { data: null },
    ]);
    const err = await refusal(scheduleInterview(fake.asDb(), ctx, { ...base, step: "Onsite", interviewId: "12345678-1234-4234-8234-123456789012" }, { calendar: google.calendarWith({ "actor-1": ME }), now }));
    expect(err.message).toContain("Move or cancel it on the Calendar.");
    expect(err.message).not.toContain("update_interview");
  });
});

describe("updateInterview, dry run", () => {
  const booked = {
    id: "int-1", application_id: "app-1", starts_at: "2026-10-21T19:00:00+00:00", ends_at: "2026-10-21T20:00:00+00:00",
    status: "scheduled", step: "Onsite", interviewer_actor_ids: ["actor-2"], location_or_link: "https://meet.google.com/x",
    google_event_id: "evt1", calendar_actor_id: "actor-9",
  };
  const HOLDER = { accountEmail: "hana@co.test", refreshToken: "rt-hana" };
  const people = [{ id: "actor-9", display_name: "Hana", email: "hana@co.test" }, { id: "actor-2", display_name: "Alice", email: "alice@co.test" }];
  const loaded = (row: unknown = booked, ...more: Array<{ data?: unknown; error?: unknown }>) =>
    new FakeSupabase([{ data: row }, { data: "role-1" }, { data: true }, ...more]);
  const later = { startsAt: "2026-10-22T19:00:00Z", endsAt: "2026-10-22T20:00:00Z" };

  test("a cancel says whose event goes, and nothing is written or asked of Google but the token", async () => {
    const google = fakeGoogle();
    const fake = loaded(booked, { data: people }, APP);
    const r = await updateInterview(fake.asDb(), ctx, { interviewId: "int-1", status: "cancelled", dryRun: true }, { calendar: google.calendarWith({ "actor-9": HOLDER }), now });
    expect(r).toMatchObject({ outcome: "preview", changed: ["status"], calendar: { status: "would_follow", action: "cancel", organizer: { userId: "actor-9", name: "Hana" }, candidateEmail: "pat@example.com" } });
    wroteNothing(fake);
    expect(google.eventCalls()).toEqual([]);
  });

  test("a move checks the new time and reports a clash instead of stopping", async () => {
    const google = fakeGoogle({ busy: { "at-hana": { "alice@co.test": [["2026-10-22T19:30:00Z", "2026-10-22T20:00:00Z"]] } } });
    const fake = loaded(booked, { data: people }, { data: { ...APP.data, people: { display_name: "Pat Lee", email: null } } });
    const r = await updateInterview(fake.asDb(), ctx, { interviewId: "int-1", ...later, dryRun: true }, { calendar: google.calendarWith({ "actor-9": HOLDER }), now });
    expect(r).toMatchObject({ outcome: "preview", calendar: { status: "would_follow", action: "move", candidateEmail: null }, conflicts: { busy: [{ userId: "actor-2", name: "Alice" }] } });
    wroteNothing(fake);
    expect(google.eventCalls()).toEqual([]);
  });

  test("the holder not connected: blocked, naming them, rather than a refusal", async () => {
    const google = fakeGoogle();
    const fake = loaded(booked, { data: people });
    const r = await updateInterview(fake.asDb(), ctx, { interviewId: "int-1", status: "cancelled", dryRun: true }, { calendar: google.calendarWith({}), now });
    expect(r).toMatchObject({ outcome: "preview", calendar: { status: "blocked", reason: "not_connected", organizer: { userId: "actor-9", name: "Hana" }, yours: false } });
    wroteNothing(fake);
  });

  test("the holder is the caller: blocked, and says it is theirs", async () => {
    const google = fakeGoogle();
    const mine = { ...booked, calendar_actor_id: "actor-1" };
    const r = await updateInterview(loaded(mine, { data: [{ id: "actor-1", display_name: "Me", email: "me@co.test" }, people[1]] }).asDb(), ctx, { interviewId: "int-1", status: "cancelled", dryRun: true }, { calendar: google.calendarWith({}), now });
    expect(r).toMatchObject({ calendar: { status: "blocked", yours: true } });
  });

  test("no calendars on this deployment: blocked, and the real call's sentence names no parameter", async () => {
    const r = await updateInterview(loaded().asDb(), ctx, { interviewId: "int-1", status: "cancelled", dryRun: true }, { calendar: null, now });
    expect(r).toMatchObject({ calendar: { status: "blocked", reason: "not_set_up" } });
    const err = await refusal(updateInterview(loaded().asDb(), ctx, { interviewId: "int-1", status: "cancelled" }, { calendar: null, now }));
    expect(err.message).not.toMatch(/update_calendar/);
  });

  test("Tacit's record only says the event is left, and asks Google nothing", async () => {
    const google = fakeGoogle();
    const fake = loaded();
    const r = await updateInterview(fake.asDb(), ctx, { interviewId: "int-1", status: "cancelled", updateCalendar: false, dryRun: true }, { calendar: google.calendarWith({}), now });
    expect(r).toMatchObject({ outcome: "preview", calendar: { status: "left_alone" } });
    expect(google.calls).toEqual([]);
    wroteNothing(fake);
  });

  test("no event: says only the record changes", async () => {
    const google = fakeGoogle();
    const r = await updateInterview(loaded({ ...booked, google_event_id: null }).asDb(), ctx, { interviewId: "int-1", ...later, dryRun: true }, { calendar: google.calendarWith({}), now });
    expect(r).toMatchObject({ outcome: "preview", calendar: { status: "none" } });
  });

  test("the same time: unchanged, as the real call", async () => {
    const r = await updateInterview(loaded().asDb(), ctx, { interviewId: "int-1", startsAt: booked.starts_at, endsAt: booked.ends_at, dryRun: true }, { calendar: null, now });
    expect(r).toMatchObject({ outcome: "unchanged" });
  });

  test("a move into the past is refused, dry or not", async () => {
    const google = fakeGoogle();
    const err = await refusal(updateInterview(loaded(booked, { data: people }).asDb(), ctx, { interviewId: "int-1", startsAt: "2026-10-01T19:00:00Z", endsAt: "2026-10-01T20:00:00Z", dryRun: true }, { calendar: google.calendarWith({ "actor-9": HOLDER }), now }));
    expect(err.message).toMatch(/past/);
  });
});
