import { describe, expect, it } from "vitest";
import { fitShift } from "./menu-fit";

describe("fitShift", () => {
  it("leaves a menu that fits", () => {
    expect(fitShift(100, 320, 375)).toBe(0);
  });

  it("moves a menu off the left edge to the right", () => {
    expect(fitShift(-60, 160, 375)).toBe(68);
  });

  it("moves a menu off the right edge to the left", () => {
    expect(fitShift(200, 420, 375)).toBe(-53);
  });

  it("keeps the left edge when the window is narrower than the menu", () => {
    expect(fitShift(40, 340, 300)).toBe(-32);
  });
});
