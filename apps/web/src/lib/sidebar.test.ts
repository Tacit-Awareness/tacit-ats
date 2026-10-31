import { describe, expect, test } from "vitest";

import { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, SIDEBAR_RAIL, SIDEBAR_SNAP, dragSidebar, formatSidebar, parseSidebar } from "./sidebar";

describe("the sidebar cookie", () => {
  test("no cookie, or one we did not write, is the default open sidebar", () => {
    for (const v of [undefined, null, "", "wide", "c", "o:", "x:300", "o:-5", "o:12345"]) {
      expect(parseSidebar(v), String(v)).toEqual({ width: SIDEBAR_DEFAULT, collapsed: false });
    }
  });

  test("reads the width and the collapsed rail", () => {
    expect(parseSidebar("o:300")).toEqual({ width: 300, collapsed: false });
    expect(parseSidebar("c:300")).toEqual({ width: 300, collapsed: true });
  });

  test("a width out of range is clamped, so a stale cookie cannot hide the nav", () => {
    expect(parseSidebar("o:20").width).toBe(SIDEBAR_MIN);
    expect(parseSidebar("o:2000").width).toBe(SIDEBAR_MAX);
  });

  test("round-trips", () => {
    for (const s of [{ width: 240, collapsed: false }, { width: 380, collapsed: true }]) {
      expect(parseSidebar(formatSidebar(s))).toEqual(s);
    }
  });
});

describe("dragging the sidebar's edge", () => {
  test("follows the pointer between the limits", () => {
    expect(dragSidebar(300, 272)).toEqual({ width: 300, collapsed: false });
    expect(dragSidebar(9000, 272).width).toBe(SIDEBAR_MAX);
  });

  test("under the snap it folds and keeps the width it started with", () => {
    expect(dragSidebar(SIDEBAR_SNAP - 1, 300)).toEqual({ width: 300, collapsed: true });
  });

  test("the rail stays until the drag passes the snap, then opens at the narrowest", () => {
    expect(dragSidebar(SIDEBAR_RAIL + 20, 300)).toEqual({ width: 300, collapsed: true });
    expect(dragSidebar(SIDEBAR_SNAP, 300)).toEqual({ width: SIDEBAR_MIN, collapsed: false });
  });
});
