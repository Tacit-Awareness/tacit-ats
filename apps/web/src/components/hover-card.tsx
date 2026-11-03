"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Avatar } from "@/components/page";
import { CARD_FRESH_MS, parseHoverTarget, placeCard, raisesCard, restMs, type HoverCardData } from "@/lib/hover-card";
import { cssPx, cssRect } from "@/lib/ui-scale";

// design/tats's hover cards (`.hcard`): rest a mouse or a pen on a name marked
// `data-hc` (lib/hover-card.ts's hoverAttr) to see who it is. Mounted once in the
// shell and listening on the document, as the pill glass does. A finger never
// raises one, nor does anything while a dialog, a menu or a drag is up. The card
// holds nothing that isn't on the page it links to, so the keys go there instead;
// Esc closes it. Its words are React text: a candidate's name is never markup.

type Up = { key: string; anchor: Element; card: HoverCardData };

const BLOCKERS = "[role=dialog], dialog[open], [role=menu]";

export function HoverCard() {
  const [up, setUp] = useState<Up | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const upRef = useRef<Up | null>(null);
  upRef.current = up;
  const pathname = usePathname();

  useEffect(() => setUp(null), [pathname]);

  useEffect(() => {
    let showing = 0;
    let hiding = 0;
    let asked: AbortController | null = null;
    let wanted: string | null = null;
    const read = new Map<string, { at: number; card: HoverCardData | null }>();

    const cancel = () => {
      clearTimeout(showing);
      asked?.abort();
      asked = null;
      wanted = null;
    };
    const hide = () => {
      cancel();
      clearTimeout(hiding);
      setUp(null);
    };
    const hideSoon = () => {
      clearTimeout(hiding);
      hiding = window.setTimeout(hide, 160);
    };

    const show = async (key: string, anchor: Element) => {
      if (document.querySelector(BLOCKERS)) return;
      const held = read.get(key);
      let card = held && Date.now() - held.at < CARD_FRESH_MS ? held.card : undefined;
      if (card === undefined) {
        const controller = new AbortController();
        asked = controller;
        try {
          const res = await fetch(`/client/hover?t=${encodeURIComponent(key)}`, { signal: controller.signal });
          card = res.ok ? ((await res.json()) as { card: HoverCardData | null }).card : null;
        } catch {
          return;
        }
        if (controller.signal.aborted) return;
        read.set(key, { at: Date.now(), card });
      }
      // Still resting there, and nothing has opened meanwhile.
      if (wanted !== key || !anchor.isConnected || document.querySelector(BLOCKERS)) return;
      setUp(card ? { key, anchor, card } : null);
    };

    const onOver = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!raisesCard(e.pointerType) || !target?.closest) return;
      if (box.current?.contains(target)) {
        clearTimeout(hiding);
        return;
      }
      const anchor = e.buttons === 0 ? target.closest("[data-hc]") : null;
      const key = anchor?.getAttribute("data-hc") ?? null;
      if (!anchor || !key || !parseHoverTarget(key) || document.querySelector(BLOCKERS)) {
        cancel();
        if (upRef.current) hideSoon();
        return;
      }
      clearTimeout(hiding);
      if (upRef.current?.anchor === anchor || wanted === key) return;
      cancel();
      wanted = key;
      showing = window.setTimeout(() => void show(key, anchor), restMs(!!upRef.current));
    };
    const onDown = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("dragstart", hide, true);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("keydown", onKey);
    return () => {
      hide();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("dragstart", hide, true);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !up) return;
    const spot = placeCard(cssRect(up.anchor.getBoundingClientRect()), { width: el.offsetWidth, height: el.offsetHeight }, { width: cssPx(window.innerWidth), height: cssPx(window.innerHeight) });
    el.style.left = `${spot.left}px`;
    el.style.top = `${spot.top}px`;
  }, [up]);

  if (!up) return null;
  return (
    <div ref={box} role="tooltip" className="fixed z-[55] w-[320px] max-w-[calc(100vw-16px)]">
      <CardBody card={up.card} />
    </div>
  );
}

/** `.hcard`: the avatar and who, the stage, the rows, the way on. A row with nothing to say isn't in `rows`. */
export function CardBody({ card }: { card: HoverCardData }) {
  return (
    <div className="grid gap-2.5 rounded-[10px] border border-[color:var(--line-strong)] bg-raised p-3 text-[13px] shadow-[var(--pop-shadow)]">
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar name={card.name} size="xl" candidate={card.kind === "candidate"} />
        <div className="grid min-w-0 gap-0.5">
          <b className="truncate text-[14px] font-semibold">{card.name}</b>
          {card.line ? <span className="line-clamp-2 text-[12.5px] text-muted-foreground">{card.line}</span> : null}
        </div>
      </div>
      {card.state ? (
        <p className="m-0 flex min-w-0 items-center gap-1.5">
          <i aria-hidden className="size-1.5 flex-none rounded-full bg-foreground/55" />
          <span className="flex-none">{card.state.stage}</span>
          <span className="truncate text-faint">· {card.state.note}</span>
        </p>
      ) : null}
      {card.rows.length ? (
        <dl className="m-0 grid gap-1 border-t border-[color:var(--line)] pt-2">
          {card.rows.map((r) => (
            <div key={r.label} className="grid grid-cols-[76px_minmax(0,1fr)] gap-2">
              <dt className="text-[12.5px] text-faint">{r.label}</dt>
              <dd className="m-0 min-w-0 truncate">
                {r.value}
                {r.faint ? <span className="ml-1.5 text-faint">{r.faint}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {card.link ? (
        <Link
          href={card.link.href}
          className="inline-flex h-7 items-center justify-self-start rounded-full border border-[color:var(--line)] bg-[color:var(--paper)] px-3 text-[12.5px] transition-colors hover:bg-[color:var(--hover)]"
        >
          {card.link.label}
        </Link>
      ) : null}
    </div>
  );
}
