import { describe, expect, test } from "vitest";

import { CRM_PAGE_SIZE, crmHref, crmTable, inJobs, matches, parseCrmQuery, rowFor, sortRows, stageLabel, withStageNames, type CrmApplication, type CrmCandidate, type CrmQuery } from "./crm-views";

const day = (n: number) => new Date(Date.parse("2026-10-01T12:00:00Z") + n * 86_400_000).toISOString();

let seq = 0;
const app = (stage: string, over: Partial<CrmApplication> = {}): CrmApplication => ({
  applicationId: `app-${++seq}`,
  jobId: `job-${stage}`,
  jobTitle: `${stage} job`,
  stage,
  ownerName: null,
  lastTouchAt: day(0),
  ...over,
});
const person = (name: string, applications: CrmApplication[], over: Partial<CrmCandidate> = {}): CrmCandidate => ({
  candidateId: `p-${name}`,
  name,
  headline: null,
  email: null,
  addedAt: day(-30),
  applications,
  ...over,
});
const q = (over: Partial<CrmQuery> = {}): CrmQuery => ({ view: "all", q: "", sort: "last", dir: "desc", page: 1, department: null, ...over });

describe("a candidate's row", () => {
  test("offers a bulk reject only the open applications it shows", () => {
    const live = app("screening", { jobTitle: "Engineer" });
    const offer = app("offer", { jobTitle: null });
    const closed = app("rejected");
    const c = person("Ana", [live, offer, closed]);
    expect(rowFor(c, "all")!.openApps).toEqual([
      { applicationId: offer.applicationId, jobTitle: "Untitled job", stage: "offer" },
      { applicationId: live.applicationId, jobTitle: "Engineer", stage: "screening" },
    ]);
    // a view shows only its own applications, so a reject there is about only those
    expect(rowFor(c, "rejected")!.openApps).toEqual([]);
    expect(rowFor(person("Bo", [app("sourced"), live]), "active")!.openApps.map((a) => a.applicationId)).toEqual([live.applicationId]);
    expect(rowFor(person("Cy", []), "all")!.openApps).toEqual([]);
  });

  test("in All, the lead application is the furthest along, and the jobs are the live ones", () => {
    const c = person("Ana", [
      app("rejected", { jobId: "j1", jobTitle: "Designer", lastTouchAt: day(5) }),
      app("screening", { jobId: "j2", jobTitle: "Engineer", ownerName: "Sam" }),
      app("offer", { jobId: "j3", jobTitle: "Researcher", ownerName: "Lee", lastTouchAt: day(2) }),
    ]);
    const row = rowFor(c, "all")!;
    expect(row.stage).toBe("offer");
    expect(row.ownerName).toBe("Lee");
    expect(row.jobs.map((j) => j.title)).toEqual(["Researcher", "Engineer"]);
    // the newest touch on any application, closed ones too
    expect(row.lastTouchAt).toBe(day(5));
  });

  test("in All with nothing live, only the lead outcome's job shows; hired outranks a rejection", () => {
    const row = rowFor(person("Bo", [app("rejected", { jobTitle: "A", lastTouchAt: day(9) }), app("hired", { jobTitle: "B" })]), "all")!;
    expect(row.stage).toBe("hired");
    expect(row.jobs.map((j) => j.title)).toEqual(["B"]);
  });

  test("a prospect is in All only, as Prospect, last touched when added", () => {
    const c = person("Cy", []);
    expect(rowFor(c, "all")).toMatchObject({ stage: null, jobs: [], ownerName: null, lastTouchAt: day(-30) });
    expect(stageLabel(null)).toBe("Prospect");
    for (const v of ["active", "hired", "rejected", "withdrew"] as const) expect(rowFor(c, v)).toBeNull();
  });

  test("a view is about the applications that put them in it", () => {
    const c = person("Di", [app("rejected", { jobTitle: "Designer", ownerName: "Ro" }), app("interviewing", { jobTitle: "Engineer", ownerName: "Sam" })]);
    expect(rowFor(c, "rejected")).toMatchObject({ stage: "rejected", ownerName: "Ro", jobs: [{ title: "Designer" }] });
    expect(rowFor(c, "active")).toMatchObject({ stage: "interviewing", ownerName: "Sam", jobs: [{ title: "Engineer" }] });
    expect(rowFor(c, "hired")).toBeNull();
    expect(rowFor(c, "withdrew")).toBeNull();
  });

  test("In process is screening, interviewing and offer; sourced and contacted are not yet", () => {
    for (const stage of ["screening", "interviewing", "offer"]) expect(rowFor(person("E", [app(stage)]), "active"), stage).not.toBeNull();
    for (const stage of ["sourced", "contacted", "hired", "withdrawn"]) expect(rowFor(person("E", [app(stage)]), "active"), stage).toBeNull();
    expect(rowFor(person("E", [app("withdrawn")]), "withdrew")).toMatchObject({ stage: "withdrawn" });
    expect(stageLabel("withdrawn")).toBe("Withdrew");
  });

  test("a job in two applications is listed once; a nameless candidate is Unnamed", () => {
    const row = rowFor(person("  ", [app("screening", { jobId: "j" }), app("interviewing", { jobId: "j" })]), "all")!;
    expect(row.jobs).toHaveLength(1);
    expect(row.name).toBe("Unnamed");
  });
});

describe("search", () => {
  const c = person("Grace Hopper", [app("screening", { jobTitle: "Compiler Engineer" })], { email: "grace@navy.test", headline: "Admiral at Navy" });
  test("every word must match somewhere: name, email, headline or a job", () => {
    expect(matches(c, "")).toBe(true);
    expect(matches(c, "grace")).toBe(true);
    expect(matches(c, "NAVY.test")).toBe(true);
    expect(matches(c, "hopper compiler")).toBe(true);
    expect(matches(c, "hopper designer")).toBe(false);
  });
});

describe("sorting", () => {
  const rows = [
    rowFor(person("bea", [app("offer", { jobTitle: "Zeta", ownerName: "Yu", lastTouchAt: day(1) })]), "all")!,
    rowFor(person("Al", [app("sourced", { jobTitle: "alpha", lastTouchAt: day(3) })]), "all")!,
    rowFor(person("Cal", []), "all")!,
  ];
  const names = (sorted: typeof rows) => sorted.map((r) => r.name);

  test("by name ignoring case, either way", () => {
    expect(names(sortRows(rows, "name", "asc"))).toEqual(["Al", "bea", "Cal"]);
    expect(names(sortRows(rows, "name", "desc"))).toEqual(["Cal", "bea", "Al"]);
  });

  test("by last touch, newest first by default", () => {
    expect(names(sortRows(rows, "last", "desc"))).toEqual(["Al", "bea", "Cal"]);
  });

  test("an empty cell goes last whichever way: no job, no owner, a prospect's stage", () => {
    expect(names(sortRows(rows, "job", "asc"))).toEqual(["Al", "bea", "Cal"]);
    expect(names(sortRows(rows, "job", "desc"))).toEqual(["bea", "Al", "Cal"]);
    expect(names(sortRows(rows, "owner", "desc"))).toEqual(["bea", "Al", "Cal"]);
    expect(names(sortRows(rows, "stage", "asc"))).toEqual(["bea", "Al", "Cal"]);
    expect(names(sortRows(rows, "stage", "desc"))).toEqual(["Al", "bea", "Cal"]);
  });
});

describe("the URL", () => {
  test("unknown values fall back to the defaults", () => {
    expect(parseCrmQuery({})).toEqual(q());
    expect(parseCrmQuery({ view: "silver", sort: "testbench", dir: "up", page: "-3" })).toEqual(q());
    expect(parseCrmQuery({ view: "hired", q: "  ada ", sort: "name", page: ["2", "9"] })).toEqual(q({ view: "hired", q: "ada", sort: "name", dir: "asc", page: 2 }));
  });

  test("a query round-trips, leaving defaults out", () => {
    expect(crmHref(q())).toBe("/client/candidates");
    const full = q({ view: "rejected", q: "ada lovelace", sort: "owner", dir: "desc", page: 3 });
    const href = crmHref(full);
    expect(href).toBe("/client/candidates?view=rejected&q=ada+lovelace&sort=owner&dir=desc&page=3");
    expect(parseCrmQuery(Object.fromEntries(new URL(href, "http://x").searchParams))).toEqual(full);
  });
});

describe("the table", () => {
  test("counts each view after the search; one candidate can count in several", () => {
    const people = [
      person("Ann", [app("rejected"), app("interviewing")]),
      person("Ben", [app("hired")]),
      person("Cat", []),
      person("Dan", [app("withdrawn")]),
    ];
    expect(crmTable(people, q()).counts).toEqual({ all: 4, active: 1, hired: 1, rejected: 1, withdrew: 1 });
    expect(crmTable(people, q({ q: "an" })).counts).toEqual({ all: 2, active: 1, hired: 0, rejected: 1, withdrew: 1 });
    expect(crmTable(people, q({ view: "rejected" })).rows.map((r) => r.name)).toEqual(["Ann"]);
  });

  test("50 rows a page; a page past the end shows the last", () => {
    const people = Array.from({ length: CRM_PAGE_SIZE * 2 + 3 }, (_, i) => person(`P${String(i).padStart(3, "0")}`, []));
    const page1 = crmTable(people, q({ sort: "name", dir: "asc" }));
    expect(page1).toMatchObject({ total: 103, page: 1, pages: 3 });
    expect(page1.rows).toHaveLength(50);
    expect(page1.rows[0]!.name).toBe("P000");
    const last = crmTable(people, q({ sort: "name", dir: "asc", page: 99 }));
    expect(last.page).toBe(3);
    expect(last.rows.map((r) => r.name)).toEqual(["P100", "P101", "P102"]);
  });
});

describe("a department's candidates", () => {
  test("each keeps only their applications to its jobs; whoever has none there drops out", () => {
    const ana = person("Ana", [app("offer", { jobId: "eng-1" }), app("hired", { jobId: "prod-1" })]);
    const bo = person("Bo", [app("screening", { jobId: "prod-1" })]);
    const prospect = person("Cy", []);
    const scoped = inJobs([ana, bo, prospect], new Set(["eng-1", "eng-2"]));
    expect(scoped.map((c) => c.name)).toEqual(["Ana"]);
    expect(scoped[0].applications.map((a) => a.jobId)).toEqual(["eng-1"]);
    // so the views count the department's applications: Ana is not Hired here
    const table = crmTable(scoped, q());
    expect(table.counts).toMatchObject({ all: 1, active: 1, hired: 0 });
    expect(inJobs([ana], new Set())).toEqual([]);
  });

  test("the department rides in the URL with the rest", () => {
    const full = q({ department: "dep-1", view: "hired", page: 2 });
    const href = crmHref(full);
    expect(href).toBe("/client/candidates?department=dep-1&view=hired&page=2");
    expect(parseCrmQuery(Object.fromEntries(new URL(href, "http://x").searchParams))).toEqual(full);
    expect(parseCrmQuery({ department: "  " }).department).toBeNull();
  });
});

describe("stage names", () => {
  test("a row names its lead application, and a name goes on by that id", () => {
    const lead = app("offer");
    const row = rowFor(person("Ana", [app("sourced"), lead]), "all")!;
    expect(row.lead).toEqual({ applicationId: lead.applicationId, jobId: lead.jobId });
    expect(withStageNames([row], new Map([[lead.applicationId, "Offer letter"]]))[0].stageName).toBe("Offer letter");
    expect(withStageNames([row], new Map())[0].stageName).toBeNull();
    expect(rowFor(person("Bo", []), "all")!.lead).toBeNull();
  });

  test("the stage column sorts by the enum, whatever the stages are called", () => {
    const rows = [rowFor(person("Ana", [app("sourced")]), "all")!, rowFor(person("Bo", [app("offer")]), "all")!];
    const named = withStageNames(rows, new Map([[rows[1].lead!.applicationId, "Aardvark"], [rows[0].lead!.applicationId, "Zebra"]]));
    expect(sortRows(named, "stage", "asc").map((r) => r.name)).toEqual(["Bo", "Ana"]);
  });
});
