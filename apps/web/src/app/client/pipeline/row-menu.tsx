"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useKeyHelp, useKeys } from "@/components/keys";
import { dismissToast, showToast } from "@/components/toasts";
import type { StageMove } from "@/lib/client/pipeline-moves";
import { CANDIDATE_ERRORS, CANDIDATE_NOTICES } from "../candidates/[id]/messages";
import { moveCardAction, type BoardMoveResult } from "./actions";
import { DESKTOP_POINTER, menuSpot, moveForm, takesRowMenu } from "./board-state";
import { MoveMenu, type MenuAt, type MenuCard } from "./move-menu";

// design/tats's right-click on a row, on the list: Open (the row's pop-up, the
// same link a click follows) and the board's stage menu, on a job the member may
// edit. It wraps the server's rows and listens once. A row the member may not edit
// has no entry, so it keeps the browser's own menu, as does everything while the
// pop-up is up: the rows behind it are inert. S opens the same menu from the keys.

export type RowCard = MenuCard & { personId: string; stage: string; openHref: string };

const rowEl = (id: string) => document.querySelector<HTMLElement>(`[data-pop-row="${id.replace(/["\\]/g, "\\$&")}"]`);
const focusRow = (id: string) => rowEl(id)?.focus();

export function RowMenus({ cards, popup, children }: { cards: RowCard[]; popup: boolean; children: React.ReactNode }) {
  const byId = useMemo(() => new Map(cards.map((c) => [c.applicationId, c])), [cards]);
  const [menu, setMenu] = useState<MenuAt<RowCard> | null>(null);
  const [pending, start] = useTransition();
  const said = useRef<string | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (popup) setMenu(null);
  }, [popup]);

  const openAt = (card: RowCard, rect: MenuAt["rect"]) => setMenu({ card, rect, open: { href: card.openHref, scroll: false } });

  const onContext = (e: React.MouseEvent) => {
    const el = (e.target as Element).closest<HTMLElement>("[data-pop-row]");
    const card = el ? byId.get(el.dataset.popRow ?? "") : undefined;
    if (!el || !takesRowMenu(e.nativeEvent, matchMedia(DESKTOP_POINTER).matches, card, popup || pending) || !card) return;
    e.preventDefault();
    el.focus();
    openAt(card, menuSpot(e.clientX, e.clientY, el.getBoundingClientRect()));
  };

  const move = (card: RowCard, to: StageMove) => {
    setMenu(null);
    if (said.current) dismissToast(said.current);
    start(async () => {
      const result: BoardMoveResult = await moveCardAction(moveForm(card, to.stage)).catch(() => ({ ok: false, error: "unsure" }) as const);
      const text = !result.ok ? CANDIDATE_ERRORS[result.error] : result.changed ? `Moved ${card.name} to ${to.label}.` : CANDIDATE_NOTICES.unchanged;
      said.current = showToast({ text, tone: result.ok ? "info" : "error" });
      focusRow(card.applicationId);
    });
  };

  /** The row the keys act on: the one focus is on. */
  const focused = () => byId.get((document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-pop-row]")?.dataset.popRow ?? "");

  const movable = cards.some((c) => c.moves);
  useKeys(
    {
      s: () => {
        const card = focused();
        const el = card && rowEl(card.applicationId);
        if (!card?.moves || !el) return;
        const r = el.getBoundingClientRect();
        openAt(card, menuSpot(0, 0, r));
      },
    },
    movable && !popup && !pending && !menu,
  );
  useKeyHelp("Applicant Tickets", movable ? [{ keys: "S or right-click", label: "Move to a stage" }] : []);

  return (
    <div onContextMenu={onContext}>
      {children}
      {menu ? <MoveMenu at={menu} onPick={(m) => move(menu.card, m)} onClose={closeMenu} focusRow={focusRow} /> : null}
    </div>
  );
}
