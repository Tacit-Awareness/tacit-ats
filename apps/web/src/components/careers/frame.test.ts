import { describe, expect, test } from "vitest";
import { readableOnPage } from "./frame";

describe("readableOnPage", () => {
  test("a dark enough accent is kept as it is", () => {
    expect(readableOnPage("#64745e")).toBe("#64745e");
    expect(readableOnPage("#152027")).toBe("#152027");
  });

  test("a light accent is taken darker until the title reads", () => {
    const out = readableOnPage("#f5d90a");
    expect(out).not.toBe("#f5d90a");
    expect(out).toMatch(/^#[0-9a-f]{6}$/);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16));
    expect(r).toBeLessThan(0xf5);
    expect(g).toBeLessThan(0xd9);
    expect(b).toBeLessThanOrEqual(0x0a);
  });

  test("anything but #rrggbb is left alone", () => {
    expect(readableOnPage("oklch(0.6 0.1 140)")).toBe("oklch(0.6 0.1 140)");
  });
});
