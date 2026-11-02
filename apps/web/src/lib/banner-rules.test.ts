import { describe, expect, test } from "vitest";
import { DISMISSED_MAX, addDismissed, bannerRole, bannerTag, orderActions, parseDismissed } from "./banner-rules";

describe("a banner's rules", () => {
  test("a warning or an error interrupts; the rest are a status", () => {
    expect(bannerRole("error")).toBe("alert");
    expect(bannerRole("warning")).toBe("alert");
    expect(bannerRole("info")).toBe("status");
    expect(bannerRole("success")).toBe("status");
    expect(bannerRole("default")).toBe("status");
  });

  test("actions: the first three, primary, secondary, ghost, stable within each", () => {
    const got = orderActions([
      { l: "g", variant: "ghost" as const },
      { l: "s1" },
      { l: "p", variant: "primary" as const },
      { l: "s2" },
    ]);
    expect(got.map((a) => a.l)).toEqual(["p", "s1", "g"]);
    const same = orderActions([{ l: "a" }, { l: "b", variant: "secondary" as const }]);
    expect(same.map((a) => a.l)).toEqual(["a", "b"]);
  });

  test("what storage held: a list of ids, anything else nothing", () => {
    expect(parseDismissed(null)).toEqual([]);
    expect(parseDismissed({ a: 1 })).toEqual([]);
    expect(parseDismissed(["a", 2, "", "b"])).toEqual(["a", "b"]);
    expect(parseDismissed(Array.from({ length: DISMISSED_MAX + 5 }, (_, i) => `x${i}`))).toHaveLength(DISMISSED_MAX);
  });

  test("dismissing adds the id once, last, and the oldest fall off", () => {
    expect(addDismissed(["a", "b"], "a")).toEqual(["b", "a"]);
    const full = Array.from({ length: DISMISSED_MAX }, (_, i) => `x${i}`);
    const next = addDismissed(full, "new");
    expect(next).toHaveLength(DISMISSED_MAX);
    expect(next[0]).toBe("x1");
    expect(next.at(-1)).toBe("new");
  });

  test("a tag is stable for the same words and changes with them", () => {
    expect(bannerTag(["a@2026-11-14"])).toBe(bannerTag(["a@2026-11-14"]));
    expect(bannerTag(["a@2026-11-14"])).not.toBe(bannerTag(["a@2026-11-15"]));
    expect(bannerTag(["ab", "c"])).not.toBe(bannerTag(["a", "bc"]));
    expect(bannerTag(["x"])).toMatch(/^[0-9a-z]+$/);
  });
});
