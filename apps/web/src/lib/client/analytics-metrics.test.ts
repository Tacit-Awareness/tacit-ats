import { describe, expect, test } from "vitest";

import {
  dailyRows,
  explore,
  metricChange,
  metricValue,
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
  type ExplorerApp,
  type ExplorerNames,
  type SourceGroup,
} from "./analytics-metrics";

const NOW = Date.parse("2026-10-30T15:00:00Z");
const H = 3_600_000;
const at = (offsetH: number) => new Date(NOW + offsetH * H).toISOString();
const app = (offsetH: number, group: SourceGroup = "careers", roleId = "eng"): CareersApp => ({ createdAt: at(offsetH), roleId, group });

describe("the URL", () => {
  test("anything unknown falls back to the defaults", () => {
    expect(parseRange("quarter")).toBe("quarter");
    for (const raw of [undefined, "", "year", "toString"]) expect(parseRange(raw)).toBe("month");
    expect(parseMetric("warm")).toBe("warm");
    expect(parseMetric("views")).toBe("applications");
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

describe("the careers page's periods", () => {
  test("are UTC days, today included, against the same number of days before", () => {
    // NOW is 15:00 UTC: -14h is today, -16h yesterday.
    const apps = [app(-14), app(-16, "referral"), app(-6 * 24, "tacit", "des"), app(-7 * 24 - 16), app(-14 * 24 - 16), app(-2 * 24, "careers", "des")];
    const { current, previous } = periodTotals(apps, "week", NOW);
    expect(current.applications).toBe(4);
    expect(current.careers).toBe(2);
    expect(current.warm).toBe(2);
    expect(current.bySource).toMatchObject({ careers: 2, referral: 1, tacit: 1, sourced: 0 });
    expect(Object.fromEntries(current.byJob)).toEqual({ eng: 2, des: 2 });
    expect(previous.applications).toBe(1);
  });

  test("the read reaches the first UTC day of the period before", () => {
    expect(readFrom("week", NOW)).toBe("2026-10-17T00:00:00.000Z");
  });

  test("a count's change is in percent, a share's in points, and none with nothing before", () => {
    const { current, previous } = periodTotals([app(-1, "referral"), app(-2), app(-24 * 8, "referral"), app(-24 * 9, "referral")], "week", NOW);
    expect(metricValue("applications", current)).toBe(2);
    expect(metricChange("applications", current, previous)).toBe(0);
    expect(metricValue("warm", current)).toBe(50);
    expect(metricChange("warm", current, previous)).toBe(-50);
    expect(metricChange("careers", current, previous)).toBeNull();
    const empty = periodTotals([], "week", NOW);
    expect(metricValue("warm", empty.current)).toBeNull();
    expect(metricChange("warm", current, empty.previous)).toBeNull();
  });
});

describe("the chart's series", () => {
  test("a week is a point a day, oldest first, with the period before at the same offset", () => {
    const { step, points } = series([app(-1), app(-2), app(-24 * 7 - 1)], "applications", "week", NOW);
    expect(step).toBe(1);
    expect(points).toHaveLength(7);
    expect(points[0].label).toBe("Oct 24");
    expect(points[6]).toEqual({ label: "Oct 30", current: 2, previous: 1 });
  });

  test("a quarter is a point a week, the last cut short", () => {
    const { step, points } = series([app(-1)], "applications", "quarter", NOW);
    expect(step).toBe(7);
    expect(points).toHaveLength(13);
    expect(points.at(-1)?.current).toBe(1);
  });

  test("a share is null on a day with no applications", () => {
    const { points } = series([app(-1, "referral")], "warm", "week", NOW);
    expect(points[6].current).toBe(100);
    expect(points[5].current).toBeNull();
  });

  test("the export is a row a day under a header of channels", () => {
    const rows = dailyRows([app(-1, "referral"), app(-2)], "week", NOW);
    expect(rows[0]).toEqual(["Date (UTC)", "Applications", "Referred", "Sent by Tacit", "Careers page", "Sourced", "Agency", "Event", "Other"]);
    expect(rows).toHaveLength(8);
    expect(rows[7]).toEqual(["2026-10-30", "2", "1", "0", "1", "0", "0", "0", "0"]);
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
