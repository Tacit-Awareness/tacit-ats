import { describe, expect, test } from "vitest";

import { MARKS_TTL_MS, NO_MARKS, hasNew, marksStale, parseMarks } from "./sidebar-marks";

describe("the sidebar's mark", () => {
  test("nothing there, or not known yet, is no tint", () => {
    expect(hasNew(null, null)).toBe(false);
    expect(hasNew([], null)).toBe(false);
    expect(hasNew([], ["a"])).toBe(false);
  });

  test("never opened, anything there is new, as the prototype", () => {
    expect(hasNew(["a"], null)).toBe(true);
  });

  test("clears once the page has shown it, and stays clear when items leave", () => {
    expect(hasNew(["a", "b"], ["a", "b"])).toBe(false);
    expect(hasNew(["a"], ["a", "b"])).toBe(false);
  });

  test("something that arrived since is new, even if the list did not grow", () => {
    expect(hasNew(["a", "c"], ["a", "b"])).toBe(true);
  });
});

describe("reading what storage or the route gave", () => {
  test("garbage knows nothing", () => {
    for (const bad of [null, undefined, "x", 4, []]) expect(parseMarks(bad), JSON.stringify(bad)).toEqual(NO_MARKS);
  });

  test("each list stands alone, and only strings count", () => {
    expect(parseMarks({ inbox: ["a", 1, null], tickets: "x" })).toEqual({ inbox: ["a"], tickets: null, activity: null });
    expect(parseMarks({ inbox: null, tickets: [], activity: ["t"] })).toEqual({ inbox: null, tickets: [], activity: ["t"] });
  });
});

describe("when to read again", () => {
  test("first, then only after the wait", () => {
    expect(marksStale(null, 0)).toBe(true);
    expect(marksStale(1000, 1000 + MARKS_TTL_MS - 1)).toBe(false);
    expect(marksStale(1000, 1000 + MARKS_TTL_MS)).toBe(true);
  });
});
