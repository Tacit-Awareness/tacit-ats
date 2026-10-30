import { describe, expect, test } from "vitest";
import {
  daysOf,
  departmentTones,
  groupByDay,
  hourSpan,
  parseYmd,
  placeDay,
  readWindow,
  stepAnchor,
  todayIn,
  toneFor,
  weekStart,
  zoned,
} from "./schedule-layout";

const ev = (id: string, startsAt: string, endsAt: string) => ({ id, startsAt, endsAt });
const brief = (placed: ReturnType<typeof placeDay<ReturnType<typeof ev>>>) => placed.map((p) => [p.event.id, p.start, p.end, p.lane, p.lanes]);

describe("days and views", () => {
  test("a date in the URL is taken only when it is a real one", () => {
    expect(parseYmd("2026-10-29")).toBe("2026-10-29");
    expect(parseYmd("2026-02-30")).toBeNull();
    expect(parseYmd("2026-10-29T00:00")).toBeNull();
    expect(parseYmd("")).toBeNull();
    expect(parseYmd(undefined)).toBeNull();
  });

  test("a week runs Sunday to Saturday; the list is the anchor's month", () => {
    expect(weekStart("2026-10-29")).toBe("2026-10-25");
    expect(daysOf("week", "2026-10-29")).toEqual(["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
    expect(daysOf("day", "2026-10-29")).toEqual(["2026-10-29"]);
    const feb = daysOf("list", "2028-02-14");
    expect([feb[0], feb.at(-1), feb.length]).toEqual(["2028-02-01", "2028-02-29", 29]);
  });

  test("← and → move a day, a week, or a month (clamped to the month's last day)", () => {
    expect(stepAnchor("day", "2026-12-31", 1)).toBe("2027-01-01");
    expect(stepAnchor("week", "2026-10-29", -1)).toBe("2026-10-22");
    expect(stepAnchor("list", "2026-01-31", 1)).toBe("2026-02-28");
    expect(stepAnchor("list", "2026-01-15", -1)).toBe("2025-12-15");
  });

  test("the read window covers the view's days in every zone", () => {
    expect(readWindow("week", "2026-10-29", new Date("2026-10-29T12:00:00Z"))).toEqual({
      from: "2026-10-24T10:00:00.000Z", // Sunday 25th's midnight at UTC+14
      to: "2026-11-01T12:00:00.000Z", // Sunday 1st's midnight at UTC-12
    });
  });

  test("with no date, the window covers the member's today a day either side of the server's", () => {
    // Saturday 23:30 UTC is already Sunday in Tokyo, the start of the next week there.
    const w = readWindow("week", null, new Date("2026-10-31T23:30:00Z"));
    expect(w.from <= "2026-10-24T15:00:00.000Z").toBe(true); // Los Angeles's week, from its Sunday
    expect(w.to >= "2026-11-07T15:00:00.000Z").toBe(true); // through Tokyo's next Saturday
  });
});

describe("time zones", () => {
  test("an instant reads as the member's wall clock, not UTC", () => {
    const iso = "2026-10-29T13:30:00Z";
    expect(zoned(iso, "UTC")).toEqual({ day: "2026-10-29", minutes: 13 * 60 + 30 });
    expect(zoned(iso, "America/New_York")).toEqual({ day: "2026-10-29", minutes: 9 * 60 + 30 });
    expect(zoned(iso, "Asia/Kolkata")).toEqual({ day: "2026-10-29", minutes: 19 * 60 });
    expect(zoned("2026-10-29T23:30:00Z", "Asia/Tokyo")).toEqual({ day: "2026-10-30", minutes: 8 * 60 + 30 });
    expect(todayIn("Pacific/Kiritimati", Date.parse("2026-10-29T11:00:00Z"))).toBe("2026-10-30");
  });

  test("the same interview sits on a different day and hour by zone", () => {
    const e = [ev("a", "2026-10-29T23:00:00Z", "2026-10-30T00:00:00Z")];
    expect(brief(placeDay(e, "2026-10-29", "America/Los_Angeles"))).toEqual([["a", 16 * 60, 17 * 60, 0, 1]]);
    expect(placeDay(e, "2026-10-29", "Europe/Berlin")).toEqual([]);
    expect(brief(placeDay(e, "2026-10-30", "Europe/Berlin"))).toEqual([["a", 0, 60, 0, 1]]);
  });

  test("across a daylight-saving change the clock time stays right", () => {
    // New York leaves daylight time on 1 November 2026: 10:00 is 14:00Z the day before, 15:00Z the day after.
    expect(zoned("2026-10-31T14:00:00Z", "America/New_York").minutes).toBe(10 * 60);
    expect(zoned("2026-11-02T15:00:00Z", "America/New_York").minutes).toBe(10 * 60);
  });

  test("an interview across midnight is clipped to each day it touches", () => {
    const e = [ev("late", "2026-10-29T22:30:00Z", "2026-10-30T01:00:00Z")];
    expect(placeDay(e, "2026-10-29", "UTC").map((p) => [p.start, p.end, p.startsBefore, p.endsAfter])).toEqual([[22 * 60 + 30, 24 * 60, false, true]]);
    expect(placeDay(e, "2026-10-30", "UTC").map((p) => [p.start, p.end, p.startsBefore, p.endsAfter])).toEqual([[0, 60, true, false]]);
    // Ending exactly at midnight does not put it on the next day.
    expect(placeDay([ev("x", "2026-10-29T23:00:00Z", "2026-10-30T00:00:00Z")], "2026-10-30", "UTC")).toEqual([]);
  });
});

describe("placing a day's interviews", () => {
  const day = "2026-10-29";
  const at = (h: number, m = 0) => `${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;

  test("apart, each takes the full width", () => {
    const placed = placeDay([ev("b", at(11), at(12)), ev("a", at(9), at(10))], day, "UTC");
    expect(brief(placed)).toEqual([["a", 540, 600, 0, 1], ["b", 660, 720, 0, 1]]);
  });

  test("back to back is not an overlap", () => {
    expect(brief(placeDay([ev("a", at(9), at(10)), ev("b", at(10), at(11))], day, "UTC"))).toEqual([["a", 540, 600, 0, 1], ["b", 600, 660, 0, 1]]);
  });

  test("overlapping ones go side by side, and a lane is reused once free", () => {
    const placed = placeDay([ev("a", at(9), at(11)), ev("b", at(9, 30), at(10)), ev("c", at(10), at(10, 30))], day, "UTC");
    expect(brief(placed)).toEqual([["a", 540, 660, 0, 2], ["b", 570, 600, 1, 2], ["c", 600, 630, 1, 2]]);
  });

  test("lanes are counted per cluster, so a clash elsewhere does not narrow the day", () => {
    const placed = placeDay([ev("a", at(9), at(10)), ev("b", at(9), at(10)), ev("c", at(9), at(10)), ev("d", at(14), at(15))], day, "UTC");
    expect(placed.map((p) => [p.event.id, p.lanes])).toEqual([["a", 3], ["b", 3], ["c", 3], ["d", 1]]);
  });

  test("the longer of two starting together takes the first lane", () => {
    expect(brief(placeDay([ev("short", at(9), at(9, 30)), ev("long", at(9), at(11))], day, "UTC"))).toEqual([["long", 540, 660, 0, 2], ["short", 540, 570, 1, 2]]);
  });

  test("a zero-length interview still counts as a short block", () => {
    const placed = placeDay([ev("a", at(9), at(9)), ev("b", at(9, 5), at(9, 30))], day, "UTC");
    expect(placed.map((p) => [p.event.id, p.lane, p.lanes])).toEqual([["a", 0, 2], ["b", 1, 2]]);
  });

  test("the grid shows the working day, widened to fit early and late interviews", () => {
    expect(hourSpan([])).toEqual({ first: 8, last: 19 });
    expect(hourSpan(placeDay([ev("a", at(7, 30), at(8, 30)), ev("b", at(20), at(21, 15))], day, "UTC"))).toEqual({ first: 7, last: 22 });
    expect(hourSpan([{ start: 23 * 60 + 50, end: 24 * 60 }])).toEqual({ first: 8, last: 24 });
  });

  test("the list groups by the day each one starts in the member's zone", () => {
    const events = [ev("b", "2026-10-30T02:00:00Z", "2026-10-30T03:00:00Z"), ev("a", "2026-10-29T15:00:00Z", "2026-10-29T16:00:00Z"), ev("out", "2026-12-01T15:00:00Z", "2026-12-01T16:00:00Z")];
    const days = daysOf("list", "2026-10-01");
    expect(groupByDay(events, days, "UTC").map((g) => [g.day, g.events.map((e) => e.id)])).toEqual([["2026-10-29", ["a"]], ["2026-10-30", ["b"]]]);
    expect(groupByDay(events, days, "America/Los_Angeles").map((g) => [g.day, g.events.map((e) => e.id)])).toEqual([["2026-10-29", ["a", "b"]]]);
  });
});

describe("department tones", () => {
  const dept = (departmentId: string, name: string, parentId: string | null = null) => ({ departmentId, name, parentId });

  test("outermost departments take the tones in name order; ones inside share their tone and name", () => {
    const tones = departmentTones([dept("p", "Platform", "e"), dept("e", "Engineering"), dept("d", "Design"), dept("s", "Sales")]);
    expect(Object.fromEntries(tones)).toEqual({
      d: { tone: "blue", name: "Design" },
      e: { tone: "mint", name: "Engineering" },
      p: { tone: "mint", name: "Engineering" },
      s: { tone: "pink", name: "Sales" },
    });
  });

  test("a parent loop does not hang", () => {
    expect(departmentTones([dept("a", "A", "b"), dept("b", "B", "a")]).size).toBe(2);
  });

  test("no department is grey; one the member cannot read still gets a steady tone", () => {
    const tones = departmentTones([dept("e", "Engineering")]);
    expect(toneFor(null, tones)).toBe("gray");
    expect(toneFor("e", tones)).toBe("blue");
    const unseen = toneFor("7f9c2b1e-0000-4000-8000-000000000001", new Map());
    expect(unseen).not.toBe("gray");
    expect(toneFor("7f9c2b1e-0000-4000-8000-000000000001", new Map())).toBe(unseen);
  });
});
