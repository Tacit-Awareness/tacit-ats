"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { KeyList, useKeyHelp, useKeys } from "@/components/keys";
import { Avatar } from "@/components/page";
import { dismissToast, showToast } from "@/components/toasts";
import { NO_DROP, type ColumnKey } from "@/lib/client/pipeline-columns";
import type { StageMove } from "@/lib/client/pipeline-moves";
import { hoverAttr } from "@/lib/hover-card";
import { isTyping } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { CANDIDATE_ERRORS, CANDIDATE_NOTICES } from "../candidates/[id]/messages";
import { moveCardAction, type BoardMoveResult } from "./actions";
import { DESKTOP_POINTER, menuSpot, moveForm, neighbourOf, shiftCard, takesRowMenu, type BoardCard, type BoardColumn } from "./board-state";
import { MoveMenu, type MenuAt } from "./move-menu";
import { cssRect } from "@/lib/ui-scale";

// The board's columns and cards, and what moves one: a drag, the menu on the
// card, or a key. All three are the same move (moveCardAction, the stage the
// board showed riding along), and all three offer only what page.tsx computed
// for the card (lib/client/pipeline-moves.ts), so a column that means no stage
// takes no drop. The card moves at once and the server's answer settles it; a
// refusal puts it back and says why. Keys, from design/tats's Pipeline: J/K
// walk the cards, Enter opens one, S is its stage menu, A its next stage, F or
// / the filter, B the list. Its X, P and L have nothing behind them here. A
// right-click on a card is the same menu with Open first (move-menu.tsx), on a
// job the member may edit and on a desktop.

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
  onContext,
}: {
  card: BoardCard;
  dragged: boolean;
  locked: boolean;
  menuOpen: boolean;
  onDragStart: (card: BoardCard) => void;
  onDragEnd: () => void;
  onMenu: (card: BoardCard) => void;
  onContext: (card: BoardCard, e: React.MouseEvent) => void;
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
      onContextMenu={(e) => onContext(card, e)}
      className={cn(
        "group relative rounded-[8px] border border-[color:var(--line)] bg-[color:var(--paper)] shadow-[var(--shadow)] transition-colors hover:border-[color:var(--line-strong)]",
        dragged && "opacity-40",
      )}
    >
      <Link href={card.href} draggable={false} data-key-item className="grid gap-1 p-3">
        <span data-hc={hoverAttr("candidate", card.personId)} className={cn("truncate text-[14px] leading-[1.3] font-medium", movable && "pr-5")}>
          {card.name}
        </span>
        <span className="truncate text-[12.5px] text-muted-foreground">{card.line}</span>
        <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[12.5px]">
          <span
            className={cn("min-w-0 truncate", card.stalled ? "text-negative" : "text-muted-foreground")}
            title={card.stalled ? "Needs attention: overdue, or untouched for a while" : undefined}
          >
            {card.status}
          </span>
          {card.ownerName ? (
            <span title={card.ownerName} data-hc={card.ownerActorId ? hoverAttr("member", card.ownerActorId) : undefined} className="shrink-0">
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
            "absolute top-2 right-2 grid size-6 place-items-center rounded-full text-muted-foreground transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-[color:var(--hover)] hover:text-foreground [@media(hover:none)]:opacity-100",
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
        "flex min-h-[300px] min-w-[184px] flex-[1_1_0] flex-col gap-2 bg-[color:var(--band)] p-1 shadow-[inset_0_0_0_1px_var(--line)] transition-[background-color,opacity]",
        takes && "ring-1 ring-[color:var(--accent)] ring-inset",
        takes && over && "bg-[color:var(--accent-soft)]",
        takes === false && !source && "opacity-55",
      )}
    >
      <h2 className="m-0 mb-0.5 flex h-[30px] shrink-0 items-center gap-2 border-b border-[color:var(--line)] bg-[color:var(--surface)] px-2 text-[14px] font-medium">
        {column.label}
        <span className="font-normal text-faint tabular-nums">{column.total}</span>
      </h2>
      {children}
      {column.more ? (
        <Link
          href={column.more.href}
          className="grid h-[30px] place-items-center rounded-full text-[12.5px] text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground"
        >
          {column.more.label}
        </Link>
      ) : null}
    </section>
  );
}

export function Board({ columns }: { columns: BoardColumn[] }) {
  const [shown, shift] = useOptimistic(columns, shiftCard);
  const [pending, start] = useTransition();
  const [drag, setDrag] = useState<{ card: BoardCard; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuAt<BoardCard> | null>(null);
  // Where focus goes while a move settles: a moved card is a new element.
  const refocus = useRef<{ id: string; fallback: string | null } | null>(null);
  // The last thing the board said: a move takes it away, a refusal left standing included.
  const said = useRef<string | null>(null);
  const say = (text: string, tone: "info" | "error" = "info") => {
    if (said.current) dismissToast(said.current);
    said.current = showToast({ text, tone });
  };
  const movable = shown.some((c) => c.cards.some((x) => x.moves));

  useEffect(() => {
    const r = refocus.current;
    if (!r) return;
    // Someone typing in the filter keeps their field: the rest of the word would land on the card as keys.
    if (!isTyping(document.activeElement)) (linkOf(r.id) ?? (r.fallback ? linkOf(r.fallback) : null))?.focus();
    if (!pending) refocus.current = null;
  }, [shown, pending]);

  const move = (card: BoardCard, to: StageMove, keepFocus: boolean) => {
    setMenu(null);
    if (said.current) dismissToast(said.current);
    if (keepFocus) refocus.current = { id: card.applicationId, fallback: neighbourOf(shown, card.applicationId) };
    const form = moveForm(card, to.stage);
    start(async () => {
      shift({ applicationId: card.applicationId, stage: to.stage, stageLabel: to.label, column: to.column });
      const result: BoardMoveResult = await moveCardAction(form).catch(() => ({ ok: false, error: "unsure" }) as const);
      if (!result.ok) say(CANDIDATE_ERRORS[result.error], "error");
      else say(result.changed ? `Moved ${card.name} to ${to.label}.` : CANDIDATE_NOTICES.unchanged);
    });
  };

  const openMenu = (card: BoardCard) => {
    const button = cardEl(card.applicationId)?.querySelector("button");
    if (button) setMenu({ card, rect: cssRect(button.getBoundingClientRect()) });
  };

  const closeMenu = useCallback(() => setMenu(null), []);
  const focusCard = useCallback((id: string) => linkOf(id)?.focus(), []);

  const onContext = (card: BoardCard, e: React.MouseEvent) => {
    const el = cardEl(card.applicationId);
    if (!el || !takesRowMenu(e.nativeEvent, matchMedia(DESKTOP_POINTER).matches, card, pending)) return;
    e.preventDefault();
    linkOf(card.applicationId)?.focus();
    setMenu({ card, rect: menuSpot(e.clientX, e.clientY, el.getBoundingClientRect()), open: { href: card.href, scroll: true } });
  };

  const drop = (column: BoardColumn) => {
    const from = drag;
    setDrag(null);
    setOver(null);
    if (!from?.card.moves || column.key === from.from) return;
    const stage = from.card.moves.drops[column.key as ColumnKey];
    const to = from.card.moves.stages.find((m) => m.stage === stage);
    if (to) move(from.card, to, false);
    else say(NO_DROP[column.key as ColumnKey] ?? "That column means no stage for them.");
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
    "Applicant Tickets",
    movable
      ? [
          { keys: "S or right-click", label: "Move to a stage" },
          { keys: "A", label: "Move to the next stage" },
          { keys: "Drag", label: "Move to another column" },
        ]
      : [],
  );

  return (
    <>
      <KeyList title="Applicant Tickets" next="Next card" mode="focus" data-tour="board" className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-8 md:px-8">
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
                  onContext={onContext}
                />
              ))}
            </Column>
          ))}
        </div>
      </KeyList>
      {menu ? <MoveMenu at={menu} onPick={(m) => move(menu.card, m, true)} onClose={closeMenu} focusRow={focusCard} /> : null}
    </>
  );
}

/** F or /: the name filter, which stays when the board has nobody to show. */
export function FilterKeys({ enabled = true }: { enabled?: boolean }) {
  const focus = () => {
    const input = document.querySelector<HTMLInputElement>('form[action="/client/pipeline"] input[name="q"]');
    input?.focus();
    input?.select();
  };
  useKeys({ f: focus, "/": focus }, enabled);
  useKeyHelp("Applicant Tickets", [{ keys: "F or /", label: "Filter by name" }]);
  return null;
}

/** B: the other layout. Across jobs there's no board to go to, and it says so, as design/tats. */
export function LayoutKey({ to, refusal, enabled }: { to: string | null; refusal: string; enabled: boolean }) {
  const router = useRouter();
  useKeys({ b: () => (to ? router.push(to) : void showToast({ text: refusal })) }, enabled);
  useKeyHelp("Applicant Tickets", [{ keys: "B", label: "List or board" }]);
  return null;
}
