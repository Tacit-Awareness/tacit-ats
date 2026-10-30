import { describe, expect, it } from "vitest";
import { SPOT_PAD, TOUR, onScreen, placeTour } from "./tour";

const view = { width: 1280, height: 800 };
const card = { width: 320, height: 170 };

describe("the tour's steps", () => {
  it("each names a page under /client (or none) and something to spotlight", () => {
    for (const s of TOUR) {
      expect(s.href === null || s.href === "/client" || s.href.startsWith("/client/")).toBe(true);
      expect(s.targets.length).toBeGreaterThan(0);
    }
  });

  it("the Pipeline step spotlights the board and names how a card moves", () => {
    const step = TOUR.find((s) => s.href === "/client/pipeline")!;
    expect(step.targets).toContain('[data-tour="board"]');
    expect(step.body).toMatch(/drag/i);
    expect(step.body).toContain("press S");
  });
});

describe("placing the card", () => {
  it("puts the card right of the element, the spotlight around it", () => {
    const p = placeTour({ left: 20, top: 100, width: 200, height: 40 }, view, card);
    expect(p.spot).toEqual({ left: 20 - SPOT_PAD, top: 100 - SPOT_PAD, width: 200 + SPOT_PAD * 2, height: 40 + SPOT_PAD * 2 });
    expect(p.card).toEqual({ left: 236, top: 100 });
  });

  it("puts it below an element too wide to sit beside", () => {
    const p = placeTour({ left: 300, top: 100, width: 900, height: 200 }, view, card);
    expect(p.card).toEqual({ left: 300, top: 316 });
  });

  it("puts it above an element near the bottom", () => {
    const p = placeTour({ left: 300, top: 600, width: 900, height: 150 }, view, card);
    expect(p.card.top).toBe(600 - 170 - 16);
  });

  it("keeps it inside the window for an element filling it", () => {
    const p = placeTour({ left: 0, top: 0, width: 1280, height: 800 }, view, card);
    expect(p.card.left).toBeGreaterThanOrEqual(16);
    expect(p.card.top).toBeGreaterThanOrEqual(16);
    expect(p.card.top + card.height).toBeLessThanOrEqual(view.height - 16);
  });

  it("centres it with no spotlight when there is no element", () => {
    expect(placeTour(null, view, card)).toEqual({ spot: null, card: { left: 480, top: 315 } });
  });
});

describe("on screen", () => {
  it("is false for a hidden or off-screen box", () => {
    expect(onScreen({ left: 0, top: 0, width: 0, height: 0 }, view)).toBe(false);
    expect(onScreen({ left: -272, top: 0, width: 260, height: 34 }, view)).toBe(false);
    expect(onScreen({ left: 10, top: 900, width: 100, height: 30 }, view)).toBe(false);
  });

  it("is true for a box partly inside", () => {
    expect(onScreen({ left: -10, top: 10, width: 100, height: 30 }, view)).toBe(true);
  });
});
