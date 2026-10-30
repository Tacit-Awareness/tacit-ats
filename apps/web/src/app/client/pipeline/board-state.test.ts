import { describe, expect, test } from "vitest";

import { neighbourOf, shiftCard, type BoardCard, type BoardColumn } from "./board-state";

const card = (id: string, stage = "screening"): BoardCard => ({
  applicationId: id,
  personId: `p-${id}`,
  href: `/client/candidates/p-${id}`,
  name: `Name ${id}`,
  line: "Engineer",
  status: "Touched today",
  ownerName: null,
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
