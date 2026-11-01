"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { CardMoves, StageMove } from "@/lib/client/pipeline-moves";
import { menuKey } from "@/lib/keys";
import { cssPx } from "@/lib/ui-scale";
import { cn } from "@/lib/utils";

// The stage menu, design/tats's `statusMenu`, for a board card and a list row:
// "<stage> · move to", J/K or the arrows, Enter, a digit, Esc. Fixed rather than
// inside its card, where the board's scroller would clip it. Rejecting needs a
// reason, so that line goes to the candidate page, where the reasons are. The
// right-click form (`open`, design/tats's row menu) leads with Open and sits where
// the pointer is; a digit still means the stage beside it.

export type MenuCard = { applicationId: string; name: string; stageLabel: string; href: string; moves: CardMoves | null };

export type MenuAt<C extends MenuCard = MenuCard> = {
  card: C;
  rect: Pick<DOMRect, "top" | "bottom" | "left" | "right">;
  /** The right-click form: where Open goes. On the list it's the pop-up, so it keeps the scroll. */
  open?: { href: string; scroll: boolean };
};

const MENU_WIDTH = 220;
const MENU_ITEM =
  "flex h-8 w-full items-center gap-2 px-2 text-left text-[13px] outline-none hover:bg-[color:var(--soft-strong)] focus-visible:bg-[color:var(--soft-strong)]";

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
    el.style.top = `${below + height + gap > cssPx(window.innerHeight) ? Math.max(gap, at.rect.top - height - (at.open ? 0 : 4)) : below}px`;
    el.style.left = `${Math.max(gap, Math.min(left, cssPx(window.innerWidth) - MENU_WIDTH - gap))}px`;
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
      className="fixed z-50 grid gap-px border border-[color:var(--line-strong)] bg-raised p-1 shadow-[var(--pop-shadow)]"
    >
      {at.open ? (
        <Link href={at.open.href} scroll={at.open.scroll} role="menuitem" tabIndex={-1} onClick={onClose} className={MENU_ITEM}>
          <span className="min-w-0 flex-1 truncate">Open</span>
          <span aria-hidden className="text-[11.5px] text-faint">
            ↵
          </span>
        </Link>
      ) : null}
      <p className="m-0 truncate px-2 py-1 text-[12px] text-faint">{at.card.stageLabel} · move to</p>
      {moves.map((m, i) => (
        <button key={m.stage} type="button" role="menuitem" tabIndex={-1} onClick={() => {
            ignoreDoubleClick();
            onPick(m);
          }} className={MENU_ITEM}>
          <span className="min-w-0 flex-1 truncate">{m.label}</span>
          <span aria-hidden className="text-[11.5px] text-faint tabular-nums">
            {i + 1}
          </span>
        </button>
      ))}
      <Link href={at.card.href} role="menuitem" tabIndex={-1} className={cn(MENU_ITEM, "text-muted-foreground")}>
        Reject or withdraw…
      </Link>
    </div>
  );
}
