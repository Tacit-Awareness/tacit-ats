"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { CardMoves, StageMove } from "@/lib/client/pipeline-moves";
import { menuKey } from "@/lib/keys";
import { cn } from "@/lib/utils";

// The stage menu, design/tats's `statusMenu` in Testbench's `.menu`, for a board
// card and a list row: "Move from <stage> to", J/K or the arrows, Enter, a digit
// (its key sits at the item's end), Esc. Fixed rather than inside its card,
// where the board's scroller would clip it. Rejecting needs a reason, so that
// line goes to the candidate page, where the reasons are. The right-click form
// (`open`, design/tats's row menu) leads with Open and sits where the pointer
// is; a digit still means the stage beside it.

export type MenuCard = { applicationId: string; name: string; stageLabel: string; href: string; moves: CardMoves | null };

export type MenuAt<C extends MenuCard = MenuCard> = {
  card: C;
  rect: Pick<DOMRect, "top" | "bottom" | "left" | "right">;
  /** The right-click form: where Open goes. On the list it's the pop-up, so it keeps the scroll. */
  open?: { href: string; scroll: boolean };
};

const MENU_WIDTH = 240;
/** Testbench's `.menu-item`: 34px, 7px corners. */
const MENU_ITEM =
  "flex h-[34px] w-full flex-none items-center gap-2.5 rounded-[7px] px-2.5 text-left text-[13px] text-foreground outline-none transition-colors hover:bg-[color:var(--hover)] focus-visible:bg-[color:var(--hover)]";
/** A key inside the item, Testbench's `.kbd`. */
const KEY = "ml-auto inline-grid h-5 min-w-5 place-items-center rounded-[4px] px-1 font-mono text-[11px] text-muted-foreground shadow-[inset_0_0_0_1px_currentColor] opacity-70";

/** The menu shuts on the first click, so a double-click's second would land on whatever is under it. */
function ignoreDoubleClick() {
  const stop = (e: MouseEvent) => {
    if (e.detail < 2) return;
    e.preventDefault();
    e.stopPropagation();
  };
  document.addEventListener("click", stop, true);
  setTimeout(() => document.removeEventListener("click", stop, true), 500);
}

export function MoveMenu({ at, onPick, onClose, focusRow }: { at: MenuAt; onPick: (move: StageMove) => void; onClose: () => void; focusRow: (applicationId: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const moves = at.card.moves?.stages ?? [];
  const count = moves.length;
  const lead = at.open ? 1 : 0;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const gap = 8;
    const height = el.offsetHeight;
    const below = at.rect.bottom + (at.open ? 0 : 4);
    const left = at.open ? at.rect.left : at.rect.right - MENU_WIDTH;
    el.style.top = `${below + height + gap > window.innerHeight ? Math.max(gap, at.rect.top - height - (at.open ? 0 : 4)) : below}px`;
    el.style.left = `${Math.max(gap, Math.min(left, window.innerWidth - MENU_WIDTH - gap))}px`;
    el.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [at]);

  useEffect(() => {
    const items = () => Array.from(box.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const outside = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      // Its keys are for it alone: the ? sheet takes focus while the key that opened it is still on its way here.
      if (!box.current?.contains(document.activeElement)) return onClose();
      const command = menuKey(e, count);
      if (!command) return;
      if (command.kind === "close") {
        if (!command.refocus) return onClose();
        e.preventDefault();
        focusRow(at.card.applicationId);
        return onClose();
      }
      e.preventDefault();
      const all = items();
      if (command.kind === "pick") return all[command.index + lead]?.click();
      const cur = all.indexOf(document.activeElement as HTMLElement);
      all[(cur + command.d + all.length) % all.length]?.focus();
    };
    // focusin too: F, / and ⌘K take focus to a field, and the menu's keys stop there.
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", outside, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("scroll", outside, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [at, count, lead, onClose, focusRow]);

  return (
    <div
      ref={box}
      role="menu"
      aria-label={`Move ${at.card.name}`}
      style={{ width: MENU_WIDTH }}
      className="fixed z-50 grid rounded-[12px] bg-raised p-1.5 shadow-[var(--pop-shadow)]"
    >
      {at.open ? (
        <Link href={at.open.href} scroll={at.open.scroll} role="menuitem" tabIndex={-1} onClick={onClose} className={MENU_ITEM}>
          <span className="min-w-0 flex-1 truncate">Open</span>
          <kbd aria-hidden className={KEY}>
            ↵
          </kbd>
        </Link>
      ) : null}
      {at.open ? <i aria-hidden className="mx-1 my-1.5 block h-px bg-[color:var(--line)]" /> : null}
      <p className="m-0 truncate px-2.5 pt-1.5 pb-1 text-[11.5px] text-faint">Move from {at.card.stageLabel} to</p>
      {moves.map((m, i) => (
        <button key={m.stage} type="button" role="menuitem" tabIndex={-1} onClick={() => {
            ignoreDoubleClick();
            onPick(m);
          }} className={MENU_ITEM}>
          <span className="min-w-0 flex-1 truncate">{m.label}</span>
          <kbd aria-hidden className={KEY}>
            {i + 1}
          </kbd>
        </button>
      ))}
      <i aria-hidden className="mx-1 my-1.5 block h-px bg-[color:var(--line)]" />
      <Link href={at.card.href} role="menuitem" tabIndex={-1} className={cn(MENU_ITEM, "text-muted-foreground")}>
        Reject or withdraw…
      </Link>
    </div>
  );
}
