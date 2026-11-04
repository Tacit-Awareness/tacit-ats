"use client";

import Link from "next/link";
import * as React from "react";
import { fitShift } from "@/lib/menu-fit";
import { cn } from "@/lib/utils";

// design/tats's filter chip: the current value and a chevron, opening a menu
// of links (the URL is the filter state). Client only to open and close it:
// a click outside, Escape or picking an option closes it. It hangs from the
// chip's right edge, and slides along for a chip near the window's left.

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
        className={cn(
          block
            ? "flex h-9 w-full items-center justify-between gap-1.5 rounded-[8px] border border-[color:var(--line-strong)] bg-[color:var(--paper)] px-3 text-[13.5px] font-medium whitespace-nowrap text-foreground shadow-[var(--shadow)] transition-colors hover:bg-[color:var(--hover)]"
            : "inline-flex h-8 max-w-[240px] items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] whitespace-nowrap text-foreground transition-colors",
          !block && (on ? "border-transparent bg-[color:var(--sel)]" : "border-[color:var(--line)] bg-[color:var(--paper)] hover:border-[color:var(--line-strong)]"),
        )}
      >
        <span className="truncate">{value}</span>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} className="size-[13px] shrink-0 text-muted-foreground" aria-hidden>
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open ? (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={label}
          className="absolute right-0 z-50 mt-1 grid max-h-[340px] max-w-[300px] min-w-[220px] gap-px overflow-y-auto rounded-[10px] border border-[color:var(--line-strong)] bg-raised p-1 shadow-[var(--pop-shadow)]"
        >
          {options.map((o) => (
            <Link
              key={o.href}
              href={o.href}
              role="menuitemradio"
              aria-checked={o.active}
              onClick={() => setOpen(false)}
              className={cn("flex h-8 items-center gap-2 px-2 text-[13px] hover:bg-[color:var(--soft-strong)]", o.active && "font-medium")}
            >
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.active ? (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-3.5 shrink-0" aria-hidden>
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
