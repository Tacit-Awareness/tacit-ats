import { expect, test } from "vitest";
import { days, hireBars, loadBars, offerBars, parseInsightRange, pipelineBars, postRows, rejectionBars, sourceBars } from "./insights-rules";

test("the range is 30 or 90 days", () => {
  expect(parseInsightRange("90")).toBe("90");
  expect(parseInsightRange(undefined)).toBe("30");
  expect(parseInsightRange("7")).toBe("30");
});

test("pipeline bars: how far each got, with the share that went on from the stage before", () => {
  const stages = [
    { stage: "sourced", now: 3, reached: 100, conversionToNext: 0.5, avgDaysInStage: null, stays: 0 },
    { stage: "screening", now: 2, reached: 50, conversionToNext: 0.4, avgDaysInStage: null, stays: 0 },
    { stage: "interviewing", now: 1, reached: 20, conversionToNext: null, avgDaysInStage: null, stays: 0 },
    { stage: "rejected", now: 9, reached: null, conversionToNext: null, avgDaysInStage: null, stays: 0 },
  ];
  expect(pipelineBars({ stages }).map((b) => [b.value, b.note])).toEqual([
    [100, undefined],
    [50, "50%"],
    [20, "40%"],
  ]);
});

test("sources, hires, load, offers and rejections become bars", () => {
  expect(sourceBars({ sources: [{ source: "job_board", applications: 7, active: 5, hired: 1, rejected: 1, withdrawn: 0, hireRate: 0.1 }] })).toEqual([{ name: "Job board", value: 7, note: "1 hired" }]);
  expect(hireBars({ jobs: [{ jobId: "a", title: "A", openedAt: "", firstHireAt: "", days: 12.4 }, { jobId: "b", title: "B", openedAt: "", firstHireAt: "", days: 30 }] }).map((b) => b.name)).toEqual(["B", "A"]);
  expect(loadBars({ interviewers: [{ userId: "u", name: null, interviews: 3, feedbackFiled: 2, onTime: 2, late: 0, notFiled: 1, notVisible: 0, medianHoursToFeedback: null }] })).toEqual([{ name: "Someone", value: 3, note: "2 filed" }]);
  expect(offerBars({ byStatus: { draft: 1, extended: 2, accepted: 3, declined: 0, withdrawn: 0 } }).map((b) => b.value)).toEqual([1, 2, 3, 0, 0]);
  expect(rejectionBars({ reasons: [{ kind: "rejected", reason: null, applications: 2 }, { kind: "rejected", reason: "Experience", applications: 5 }] }).map((b) => b.name)).toEqual(["Experience", "No reason given"]);
});

test("job posts: views and form applications per job, most applied first", () => {
  const rows = postRows(
    {
      views: [{ day: "2026-11-01", roleId: "a", views: 10 }, { day: "2026-11-02", roleId: "a", views: 5 }, { day: "2026-11-01", roleId: "b", views: 3 }],
      apps: [
        { createdAt: "", roleId: "b", group: "careers", channel: "linkedin" },
        { createdAt: "", roleId: "b", group: "careers", channel: "direct" },
        { createdAt: "", roleId: "a", group: "referral", channel: null },
      ],
    } as never,
    { a: "Alpha", b: "Beta" },
  );
  expect(rows).toEqual([
    { roleId: "b", title: "Beta", views: 3, applied: 2 },
    { roleId: "a", title: "Alpha", views: 15, applied: 0 },
  ]);
});

test("days", () => {
  expect(days(12.6)).toBe("13d");
  expect(days(null)).toBe("None yet");
});
