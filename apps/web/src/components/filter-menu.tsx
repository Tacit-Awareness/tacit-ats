"use client";

import Link from "next/link";
import * as React from "react";
import { fitShift } from "@/lib/menu-fit";
import { cn } from "@/lib/utils";
import "./overlays.css";

// design/tats's filter chip: the current value and a chevron, opening a menu
// of links (the URL is the filter state). Client only to open and close it:
// a click outside, Escape or picking an option closes it. It hangs from the
// chip's right edge, and slides along for a chip near the window's left. The
// chip is Testbench's `.filter` on a white face, as tall as the SearchBox
// beside it (34px), and the list its `.menu` (overlays.css). A chip that is
// filtering (`data-on`) takes a darker ring, the ink and a quiet fill.

export type FilterOption = { href: string; label: string; active: boolean };

export function FilterMenu({
  label,
  value,
  on,
  options,
  block,
}: {
  label: string;
  value: string;
  on: boolean;
  options: FilterOption[];
  /** design/tats's `.ex-sel`: a full-width 36px select rather than a chip (Analytics' explorer). */
  block?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  const menu = React.useRef<HTMLDivElement>(null);
  const id = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  React.useLayoutEffect(() => {
    const el = menu.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    el.style.right = `${-fitShift(box.x, box.x + box.width, innerWidth)}px`;
  }, [open]);

  return (
    <div ref={root} className={cn("relative", block && "w-full")}>
      <button
        type="button"
        aria-label={`${label}: ${value}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        data-on={on || undefined}
        className={cn(
          "items-center gap-1.5 rounded-[7px] bg-[color:var(--paper)] font-mono text-[13px] whitespace-nowrap transition-colors hover:bg-[color:var(--hover)] hover:text-foreground aria-expanded:bg-[color:var(--hover)] aria-expanded:text-foreground",
          block ? "flex h-9 w-full justify-between pr-2.5 pl-3" : "inline-flex h-[34px] max-w-[240px] pr-2.5 pl-3",
          on && !block ? "bg-[color:var(--sel)] text-foreground shadow-[inset_0_0_0_1px_var(--faint)]" : "text-muted-foreground shadow-[inset_0_0_0_1px_var(--line-strong)]",
        )}
      >
        <span className="truncate">{value}</span>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-[13px] shrink-0 text-faint" aria-hidden>
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open ? (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={label}
          className="ov-menu absolute right-0 z-50 mt-1.5 grid max-h-[340px] max-w-[320px] min-w-[240px] origin-top-right overflow-y-auto"
        >
          {options.map((o) => (
            <Link
              key={o.href}
              href={o.href}
              role="menuitemradio"
              aria-checked={o.active}
              onClick={() => setOpen(false)}
              className={cn("ov-item", o.active && "font-medium")}
            >
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.active ? (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="ml-auto size-3.5" aria-hidden>
                  <path d="M3.5 8.5l3 3 6-7" />
                </svg>
              ) : null}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
