import { describe, expect, test } from "vitest";
import { parseScheduleRequest, sameOrigin } from "./schedule-requests";

const ID = "d1a00000-0000-4000-8000-0000000000e1";
const OTHER = "d1a00000-0000-4000-8000-0000000000e2";
const AT = "2030-01-07T15:00:00Z";
const TO = "2030-01-07T16:00:00-05:00";

const book = (over: Record<string, unknown> = {}) => ({
  op: "book", confirmed: true, interviewId: ID, applicationId: OTHER, startsAt: AT, endsAt: TO, interviewerIds: [ID], timezone: "America/New_York", ...over,
});
const move = (over: Record<string, unknown> = {}) => ({ op: "move", confirmed: true, interviewId: ID, startsAt: AT, endsAt: TO, timezone: "UTC", ...over });
const cancel = (over: Record<string, unknown> = {}) => ({ op: "cancel", confirmed: true, interviewId: ID, timezone: "UTC", ...over });
const find = (over: Record<string, unknown> = {}) => ({ op: "find", interviewerIds: [ID], durationMinutes: 60, windowStart: AT, windowEnd: TO, timezone: "UTC", ...over });

const confirmedOf = (body: unknown) => {
  const parsed = parseScheduleRequest(body);
  if (!parsed.ok) throw new Error("expected a request");
  return (parsed.request as { confirmed?: boolean }).confirmed;
};

describe("what confirms a write", () => {
  test("only `true` itself: anything else, or nothing, is a dry run", () => {
    expect(confirmedOf(cancel())).toBe(true);
    for (const value of [undefined, false, "true", 1, {}, [], null]) {
      expect(confirmedOf(cancel({ confirmed: value }))).toBe(false);
      expect(confirmedOf(book({ confirmed: value }))).toBe(false);
      expect(confirmedOf(move({ confirmed: value }))).toBe(false);
    }
  });

  test("the same goes for booking through a clash, and for leaving the calendar out", () => {
    const parsed = parseScheduleRequest(book({ bookDespiteConflicts: "yes", recordOnly: 1 }));
    expect(parsed).toMatchObject({ ok: true, request: { bookDespiteConflicts: false, recordOnly: false } });
  });
});

describe("parseScheduleRequest", () => {
  test("reads each kind of request, and nothing it does not know", () => {
    expect(parseScheduleRequest({ ...cancel(), org_id: "another", actorId: OTHER })).toEqual({
      ok: true, request: { op: "cancel", confirmed: true, interviewId: ID, timezone: "UTC", recordOnly: false },
    });
    expect(parseScheduleRequest(move())).toMatchObject({ ok: true, request: { op: "move", startsAt: AT, endsAt: TO } });
    expect(parseScheduleRequest(find())).toMatchObject({ ok: true, request: { op: "find", applicationId: null, durationMinutes: 60 } });
    expect(parseScheduleRequest(book({ step: "  ", locationOrLink: " Room 2 " }))).toMatchObject({ ok: true, request: { step: null, locationOrLink: "Room 2" } });
  });

  test("a repeated interviewer counts once", () => {
    expect(parseScheduleRequest(find({ interviewerIds: [ID, ID, OTHER] }))).toMatchObject({ ok: true, request: { interviewerIds: [ID, OTHER] } });
  });

  test.each([
    ["not an object", null],
    ["a list", []],
    ["a string", "cancel"],
    ["no op", { timezone: "UTC", interviewId: ID }],
    ["an op it does not have", cancel({ op: "delete" })],
    ["no zone", cancel({ timezone: undefined })],
    ["a blank zone", cancel({ timezone: "  " })],
    ["a zone as a number", cancel({ timezone: 5 })],
    ["an id that is not one", cancel({ interviewId: "1 or 1=1" })],
    ["a move to no time", move({ startsAt: undefined })],
    ["a time with no offset", move({ startsAt: "2030-01-07T15:00:00" })],
    ["a time that is not one", move({ startsAt: "2030-13-45T99:00:00Z" })],
    ["a time as a number", move({ startsAt: 1893 })],
    ["nobody interviewing", book({ interviewerIds: [] })],
    ["interviewers not a list", book({ interviewerIds: ID })],
    ["an interviewer that is no id", book({ interviewerIds: [ID, "x"] })],
    ["eleven interviewers", book({ interviewerIds: Array.from({ length: 11 }, (_, i) => `d1a00000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`) })],
    ["a step that is not text", book({ step: 5 })],
    ["a location past any limit", book({ locationOrLink: "x".repeat(2001) })],
    ["a length with a fraction", find({ durationMinutes: 1.5 })],
    ["a length as text", find({ durationMinutes: "60" })],
    ["an application that is no id", find({ applicationId: "x" })],
  ])("refuses %s", (_, body) => {
    expect(parseScheduleRequest(body)).toEqual({ ok: false });
  });
});

describe("sameOrigin", () => {
  const headers = (h: Record<string, string>) => new Headers(h);

  test("this site, to this host", () => {
    expect(sameOrigin(headers({ origin: "https://ats.test", host: "ats.test" }))).toBe(true);
    expect(sameOrigin(headers({ origin: "http://localhost:3100", host: "localhost:3100" }))).toBe(true);
  });

  test("behind a proxy, the host the browser asked for", () => {
    expect(sameOrigin(headers({ origin: "https://ats.test", host: "vercel.internal", "x-forwarded-host": "ats.test" }))).toBe(true);
  });

  test("another site, or none named, is refused", () => {
    expect(sameOrigin(headers({ origin: "https://evil.test", host: "ats.test" }))).toBe(false);
    expect(sameOrigin(headers({ origin: "https://ats.test.evil.test", host: "ats.test" }))).toBe(false);
    expect(sameOrigin(headers({ origin: "null", host: "ats.test" }))).toBe(false);
    expect(sameOrigin(headers({ host: "ats.test" }))).toBe(false);
    expect(sameOrigin(headers({ origin: "https://ats.test" }))).toBe(false);
  });
});
