import { describe, expect, test } from "vitest";
import { WIDGETS, addWidget, cycleSize, defaultWidgets, formatWidgets, moveWidget, parseWidgets, removeWidget, type Placed } from "./home-widgets";

const keys = (l: Placed[]) => l.map((x) => x.k);

describe("the cookie", () => {
  test("no cookie is the default, and a layout comes back as it went in", () => {
    expect(parseWidgets(undefined)).toEqual(defaultWidgets());
    const layout: Placed[] = [{ k: "trend", w: 3 }, { k: "apps", w: 2 }];
    expect(parseWidgets(formatWidgets(layout))).toEqual(layout);
  });

  test("a layout with nothing on it stays empty", () => {
    expect(parseWidgets(formatWidgets([]))).toEqual([]);
  });

  test("what it should not hold is dropped, never thrown", () => {
    expect(parseWidgets("gone.1,apps.1,apps.2,__proto__.1,constructor.1")).toEqual([{ k: "apps", w: 1 }]);
    expect(parseWidgets("trend.1,hires.3,apps.x")).toEqual([{ k: "trend", w: 2 }, { k: "hires", w: 1 }, { k: "apps", w: 1 }]);
  });
});

test("every default size is one its widget takes", () => {
  for (const x of defaultWidgets()) expect(WIDGETS[x.k].sizes).toContain(x.w);
});

test("adding lands last at the first size, once", () => {
  const added = addWidget([{ k: "apps", w: 1 }], "stages");
  expect(added).toEqual([{ k: "apps", w: 1 }, { k: "stages", w: 2 }]);
  expect(addWidget(added, "apps")).toBe(added);
});

test("the default says each thing once: the applications chart across the top, New applications in the gallery", () => {
  expect(defaultWidgets()).toEqual([
    { k: "trend", w: 3 },
    { k: "active", w: 1 },
    { k: "review", w: 1 },
    { k: "sched", w: 1 },
    { k: "cards", w: 1 },
    { k: "load", w: 1 },
    { k: "hires", w: 1 },
  ]);
  expect(keys(defaultWidgets())).not.toContain("apps");
  // An empty cookie is no cookie: the same default, never an older one.
  expect(parseWidgets("")).toEqual(defaultWidgets());
});

test("removing takes only that one", () => {
  expect(keys(removeWidget(defaultWidgets(), "load"))).not.toContain("load");
  expect(removeWidget(defaultWidgets(), "load")).toHaveLength(defaultWidgets().length - 1);
});

test("the size pill goes round", () => {
  const one: Placed[] = [{ k: "apps", w: 1 }];
  expect(cycleSize(one, "apps")[0].w).toBe(2);
  expect(cycleSize(cycleSize(one, "apps"), "apps")[0].w).toBe(1);
});

describe("moving", () => {
  const abc: Placed[] = [{ k: "apps", w: 1 }, { k: "active", w: 1 }, { k: "review", w: 1 }, { k: "sched", w: 1 }];

  test("forward lands after, back lands before, so each passing swaps", () => {
    expect(keys(moveWidget(abc, "apps", "active"))).toEqual(["active", "apps", "review", "sched"]);
    expect(keys(moveWidget(abc, "apps", "review"))).toEqual(["active", "review", "apps", "sched"]);
    expect(keys(moveWidget(abc, "sched", "active"))).toEqual(["apps", "sched", "active", "review"]);
  });

  test("onto itself or something not there changes nothing", () => {
    expect(moveWidget(abc, "apps", "apps")).toBe(abc);
    expect(moveWidget(abc, "apps", "hires")).toBe(abc);
  });
});
