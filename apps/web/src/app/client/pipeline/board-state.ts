import type { CardMoves } from "@/lib/client/pipeline-moves";

// The Pipeline board's data as the client holds it, and the two pure steps a
// move needs. Unit-tested in board-state.test.ts.

export type BoardCard = {
  applicationId: string;
  personId: string;
  href: string;
  name: string;
  line: string;
  status: string;
  ownerName: string | null;
  ownerActorId: string | null;
  stalled: boolean;
  stage: string;
  stageLabel: string;
  /** What the member may do to it; null when they may not edit its job's pipeline. */
  moves: CardMoves | null;
};

export type BoardColumn = {
  key: string;
  label: string;
  total: number;
  cards: BoardCard[];
  more: { href: string; label: string } | null;
};

export type CardShift = { applicationId: string; stage: string; stageLabel: string; column: string | null };

/**
 * The board once a move lands, before the server has said so: the card at the
 * top of its new column, or gone when it left the board (hired). A move inside
 * a column only changes its stage.
 */
export function shiftCard(columns: BoardColumn[], shift: CardShift): BoardColumn[] {
  const from = columns.find((c) => c.cards.some((x) => x.applicationId === shift.applicationId));
  const card = from?.cards.find((x) => x.applicationId === shift.applicationId);
  if (!from || !card) return columns;
  const moved = { ...card, stage: shift.stage, stageLabel: shift.stageLabel };
  if (shift.column === from.key) return columns.map((c) => (c === from ? { ...c, cards: c.cards.map((x) => (x === card ? moved : x)) } : c));
  return columns.map((c) => {
    if (c === from) return { ...c, total: c.total - 1, cards: c.cards.filter((x) => x !== card) };
    return c.key === shift.column ? { ...c, total: c.total + 1, cards: [moved, ...c.cards] } : c;
  });
}

/** The card after this one in J order, else the one before: where focus goes if this one leaves the board. */
export function neighbourOf(columns: BoardColumn[], applicationId: string): string | null {
  const all = columns.flatMap((c) => c.cards);
  const i = all.findIndex((x) => x.applicationId === applicationId);
  return i < 0 ? null : ((all[i + 1] ?? all[i - 1])?.applicationId ?? null);
}

/** A desktop's pointer, with room for a menu: a long press on a phone fires `contextmenu` too. */
export const DESKTOP_POINTER = "(hover: hover) and (pointer: fine) and (min-width: 768px)";

/**
 * Whether a right-click means the row menu: on a desktop, with a mouse, over a
 * row whose job the member may edit (`moves`, the board's own gate), and nothing
 * in the way. Anything else keeps the browser's menu; Shift asks for it.
 */
export function takesRowMenu(e: { shiftKey: boolean; pointerType?: string }, desktop: boolean, card: { moves: unknown } | undefined, blocked: boolean): boolean {
  return desktop && !blocked && !e.shiftKey && e.pointerType !== "touch" && !!card?.moves;
}

/** Where the menu sits: the pointer, or the row when the menu key sent it, which comes with no position. */
export function menuSpot(x: number, y: number, row: { left: number; bottom: number }) {
  const left = x || y ? x : row.left;
  const top = x || y ? y : row.bottom;
  return { left, right: left, top, bottom: top };
}

/** The move as moveCardAction takes it, carrying the stage the page showed. */
export function moveForm(card: { applicationId: string; personId: string; stage: string }, stage: string): FormData {
  const form = new FormData();
  form.set("applicationId", card.applicationId);
  form.set("candidateId", card.personId);
  form.set("stage", stage);
  form.set("expectedStage", card.stage);
  return form;
}
