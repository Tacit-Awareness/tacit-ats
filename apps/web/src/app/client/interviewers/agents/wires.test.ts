import { describe, expect, test } from "vitest";
import { levels, spread, wireH, wireV } from "./wires";

describe("wireV", () => {
  test("straight down when the ports line up", () => {
    expect(wireV({ x: 40, y: 0 }, { x: 40, y: 60 }, 30)).toBe("M40 0V60");
  });

  test("down, across with rounded corners, then down into the lane", () => {
    expect(wireV({ x: 0, y: 0 }, { x: 100, y: 60 }, 30, 10)).toBe("M0 0V20Q0 30 10 30H90Q100 30 100 40V60");
  });

  test("up into a card from a lane below it, the corners turning the other way", () => {
    expect(wireV({ x: 100, y: 60 }, { x: 0, y: 0 }, 30, 10)).toBe("M100 60V40Q100 30 90 30H10Q0 30 0 20V0");
  });

  test("a short hop never rounds past half its run", () => {
    expect(wireV({ x: 0, y: 0 }, { x: 6, y: 60 }, 30, 10)).toBe("M0 0V27Q0 30 3 30H3Q6 30 6 33V60");
  });
});

describe("wireH", () => {
  test("across, down, across", () => {
    expect(wireH({ x: 0, y: 0 }, { x: 100, y: 40 }, 50, 8)).toBe("M0 0H42Q50 0 50 8V32Q50 40 58 40H100");
  });
});

describe("spread and levels", () => {
  test("one port in the middle, more over the middle of the edge", () => {
    expect(spread(1, 0, 200)).toEqual([100]);
    expect(spread(3, 0, 200)).toEqual([72, 100, 128]);
    expect(spread(0, 0, 200)).toEqual([]);
  });

  test("runs share the gutter evenly, clear of its edges", () => {
    expect(levels(1, 100, 148)).toEqual([124]);
    expect(levels(3, 100, 148)).toEqual([112, 124, 136]);
  });
});
