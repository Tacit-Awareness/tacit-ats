import { describe, expect, test } from "vitest";
import { hoverAttr, parseHoverTarget, placeCard, raisesCard, restMs } from "./hover-card";

const ID = "c1000000-0000-4000-8000-0000000000f1";

describe("what a name says it is", () => {
  test("a candidate and a member round-trip", () => {
    expect(parseHoverTarget(hoverAttr("candidate", ID))).toEqual({ kind: "candidate", id: ID });
    expect(parseHoverTarget(hoverAttr("member", ID))).toEqual({ kind: "member", id: ID });
  });

  test("anything else in the URL is nothing", () => {
    for (const raw of [null, undefined, "", ID, "x:" + ID, "c:", "c:not-a-uuid", `c:${ID}&x=1`]) expect(parseHoverTarget(raw)).toBeNull();
  });
});

describe("who raises a card", () => {
  test("a mouse or a pen, never a finger", () => {
    expect(raisesCard("mouse")).toBe(true);
    expect(raisesCard("pen")).toBe(true);
    expect(raisesCard("touch")).toBe(false);
    expect(raisesCard("")).toBe(false);
  });

  test("a rest first, shorter once one is up", () => {
    expect(restMs(false)).toBeGreaterThan(restMs(true));
  });
});

describe("where a card sits", () => {
  const card = { width: 320, height: 200 };
  const view = { width: 1000, height: 800 };

  test("under the name", () => {
    expect(placeCard({ left: 100, top: 50, bottom: 70 }, card, view)).toEqual({ left: 100, top: 76 });
  });

  test("above it with no room below, and never off the window", () => {
    expect(placeCard({ left: 900, top: 700, bottom: 720 }, card, view)).toEqual({ left: 672, top: 494 });
    expect(placeCard({ left: 0, top: 10, bottom: 780 }, card, view)).toEqual({ left: 8, top: 8 });
  });
});
