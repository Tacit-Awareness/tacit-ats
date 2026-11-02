import { describe, expect, test } from "vitest";

import { awayOn, fullIn, limitText, weekStart, weeksOf, type InterviewerLimits } from "./interviewer-limits.js";

describe("interviewer limits", () => {
  test("a week is Monday to Sunday in UTC", () => {
    expect(new Date(weekStart(Date.parse("2026-10-25T23:59:00Z"))).toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(new Date(weekStart(Date.parse("2026-10-26T00:00:00Z"))).toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(weeksOf(Date.parse("2026-10-23T13:00:00Z"), Date.parse("2026-11-02T00:00:00Z"))).toEqual(["2026-10-19", "2026-10-26"]);
  });

  test("away through the last day inclusive; full at the cap, not under it", () => {
    const limits: InterviewerLimits = {
      profiles: new Map([
        ["a", { weeklyCap: null, awayUntil: "2026-10-20" }],
        ["b", { weeklyCap: 2, awayUntil: null }],
      ]),
      booked: new Map([["b", new Map([["2026-10-19", 2], ["2026-10-26", 1]])]]),
    };
    expect(awayOn(limits, "2026-10-20")).toEqual(["a"]);
    expect(awayOn(limits, "2026-10-21")).toEqual([]);
    expect(fullIn(limits, Date.parse("2026-10-23T15:00:00Z"))).toEqual(["b"]);
    expect(fullIn(limits, Date.parse("2026-10-27T15:00:00Z"))).toEqual([]);
  });

  test("the reason in words", () => {
    expect(limitText({ awayThrough: "2026-11-14", fullWeeks: [{ weekOf: "2026-11-16", booked: 3, cap: 3 }] }))
      .toBe("away through Nov 14; has 3 of 3 interviews the week of Nov 16");
    expect(limitText({ awayThrough: null, fullWeeks: [{ weekOf: "2026-11-16", booked: 0, cap: 0 }] })).toBe("takes no interviews the week of Nov 16");
  });
});
