"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { STAGE_GLYPH, StatusGlyph } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { STAGE_LABELS } from "@/lib/client/stage-labels";
import { CARD_FRESH_MS, parseHoverTarget, placeCard, raisesCard, restMs, type HoverCardData } from "@/lib/hover-card";

// design/tats's hover cards (`.hcard`): rest a mouse or a pen on a name marked
// `data-hc` (lib/hover-card.ts's hoverAttr) to see who it is. Mounted once in the
// shell and listening on the document, as the pill glass does. A finger never
// raises one, nor does anything while a dialog, a menu or a drag is up. The card
// holds nothing that isn't on the page it links to, so the keys go there instead;
// Esc closes it. Its words are React text: a candidate's name is never markup.
// Drawn as a Testbench popover: white, 12px corners, the pop shadow, the name in
// Mona Sans, the stage as its square glyph, never a picture.

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
    const spot = placeCard(up.anchor.getBoundingClientRect(), { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
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

/** The card says the stage in words (crm-views.ts's stageLabel); its glyph is the stage's. */
const glyphOf = (label: string) => STAGE_GLYPH[Object.keys(STAGE_LABELS).find((k) => STAGE_LABELS[k] === label) ?? ""] ?? "empty";

/** `.hcard`: who, the stage, the rows, the way on. A row with nothing to say isn't in `rows`. */
export function CardBody({ card }: { card: HoverCardData }) {
  return (
    <div className="grid gap-3 rounded-[12px] bg-[color:var(--paper)] p-4 text-[13px] shadow-[var(--pop-shadow)]">
      <div className="grid min-w-0 gap-1">
        <b className="truncate font-sans text-[15px] leading-5 font-semibold tracking-[-0.01em]">{card.name}</b>
        {/* The line comes joined with "·" (lib/client/hover-card.ts); its facts sit apart here, without the dots. */}
        {card.line ? (
          <span className="flex flex-wrap gap-x-2.5 text-[12.5px] text-faint">
            {card.line.split(" · ").map((fact, i) => (
              <span key={i} className="line-clamp-2">
                {fact}
              </span>
            ))}
          </span>
        ) : null}
      </div>
      {card.state ? (
        <p className="m-0 flex min-w-0 items-center gap-2">
          <StatusGlyph kind={glyphOf(card.state.stage)} />
          <span className="flex-none font-medium">{card.state.stage}</span>
          <span className="truncate text-faint">{card.state.note}</span>
        </p>
      ) : null}
      {card.rows.length ? (
        <dl className="m-0 grid gap-1.5 border-t border-[color:var(--line)] pt-3">
          {card.rows.map((r) => (
            <div key={r.label} className="grid grid-cols-[76px_minmax(0,1fr)] gap-2">
              <dt className="text-faint">{r.label}</dt>
              {/* Wraps between words rather than cutting a value short ("Either way  1 of 4 this week"); a value stays whole. */}
              <dd className="m-0 flex min-w-0 flex-wrap gap-x-1.5">
                <span>{r.value}</span>
                {r.faint ? <span className="text-faint">{r.faint}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {card.link ? (
        <Link href={card.link.href} className={`${buttonVariants({ variant: "outline", size: "sm" })} justify-self-start`}>
          {card.link.label}
        </Link>
      ) : null}
    </div>
  );
}
