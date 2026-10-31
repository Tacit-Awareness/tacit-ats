import { describe, expect, test } from "vitest";
import { UI_BASE, UI_MAX, UI_SCALE_SCRIPT, fitScale } from "./ui-scale";

describe("fitScale", () => {
  test("never shrinks the layout", () => {
    expect(fitScale(375, 812)).toBe(1);
    expect(fitScale(UI_BASE.width, UI_BASE.height)).toBe(1);
  });

  test("takes the smaller ratio, so nothing runs off the window", () => {
    expect(fitScale(2160, 840)).toBe(1);
    expect(fitScale(2160, 1260)).toBe(1.5);
    expect(fitScale(2560, 1000)).toBe(1.19);
  });

  test("stops at the cap", () => {
    expect(fitScale(5120, 2880)).toBe(UI_MAX);
  });

  test("the before-paint script works it out the same way", () => {
    const set: string[] = [];
    const run = new Function("document", "innerWidth", "innerHeight", UI_SCALE_SCRIPT);
    run({ documentElement: { style: { setProperty: (_: string, v: string) => set.push(v) } } }, 2560, 1440);
    expect(set).toEqual([String(fitScale(2560, 1440))]);
  });
});
