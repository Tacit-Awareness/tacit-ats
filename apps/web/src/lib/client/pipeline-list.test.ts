import { describe, expect, it } from "vitest";
import type { PipelineEntry } from "./pipeline";
import { ROW_PREVIEW, defaultMode, factsOf, modeParam, parseLayout, pipelineHref, resolveMode, rowGroups, shortSpan, stageCounts, statusOf, toRow, type ModeContext, type PipelineUrl } from "./pipeline-list";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

let id = 0;
function entry(over: Partial<PipelineEntry> = {}): PipelineEntry {
  id += 1;
  return {
    applicationId: `app-${id}`,
    personId: `person-${id}`,
    personName: `Person ${id}`,
    headline: null,
    stage: "screening",
    source: "other",
    sourceDetail: null,
    ownerActorId: null,
    ownerName: null,
    lastTouchAt: daysAgo(1),
    nextAction: null,
    nextActionDue: null,
    nextActionOwnerActorId: null,
    nextActionOwnerName: null,
    stalled: [],
    addedAt: daysAgo(10),
    roleId: "role-1",
    roleTitle: "Staff Engineer",
    column: "screening",
    interviews: [],
    editable: true,
    ...over,
  };
}

const plain: ModeContext = { stage: null, source: null, tag: null, view: null, all: null, q: null };

describe("the mode a URL means", () => {
  it("opens on Stuck", () => {
    expect(defaultMode(plain)).toBe("stuck");
    expect(resolveMode(undefined, plain)).toBe("stuck");
  });

  it.each([
    ["a saved view", { view: "referrals" }],
    ["a view's stage", { stage: "booked" }],
    ["a view's source", { source: "referral" }],
    ["a view's label", { tag: "b0000000-0000-4000-8000-000000000000" }],
    ["Home's link to a whole stage", { all: "screening" }],
    ["a name search", { q: "ada" }],
  ])("opens %s in Everyone, so Stuck cannot hide what the URL names", (_, over) => {
    expect(resolveMode(undefined, { ...plain, ...over })).toBe("everyone");
  });

  it("lets ?mode= win either way, and ignores anything else", () => {
    expect(resolveMode("everyone", plain)).toBe("everyone");
    expect(resolveMode("stuck", { ...plain, stage: "booked" })).toBe("stuck");
    expect(resolveMode("nonsense", plain)).toBe("stuck");
  });

  it("writes ?mode= only where the target URL would not open on it", () => {
    expect(modeParam("stuck", plain)).toBeNull();
    expect(modeParam("everyone", plain)).toBe("everyone");
    // A stage picked from the bar while on Stuck stays on Stuck.
    expect(modeParam("stuck", { ...plain, stage: "new" })).toBe("stuck");
    // Clearing that stage from Everyone stays on Everyone.
    expect(modeParam("everyone", { ...plain, stage: "new" })).toBeNull();
  });
});

describe("the layout and the pop-up in the URL", () => {
  const page: PipelineUrl = { department: null, job: null, q: null, all: null, mode: "stuck", stage: null, source: null, tag: null, view: null };

  it("only `list` is a layout: the board is what a job opens on", () => {
    expect(parseLayout("list")).toBe("list");
    expect(parseLayout("board")).toBeNull();
    expect(parseLayout("garbage")).toBeNull();
    expect(parseLayout(undefined)).toBeNull();
  });

  it("the list needs a job: across jobs it is all there is", () => {
    expect(pipelineHref(page, { layout: "list" })).toBe("/client/pipeline");
    expect(pipelineHref({ ...page, job: "j1" }, { layout: "list" })).toBe("/client/pipeline?job=j1&layout=list");
  });

  it("it stays on the links that follow, and goes with the job or when asked", () => {
    const list: PipelineUrl = { ...page, job: "j1", layout: "list" };
    expect(pipelineHref(list, { job: "j2" })).toBe("/client/pipeline?job=j2&layout=list");
    expect(pipelineHref(list, { job: null })).toBe("/client/pipeline");
    expect(pipelineHref(list, { layout: null })).toBe("/client/pipeline?job=j1");
  });

  it("a row's link opens it, and no other link carries it on", () => {
    expect(pipelineHref(page, { open: "a1" })).toBe("/client/pipeline?open=a1");
    expect(pipelineHref({ ...page, q: "ann", mode: "everyone" }, { open: "a1" })).toBe("/client/pipeline?q=ann&open=a1");
    expect(pipelineHref(page, {})).not.toContain("open");
  });
});

describe("pipelineHref", () => {
  const page: PipelineUrl = { department: null, job: null, q: null, all: null, mode: "stuck", stage: null, source: null, tag: null, view: null };
  const view: PipelineUrl = { ...page, mode: "everyone", stage: "booked", source: "referral", view: "v123" };

  it("keeps the plain URL plain", () => {
    expect(pipelineHref(page, {})).toBe("/client/pipeline");
    expect(pipelineHref(page, { mode: "stuck" })).toBe("/client/pipeline");
  });

  it("the stage bar sets the stage and stays on Stuck", () => {
    expect(pipelineHref(page, { stage: "new" })).toBe("/client/pipeline?mode=stuck&stage=new");
  });

  it("clicking the stage again clears it, in either mode", () => {
    expect(pipelineHref({ ...page, stage: "new" }, { stage: null })).toBe("/client/pipeline");
    expect(pipelineHref({ ...page, mode: "everyone", stage: "new" }, { stage: null })).toBe("/client/pipeline?mode=everyone");
  });

  it("a saved view's link round-trips, with the same filters and name", () => {
    expect(pipelineHref(view, {})).toBe("/client/pipeline?stage=booked&source=referral&view=v123");
  });

  it("using the stage bar on a view drops its name and keeps its other filters", () => {
    expect(pipelineHref(view, { stage: "new" })).toBe("/client/pipeline?stage=new&source=referral");
    expect(pipelineHref(view, { stage: null })).toBe("/client/pipeline?source=referral");
  });

  it("switching mode on a view keeps the view", () => {
    expect(pipelineHref(view, { mode: "stuck" })).toBe("/client/pipeline?mode=stuck&stage=booked&source=referral&view=v123");
  });

  it("a department leaves the view, as it always did, and keeps what the member was looking at", () => {
    expect(pipelineHref(view, { department: "d1", job: null, all: null, leaveView: true })).toBe("/client/pipeline?department=d1&mode=everyone");
  });

  it("Show all stays in Everyone, and Show fewer does too", () => {
    const everyone = { ...page, mode: "everyone" as const };
    expect(pipelineHref(everyone, { all: "new" })).toBe("/client/pipeline?all=new");
    expect(pipelineHref({ ...everyone, all: "new" }, { all: null })).toBe("/client/pipeline?mode=everyone");
  });

  it("carries the search, and picking a job keeps a saved view's stage", () => {
    expect(pipelineHref({ ...page, q: "ada", mode: "everyone" }, { job: "r1" })).toBe("/client/pipeline?job=r1&q=ada");
    expect(pipelineHref(view, { job: "r1" })).toBe("/client/pipeline?job=r1&stage=booked&source=referral&view=v123");
  });
});

describe("the stage bar", () => {
  it("counts every stage, empty ones too, with its stuck count and red share", () => {
    const bar = stageCounts([entry({ column: "new" }), entry({ column: "new", stalled: ["no_touch"] }), entry({ column: "new", stalled: ["overdue"] }), entry({ column: "offer" })]);
    expect(bar.map((s) => s.key)).toEqual(["new", "screening", "scheduling", "booked", "decide", "offer"]);
    expect(bar[0]).toMatchObject({ label: "New", total: 3, stuck: 2, share: 67 });
    expect(bar[1]).toMatchObject({ total: 0, stuck: 0, share: 0 });
    expect(bar[5]).toMatchObject({ total: 1, stuck: 0, share: 0 });
  });
});

describe("rowGroups", () => {
  const opts = { stage: null, expanded: null, now: NOW } as const;

  it("Stuck keeps only people whose stalled is non-empty", () => {
    const stuck = entry({ stalled: ["overdue"] });
    const groups = rowGroups([entry(), stuck], { ...opts, mode: "stuck" });
    expect(groups.flatMap((g) => g.rows.map((r) => r.applicationId))).toEqual([stuck.applicationId]);
  });

  it("Stuck shows the longest quiet first and never holds anyone back", () => {
    const list = Array.from({ length: ROW_PREVIEW + 3 }, (_, i) => entry({ column: "new", stalled: ["no_touch"], lastTouchAt: daysAgo(8 + i) }));
    const [group] = rowGroups(list, { ...opts, mode: "stuck" });
    expect(group.rows).toHaveLength(ROW_PREVIEW + 3);
    expect(group.more).toBeNull();
    expect(group.rows[0].applicationId).toBe(list.at(-1)?.applicationId);
  });

  it("a stage filters, and groups come in the board's order with empty stages left out", () => {
    const list = [entry({ column: "offer" }), entry({ column: "new" }), entry({ column: "screening" })];
    expect(rowGroups(list, { ...opts, mode: "everyone" }).map((g) => g.key)).toEqual(["new", "screening", "offer"]);
    expect(rowGroups(list, { ...opts, mode: "everyone", stage: "offer" }).map((g) => g.key)).toEqual(["offer"]);
  });

  it("Everyone shows a dozen a stage, with Show all, and Show fewer once expanded", () => {
    const list = Array.from({ length: ROW_PREVIEW + 1 }, () => entry({ column: "new" }));
    const [closed] = rowGroups(list, { ...opts, mode: "everyone" });
    expect(closed.rows).toHaveLength(ROW_PREVIEW);
    expect(closed.total).toBe(ROW_PREVIEW + 1);
    expect(closed.more).toEqual({ all: "new", label: `Show all ${ROW_PREVIEW + 1} in New` });
    const [open] = rowGroups(list, { ...opts, mode: "everyone", expanded: "new" });
    expect(open.rows).toHaveLength(ROW_PREVIEW + 1);
    expect(open.more).toEqual({ all: null, label: "Show fewer" });
  });

  it("has no link when a stage fits", () => {
    const list = Array.from({ length: ROW_PREVIEW }, () => entry({ column: "new" }));
    expect(rowGroups(list, { ...opts, mode: "everyone" })[0].more).toBeNull();
  });

  it("is empty when nobody is stuck, for the friendly state", () => {
    expect(rowGroups([entry(), entry()], { ...opts, mode: "stuck" })).toEqual([]);
  });
});

describe("a row with no name", () => {
  it("says Unnamed, as Applicant Tickets do", () => {
    expect(toRow(entry({ personName: "   " }), NOW).name).toBe("Unnamed");
    expect(toRow(entry({ personName: "" }), NOW).name).toBe("Unnamed");
  });
});

describe("a row", () => {
  it("links to the candidate and carries the status, facts and time", () => {
    const e = entry({ column: "new", sourceDetail: "Ana Ruiz", source: "referral", ownerName: "Sam", stalled: ["no_touch"], lastTouchAt: daysAgo(9), headline: "Engineer at Acme" });
    expect(toRow(e, NOW)).toEqual({
      applicationId: e.applicationId,
      href: `/client/candidates/${e.personId}`,
      name: e.personName,
      status: "Ana Ruiz",
      facts: "Staff Engineer · No touch in a week · Sam · Referred · Engineer at Acme",
      time: "9d",
      stuck: true,
    });
  });

  it("shows only facts we have", () => {
    expect(factsOf(entry())).toEqual(["Staff Engineer"]);
  });

  it("keeps the board's status line", () => {
    expect(statusOf(entry({ column: "scheduling" }), NOW)).toBe("No interview booked");
    const iv = { startsAt: daysAgo(-2), endsAt: daysAgo(-1.9), status: "scheduled" };
    expect(statusOf(entry({ column: "booked", interviews: [iv] }), NOW)).toBe("Interview in 2d");
  });

  it("spans time as the prototype does", () => {
    expect(shortSpan(new Date(NOW - 20 * 60_000).toISOString(), NOW)).toBe("<1h");
    expect(shortSpan(new Date(NOW - 5 * 3_600_000).toISOString(), NOW)).toBe("5h");
    expect(shortSpan(daysAgo(3), NOW)).toBe("3d");
  });
});
