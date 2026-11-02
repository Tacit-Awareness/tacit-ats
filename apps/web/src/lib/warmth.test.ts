import { describe, expect, test } from "vitest";

import { MAX_WARMTH, WARMTH_LEVELS, displayId, isNight, levelAt, parseWarmth, warmthHint, warmthKey, warmthMatrix, withLevel } from "./warmth";

const at = (h: number, m = 0) => new Date(2026, 10, 2, h, m);

describe("warmth correction", () => {
  test("Off draws no filter; only a real level has a matrix", () => {
    expect(warmthMatrix(0)).toBeNull();
    for (const v of [-1, 5, 1.5, Number.NaN]) expect(warmthMatrix(v), String(v)).toBeNull();
    expect(warmthMatrix(1)).toBe("0.965 0 0 0 0  0 0.985 0 0 0  0 0 1 0 0  0 0 0 1 0");
    expect(warmthMatrix(MAX_WARMTH)).toBe("0.85 0 0 0 0  0 0.93 0 0 0  0 0 1 0 0  0 0 0 1 0");
  });

  test("each level cools further, trimming red more than green and never touching blue", () => {
    expect(WARMTH_LEVELS[0]).toEqual([1, 1]);
    for (let i = 1; i < WARMTH_LEVELS.length; i++) {
      const [r, g] = WARMTH_LEVELS[i];
      const [pr, pg] = WARMTH_LEVELS[i - 1];
      expect(r).toBeLessThan(pr);
      expect(g).toBeLessThan(pg);
      expect(r).toBeLessThan(g);
    }
  });

  test("night is 7pm to 7am", () => {
    expect(isNight(at(18, 59))).toBe(false);
    expect(isNight(at(19))).toBe(true);
    expect(isNight(at(0))).toBe(true);
    expect(isNight(at(6, 59))).toBe(true);
    expect(isNight(at(7))).toBe(false);
    expect(isNight(at(12))).toBe(false);
  });

  test("a level is kept per display and per day or night", () => {
    const laptop = displayId({ width: 1512, height: 982, dpr: 2, p3: true });
    const monitor = displayId({ width: 2560, height: 1440, dpr: 1, p3: false });
    expect(laptop).toBe("1512x982@2p3");
    expect(monitor).toBe("2560x1440@1");
    expect(warmthKey(laptop, true)).toBe("1512x982@2p3|night");
    expect(warmthKey(laptop, false)).toBe("1512x982@2p3|day");

    let s = withLevel({}, warmthKey(laptop, true), 3);
    s = withLevel(s, warmthKey(monitor, false), 1);
    expect(levelAt(s, warmthKey(laptop, true))).toBe(3);
    expect(levelAt(s, warmthKey(laptop, false))).toBe(0);
    expect(levelAt(s, warmthKey(monitor, false))).toBe(1);
  });

  test("Off removes the display's entry rather than storing a 0", () => {
    const s = withLevel({ "a|day": 2, "b|night": 4 }, "a|day", 0);
    expect(s).toEqual({ "b|night": 4 });
    expect(withLevel(s, "b|night", 9)).toEqual({});
  });

  test("storage that is missing or corrupt reads as nothing remembered", () => {
    for (const v of [null, undefined, "x", 3, [1, 2]]) expect(parseWarmth(v), String(v)).toEqual({});
    expect(parseWarmth({ "a|day": 2, "b|night": 0, "c|day": 7, "d|day": "2", nokey: 1, "e|night": 4 })).toEqual({ "a|day": 2, "e|night": 4 });
  });

  test("the hint says which half of the day it corrects", () => {
    expect(warmthHint(true)).toContain("at night");
    expect(warmthHint(false)).toContain("by day");
  });
});
