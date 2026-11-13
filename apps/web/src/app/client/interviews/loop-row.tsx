"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Testbench's recessed well, which the rounds sit in so the one being read can rise off it. */
const WELL = "rounded-[10px] bg-[color:var(--soft)] p-2 shadow-[inset_0_0_0_1px_var(--line)]";

/**
 * With more than fits, a row opens with the round being read in view rather
 * than the first ones. It scrolls only as far as it must, and to where a step
 * begins, so no step is cut in half at the left on first paint. Only the row
 * moves, so the reader stays where it is. `fit` re-runs it once the graph has
 * been scaled to the reader.
 */
function useInView<E extends HTMLElement>(current: string | null, fit: number = 1) {
  const row = useRef<E>(null);
  useEffect(() => {
    const el = row.current;
    const card = el?.querySelector('[aria-current="step"]');
    if (!el || !card) return;
    const box = el.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0;
    const from = (x: number) => x - box.left + el.scrollLeft;
    const need = from(card.getBoundingClientRect().right) + pad - el.clientWidth;
    if (need <= 0) {
      el.scrollLeft = 0;
      return;
    }
    const starts = [...el.querySelectorAll("li")].map((li) => from(li.getBoundingClientRect().left) - pad).filter((x) => x >= need);
    el.scrollLeft = starts.length ? Math.min(...starts) : need;
  }, [current, fit]);
  return row;
}

/** The loop's row of rounds, wrapping onto another line before it would cut one; it scrolls sideways inside itself only where even one will not fit (a phone). Focusable so the keyboard can scroll it then. */
export function LoopRow({ current, label = "Rounds, in order", children }: { current: string | null; label?: string; children: ReactNode }) {
  const row = useInView<HTMLOListElement>(current);
  return (
    <ol
      ref={row}
      tabIndex={0}
      aria-label={label}
      className={`${WELL} m-0 flex list-none flex-wrap gap-y-2 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]`}
    >
      {children}
    </ol>
  );
}

/** Scaled to the reader, never up, never below this (design/tats's ftFit). Past that, which is a phone, it scrolls. */
const SMALLEST = 0.75;

/** The routing graph, fitted to the reader where it can be and scrolling sideways inside itself where it cannot, never widening the page. */
export function RouteRow({ current, width, height, children }: { current: string | null; width: number; height: number; children: ReactNode }) {
  const [scale, setScale] = useState(1);
  const row = useInView<HTMLDivElement>(current, scale);
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
      className={`${WELL} overflow-x-auto p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]`}
    >
      <div style={{ width: width * scale, height: height * scale }}>
        <div className="relative origin-top-left" style={{ width, height, transform: scale === 1 ? undefined : `scale(${scale})` }}>
          {children}
        </div>
      </div>
    </div>
  );
}
