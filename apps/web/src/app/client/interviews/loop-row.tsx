"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cssPx } from "@/lib/ui-scale";

/**
 * The loop's row of rounds, scrolling sideways inside itself. With more rounds
 * than fit, it opens on the round being read rather than on the first. Only the
 * row moves, so the reader stays where it is. Focusable so the keyboard can
 * scroll it when none of its cards is a link.
 */
export function LoopRow({ current, children }: { current: string | null; children: ReactNode }) {
  const row = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = row.current;
    const card = el?.querySelector('[aria-current="step"]');
    if (!el || !card) return;
    const box = el.getBoundingClientRect();
    const at = card.getBoundingClientRect();
    el.scrollLeft += cssPx(at.left - box.left - (box.width - at.width) / 2);
  }, [current]);
  return (
    <ol
      ref={row}
      tabIndex={0}
      aria-label="Rounds, in order"
      className="-mx-4 m-0 flex list-none overflow-x-auto px-4 pt-1 pb-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--accent)] @2xl:-mx-[26px] @2xl:px-[26px]"
    >
      {children}
    </ol>
  );
}
