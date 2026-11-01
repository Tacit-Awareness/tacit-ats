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
  daily: [1, 2, 3, 4],
  sources: { referral: 2, tacit: 0, careers: 5, sourced: 0, agency: 0, event: 0, other: 0 },
  hires: Array.from({ length: 24 }, (_, i) => (i < 12 ? 1 : 2)),
  offers: [],
  waiting: [],
  stages: null,
  stays: [],
  efficiency: null,
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

describe("stages from the process", () => {
  const stages = [{ name: "Application review", order: 0 }, { name: "Team interview", order: 1 }, { name: "Offer", order: 2 }];

  test("with none, the board's columns and their own short labels", () => {
    const p = props({ waiting: [waiter(5, "new")] });
    expect(p.stages.map((s) => s.label)).toEqual(["New", "Screening", "Scheduling", "Interview booked", "Your call", "Offer"]);
    expect(p.inProcess.parts[0].label).toBe("New");
    expect(p.inProcess.byProcess).toBe(false);
  });

  test("with one, its stages, a job off the process on a column of its own, and everyone counted", () => {
    const named = { ...waiter(5, "new", "a"), stage: stages[0] };
    const p = props({ stages, waiting: [named, waiter(9, "scheduling", "b")] });
    expect(p.stages.map((s) => [s.label, s.n])).toEqual([["Application review", 1], ["Team interview", 0], ["Offer", 0], ["Scheduling", 1]]);
    expect(p.inProcess.parts.map((b) => b.label)).toEqual(["Application review", "Team interview", "Offer", "Scheduling"]);
    expect(p.inProcess.value).toBe(2);
    expect(p.inProcess.byProcess).toBe(true);
  });

  test("the review and scheduling cards stay on the board's columns", () => {
    const p = props({ stages, waiting: [{ ...waiter(5, "new", "a"), stage: stages[0] }] });
    expect(p.review.waiting).toBe(1);
  });

  test("the workload is by department, by person with none, and the bars never claim more than the total", () => {
    const iv = (team: string | null, id: string) => ({ startsAt: new Date(NOW - 2 * H).toISOString(), endsAt: new Date(NOW - H).toISOString(), interviewerIds: [id], team });
    const named = props({ interviews: [iv("Infra", "a"), iv("Infra", "b"), iv(null, "a")], names: { a: "Ann", b: "Bo" } }).workload;
    expect(named.byTeam).toBe(true);
    expect(named.rows.map((r) => [r.name, r.label])).toEqual([["Infra", "2h"], ["No department", "1h"]]);

    const people = props({ interviews: [iv(null, "a"), iv(null, "a"), iv(null, "b")], names: { a: "Ann" } }).workload;
    expect(people.byTeam).toBe(false);
    expect(people.rows.map((r) => [r.name, r.label])).toEqual([["Ann", "2h"], ["Unknown", "1h"]]);
  });

  test("interview efficiency in words, and a dash where there is no hire to divide by", () => {
    const e = { closed: 9, hires: 2, rounds: [{ label: "Round 1 to the final", from: 3, to: 2, rate: 2 / 3 }], interviewsPerHire: 4.25, hoursPerHire: 5 };
    expect(props({ efficiency: e }).efficiency).toEqual({
      closed: 9,
      hires: 2,
      rounds: [{ label: "Round 1 to the final", share: 2 / 3, value: "67%", title: "2 of 3 went on" }],
      perHire: "4.3",
      hoursPerHire: "5.0h",
    });
    expect(props({ efficiency: { ...e, hires: 0, interviewsPerHire: null, hoursPerHire: null } }).efficiency).toMatchObject({ perHire: "—", hoursPerHire: "—" });
    expect(props({}).efficiency).toBeNull();
  });

  test("only an admin is offered Edit stages", () => {
    expect(props({}).editStages).toBe("/client/onboarding/process");
    expect(props({}, false).editStages).toBeNull();
  });
});

describe("the widgets' numbers", () => {
  test("the trend's two periods, the older half first", () => {
    expect(props({}).trend).toEqual({ current: [3, 4], previous: [1, 2], total: 7, before: 3 });
  });

  test("hires are the last 12 weeks against the 12 before", () => {
    expect(props({}).hires).toMatchObject({ total: 24, before: 12 });
    expect(props({}).hires.weeks).toHaveLength(12);
  });

  test("only the sources something came from", () => {
    expect(props({}).sources).toEqual([{ label: "Referred", n: 2 }, { label: "Careers page", n: 5 }]);
  });

  test("an offer opens its approval in the Inbox and carries no terms", () => {
    const offer = { requestId: "r1", candidateName: "Ada", jobTitle: "Engineer", requestedBy: "Lin", requestedAt: new Date(NOW - 3_600_000).toISOString() };
    const p = props({ offers: [offer] }).offers;
    expect(p.total).toBe(1);
    expect(p.rows[0]).toMatchObject({ candidate: "Ada", line: "Engineer · from Lin", href: "/client/inbox?i=appr-r1" });
    expect(JSON.stringify(p)).not.toMatch(/salary|terms|equity/);
  });

  test("past the preview, a link to the rest", () => {
    const offers = Array.from({ length: 6 }, (_, i) => ({ requestId: `r${i}`, candidateName: null, jobTitle: "Engineer", requestedBy: null, requestedAt: new Date(NOW).toISOString() }));
    const p = props({ offers }).offers;
    expect(p.rows).toHaveLength(5);
    expect(p.rows[0].candidate).toBe("A candidate");
    expect(p.more?.label).toBe("All 6 in the Inbox");
  });
});
