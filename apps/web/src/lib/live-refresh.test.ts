import { describe, expect, test } from "vitest";
import { HOLDING, LIVE_BACK_MS, LIVE_CHECK_MS, LIVE_START, answered, asked, held, parseStamp, refreshed, shouldAsk, shouldRefresh, type Live } from "./live-refresh";

const T = 1_000_000;
const after = (): Live => ({ stamp: "a", asked: T, due: false });

describe("when a tab asks for the stamp", () => {
  test("on mounting, at once", () => {
    expect(shouldAsk(LIVE_START, T, "start", false)).toBe(true);
    expect(shouldAsk(after(), T, "start", false)).toBe(true);
  });

  test("a hidden tab never asks, whatever woke it", () => {
    for (const why of ["start", "tick", "back"] as const) {
      expect(shouldAsk(LIVE_START, T, why, true)).toBe(false);
      expect(shouldAsk(after(), T + 10 * LIVE_CHECK_MS, why, true)).toBe(false);
    }
  });

  test("a tick asks only once the check interval has passed", () => {
    expect(shouldAsk(after(), T + LIVE_CHECK_MS - 1, "tick", false)).toBe(false);
    expect(shouldAsk(after(), T + LIVE_CHECK_MS, "tick", false)).toBe(true);
  });

  test("coming back asks soon, but not twice for one return (focus and visibility both fire)", () => {
    expect(shouldAsk(after(), T + LIVE_BACK_MS - 1, "back", false)).toBe(false);
    expect(shouldAsk(after(), T + LIVE_BACK_MS, "back", false)).toBe(true);
    expect(LIVE_BACK_MS).toBeLessThan(LIVE_CHECK_MS);
  });

  test("never asked yet: any wake asks", () => {
    expect(shouldAsk(LIVE_START, T, "tick", false)).toBe(true);
    expect(shouldAsk(LIVE_START, T, "back", false)).toBe(true);
  });

  test("asking records when", () => {
    expect(asked(LIVE_START, T)).toEqual({ stamp: null, asked: T, due: false });
  });
});

describe("what an answer means", () => {
  test("the first is the page as drawn, not a change", () => {
    expect(answered(LIVE_START, "a")).toEqual({ stamp: "a", asked: null, due: false });
  });

  test("the same stamp changes nothing", () => {
    const live = { stamp: "a", asked: T, due: false };
    expect(answered(live, "a")).toBe(live);
  });

  test("a new stamp is due a re-read, and becomes the baseline", () => {
    expect(answered({ stamp: "a", asked: T, due: false }, "b")).toEqual({ stamp: "b", asked: T, due: true });
  });

  test("a failed read knows nothing: no baseline, no change, and a due re-read stays due", () => {
    expect(answered(LIVE_START, null)).toBe(LIVE_START);
    const due = { stamp: "b", asked: T, due: true };
    expect(answered(due, null)).toBe(due);
  });

  test("going back to an earlier stamp is still a change", () => {
    expect(answered({ stamp: "b", asked: T, due: false }, "a").due).toBe(true);
  });
});

describe("when the page re-reads", () => {
  const due: Live = { stamp: "b", asked: T, due: true };

  test("only with a change due, a visible tab and a member not busy", () => {
    expect(shouldRefresh(due, false, false)).toBe(true);
    expect(shouldRefresh({ ...due, due: false }, false, false)).toBe(false);
    expect(shouldRefresh(due, true, false)).toBe(false);
    expect(shouldRefresh(due, false, true)).toBe(false);
  });

  test("a held change waits, then lands once the hold lifts", () => {
    let live = due;
    expect(shouldRefresh(live, false, true)).toBe(false);
    live = answered(live, "b");
    expect(shouldRefresh(live, false, false)).toBe(true);
    live = refreshed(live);
    expect(live).toEqual({ stamp: "b", asked: T, due: false });
    expect(shouldRefresh(live, false, false)).toBe(false);
  });
});

describe("the answer from GET /client/live", () => {
  test("a stamp, or nothing", () => {
    expect(parseStamp({ stamp: "e1:a1:2026-11-02T10:00:00Z" })).toBe("e1:a1:2026-11-02T10:00:00Z");
    expect(parseStamp({ stamp: null })).toBeNull();
    expect(parseStamp({ stamp: "" })).toBeNull();
    expect(parseStamp({ stamp: 3 })).toBeNull();
    expect(parseStamp(null)).toBeNull();
    expect(parseStamp("e1")).toBeNull();
  });
});

describe("what holds a re-read", () => {
  const doc = (active: unknown, open: string[] = []) => ({
    activeElement: active,
    querySelector: (selector: string) => (selector === HOLDING && open.length ? {} : null),
  });

  test("nothing: the body has focus and nothing is open", () => {
    expect(held(doc({ tagName: "BODY" }), false)).toBe(false);
    expect(held(doc(null), false)).toBe(false);
    expect(held(doc({ tagName: "A" }), false)).toBe(false);
  });

  test("a drag in progress", () => {
    expect(held(doc({ tagName: "BODY" }), true)).toBe(true);
  });

  test("typing in a field", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) expect(held(doc({ tagName }), false)).toBe(true);
    expect(held(doc({ tagName: "DIV", isContentEditable: true }), false)).toBe(true);
  });

  test("a pop-up, a dialog or a menu open", () => {
    expect(held(doc({ tagName: "BODY" }, ["dialog"]), false)).toBe(true);
  });

  test("the selector names the pop-ups, native dialogs and menus", () => {
    expect(HOLDING).toContain('[role="dialog"]');
    expect(HOLDING).toContain("dialog[open]");
    expect(HOLDING).toContain('[role="menu"]');
  });
});
