import { describe, expect, test } from "vitest";

import {
  NO_DEPARTMENT,
  SEVERAL_DEPARTMENTS,
  assembleInterviewers,
  countLoad,
  departmentPaths,
  groupByDepartment,
  readWindow,
  weekBounds,
  type Interviewer,
  type JobRef,
  type LoadInterview,
} from "./interviewer-load";
import type { StoredProfile } from "./interviewer-profile";

// Thursday 29 October 2026, noon UTC: this week is Monday 26 October to Sunday 1 November.
const NOW = new Date("2026-10-29T12:00:00Z");
const iv = (startsAt: string, interviewerIds: string[], roleId = "job-a"): LoadInterview => ({ startsAt, interviewerIds, roleId });

describe("calendar weeks", () => {
  test("start on Monday 00:00 UTC, whatever the day", () => {
    const b = weekBounds(NOW);
    expect(new Date(b.thisWeek).toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(new Date(b.nextWeek).toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(new Date(b.end).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    // a Sunday night still belongs to the week that began six days before
    expect(new Date(weekBounds(new Date("2026-11-01T23:59:00Z")).thisWeek).toISOString()).toBe("2026-10-26T00:00:00.000Z");
    // and a Monday is its own week's start
    expect(new Date(weekBounds(new Date("2026-10-26T00:00:00Z")).thisWeek).toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });

  test("the read covers 30 days back to the end of next week", () => {
    expect(readWindow(NOW)).toEqual({ from: "2026-09-29T12:00:00.000Z", to: "2026-11-09T00:00:00.000Z" });
  });
});

describe("counting interviews", () => {
  test("this week includes its days already gone; next week is the one after; 30 days looks back from now", () => {
    const load = countLoad(
      [
        iv("2026-10-26T09:00:00Z", ["ada"]), // this Monday, past: this week and last 30 days
        iv("2026-10-30T09:00:00Z", ["ada"]), // tomorrow: this week only
        iv("2026-11-01T23:30:00Z", ["ada"]), // Sunday night: still this week
        iv("2026-11-02T00:00:00Z", ["ada"]), // next Monday
        iv("2026-11-08T23:59:00Z", ["ada"]), // next Sunday
        iv("2026-11-09T00:00:00Z", ["ada"]), // the week after: not counted
        iv("2026-10-10T09:00:00Z", ["ada"]), // three weeks ago: last 30 days only
        iv("2026-09-28T09:00:00Z", ["ada"]), // 31 days ago: nothing
      ],
      NOW,
    );
    expect(load.get("ada")).toEqual({ thisWeek: 3, nextWeek: 2, last30: 2 });
  });

  test("a panel counts once for each interviewer, and a name listed twice once", () => {
    const load = countLoad([iv("2026-10-30T09:00:00Z", ["ada", "bo", "ada"])], NOW);
    expect(load.get("ada")).toEqual({ thisWeek: 1, nextWeek: 0, last30: 0 });
    expect(load.get("bo")).toEqual({ thisWeek: 1, nextWeek: 0, last30: 0 });
  });
});

describe("departments", () => {
  test("a path names its parents outermost first, and a loop stops", () => {
    const paths = departmentPaths([
      { id: "eng", name: "Engineering", parentId: null },
      { id: "plat", name: "Platform", parentId: "eng" },
      { id: "x", name: "X", parentId: "y" },
      { id: "y", name: "Y", parentId: "x" },
      { id: "orphan", name: "Orphan", parentId: "gone" },
    ]);
    expect(paths.get("plat")).toBe("Engineering > Platform");
    expect(paths.get("x")).toBe("Y > X");
    expect(paths.get("orphan")).toBe("Orphan");
  });
});

const JOBS: JobRef[] = [
  { id: "job-a", title: "Backend Engineer", status: "open", departmentId: "eng" },
  { id: "job-b", title: "Designer", status: "open", departmentId: "design" },
  { id: "job-c", title: "Old Role", status: "closed", departmentId: "eng" },
  { id: "job-d", title: "Office Manager", status: "paused", departmentId: null },
];
const DEPTS = [
  { id: "eng", name: "Engineering", parentId: null },
  { id: "design", name: "Design", parentId: null },
];
const NAMES = new Map([
  ["ada", "Ada"],
  ["bo", "Bo"],
  ["cy", "Cy"],
  ["di", "Di"],
  ["ed", "Ed"],
]);

const PROFILE = { preference: "loves", weeklyCap: 3, focusAreas: ["Go"], channel: "slack", awayUntil: null, updatedAt: "2026-10-30T12:00:00+00:00" } as const satisfies StoredProfile;

describe("who is an interviewer", () => {
  const rows = assembleInterviewers({
    interviews: [iv("2026-10-30T09:00:00Z", ["bo"], "job-b"), iv("2026-10-20T09:00:00Z", ["cy"], "job-c")],
    seats: [
      { roleId: "job-a", actorId: "ada", teamRole: "interviewer" },
      { roleId: "job-b", actorId: "ada", teamRole: "interviewer" },
      { roleId: "job-a", actorId: "bo", teamRole: "hiring_manager" },
      { roleId: "job-c", actorId: "di", teamRole: "interviewer" }, // a closed job only
      { roleId: "job-a", actorId: "ed", teamRole: "recruiter" }, // never interviews
    ],
    jobs: JOBS,
    departments: DEPTS,
    names: NAMES,
    profiles: new Map([["bo", PROFILE], ["ed", PROFILE]]),
    feedback: new Map([["ada", { onTime: 1, late: 0, notFiled: 2, notVisible: 0 }]]),
    now: NOW,
  });
  const by = Object.fromEntries(rows.map((r) => [r.actorId, r]));

  test("an interviewer seat on a live job, or an interview in the window; not a closed job's seat or a recruiter", () => {
    expect(rows.map((r) => r.actorId)).toEqual(["ada", "bo", "cy"]);
  });

  test("their jobs are their live hiring teams plus the jobs of their interviews", () => {
    expect(by.ada!.jobs.map((j) => j.title)).toEqual(["Backend Engineer", "Designer"]);
    expect(by.bo!.jobs.map((j) => j.title)).toEqual(["Backend Engineer", "Designer"]);
    // a closed job still names the interview it held
    expect(by.cy!.jobs.map((j) => j.title)).toEqual(["Old Role"]);
    expect(by.ada!.departments).toEqual(["Design", "Engineering"]);
    expect(by.cy!.departments).toEqual(["Engineering"]);
  });

  test("counts and feedback ride along; no feedback is null", () => {
    expect(by.bo!.load).toEqual({ thisWeek: 1, nextWeek: 0, last30: 0 });
    expect(by.ada!.load).toEqual({ thisWeek: 0, nextWeek: 0, last30: 0 });
    expect(by.ada!.feedback).toEqual({ onTime: 1, late: 0, notFiled: 2, notVisible: 0 });
    expect(by.bo!.feedback).toBeNull();
  });

  test("a profile rides along, and having one does not make anyone a row", () => {
    expect(by.bo!.profile).toEqual(PROFILE);
    expect(by.ada!.profile).toBeNull();
    expect(by.ed).toBeUndefined();
  });

  test("someone the feedback report has, but nothing else, is still a row", () => {
    const only = assembleInterviewers({
      interviews: [],
      seats: [],
      jobs: JOBS,
      departments: DEPTS,
      names: new Map(),
      profiles: new Map(),
      feedback: new Map([["zed", { onTime: 0, late: 1, notFiled: 0, notVisible: 0 }]]),
      now: NOW,
    });
    expect(only).toMatchObject([{ actorId: "zed", name: "Unknown", jobs: [], departments: [] }]);
  });
});

const person = (actorId: string, departments: string[]): Interviewer => ({
  actorId,
  name: actorId,
  profile: null,
  load: { thisWeek: 0, nextWeek: 0, last30: 0 },
  jobs: [],
  departments,
  feedback: null,
});

describe("grouping by department", () => {
  test("one section per department, alphabetical, then several, then none", () => {
    const groups = groupByDepartment([
      person("a", ["Engineering"]),
      person("b", []),
      person("c", ["Design", "Engineering"]),
      person("d", ["Design"]),
      person("e", ["Engineering"]),
    ]);
    expect(groups.map((g) => [g.label, g.interviewers.map((i) => i.actorId)])).toEqual([
      ["Design", ["d"]],
      ["Engineering", ["a", "e"]],
      [SEVERAL_DEPARTMENTS, ["c"]],
      [NO_DEPARTMENT, ["b"]],
    ]);
  });

  test("nobody with a department is one unlabelled list; nobody at all is no sections", () => {
    expect(groupByDepartment([person("a", []), person("b", [])])).toEqual([{ label: null, interviewers: [person("a", []), person("b", [])] }]);
    expect(groupByDepartment([])).toEqual([]);
  });
});
