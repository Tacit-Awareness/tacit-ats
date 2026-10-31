import { describe, expect, test } from "vitest";

import { neighbourOf, shiftCard, type BoardCard, type BoardColumn, menuSpot, moveForm, takesRowMenu } from "./board-state";

const card = (id: string, stage = "screening"): BoardCard => ({
  applicationId: id,
  personId: `p-${id}`,
  href: `/client/candidates/p-${id}`,
  name: `Name ${id}`,
  line: "Engineer",
  status: "Touched today",
  ownerName: null,
  ownerActorId: null,
  stalled: false,
  stage,
  stageLabel: stage,
  moves: null,
});
const col = (key: string, cards: BoardCard[], total = cards.length): BoardColumn => ({ key, label: key, total, cards, more: null });

const board = () => [col("new", [card("a", "sourced")]), col("screening", [card("b"), card("c")], 15), col("offer", [])];

describe("shiftCard", () => {
  test("moves a card to the top of its new column, counts and all", () => {
    const next = shiftCard(board(), { applicationId: "c", stage: "offer", stageLabel: "Offer", column: "offer" });
    expect(next[1]!.cards.map((x) => x.applicationId)).toEqual(["b"]);
    expect(next[1]!.total).toBe(14);
    expect(next[2]!.cards.map((x) => x.applicationId)).toEqual(["c"]);
    expect(next[2]!.cards[0]).toMatchObject({ stage: "offer", stageLabel: "Offer" });
    expect(next[2]!.total).toBe(1);
  });

  test("inside a column only the stage changes", () => {
    const next = shiftCard(board(), { applicationId: "a", stage: "contacted", stageLabel: "Contacted", column: "new" });
    expect(next[0]).toMatchObject({ total: 1 });
    expect(next[0]!.cards).toHaveLength(1);
    expect(next[0]!.cards[0]).toMatchObject({ applicationId: "a", stage: "contacted", stageLabel: "Contacted" });
  });

  test("a card that leaves the board (hired) leaves every column", () => {
    const next = shiftCard(board(), { applicationId: "b", stage: "hired", stageLabel: "Hired", column: null });
    expect(next.flatMap((c) => c.cards).map((x) => x.applicationId)).toEqual(["a", "c"]);
    expect(next[1]!.total).toBe(14);
  });

  test("a card no longer on the board changes nothing", () => {
    const before = board();
    expect(shiftCard(before, { applicationId: "z", stage: "offer", stageLabel: "Offer", column: "offer" })).toBe(before);
  });

  test("the board it was given stays as it was, so a refusal can fall back to it", () => {
    const before = board();
    shiftCard(before, { applicationId: "c", stage: "offer", stageLabel: "Offer", column: "offer" });
    expect(before).toEqual(board());
  });
});

describe("neighbourOf", () => {
  test("is the next card in J order, across columns, else the one before", () => {
    expect(neighbourOf(board(), "a")).toBe("b");
    expect(neighbourOf(board(), "b")).toBe("c");
    expect(neighbourOf(board(), "c")).toBe("b");
  });

  test("is nothing on an empty board or for a card not on it", () => {
    expect(neighbourOf([col("new", [card("a")])], "a")).toBeNull();
    expect(neighbourOf(board(), "z")).toBeNull();
  });
});

describe("a right-click on a row", () => {
  const plain = { shiftKey: false, pointerType: "mouse" };
  const movable = { moves: {} };

  test("is the menu on a desktop, on a row the member may move", () => {
    expect(takesRowMenu(plain, true, movable, false)).toBe(true);
    // Safari's contextmenu is a MouseEvent, with no pointerType.
    expect(takesRowMenu({ shiftKey: false }, true, movable, false)).toBe(true);
  });

  test("keeps the browser's menu otherwise: the board's own gate, a phone, a touch, Shift, or something in the way", () => {
    expect(takesRowMenu(plain, true, { moves: null }, false)).toBe(false);
    expect(takesRowMenu(plain, true, undefined, false)).toBe(false);
    expect(takesRowMenu(plain, false, movable, false)).toBe(false);
    expect(takesRowMenu({ shiftKey: false, pointerType: "touch" }, true, movable, false)).toBe(false);
    expect(takesRowMenu({ shiftKey: true, pointerType: "mouse" }, true, movable, false)).toBe(false);
    expect(takesRowMenu(plain, true, movable, true)).toBe(false);
  });

  test("sits at the pointer, or under the row when the menu key sent it", () => {
    expect(menuSpot(40, 60, { left: 10, bottom: 20 })).toEqual({ left: 40, right: 40, top: 60, bottom: 60 });
    expect(menuSpot(0, 0, { left: 10, bottom: 20 })).toEqual({ left: 10, right: 10, top: 20, bottom: 20 });
  });

  test("a move carries the stage the page showed", () => {
    const form = moveForm({ applicationId: "a", personId: "p", stage: "screening" }, "offer");
    expect(Object.fromEntries(form)).toEqual({ applicationId: "a", candidateId: "p", stage: "offer", expectedStage: "screening" });
  });
});
