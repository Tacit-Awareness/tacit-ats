import { describe, expect, test } from "vitest";

import {
  BUILT_IN_VIEWS,
  NO_VIEWS,
  VIEWS_MAX,
  VIEW_NAME_MAX,
  addView,
  describeFilters,
  hasFilters,
  newViewId,
  parseViewFilters,
  parseViewId,
  parseViews,
  pinnedViews,
  removeView,
  rowSource,
  togglePin,
  viewById,
  viewHref,
  viewKeeps,
  type SavedView,
  type ViewRow,
} from "./saved-views";

const DEPT = "11111111-1111-4111-8111-111111111111";
const TAG = "22222222-2222-4222-8222-222222222222";
const none = { department: null, stage: null, source: null, tag: null };
const view = (over: Partial<SavedView> = {}): SavedView => ({ ...none, id: "v1", name: "Mine", desc: "", ...over });
const row = (over: Partial<ViewRow> = {}): ViewRow => ({ roleId: "r1", column: "new", source: "careers", tagIds: [], ...over });

describe("a view's link", () => {
  test("spells the filters out, so the server needs nothing from the browser", () => {
    const href = viewHref(view({ department: DEPT, stage: "booked", source: "referral", tag: TAG }));
    expect(href.startsWith("/client/pipeline?")).toBe(true);
    const p = new URLSearchParams(href.split("?")[1]);
    expect(parseViewFilters({ department: p.get("department")!, stage: p.get("stage")!, source: p.get("source")!, tag: p.get("tag")! })).toEqual({
      department: DEPT,
      stage: "booked",
      source: "referral",
      tag: TAG,
    });
    expect(parseViewId(p.get("view")!)).toBe("v1");
  });

  test("a view with no filters still has a link", () => {
    expect(viewHref(view())).toBe("/client/pipeline?view=v1");
  });
});

describe("the URL's filters", () => {
  test("anything we did not write is no filter", () => {
    expect(parseViewFilters({ department: "x", stage: "closed", source: "toString", tag: "'; drop" })).toEqual(none);
    expect(parseViewFilters({})).toEqual(none);
    expect(hasFilters(parseViewFilters({ stage: "offer" }))).toBe(true);
    expect(hasFilters(none)).toBe(false);
  });

  test("an id reads the same however it was cased: the database's are lower case", () => {
    expect(parseViewFilters({ department: DEPT.toUpperCase().replace(/^1/, "A"), tag: "ABCDEF01-2222-4222-8222-222222222222" })).toEqual({
      ...none,
      department: "a1111111-1111-4111-8111-111111111111",
      tag: "abcdef01-2222-4222-8222-222222222222",
    });
    const stored = parseViews({ custom: [{ ...view(), tag: "ABCDEF01-2222-4222-8222-222222222222" }] });
    expect(stored.custom[0].tag).toBe("abcdef01-2222-4222-8222-222222222222");
  });

  test("?view= is a built-in or one made here", () => {
    expect(parseViewId("referrals")).toBe("referrals");
    expect(parseViewId("v1700000000000")).toBe("v1700000000000");
    for (const bad of [undefined, "", "v", "vx", "constructor", "<b>", `v${"1".repeat(40)}`]) expect(parseViewId(bad), String(bad)).toBeNull();
  });
});

describe("what a view keeps", () => {
  test("stage, source and label each narrow; no filter keeps everything", () => {
    expect(viewKeeps(none, row(), null)).toBe(true);
    expect(viewKeeps({ ...none, stage: "booked" }, row(), null)).toBe(false);
    expect(viewKeeps({ ...none, stage: "new" }, row(), null)).toBe(true);
    expect(viewKeeps({ ...none, source: "referral" }, row(), null)).toBe(false);
    expect(viewKeeps({ ...none, source: "careers" }, row(), null)).toBe(true);
    expect(viewKeeps({ ...none, tag: TAG }, row(), null)).toBe(false);
    expect(viewKeeps({ ...none, tag: TAG }, row({ tagIds: [TAG] }), null)).toBe(true);
  });

  test("a department narrows by its jobs; null, one no longer on offer, narrows nothing", () => {
    expect(viewKeeps({ ...none, department: DEPT }, row(), new Set(["r2"]))).toBe(false);
    expect(viewKeeps({ ...none, department: DEPT }, row(), new Set(["r1"]))).toBe(true);
    expect(viewKeeps({ ...none, department: DEPT }, row(), null)).toBe(true);
  });

  test("source is Analytics' channel: Tacit's submissions are not any agency", () => {
    expect(rowSource({ source: "agency", sourceDetail: "Tacit · Ryan" })).toBe("tacit");
    expect(rowSource({ source: "agency", sourceDetail: "Hunt & Co" })).toBe("agency");
    expect(rowSource({ source: "job_board", sourceDetail: null })).toBe("careers");
  });
});

describe("describing a view", () => {
  test("names what it filters on, in the form's order", () => {
    expect(describeFilters({ department: DEPT, stage: "booked", source: "referral", tag: TAG }, { department: "Eng › Infra", tag: "Competing offer" })).toBe(
      "Eng › Infra · Interview booked · Referred · Competing offer",
    );
  });

  test("no filters, or names nobody could read, is all applicants", () => {
    expect(describeFilters(none, {})).toBe("All applicants");
    expect(describeFilters({ ...none, tag: TAG }, { tag: null })).toBe("All applicants");
  });
});

describe("what storage held", () => {
  test("round-trips", () => {
    const s = { pins: ["referrals", "v1"], custom: [view({ source: "referral", desc: "Referred" })] };
    expect(parseViews(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  test("anything that is not ours is no views", () => {
    for (const bad of [null, undefined, 3, "x", [], { pins: "x", custom: {} }]) expect(parseViews(bad), JSON.stringify(bad)).toEqual(NO_VIEWS);
  });

  test("a bad entry is dropped and the rest kept", () => {
    const parsed = parseViews({
      pins: ["v1", "gone", 7, "v1"],
      custom: [view(), view({ id: "referrals" }), view({ id: "v2", name: "   " }), view({ id: "v3", name: "x".repeat(VIEW_NAME_MAX + 1) }), { id: "v4" }, 12, null, view({ name: "again" })],
    });
    expect(parsed.custom.map((v) => v.id)).toEqual(["v1"]);
    expect(parsed.pins).toEqual(["v1"]);
  });

  test("a stored filter is checked as the URL's is", () => {
    const parsed = parseViews({ custom: [{ ...view(), stage: "closed", source: 1, department: "x", tag: {} }] });
    expect(parsed.custom[0]).toMatchObject(none);
  });

  test("a stored view cannot grow past the cap, or stand in for a built-in", () => {
    const many = Array.from({ length: VIEWS_MAX + 5 }, (_, i) => view({ id: `v${i}` }));
    expect(parseViews({ custom: many }).custom).toHaveLength(VIEWS_MAX);
    expect(viewById(parseViews({ custom: [view({ id: "referrals", name: "Fake" })] }), "referrals")?.name).toBe("Referrals");
  });
});

describe("changing the views", () => {
  const made = (s = NO_VIEWS, over: Partial<Parameters<typeof addView>[1]> = {}) => addView(s, { ...none, id: "v9", name: " Mine ", desc: "", pin: true, ...over });

  test("adding trims the name and pins when asked", () => {
    expect(made()).toEqual({ pins: ["v9"], custom: [{ ...none, id: "v9", name: "Mine", desc: "" }] });
    expect(made(NO_VIEWS, { pin: false })?.pins).toEqual([]);
  });

  test("refuses no name, too long a name, or too many", () => {
    expect(made(NO_VIEWS, { name: "   " })).toBeNull();
    expect(made(NO_VIEWS, { name: "x".repeat(VIEW_NAME_MAX + 1) })).toBeNull();
    expect(made({ pins: [], custom: Array.from({ length: VIEWS_MAX }, (_, i) => view({ id: `v${i}` })) })).toBeNull();
  });

  test("ids from the same millisecond do not collide", () => {
    const s = { pins: [], custom: [view({ id: "v5" }), view({ id: "v6" })] };
    expect(newViewId(s, 5)).toBe("v7");
    expect(newViewId(s, 8)).toBe("v8");
  });

  test("pinning toggles, in the order pinned; a built-in pins too", () => {
    const s = togglePin(togglePin({ pins: [], custom: [view()] }, "v1"), "referrals");
    expect(pinnedViews(s).map((v) => v.id)).toEqual(["v1", "referrals"]);
    expect(togglePin(s, "v1").pins).toEqual(["referrals"]);
  });

  test("removing takes the pin with it", () => {
    expect(removeView({ pins: ["v1", "referrals"], custom: [view()] }, "v1")).toEqual({ pins: ["referrals"], custom: [] });
  });

  test("a pin with nothing behind it is not drawn", () => {
    expect(pinnedViews({ pins: ["gone"], custom: [] })).toEqual([]);
  });

  test("the built-ins are only what the data records: no Testbench score", () => {
    expect(BUILT_IN_VIEWS.map((v) => v.id)).toEqual(["referrals"]);
  });
});
