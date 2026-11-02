import { describe, expect, test } from "vitest";

import { fakeGoogle } from "../test-helpers/fake-google.js";
import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { findInterviewTimes, wallClock, zonedInstant } from "./calendar.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";

const ctx = (accessLevel: ClientToolCtx["accessLevel"] = "admin"): ClientToolCtx => ({
  actorId: "actor-1", orgId: "org-1", accessLevel, source: "claude",
});

async function refusal(promise: Promise<unknown>): Promise<ClientToolError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ClientToolError);
  return err as ClientToolError;
}

// Monday 19 October 2026, 8am in New York.
const NOW = new Date("2026-10-19T12:00:00Z");
const TEAM = [
  { id: "actor-2", display_name: "Alice", email: "alice@co.test" },
  { id: "actor-3", display_name: "Bob", email: "bob@co.test" },
];
const base = {
  interviewerIds: ["actor-2", "actor-3"], windowStart: "2026-10-19T00:00:00-04:00", windowEnd: "2026-10-21T00:00:00-04:00",
  timezone: "America/New_York",
};
type ProfileRow = { actor_id: string; weekly_interview_cap: number | null; away_until: string | null };
type BookedRow = { starts_at: string; interviewer_actor_ids: string[] };
/** The interviewers, their details, then the profiles and interviews their limits are read from. */
const members = (profiles: ProfileRow[] = [], booked: BookedRow[] = []) =>
  new FakeSupabase([{ data: TEAM.map(({ id }) => ({ id })) }, { data: TEAM }, { data: profiles }, { data: booked }]);

describe("wall-clock time in a zone", () => {
  test("9am is 13:00Z in summer time and 14:00Z once New York falls back", () => {
    expect(new Date(zonedInstant(2026, 10, 31, 9, 0, "America/New_York")).toISOString()).toBe("2026-10-31T13:00:00.000Z");
    expect(new Date(zonedInstant(2026, 11, 2, 9, 0, "America/New_York")).toISOString()).toBe("2026-11-02T14:00:00.000Z");
    expect(wallClock(Date.parse("2026-10-24T15:00:00Z"), "Europe/London")).toMatchObject({ hour: 16, weekday: 6 });
  });
});

describe("findInterviewTimes", () => {
  test("slots inside working hours where every readable calendar is free, a few per day, earliest first", async () => {
    const google = fakeGoogle({
      busy: {
        // The caller's grant reads Alice's calendar (same Workspace); Bob's own grant reads his.
        "at-me": { "alice@co.test": [["2026-10-19T13:00:00Z", "2026-10-19T15:00:00Z"]] },
        "at-bob": { "bob@gmail.test": [["2026-10-20T13:00:00Z", "2026-10-20T19:00:00Z"]] },
      },
    });
    const calendar = google.calendarWith({
      "actor-1": { accountEmail: "me@co.test", refreshToken: "rt-me" },
      "actor-3": { accountEmail: "bob@gmail.test", refreshToken: "rt-bob" },
    });
    const found = await findInterviewTimes(members().asDb(), ctx(), calendar, { ...base, maxResults: 4 }, NOW);
    expect(found.slots.map((s) => s.startsAt)).toEqual([
      "2026-10-19T15:00:00.000Z", "2026-10-19T15:30:00.000Z", "2026-10-20T19:00:00.000Z", "2026-10-20T19:30:00.000Z",
    ]);
    expect(found.slots[0]).toMatchObject({ endsAt: "2026-10-19T16:00:00.000Z" });
    expect(found.slots[0].local).toMatch(/11:00/);
    expect(found.checked).toEqual(expect.arrayContaining([
      { userId: "actor-3", name: "Bob", via: "their_calendar" },
      { userId: "actor-2", name: "Alice", via: "your_calendar" },
    ]));
    expect(found.unknown).toEqual([]);
    // Only busy times were asked for: no event was read or written.
    expect(google.eventCalls()).toEqual([]);
  });

  test("the last slot of a day ends at the close of the working day, and weekends are skipped", async () => {
    const google = fakeGoogle({ busy: { "at-me": { "alice@co.test": [], "bob@co.test": [] } } });
    const calendar = google.calendarWith({ "actor-1": { accountEmail: "me@co.test", refreshToken: "rt-me" } });
    const found = await findInterviewTimes(members().asDb(), ctx(), calendar, {
      ...base, windowStart: "2026-10-23T16:00:00-04:00", windowEnd: "2026-10-26T10:00:00-04:00", maxResults: 25,
    }, NOW);
    // Friday 16:00 and 16:30 can still hold 30 minutes; nothing on Saturday or Sunday; Monday from 9 until the window ends at 10.
    expect(found.slots.map((s) => s.startsAt)).toEqual([
      "2026-10-23T20:00:00.000Z", "2026-10-26T13:00:00.000Z",
    ]);
    const short = await findInterviewTimes(members().asDb(), ctx(), calendar, {
      ...base, windowStart: "2026-10-23T16:00:00-04:00", windowEnd: "2026-10-26T10:00:00-04:00", durationMinutes: 30, maxResults: 25,
    }, NOW);
    expect(short.slots.map((s) => s.startsAt)).toEqual([
      "2026-10-23T20:00:00.000Z", "2026-10-23T20:30:00.000Z", "2026-10-26T13:00:00.000Z", "2026-10-26T13:30:00.000Z",
    ]);
  });

  test("a calendar that cannot be read is listed as unknown, not taken as free or busy", async () => {
    const google = fakeGoogle({ busy: { "at-me": { "alice@co.test": [] } } });
    const calendar = google.calendarWith({ "actor-1": { accountEmail: "me@co.test", refreshToken: "rt-me" } });
    const found = await findInterviewTimes(members().asDb(), ctx(), calendar, base, NOW);
    expect(found.unknown).toEqual([{ userId: "actor-3", name: "Bob", reason: "not_shared" }]);
    expect(found.slots.length).toBe(10);
  });

  test("nobody readable is a sentence that says who must connect", async () => {
    const google = fakeGoogle();
    const err = await refusal(findInterviewTimes(members().asDb(), ctx(), google.calendarWith({}), base, NOW));
    expect(err.message).toMatch(/No interviewer's calendar could be read: Alice has not connected/);
    expect(err.message).toMatch(/Your calendar is not connected. Connect it at https:\/\/app.test\/client\/calendar/);
  });

  test("an expired connection of the interviewer's own is reported as such", async () => {
    const google = fakeGoogle({ expired: ["rt-bob"], busy: { "at-me": { "alice@co.test": [] } } });
    const calendar = google.calendarWith({
      "actor-1": { accountEmail: "me@co.test", refreshToken: "rt-me" },
      "actor-3": { accountEmail: "bob@gmail.test", refreshToken: "rt-bob" },
    });
    const found = await findInterviewTimes(members().asDb(), ctx(), calendar, base, NOW);
    expect(found.unknown).toEqual([{ userId: "actor-3", name: "Bob", reason: "connection_expired" }]);
  });

  test("refusals before any read: an interviewer, a long window, a bad zone, no calendar set up", async () => {
    const fake = new FakeSupabase();
    const calendar = fakeGoogle().calendarWith({});
    expect((await refusal(findInterviewTimes(fake.asDb(), ctx("limited"), calendar, base, NOW))).code).toBe("forbidden");
    expect((await refusal(findInterviewTimes(fake.asDb(), ctx(), calendar, { ...base, windowEnd: "2026-11-19T00:00:00Z" }, NOW))).message)
      .toMatch(/at most 14 days/);
    expect((await refusal(findInterviewTimes(fake.asDb(), ctx(), calendar, { ...base, timezone: "Mars/Olympus" }, NOW))).message)
      .toMatch(/not a time zone/);
    expect((await refusal(findInterviewTimes(fake.asDb(), ctx(), calendar, { ...base, windowStart: "2026-10-20T09:00:00" }, NOW))).message)
      .toMatch(/with its offset/);
    expect((await refusal(findInterviewTimes(fake.asDb(), ctx(), null, base, NOW))).message).toMatch(/not set up/);
    expect(fake.calls).toEqual([]);
  });

  test("with an application, the caller must be able to schedule on its job", async () => {
    const fake = new FakeSupabase([
      { data: TEAM.map(({ id }) => ({ id })) }, { data: { id: "app-1", role_id: "role-1" } }, { data: false },
    ]);
    const err = await refusal(findInterviewTimes(fake.asDb(), ctx("elevated"), fakeGoogle().calendarWith({}), { ...base, applicationId: "app-1" }, NOW));
    expect(err.code).toBe("forbidden");
  });
});

describe("findInterviewTimes and the interviewers' own limits", () => {
  const google = () => fakeGoogle({ busy: { "at-me": { "alice@co.test": [], "bob@co.test": [] } } });
  const calendarOf = (g: ReturnType<typeof fakeGoogle>) => g.calendarWith({ "actor-1": { accountEmail: "me@co.test", refreshToken: "rt-me" } });

  test("no day an interviewer is away, through their last day; a date gone by is no limit", async () => {
    const fake = members([
      { actor_id: "actor-2", weekly_interview_cap: null, away_until: "2026-10-19" },
      { actor_id: "actor-3", weekly_interview_cap: null, away_until: "2026-10-01" },
    ]);
    const found = await findInterviewTimes(fake.asDb(), ctx(), calendarOf(google()), { ...base, maxResults: 25 }, NOW);
    expect(found.slots.length).toBeGreaterThan(0);
    expect(found.slots.every((s) => s.startsAt.startsWith("2026-10-20"))).toBe(true);
    expect(found.limited).toEqual([{ userId: "actor-2", name: "Alice", awayThrough: "2026-10-19", fullWeeks: [] }]);
  });

  test("no time in a week an interviewer already has their cap of interviews in", async () => {
    const fake = members(
      [{ actor_id: "actor-3", weekly_interview_cap: 2, away_until: null }],
      [
        { starts_at: "2026-10-19T15:00:00Z", interviewer_actor_ids: ["actor-3", "actor-9"] },
        { starts_at: "2026-10-22T15:00:00Z", interviewer_actor_ids: ["actor-3"] },
        // Next week's one is under the cap there.
        { starts_at: "2026-10-27T15:00:00Z", interviewer_actor_ids: ["actor-3"] },
      ],
    );
    const found = await findInterviewTimes(fake.asDb(), ctx(), calendarOf(google()), {
      ...base, windowStart: "2026-10-23T09:00:00-04:00", windowEnd: "2026-10-27T00:00:00-04:00", maxResults: 25,
    }, NOW);
    // Friday is in the full week; Monday the 26th starts the next.
    expect(found.slots.length).toBeGreaterThan(0);
    expect(found.slots.every((s) => s.startsAt.startsWith("2026-10-26"))).toBe(true);
    expect(found.limited).toEqual([{ userId: "actor-3", name: "Bob", awayThrough: null, fullWeeks: [{ weekOf: "2026-10-19", booked: 2, cap: 2 }] }]);

    // Read on the caller's token: their interviews, not cancelled, from the Monday of the window's first week to the one after its last.
    const read = fake.calls.find((c) => c.table === "interviews")!;
    expect(read.filters).toEqual(expect.arrayContaining([
      { method: "overlaps", column: "interviewer_actor_ids", value: ["actor-2", "actor-3"] },
      { method: "neq", column: "status", value: "cancelled" },
      { method: "gte", column: "starts_at", value: "2026-10-19T00:00:00.000Z" },
      { method: "lt", column: "starts_at", value: "2026-11-02T00:00:00.000Z" },
    ]));
  });

  test("a cap of 0 is no interviews at all; no profile the caller may read is no limit", async () => {
    const none = await findInterviewTimes(members([{ actor_id: "actor-2", weekly_interview_cap: 0, away_until: null }]).asDb(), ctx(), calendarOf(google()), base, NOW);
    expect(none.slots).toEqual([]);
    expect(none.limited).toEqual([{ userId: "actor-2", name: "Alice", awayThrough: null, fullWeeks: [{ weekOf: "2026-10-19", booked: 0, cap: 0 }] }]);
    const open = await findInterviewTimes(members().asDb(), ctx(), calendarOf(google()), base, NOW);
    expect(open.slots.length).toBe(10);
    expect(open.limited).toEqual([]);
  });
});
