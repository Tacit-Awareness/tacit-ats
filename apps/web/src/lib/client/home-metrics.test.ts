import { describe, expect, test } from "vitest";

import {
  ageBuckets,
  bins,
  bottlenecks,
  feedbackSummary,
  fmtHours,
  median,
  parsePeriod,
  periodCount,
  stageRows,
  waitingSince,
  workload,
  type FeedbackRow,
  type Waiting,
} from "./home-metrics";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const H = 3_600_000;
const at = (offsetH: number) => new Date(NOW + offsetH * H).toISOString();
const daysAgo = (d: number) => at(-d * 24);

describe("the period", () => {
  test("is 7, 30 or 90 days; anything else is 7", () => {
    expect(parsePeriod("30")).toBe(30);
    expect(parsePeriod("90")).toBe(90);
    for (const raw of [undefined, "", "14", "abc", "-7"]) expect(parsePeriod(raw)).toBe(7);
  });

  test("counts this period against the one before, and says the change", () => {
    const created = [daysAgo(1), daysAgo(3), daysAgo(6.9), daysAgo(8), daysAgo(13), daysAgo(20)];
    expect(periodCount(created, 7, NOW)).toEqual({ current: 3, previous: 2, change: 0.5 });
    expect(periodCount([daysAgo(1)], 7, NOW)).toEqual({ current: 1, previous: 0, change: null });
    expect(periodCount([], 7, NOW).change).toBeNull();
  });
});

describe("applications per bin", () => {
  test("a day each for a week, oldest first", () => {
    const b = bins([daysAgo(0.5), daysAgo(0.6), daysAgo(6.5), daysAgo(8)], 7, NOW);
    expect(b).toHaveLength(7);
    expect(b[0]).toEqual({ fromDaysAgo: 7, toDaysAgo: 6, n: 1 });
    expect(b[6]).toEqual({ fromDaysAgo: 1, toDaysAgo: 0, n: 2 });
    expect(b.reduce((n, x) => n + x.n, 0)).toBe(3);
  });

  test("a week each past that, the oldest cut short", () => {
    const b = bins([daysAgo(29), daysAgo(2)], 30, NOW);
    expect(b).toHaveLength(5);
    expect(b[0]).toEqual({ fromDaysAgo: 30, toDaysAgo: 28, n: 1 });
    expect(b[4]).toEqual({ fromDaysAgo: 7, toDaysAgo: 0, n: 1 });
    expect(bins([], 90, NOW)).toHaveLength(13);
  });
});

describe("how long someone has waited", () => {
  const base = { stage: "screening", column: "screening" as const, addedAt: daysAgo(10), interviews: [] };

  test("since the last move into the stage they are in", () => {
    const moves = [
      { toStage: "screening", at: daysAgo(8) },
      { toStage: "contacted", at: daysAgo(6) },
      { toStage: "screening", at: daysAgo(2) },
    ];
    expect(waitingSince(base, moves, NOW)).toBe(daysAgo(2));
  });

  test("since they were added when no move says otherwise", () => {
    expect(waitingSince(base, [{ toStage: "contacted", at: daysAgo(3) }], NOW)).toBe(daysAgo(10));
  });

  test("on the team's call, since the last interview ended", () => {
    const e = {
      stage: "interviewing",
      column: "decide" as const,
      addedAt: daysAgo(10),
      interviews: [
        { startsAt: at(-50), endsAt: at(-49), status: "done" },
        { startsAt: at(-6), endsAt: at(-5), status: "scheduled" },
        { startsAt: at(-3), endsAt: at(-2), status: "cancelled" },
      ],
    };
    expect(waitingSince(e, [{ toStage: "interviewing", at: daysAgo(5) }], NOW)).toBe(at(-5));
  });
});

const w = (column: Waiting["column"], hours: number, extra: Partial<Waiting> = {}): Waiting => ({
  applicationId: `${column}-${hours}`,
  personId: `p-${hours}`,
  roleId: "r",
  roleTitle: "Role",
  personName: `P ${hours}`,
  column,
  hours,
  stalled: false,
  lastTouchAt: at(-hours),
  ...extra,
});

describe("time in stage", () => {
  test("every column, its people longest first, the segments, typical and longest", () => {
    const rows = stageRows([w("new", 2), w("new", 30), w("new", 100), w("decide", 50)]);
    expect(rows.map((r) => r.key)).toEqual(["new", "screening", "scheduling", "booked", "decide", "offer"]);
    const fresh = rows[0];
    expect(fresh.people.map((p) => p.hours)).toEqual([100, 30, 2]);
    expect(fresh.segments).toEqual([1, 1, 1]);
    expect(fresh.medianHours).toBe(30);
    expect(fresh.longestHours).toBe(100);
    expect(rows[1]).toMatchObject({ people: [], segments: [0, 0, 0], medianHours: null, longestHours: null });
  });

  test("age buckets", () => {
    expect(ageBuckets([1, 23, 24, 50, 80, 200]).map((b) => b.n)).toEqual([2, 1, 1, 1, 1]);
  });

  test("median takes the lower middle", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2);
  });
});

describe("bottlenecks", () => {
  test("only what is waiting, oldest first, feedback (undated) after the dated ones", () => {
    const rows = bottlenecks([w("new", 5), w("scheduling", 80), w("scheduling", 10), w("booked", 300, { stalled: true, lastTouchAt: at(-24) })], 3, NOW);
    expect(rows).toEqual([
      { key: "schedule", n: 2, oldestHours: 80 },
      { key: "stalled", n: 1, oldestHours: 24 },
      { key: "review", n: 1, oldestHours: 5 },
      { key: "feedback", n: 3, oldestHours: null },
    ]);
  });

  test("nothing waiting is no rows; hidden feedback is no row", () => {
    expect(bottlenecks([w("booked", 5), w("offer", 9)], null, NOW)).toEqual([]);
  });
});

describe("interview workload", () => {
  test("held in the period and booked ahead, in interviewer hours", () => {
    const load = workload(
      [
        { startsAt: at(-48), endsAt: at(-47), interviewerIds: ["a", "b"] },
        { startsAt: at(24), endsAt: at(24.5), interviewerIds: ["a"] },
        // outside both windows
        { startsAt: at(-24 * 8), endsAt: at(-24 * 8 + 1), interviewerIds: ["a"] },
        { startsAt: at(24 * 8), endsAt: at(24 * 8 + 1), interviewerIds: ["b"] },
      ],
      7,
      NOW,
    );
    expect(load).toMatchObject({ interviews: 2, held: 1, booked: 1, hours: 2.5 });
    expect(load.byInterviewer).toEqual([
      { id: "a", hours: 1.5, interviews: 2 },
      { id: "b", hours: 1, interviews: 1 },
    ]);
  });
});

describe("interviewer feedback", () => {
  const row = (userId: string, r: Partial<FeedbackRow>): FeedbackRow => ({
    userId, name: userId, interviews: 0, feedbackFiled: 0, onTime: 0, late: 0, notFiled: 0, medianHoursToFeedback: null, ...r,
  });

  test("on-time share over what was filed, outstanding, slowest first", () => {
    const s = feedbackSummary([
      row("quick", { interviews: 3, feedbackFiled: 3, onTime: 3, medianHoursToFeedback: 2 }),
      row("slow", { interviews: 2, feedbackFiled: 1, late: 1, notFiled: 1, medianHoursToFeedback: 40 }),
      row("owes", { interviews: 2, notFiled: 2 }),
      row("hidden", { interviews: 1 }),
    ]);
    expect(s).toMatchObject({ filed: 4, onTime: 3, onTimeShare: 0.75, outstanding: 3 });
    expect(s.interviewers.map((r) => r.userId)).toEqual(["slow", "quick", "owes"]);
    expect(feedbackSummary([]).onTimeShare).toBeNull();
  });
});

test("hours read like design/tats", () => {
  expect(fmtHours(0.2)).toBe("12m");
  expect(fmtHours(5.4)).toBe("5h");
  expect(fmtHours(60)).toBe("2.5d");
  expect(fmtHours(72)).toBe("3d");
});
