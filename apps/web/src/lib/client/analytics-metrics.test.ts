import { describe, expect, test } from "vitest";

import {
  dailyRows,
  explore,
  metricChange,
  metricValue,
  originOf,
  axisTop,
  parseMeasure,
  parseMetric,
  parseRange,
  parseSegment,
  parseSlice,
  periodTotals,
  readFrom,
  series,
  sourceGroup,
  type CareersApp,
  type CareersData,
  type ExplorerApp,
  type ExplorerNames,
  type SourceGroup,
} from "./analytics-metrics";

const NOW = Date.parse("2026-10-30T15:00:00Z");
const H = 3_600_000;
const at = (offsetH: number) => new Date(NOW + offsetH * H).toISOString();
const app = (offsetH: number, group: SourceGroup = "careers", roleId = "eng", channel: CareersApp["channel"] = null): CareersApp => ({ createdAt: at(offsetH), roleId, group, channel });
const only = (apps: CareersApp[]): CareersData => ({ apps, views: [], viewsFrom: null });
/** Views a number of UTC days before NOW's. */
const viewed = (daysAgo: number, views: number, roleId = "eng") => ({ day: new Date(NOW - daysAgo * 24 * H).toISOString().slice(0, 10), roleId, views });

describe("the URL", () => {
  test("anything unknown falls back to the defaults", () => {
    expect(parseRange("quarter")).toBe("quarter");
    for (const raw of [undefined, "", "year", "toString"]) expect(parseRange(raw)).toBe("month");
    for (const m of ["views", "rate", "warm"]) expect(parseMetric(m)).toBe(m);
    expect(parseMetric("careers")).toBe("applications");
    expect([parseMeasure("interviews"), parseSlice("interviewer"), parseSegment("stage")]).toEqual(["interviews", "interviewer", "stage"]);
    expect([parseMeasure("runs"), parseSlice("constructor"), parseSegment("priority")]).toEqual(["applicants", "stage", "source"]);
  });
});

describe("sources as channels", () => {
  test("map every database source, with Tacit's agency submissions apart", () => {
    expect(sourceGroup("referral", "Priya")).toBe("referral");
    expect(sourceGroup("agency", "Tacit · Kim")).toBe("tacit");
    expect(sourceGroup("agency", "Tacit")).toBe("tacit");
    expect(sourceGroup("agency", "Tacitly Recruiting")).toBe("agency");
    expect(sourceGroup("agency", null)).toBe("agency");
    for (const s of ["job_board", "applicant", "candidate"]) expect(sourceGroup(s, null)).toBe("careers");
    for (const s of ["sourced", "suggested"]) expect(sourceGroup(s, null)).toBe("sourced");
    expect(sourceGroup("event", "Meetup")).toBe("event");
    expect(sourceGroup("other", null)).toBe("other");
    expect(sourceGroup("something new", null)).toBe("other");
  });
});

describe("where they came from", () => {
  test("splits the public form's applications by the channel it recorded, and nothing else", () => {
    expect(originOf("careers", "linkedin")).toBe("linkedin");
    expect(originOf("careers", "hackernews")).toBe("hackernews");
    expect(originOf("careers", "direct")).toBe("direct");
    expect(originOf("careers", "other")).toBe("site");
    expect(originOf("careers", null)).toBe("careers");
    expect(originOf("referral", "linkedin")).toBe("referral");
    expect(originOf("other", "other")).toBe("other");
  });

  test("the origins add up to the applications, and warm is untouched by them", () => {
    const apps = [app(-1, "careers", "eng", "linkedin"), app(-2, "careers", "eng", "other"), app(-3), app(-4, "referral")];
    const { current } = periodTotals(only(apps), "week", NOW);
    expect(current.byOrigin).toMatchObject({ linkedin: 1, site: 1, careers: 1, referral: 1, other: 0 });
    expect(Object.values(current.byOrigin).reduce((s, n) => s + n, 0)).toBe(current.applications);
    expect(current.bySource.careers).toBe(3);
    expect(current.warm).toBe(1);
  });
});

describe("page views", () => {
  const from = viewed(40, 0).day;

  test("are summed by UTC day, and the rate is public form applications per view", () => {
    const data: CareersData = { apps: [app(-1, "careers", "eng", "direct"), app(-2, "careers", "eng", "linkedin"), app(-3, "referral")], views: [viewed(0, 30), viewed(3, 70, "des"), viewed(9, 40)], viewsFrom: from };
    const { current, previous } = periodTotals(data, "week", NOW);
    expect(current.views).toBe(100);
    expect(metricValue("views", current)).toBe(100);
    expect(metricValue("rate", current)).toBe(2);
    expect(previous.views).toBe(40);
    expect(metricChange("views", current, previous)).toBe(150);
    expect(metricChange("rate", current, previous)).toBe(2);
  });

  test("a rate needs a view, and no views at all is none and not 0%", () => {
    const { current } = periodTotals(only([app(-1)]), "week", NOW);
    expect(metricValue("views", current)).toBe(0);
    expect(metricValue("rate", current)).toBeNull();
  });

  test("applications before the first view are left out of the rate, not of Applications", () => {
    // Views began two days ago; the month's other applications could never have been counted against one.
    const apps = [app(-1, "careers", "eng", "direct"), ...Array.from({ length: 20 }, (_, i) => app(-24 * (5 + i), "careers", "eng", "direct"))];
    const { current } = periodTotals({ apps, views: [viewed(1, 50)], viewsFrom: viewed(2, 0).day }, "month", NOW);
    expect(current.applications).toBe(21);
    expect(current.viewed).toBe(1);
    expect(metricValue("rate", current)).toBe(2);
  });

  test("the rate counts what the form recorded: someone a member added as job_board or applicant never opened the post", () => {
    const apps = [app(-1, "careers", "eng", "linkedin"), app(-2, "careers", "eng", "direct"), app(-3), app(-4)];
    const { current } = periodTotals({ apps, views: [viewed(0, 100)], viewsFrom: from }, "week", NOW);
    expect(current.applications).toBe(4);
    expect(current.byOrigin.careers).toBe(2);
    expect(current.viewed).toBe(2);
    expect(metricValue("rate", current)).toBe(2);
  });

  test("a period before that views only reach part of is nothing to compare", () => {
    const data: CareersData = { apps: [app(-1), app(-24 * 8)], views: [viewed(1, 50), viewed(8, 100)], viewsFrom: viewed(9, 0).day };
    const { current, previous } = periodTotals(data, "week", NOW);
    expect(previous.viewsPartial).toBe(true);
    expect(metricChange("views", current, previous)).toBeNull();
    expect(metricChange("rate", current, previous)).toBeNull();
    expect(metricChange("applications", current, previous)).not.toBeNull();
  });

  test("a quiet first day of the period before is still a fair comparison: views began long ago", () => {
    const { current, previous } = periodTotals({ apps: [], views: [viewed(1, 50), viewed(8, 100)], viewsFrom: from }, "week", NOW);
    expect(previous.viewsPartial).toBe(false);
    expect(metricChange("views", current, previous)).toBe(-50);
  });

  test("a fall to nothing is a fall, and views from nothing have nothing to compare", () => {
    const { current, previous } = periodTotals({ apps: [], views: [viewed(8, 100)], viewsFrom: from }, "week", NOW);
    expect(metricChange("views", current, previous)).toBe(-100);
    expect(metricChange("views", previous, current)).toBeNull();
  });

  test("chart by day, the rate null on a day with no views", () => {
    const data: CareersData = { apps: [app(-1, "careers", "eng", "direct"), app(-24 * 7 - 1, "careers", "eng", "direct")], views: [viewed(0, 4), viewed(7, 8)], viewsFrom: from };
    const views = series(data, "views", "week", NOW).points;
    expect(views[6]).toEqual({ label: "Oct 30", current: 4, previous: 8 });
    expect(views[5].current).toBe(0);
    const rate = series(data, "rate", "week", NOW).points;
    expect(rate[6]).toEqual({ label: "Oct 30", current: 25, previous: 12.5 });
    expect(rate[5].current).toBeNull();
  });

  test("a day before the first recorded view is unknown, not zero views", () => {
    const data: CareersData = { apps: [], views: [viewed(1, 5)], viewsFrom: viewed(2, 0).day };
    const { points } = series(data, "views", "week", NOW);
    expect(points.map((p) => p.current)).toEqual([null, null, null, null, 0, 5, 0]);
    expect(points.every((p) => p.previous === null)).toBe(true);
  });

  test("a week that views began in is a number, and only a week wholly before is unknown", () => {
    const data: CareersData = { apps: [], views: [viewed(2, 5)], viewsFrom: viewed(2, 0).day };
    const { points } = series(data, "views", "quarter", NOW);
    expect(points.at(-1)?.current).toBe(5);
    expect(points[0].current).toBeNull();
  });

  test("with no view recorded at all, the chart has no views to draw, and the card still says 0", () => {
    const data: CareersData = { apps: [], views: [], viewsFrom: null };
    expect(series(data, "views", "week", NOW).points.every((p) => p.current === null)).toBe(true);
    expect(metricValue("views", periodTotals(data, "week", NOW).current)).toBe(0);
  });

  test("the export leaves those days empty rather than writing 0", () => {
    const rows = dailyRows({ apps: [], views: [viewed(1, 5)], viewsFrom: viewed(2, 0).day }, "week", NOW);
    expect(rows.slice(1).map((r) => r[1])).toEqual(["", "", "", "", "0", "5", "0"]);
  });
});

describe("the careers page's periods", () => {
  test("are UTC days, today included, against the same number of days before", () => {
    // NOW is 15:00 UTC: -14h is today, -16h yesterday.
    const apps = [app(-14), app(-16, "referral"), app(-6 * 24, "tacit", "des"), app(-7 * 24 - 16), app(-14 * 24 - 16), app(-2 * 24, "careers", "des")];
    const { current, previous } = periodTotals(only(apps), "week", NOW);
    expect(current.applications).toBe(4);
    expect(current.warm).toBe(2);
    expect(current.bySource).toMatchObject({ careers: 2, referral: 1, tacit: 1, sourced: 0 });
    expect(Object.fromEntries(current.byJob)).toEqual({ eng: 2, des: 2 });
    expect(previous.applications).toBe(1);
  });

  test("the read reaches the first UTC day of the period before", () => {
    expect(readFrom("week", NOW)).toBe("2026-10-17T00:00:00.000Z");
  });

  test("a count's change is in percent, a share's in points, and none with nothing before", () => {
    const { current, previous } = periodTotals(only([app(-1, "referral"), app(-2), app(-24 * 8, "referral"), app(-24 * 9, "referral")]), "week", NOW);
    expect(metricValue("applications", current)).toBe(2);
    expect(metricChange("applications", current, previous)).toBe(0);
    expect(metricValue("warm", current)).toBe(50);
    expect(metricChange("warm", current, previous)).toBe(-50);
    const empty = periodTotals(only([]), "week", NOW);
    expect(metricValue("warm", empty.current)).toBeNull();
    expect(metricChange("warm", current, empty.previous)).toBeNull();
  });
});

describe("the chart's series", () => {
  test("a week is a point a day, oldest first, with the period before at the same offset", () => {
    const { step, points } = series(only([app(-1), app(-2), app(-24 * 7 - 1)]), "applications", "week", NOW);
    expect(step).toBe(1);
    expect(points).toHaveLength(7);
    expect(points[0].label).toBe("Oct 24");
    expect(points[6]).toEqual({ label: "Oct 30", current: 2, previous: 1 });
  });

  test("a quarter is a point a week, the last cut short", () => {
    const { step, points } = series(only([app(-1)]), "applications", "quarter", NOW);
    expect(step).toBe(7);
    expect(points).toHaveLength(13);
    expect(points.at(-1)?.current).toBe(1);
  });

  test("a share is null on a day with no applications", () => {
    const { points } = series(only([app(-1, "referral")]), "warm", "week", NOW);
    expect(points[6].current).toBe(100);
    expect(points[5].current).toBeNull();
  });

  test("the export is a row a day under a header of channels", () => {
    const rows = dailyRows({ apps: [app(-1, "referral"), app(-2), app(-3, "careers", "eng", "hackernews")], views: [viewed(0, 12)], viewsFrom: viewed(5, 0).day }, "week", NOW);
    expect(rows[0]).toEqual(["Date (UTC)", "Page views", "Applications", "Referred", "Sent by Tacit", "LinkedIn", "Hacker News", "Direct", "Other sites", "Careers page, not recorded", "Sourced", "Agency", "Event", "Other"]);
    expect(rows).toHaveLength(8);
    expect(rows[7]).toEqual(["2026-10-30", "12", "3", "1", "0", "0", "1", "0", "0", "1", "0", "0", "0", "0"]);
  });
});

describe("the Pipeline explorer", () => {
  const names: ExplorerNames = {
    jobs: [
      { id: "eng", title: "Engineer" },
      { id: "des", title: "Designer" },
    ],
    departments: [{ id: "d1", label: "Engineering" }],
    interviewers: { kim: "Kim", lee: "Lee" },
  };
  const ex = (id: string, over: Partial<ExplorerApp> = {}): ExplorerApp => ({
    applicationId: id, roleId: "eng", column: "new", group: "careers", departmentId: "d1", interviews: [], ...over,
  });
  const apps = [
    ex("a", { column: "booked", group: "referral", interviews: [{ interviewerIds: ["kim", "lee"] }, { interviewerIds: ["kim"] }] }),
    ex("b", { column: "decide", interviews: [{ interviewerIds: ["lee"] }] }),
    ex("c", { roleId: "des", departmentId: null }),
  ];

  test("applicants by stage keep every column, split by source", () => {
    const r = explore(apps, names, "applicants", "stage", "source");
    expect(r.total).toBe(3);
    expect(r.rows.map((x) => x.key)).toEqual(["new", "screening", "scheduling", "booked", "decide", "offer"]);
    expect(r.rows.find((x) => x.key === "booked")).toMatchObject({ label: "Interview booked", total: 1, by: [1, 0, 0, 0, 0, 0, 0] });
    expect(r.rows.find((x) => x.key === "new")!.by[2]).toBe(1);
  });

  test("interviews by job, split by stage, keep jobs with none", () => {
    const r = explore(apps, names, "interviews", "job", "stage");
    expect(r.total).toBe(3);
    expect(r.rows).toEqual([
      { key: "eng", label: "Engineer", total: 3, by: [0, 0, 0, 2, 1, 0] },
      { key: "des", label: "Designer", total: 0, by: [0, 0, 0, 0, 0, 0] },
    ]);
  });

  test("by department, with no department last and empty departments dropped", () => {
    const r = explore(apps, { ...names, departments: [...names.departments, { id: "d2", label: "Sales" }] }, "applicants", "department", "source");
    expect(r.rows.map((x) => [x.label, x.total])).toEqual([["Engineering", 2], ["No department", 1]]);
  });

  test("by interviewer, someone interviewed by two counts under each but once in the total", () => {
    const people = explore(apps, names, "applicants", "interviewer", "source");
    expect(people.rows.map((x) => [x.label, x.total])).toEqual([["Lee", 2], ["Kim", 1]]);
    expect(people.total).toBe(2);
    const ivs = explore(apps, names, "interviews", "interviewer", "source");
    expect(ivs.rows.map((x) => [x.label, x.total])).toEqual([["Kim", 2], ["Lee", 2]]);
    expect(ivs.total).toBe(3);
  });

  test("a job outside the names is not counted", () => {
    const r = explore([ex("x", { roleId: "gone" })], names, "applicants", "job", "source");
    expect(r.total).toBe(0);
  });
});

test("the axis top is four round steps, at least 4", () => {
  expect([axisTop(0), axisTop(3), axisTop(5), axisTop(7), axisTop(13), axisTop(45), axisTop(230), axisTop(410)]).toEqual([4, 4, 8, 8, 16, 60, 240, 500]);
});
