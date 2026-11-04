"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const BLEED = "-mx-4 px-4 @2xl:-mx-[26px] @2xl:px-[26px]";

/** With more than fits, a row opens on the round being read rather than on the first. Only the row moves, so the reader stays where it is. */
function useCentred<E extends HTMLElement>(current: string | null) {
  const row = useRef<E>(null);
  useEffect(() => {
    const el = row.current;
    const card = el?.querySelector('[aria-current="step"]');
    if (!el || !card) return;
    const box = el.getBoundingClientRect();
    const at = card.getBoundingClientRect();
    el.scrollLeft += at.left - box.left - (box.width - at.width) / 2;
  }, [current]);
  return row;
}

/** The loop's row of rounds, scrolling sideways inside itself. Focusable so the keyboard can scroll it when none of its cards is a link. */
export function LoopRow({ current, label = "Rounds, in order", children }: { current: string | null; label?: string; children: ReactNode }) {
  const row = useCentred<HTMLOListElement>(current);
  return (
    <ol
      ref={row}
      tabIndex={0}
      aria-label={label}
      className={`${BLEED} m-0 flex list-none overflow-x-auto pt-1 pb-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--accent)]`}
    >
      {children}
    </ol>
  );
}

/** Scaled to the reader, never up, never below this (design/tats's ftFit). Past that, which is a phone, it scrolls. */
const SMALLEST = 0.75;

/** The routing graph, fitted to the reader where it can be and scrolling sideways inside itself where it cannot, never widening the page. */
export function RouteRow({ current, width, height, children }: { current: string | null; width: number; height: number; children: ReactNode }) {
  const row = useCentred<HTMLDivElement>(current);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const fit = () => {
      const { paddingLeft, paddingRight } = getComputedStyle(el);
      setScale(Math.max(SMALLEST, Math.min(1, (el.clientWidth - parseFloat(paddingLeft) - parseFloat(paddingRight)) / width)));
    };
    fit();
    const seen = new ResizeObserver(fit);
    seen.observe(el);
    return () => seen.disconnect();
  }, [row, width]);
  return (
    <div
      ref={row}
      tabIndex={0}
      role="group"
      aria-label="The way through the interview process"
      className={`${BLEED} overflow-x-auto pt-1 pb-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--accent)]`}
    >
      <div style={{ width: width * scale, height: height * scale }}>
        <div className="relative origin-top-left" style={{ width, height, transform: scale === 1 ? undefined : `scale(${scale})` }}>
          {children}
        </div>
      </div>
    </div>
  );
}
