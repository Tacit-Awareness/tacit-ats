"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { KeyList, useKeyHelp, useKeys } from "@/components/keys";
import { Avatar } from "@/components/page";
import { NO_DROP, type ColumnKey } from "@/lib/client/pipeline-columns";
import type { StageMove } from "@/lib/client/pipeline-moves";
import { isTyping, menuKey } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { CANDIDATE_ERRORS, CANDIDATE_NOTICES } from "../candidates/[id]/messages";
import { moveCardAction, type BoardMoveResult } from "./actions";
import { neighbourOf, shiftCard, type BoardCard, type BoardColumn } from "./board-state";

// The board's columns and cards, and what moves one: a drag, the menu on the
// card, or a key. All three are the same move (moveCardAction, the stage the
// board showed riding along), and all three offer only what page.tsx computed
// for the card (lib/client/pipeline-moves.ts), so a column that means no stage
// takes no drop. The card moves at once and the server's answer settles it; a
// refusal puts it back and says why. Keys, from design/tats's Pipeline: J/K
// walk the cards, Enter opens one, S is its stage menu, A its next stage, F or
// / the filter. Its X, P, L and B have nothing behind them here.

/** A move's confirmation stays this long; a refusal stays until dismissed or the next move. */
const NOTICE_MS = 4000;

type Notice = { text: string; error: boolean };
type MenuAt = { card: BoardCard; rect: DOMRect };

const cardEl = (id: string) => document.querySelector<HTMLElement>(`[data-card="${id}"]`);
const linkOf = (id: string) => cardEl(id)?.querySelector<HTMLElement>("[data-key-item]") ?? null;

function MoveIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="size-[13px]" aria-hidden>
      <path d="M2.5 5.5h10m0 0-2.5-2.5m2.5 2.5L10 8M13.5 10.5h-10m0 0L6 8m-2.5 2.5L6 13" />
    </svg>
  );
}

/** design/tats's `.card.calm`: 12px padding, 4px between lines, the footer 4px further down with a 20px owner. */
function Card({
  card,
  dragged,
  locked,
  menuOpen,
  onDragStart,
  onDragEnd,
  onMenu,
}: {
  card: BoardCard;
  dragged: boolean;
  locked: boolean;
  menuOpen: boolean;
  onDragStart: (card: BoardCard) => void;
  onDragEnd: () => void;
  onMenu: (card: BoardCard) => void;
}) {
  const movable = card.moves !== null;
  return (
    <div
      data-card={card.applicationId}
      draggable={movable && !locked}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", card.applicationId);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(card);
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative rounded-lg border border-[color:var(--line)] bg-[color:var(--paper)] shadow-[var(--shadow)] transition-colors hover:border-[color:var(--line-strong)]",
        dragged && "opacity-40",
      )}
    >
      <Link href={card.href} draggable={false} data-key-item className="grid gap-1 rounded-lg p-3">
        <span className={cn("truncate text-[14px] leading-[1.3] font-medium", movable && "pr-5")}>{card.name}</span>
        <span className="truncate text-[12.5px] text-muted-foreground">{card.line}</span>
        <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[12.5px]">
          <span
            className={cn("min-w-0 truncate", card.stalled ? "text-negative" : "text-muted-foreground")}
            title={card.stalled ? "Needs attention: overdue, or untouched for a while" : undefined}
          >
            {card.status}
          </span>
          {card.ownerName ? (
            <span title={card.ownerName} className="shrink-0">
              <Avatar name={card.ownerName} size="xs" />
            </span>
          ) : null}
        </span>
      </Link>
      {movable ? (
        <button
          type="button"
          aria-label={`Move ${card.name}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-keyshortcuts="S"
          title="Move (S)"
          disabled={locked}
          onClick={() => onMenu(card)}
          className={cn(
            "absolute top-2 right-2 grid size-6 place-items-center rounded-md text-muted-foreground transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-[color:var(--hover)] hover:text-foreground [@media(hover:none)]:opacity-100",
            menuOpen ? "opacity-100" : "opacity-0",
          )}
        >
          <MoveIcon />
        </button>
      ) : null}
    </div>
  );
}

/** design/tats's `.col`: `flex: 1 1 0`, at least 184px wide and 300px high, so an empty one is a blank band. `.col.over` while a card is over it. */
function Column({
  column,
  source,
  takes,
  over,
  onOver,
  onLeave,
  onDrop,
  children,
}: {
  column: BoardColumn;
  /** A card is being dragged out of this column. */
  source: boolean;
  /** With a card being dragged, whether this column means a stage for it; null with no drag. */
  takes: boolean | null;
  over: boolean;
  onOver: () => void;
  onLeave: () => void;
  onDrop: () => void;
  children: React.ReactNode;
}) {
  // Both events: crossing into a child (every card is one) fires dragenter, not
  // dragover, and the browser decides the drop on that. Allowed even on a column
  // that means no stage, so the drop can say why.
  const allow = (e: React.DragEvent) => {
    if (takes === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    onOver();
  };
  return (
    <section
      aria-label={column.label}
      onDragEnter={allow}
      onDragOver={allow}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onLeave();
      }}
      onDrop={(e) => {
        if (takes === null) return;
        e.preventDefault();
        onDrop();
      }}
      className={cn(
        "flex min-h-[300px] min-w-[184px] flex-[1_1_0] flex-col gap-2 rounded-lg bg-[color:var(--band)] p-1 transition-[background-color,opacity]",
        takes && "ring-1 ring-[color:var(--accent)] ring-inset",
        takes && over && "bg-[color:var(--accent-soft)]",
        takes === false && !source && "opacity-55",
      )}
    >
      <h2 className="m-0 flex h-[30px] shrink-0 items-center gap-2 px-1.5 text-[14px] font-medium">
        {column.label}
        <span className="font-normal text-faint tabular-nums">{column.total}</span>
      </h2>
      {children}
      {column.more ? (
        <Link
          href={column.more.href}
          className="grid h-[30px] place-items-center rounded-md text-[12.5px] text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground"
        >
          {column.more.label}
        </Link>
      ) : null}
    </section>
  );
}

const MENU_WIDTH = 220;
const MENU_ITEM =
  "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none hover:bg-[color:var(--soft-strong)] focus-visible:bg-[color:var(--soft-strong)]";

/**
 * The stage menu, design/tats's `statusMenu`: "<stage> · move to", J/K or the
 * arrows, Enter, a digit, Esc. Fixed rather than inside its card, where the
 * board's scroller would clip it. Rejecting needs a reason, so that line goes
 * to the candidate page, where the reasons are.
 */
function MoveMenu({ at, onPick, onClose }: { at: MenuAt; onPick: (move: StageMove) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const moves = at.card.moves?.stages ?? [];
  const count = moves.length;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const gap = 8;
    const height = el.offsetHeight;
    const below = at.rect.bottom + 4;
    el.style.top = `${below + height + gap > window.innerHeight ? Math.max(gap, at.rect.top - height - 4) : below}px`;
    el.style.left = `${Math.max(gap, Math.min(at.rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - gap))}px`;
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
        linkOf(at.card.applicationId)?.focus();
        return onClose();
      }
      e.preventDefault();
      const all = items();
      if (command.kind === "pick") return all[command.index]?.click();
      const cur = all.indexOf(document.activeElement as HTMLElement);
      all[(cur + command.d + all.length) % all.length]?.focus();
    };
    // focusin too: F, / and ⌘K take focus to a field, and the menu's keys stop there.
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", outside, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("scroll", outside, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [at, count, onClose]);

  return (
    <div
      ref={box}
      role="menu"
      aria-label={`Move ${at.card.name}`}
      style={{ width: MENU_WIDTH }}
      className="fixed z-50 grid gap-px rounded-lg border border-[color:var(--line-strong)] bg-raised p-1 shadow-[var(--pop-shadow)]"
    >
      <p className="m-0 truncate px-2 py-1 text-[12px] text-faint">{at.card.stageLabel} · move to</p>
      {moves.map((m, i) => (
        <button key={m.stage} type="button" role="menuitem" tabIndex={-1} onClick={() => onPick(m)} className={MENU_ITEM}>
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

/** design/tats's toast: bottom right, across the bottom on a phone. Always mounted, so a reader hears what changes in it. */
function Toast({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  return (
    <div role="status" className="fixed right-5 bottom-[60px] z-[70] max-sm:right-4 max-sm:left-4">
      {notice ? (
        <div className="flex max-w-[420px] items-center gap-2.5 rounded-lg border border-[color:var(--line-strong)] bg-raised py-2 pr-2 pl-3 text-[13px] shadow-[var(--pop-shadow)]">
          <span className={cn("min-w-0 flex-1", notice.error && "text-negative")}>{notice.text}</span>
          {notice.error ? (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-[5px] px-1.5 py-0.5 text-[12.5px] font-medium text-muted-foreground hover:bg-[color:var(--hover)] hover:text-foreground"
            >
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function Board({ columns }: { columns: BoardColumn[] }) {
  const [shown, shift] = useOptimistic(columns, shiftCard);
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [drag, setDrag] = useState<{ card: BoardCard; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  // Where focus goes while a move settles: a moved card is a new element.
  const refocus = useRef<{ id: string; fallback: string | null } | null>(null);
  const movable = shown.some((c) => c.cards.some((x) => x.moves));

  useEffect(() => {
    const r = refocus.current;
    if (!r) return;
    // Someone typing in the filter keeps their field: the rest of the word would land on the card as keys.
    if (!isTyping(document.activeElement)) (linkOf(r.id) ?? (r.fallback ? linkOf(r.fallback) : null))?.focus();
    if (!pending) refocus.current = null;
  }, [shown, pending]);

  useEffect(() => {
    if (!notice || notice.error) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const move = (card: BoardCard, to: StageMove, keepFocus: boolean) => {
    setMenu(null);
    setNotice(null);
    if (keepFocus) refocus.current = { id: card.applicationId, fallback: neighbourOf(shown, card.applicationId) };
    const form = new FormData();
    form.set("applicationId", card.applicationId);
    form.set("candidateId", card.personId);
    form.set("stage", to.stage);
    form.set("expectedStage", card.stage);
    start(async () => {
      shift({ applicationId: card.applicationId, stage: to.stage, stageLabel: to.label, column: to.column });
      const result: BoardMoveResult = await moveCardAction(form).catch(() => ({ ok: false, error: "unsure" }) as const);
      if (!result.ok) setNotice({ text: CANDIDATE_ERRORS[result.error], error: true });
      else setNotice({ text: result.changed ? `Moved ${card.name} to ${to.label}.` : CANDIDATE_NOTICES.unchanged, error: false });
    });
  };

  const openMenu = (card: BoardCard) => {
    const button = cardEl(card.applicationId)?.querySelector("button");
    if (button) setMenu({ card, rect: button.getBoundingClientRect() });
  };

  const closeMenu = useCallback(() => setMenu(null), []);

  const drop = (column: BoardColumn) => {
    const from = drag;
    setDrag(null);
    setOver(null);
    if (!from?.card.moves || column.key === from.from) return;
    const stage = from.card.moves.drops[column.key as ColumnKey];
    const to = from.card.moves.stages.find((m) => m.stage === stage);
    if (to) move(from.card, to, false);
    else setNotice({ text: NO_DROP[column.key as ColumnKey] ?? "That column means no stage for them.", error: false });
  };

  /** The card the keys act on: the one focus is in. */
  const focused = () => {
    const id = document.activeElement?.closest<HTMLElement>("[data-card]")?.dataset.card;
    return shown.flatMap((c) => c.cards).find((x) => x.applicationId === id && x.moves) ?? null;
  };

  useKeys(
    {
      s: () => {
        const card = focused();
        if (card) openMenu(card);
      },
      a: (e) => {
        const card = focused();
        if (!card?.moves || e.repeat) return;
        const to = card.moves.stages.find((m) => m.stage === card.moves?.next);
        if (to) move(card, to, true);
        else openMenu(card);
      },
    },
    movable && !pending && !menu,
  );
  useKeyHelp(
    "Pipeline",
    movable
      ? [
          { keys: "S", label: "Move to a stage" },
          { keys: "A", label: "Move to the next stage" },
          { keys: "Drag", label: "Move to another column" },
        ]
      : [],
  );

  return (
    <>
      <KeyList title="Pipeline" next="Next card" mode="focus" data-tour="board" className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-8 md:px-8">
        <div className="flex min-w-full items-start gap-2">
          {shown.map((column) => (
            <Column
              key={column.key}
              column={column}
              source={drag?.from === column.key}
              takes={drag ? !!drag.card.moves?.drops[column.key as ColumnKey] : null}
              over={over === column.key}
              onOver={() => setOver(column.key)}
              onLeave={() => setOver((o) => (o === column.key ? null : o))}
              onDrop={() => drop(column)}
            >
              {column.cards.map((card) => (
                <Card
                  key={card.applicationId}
                  card={card}
                  dragged={drag?.card.applicationId === card.applicationId}
                  locked={pending}
                  menuOpen={menu?.card.applicationId === card.applicationId}
                  onDragStart={(c) => setDrag({ card: c, from: column.key })}
                  onDragEnd={() => {
                    setDrag(null);
                    setOver(null);
                  }}
                  onMenu={openMenu}
                />
              ))}
            </Column>
          ))}
        </div>
      </KeyList>
      {menu ? <MoveMenu at={menu} onPick={(m) => move(menu.card, m, true)} onClose={closeMenu} /> : null}
      <Toast notice={notice} onDismiss={() => setNotice(null)} />
    </>
  );
}

/** F or /: the name filter, which stays when the board has nobody to show. */
export function FilterKeys() {
  const focus = () => {
    const input = document.querySelector<HTMLInputElement>('form[action="/client/pipeline"] input[name="q"]');
    input?.focus();
    input?.select();
  };
  useKeys({ f: focus, "/": focus });
  useKeyHelp("Pipeline", [{ keys: "F or /", label: "Filter by name" }]);
  return null;
}
