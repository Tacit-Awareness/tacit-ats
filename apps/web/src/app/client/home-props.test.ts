import { describe, expect, test } from "vitest";
import type { HomeRead } from "@/lib/client/home";
import type { Waiting } from "@/lib/client/home-metrics";
import type { HomeTargets } from "@/lib/client/home-target-rules";
import { overviewProps } from "./home-props";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const H = 3_600_000;

const waiter = (hours: number, column: Waiting["column"], id = `${column}-${hours}`): Waiting => ({
  applicationId: id, personId: `p-${id}`, roleId: "job-1", roleTitle: "Engineer", personName: "A Person", column, hours, stalled: false, lastTouchAt: new Date(NOW).toISOString(),
});

const read = (over: Partial<HomeRead> = {}): HomeRead => ({
  departments: [],
  departmentId: null,
  jobs: [],
  jobId: null,
  applications: { current: 10, previous: 5, change: 1, bins: [] },
  waiting: [],
  stays: [],
  interviews: [],
  names: {},
  feedback: [],
  feedbackMedianHours: null,
  outstanding: [],
  targets: {},
  truncated: false,
  ...over,
});

const props = (r: Partial<HomeRead>, canEdit = true) => overviewProps(read(r), 7, NOW, canEdit);
const withTargets = (targets: HomeTargets | null, r: Partial<HomeRead> = {}, canEdit = true) => props({ ...r, targets }, canEdit);

describe("a card's target", () => {
  test("an admin with none set gets the chip that sets one, on every card that takes one", () => {
    const p = props({});
    for (const c of [p.newApps.target, p.review.target, p.schedule.target, p.feedback!.target, p.workload.target]) {
      expect(c).toMatchObject({ shown: null, off: false, canEdit: true });
    }
  });

  test("the hiring team with none set sees nothing, and with one set sees it read-only", () => {
    const none = props({}, false);
    expect([none.newApps.target, none.review.target, none.schedule.target, none.feedback!.target, none.workload.target]).toEqual([null, null, null, null, null]);
    expect(withTargets({ review: 48 }, {}, false).review.target).toMatchObject({ shown: "2d", canEdit: false });
  });

  test("targets that could not be read offer nothing, and the page keeps its numbers", () => {
    const p = withTargets(null, { waiting: [waiter(100, "new")] });
    expect([p.newApps.target, p.review.target, p.schedule.target, p.feedback!.target, p.workload.target]).toEqual([null, null, null, null, null]);
    expect(p.review.typical).toBe("4.2d");
  });

  test("new applications: below the alert", () => {
    expect(withTargets({ new_applications: 20 }).newApps.target).toMatchObject({ label: "Alert below", shown: "20", off: true, offNote: "Below target" });
    expect(withTargets({ new_applications: 10 }).newApps.target).toMatchObject({ off: false });
  });

  test("a wait is off on its typical, not its oldest", () => {
    const waiting = [waiter(1, "new"), waiter(2, "new"), waiter(500, "new")];
    expect(withTargets({ review: 24 }, { waiting }).review.target).toMatchObject({ shown: "24h", off: false });
    expect(withTargets({ review: 1 }, { waiting }).review.target).toMatchObject({ off: true, offNote: "Over target" });
  });

  test("nobody waiting is not off a target of 0", () => {
    expect(withTargets({ review: 0 }).review.target).toMatchObject({ shown: "0h", off: false });
  });

  test("feedback is compared with the typical time, not the on-time share", () => {
    const p = withTargets({ feedback: 6 }, { feedbackMedianHours: 8 });
    expect(p.feedback).toMatchObject({ typical: "8h", target: { shown: "6h", off: true } });
    expect(withTargets({ feedback: 6 }, { feedbackMedianHours: null }).feedback).toMatchObject({ typical: null, target: { shown: "6h", off: false } });
  });

  test("workload: over the cap, on the unrounded hours", () => {
    const interviews = [{ startsAt: new Date(NOW - 3 * H).toISOString(), endsAt: new Date(NOW - 2.75 * H).toISOString(), interviewerIds: ["a", "b"] }];
    expect(withTargets({ workload: 0.5 }, { interviews }).workload.target).toMatchObject({ label: "Cap", off: false });
    expect(withTargets({ workload: 0.49 }, { interviews }).workload.target).toMatchObject({ off: true });
  });

  test("someone with no feedback card has no chip for it", () => {
    expect(withTargets({ feedback: 6 }, { feedback: null }).feedback).toBeNull();
  });
});

describe("the bars", () => {
  const waiting = [waiter(30, "new"), waiter(100, "new")];
  const late = (p: ReturnType<typeof props>) => p.review.buckets.map((b) => b.late);

  test("with no target, the two oldest buckets, as before", () => {
    expect(late(props({ waiting }))).toEqual([false, false, false, true, true]);
  });

  test("with a target, from the bucket starting at or past it", () => {
    expect(late(withTargets({ review: 24 }, { waiting }))).toEqual([false, true, true, true, true]);
    expect(late(withTargets({ review: 200 }, { waiting }))).toEqual([false, false, false, false, false]);
    expect(late(withTargets({ review: 0 }, { waiting }))).toEqual([true, true, true, true, true]);
  });

  test("with the targets unread, as with none", () => {
    expect(late(withTargets(null, { waiting }))).toEqual([false, false, false, true, true]);
  });
});

describe("the bottlenecks", () => {
  const row = (p: ReturnType<typeof props>, key: string) => p.bottlenecks.find((b) => b.key === key);

  test("over target on the oldest, not the typical, as design/tats, and first", () => {
    const waiting = [waiter(1, "new"), waiter(30, "new"), waiter(200, "decide")];
    const p = withTargets({ review: 24 }, { waiting });
    expect(p.bottlenecks.map((b) => b.key)).toEqual(["review", "decide"]);
    expect(row(p, "review")?.over).toBe(true);
    expect(row(p, "decide")?.over).toBe(false);
  });

  test("feedback is judged on the oldest outstanding", () => {
    const feedback = [{ userId: "u", name: "U", interviews: 1, feedbackFiled: 0, onTime: 0, late: 0, notFiled: 1, medianHoursToFeedback: null }];
    const outstanding = [{ interviewId: "i", interviewerId: "u", interviewerName: "U", candidateName: "C", jobTitle: "J", endsAt: new Date(NOW - 30 * H).toISOString() }];
    expect(row(withTargets({ feedback: 24 }, { feedback, outstanding }), "feedback")?.over).toBe(true);
    expect(row(withTargets({ feedback: 40 }, { feedback, outstanding }), "feedback")?.over).toBe(false);
    expect(row(withTargets({}, { feedback, outstanding }), "feedback")?.over).toBe(false);
  });
});
