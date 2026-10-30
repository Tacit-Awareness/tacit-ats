import { describe, expect, test } from "vitest";
import { isOffTarget, parseTarget, targetField, targetRule, targetWords, type TargetMetric } from "./home-target-rules";

const post = (metric: unknown, value: unknown, unit: unknown = "d", clear: unknown = null) => parseTarget({ metric, value, unit, clear });

describe("isOffTarget", () => {
  test("a count is off below its target, not at it", () => {
    expect(isOffTarget("new_applications", 19, 20)).toBe(true);
    expect(isOffTarget("new_applications", 20, 20)).toBe(false);
    expect(isOffTarget("new_applications", 21, 20)).toBe(false);
  });

  test.each(["review", "schedule", "feedback", "workload"] as const)("%s is off over its target, not at it", (metric) => {
    expect(isOffTarget(metric, 49, 48)).toBe(true);
    expect(isOffTarget(metric, 48, 48)).toBe(false);
    expect(isOffTarget(metric, 47, 48)).toBe(false);
  });

  test("0 is a target, not a missing one", () => {
    expect(isOffTarget("review", 0.5, 0)).toBe(true);
    expect(isOffTarget("new_applications", 0, 0)).toBe(false);
  });

  test("no target, or nothing to compare, is never off", () => {
    expect(isOffTarget("review", 500, null)).toBe(false);
    expect(isOffTarget("review", 500, undefined)).toBe(false);
    expect(isOffTarget("review", null, 1)).toBe(false);
    expect(isOffTarget("new_applications", null, 1)).toBe(false);
  });
});

describe("targetWords", () => {
  test.each<[TargetMetric, number, string]>([
    ["new_applications", 20, "20"],
    ["new_applications", 1200, "1,200"],
    ["new_applications", 0, "0"],
    ["review", 72, "3d"],
    ["review", 60, "2.5d"],
    ["review", 48, "2d"],
    ["review", 36, "36h"],
    ["review", 1.5, "1.5h"],
    ["review", 0.5, "30m"],
    ["review", 0, "0h"],
    ["workload", 40, "40h"],
    ["workload", 240, "240h"],
    ["workload", 0, "0h"],
  ])("%s %s reads %s", (metric, value, words) => {
    expect(targetWords(metric, value)).toBe(words);
  });
});

describe("targetField", () => {
  test("none set: empty, days for a time and hours for a cap", () => {
    expect(targetField("review", null)).toEqual({ value: "", unit: "d" });
    expect(targetField("workload", null)).toEqual({ value: "", unit: "h" });
    expect(targetField("new_applications", null)).toEqual({ value: "", unit: "h" });
  });

  test("two days and up in days, as the card reads", () => {
    expect(targetField("review", 72)).toEqual({ value: "3", unit: "d" });
    expect(targetField("review", 60)).toEqual({ value: "2.5", unit: "d" });
  });

  test("under two days in hours", () => {
    expect(targetField("review", 36)).toEqual({ value: "36", unit: "h" });
  });

  test("a workload stays hours however large", () => {
    expect(targetField("workload", 240)).toEqual({ value: "240", unit: "h" });
  });

  // The prototype opened 49.5h as 2.1 days, so a Save with nothing changed made it 50.4h.
  test.each([48, 49.5, 50, 72.01, 100.1, 999.99, 1000.5, 123456.78, 1_000_000])("opening and saving %s leaves it as it was", (value) => {
    const field = targetField("schedule", value);
    expect(post("schedule", field.value, field.unit)).toEqual({ ok: true, metric: "schedule", value });
  });

  test("every value in two places of hours comes back unchanged", () => {
    for (let cents = 0; cents <= 20_000; cents += 7) {
      const value = cents / 100;
      const field = targetField("review", value);
      expect(post("review", field.value, field.unit)).toEqual({ ok: true, metric: "review", value });
    }
  });
});

describe("parseTarget", () => {
  test("days become hours, hours stay", () => {
    expect(post("review", "2", "d")).toEqual({ ok: true, metric: "review", value: 48 });
    expect(post("review", "1.5", "d")).toEqual({ ok: true, metric: "review", value: 36 });
    expect(post("review", "5", "h")).toEqual({ ok: true, metric: "review", value: 5 });
  });

  test("a count and a cap take no unit", () => {
    expect(post("new_applications", "20", "garbage")).toEqual({ ok: true, metric: "new_applications", value: 20 });
    expect(post("workload", "40", null)).toEqual({ ok: true, metric: "workload", value: 40 });
  });

  test("to two places, what the column keeps", () => {
    expect(post("review", "1.333", "d")).toEqual({ ok: true, metric: "review", value: 31.99 });
    expect(post("workload", "12.345", "h")).toEqual({ ok: true, metric: "workload", value: 12.35 });
  });

  test("0 is a target", () => {
    expect(post("review", "0", "h")).toEqual({ ok: true, metric: "review", value: 0 });
    expect(post("new_applications", "0")).toEqual({ ok: true, metric: "new_applications", value: 0 });
    expect(post("review", "0.00", "d")).toEqual({ ok: true, metric: "review", value: 0 });
  });

  test("blank means no target, as the prototype, and the field's edges are ignored", () => {
    expect(post("review", "")).toEqual({ ok: true, metric: "review", value: null });
    expect(post("review", "   ")).toEqual({ ok: true, metric: "review", value: null });
    expect(post("review", " 2 ", "d")).toEqual({ ok: true, metric: "review", value: 48 });
  });

  test("a post with no number in it is tampered, not a blank field, and removes nothing", () => {
    expect(post("review", null)).toEqual({ ok: false, error: "invalid" });
    expect(post("review", undefined)).toEqual({ ok: false, error: "invalid" });
    expect(post("review", new File(["2"], "2.txt"))).toEqual({ ok: false, error: "invalid" });
    expect(post("review", null, "d", "on")).toEqual({ ok: true, metric: "review", value: null });
  });

  test("Remove wins over whatever is in the field", () => {
    expect(post("review", "not a number", "garbage", "on")).toEqual({ ok: true, metric: "review", value: null });
  });

  test.each(["abc", "1,5", "-1", "+2", "1e3", "0x10", "Infinity", "NaN", "1.2.3", ".", "٣", "1 2", "1".repeat(33)])("%j is not a number", (value) => {
    expect(post("workload", value)).toEqual({ ok: false, error: "not_number" });
  });

  test("a count is whole", () => {
    expect(post("new_applications", "2.5")).toEqual({ ok: false, error: "not_whole" });
    expect(post("new_applications", "2.0")).toEqual({ ok: true, metric: "new_applications", value: 2 });
  });

  test("the limit is in hours, so days reach it sooner", () => {
    expect(post("workload", "1000000")).toEqual({ ok: true, metric: "workload", value: 1_000_000 });
    expect(post("workload", "1000000.01")).toEqual({ ok: false, error: "too_big" });
    expect(post("new_applications", "1000001")).toEqual({ ok: false, error: "too_big" });
    expect(post("review", "41666", "d")).toEqual({ ok: true, metric: "review", value: 999_984 });
    expect(post("review", "41667", "d")).toEqual({ ok: false, error: "too_big" });
    expect(post("workload", "9".repeat(32))).toEqual({ ok: false, error: "too_big" });
  });

  test("what would round to 0 is refused, not stored as a target of 0", () => {
    expect(post("review", "0.004", "h")).toEqual({ ok: false, error: "too_small" });
    expect(post("review", "0.0001", "d")).toEqual({ ok: false, error: "too_small" });
  });

  test.each([["candidates_in_process"], ["__proto__"], ["constructor"], [""], [null], [1]])("metric %j is refused", (metric) => {
    expect(post(metric, "2")).toEqual({ ok: false, error: "invalid" });
  });

  test.each([["w"], ["days"], [""], [null], ["__proto__"]])("a time's unit %j is refused, never guessed", (unit) => {
    expect(post("review", "2", unit)).toEqual({ ok: false, error: "invalid" });
  });

  test("the words on the chip match what was asked", () => {
    expect(targetRule("new_applications").label).toBe("Alert below");
    expect(targetRule("workload").label).toBe("Cap");
    expect(targetRule("review").label).toBe("Target");
  });
});
