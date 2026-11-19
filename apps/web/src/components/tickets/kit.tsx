"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { TONE_COLOR, TONE_MEANING } from "./tone";

// Tacit Tickets' shared parts (design/tacit-tickets/src/kit.tsx and ui.tsx),
// ported as they are: the heading and label styles, the legend, the key hint,
// the mark, the quiet button, the menu and the icon button. Only what a ported
// screen uses comes over; the prototype's demo store does not.

export { heading, label } from "./styles";

/** What each colour means, said once beside anything coloured. */
export function ToneLegend({ className = "" }: { className?: string }) {
  return (
    <span className={`flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-mute ${className}`}>
      {TONE_MEANING.map(([tone, name, means]) => (
        <span key={tone} title={means} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="size-2 rounded-full" style={{ background: TONE_COLOR[tone] }} />
          {name}
        </span>
      ))}
    </span>
  );
}

const noop = () => () => {};
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** The shortcut as this computer names it: ⌘K on a Mac, Ctrl K elsewhere. The server draws ⌘. */
export function useMod(key: string) {
  const mac = useSyncExternalStore(noop, isMac, () => true);
  return mac ? `⌘${key}` : `Ctrl ${key}`;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded bg-current/10 px-1 font-sans text-[11px] text-current/70">
      {children}
    </kbd>
  );
}

/** The Tacit mark: two corners facing each other, in the current text colour. */
export function TacitMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Tacit">
      <path d="M40 14H66V40" />
      <path d="M40 66H14V40" />
    </svg>
  );
}

export function IconButton({ label: name, children, onClick, className = "" }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <button type="button" aria-label={name} title={name} onClick={onClick} className={`flex size-7 items-center justify-center rounded-md text-mute transition-colors hover:bg-sel hover:text-ink ${className}`}>
      {children}
    </button>
  );
}

/** A quiet button: `solid` is the one primary action on a surface. */
export function Btn({ children, onClick, solid, disabled, title: tip, className = "", type = "button" }: { children: ReactNode; onClick?: () => void; solid?: boolean; disabled?: boolean; title?: string; className?: string; type?: "button" | "submit" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={tip}
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 whitespace-nowrap transition disabled:opacity-30 ${solid ? "bg-ink font-medium text-well hover:opacity-90" : "border border-line-strong text-ink hover:bg-hover"} ${className}`}
    >
      {children}
    </button>
  );
}

export type MenuItem = { label: ReactNode; onPick: () => void; on?: boolean; danger?: boolean } | { label: ReactNode; href: string; on?: boolean } | "sep" | { heading: string };

/** A menu that opens from its trigger; closes on pick, outside click or Escape. */
export function Menu({ trigger, items, align = "left", up, width = 200 }: { trigger: (open: boolean) => ReactNode; items: MenuItem[]; align?: "left" | "right"; up?: boolean; width?: number }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  const row = "flex min-h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 py-1 text-left transition-colors hover:bg-hover";
  return (
    <span className="relative inline-flex min-w-0">
      <span onClick={() => setOpen(!open)} className="inline-flex min-w-0">
        {trigger(open)}
      </span>
      {open && (
        <>
          <span className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <span
            role="menu"
            style={{ width }}
            className={`anim-rise scroll-quiet absolute z-50 flex max-h-[360px] flex-col overflow-y-auto rounded-xl border border-line-strong bg-panel p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.45)] ${up ? "bottom-full mb-1.5" : "top-full mt-1.5"} ${align === "right" ? "right-0" : "left-0"}`}
          >
            {items.map((it, i) =>
              it === "sep" ? (
                <span key={i} className="mx-1 my-1 h-px shrink-0 bg-line" />
              ) : "heading" in it ? (
                <span key={i} className="px-2.5 pt-1.5 pb-1 text-xs text-dim">
                  {it.heading}
                </span>
              ) : "href" in it ? (
                <Link key={i} role="menuitem" href={it.href} onClick={() => setOpen(false)} className={`${row} text-ink`}>
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.on && <span className="size-1.5 shrink-0 rounded-full bg-ink" />}
                </Link>
              ) : (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    it.onPick();
                  }}
                  className={`${row} ${it.danger ? "text-bad" : "text-ink"}`}
                >
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.on && <span className="size-1.5 shrink-0 rounded-full bg-ink" />}
                </button>
              ),
            )}
          </span>
        </>
      )}
    </span>
  );
}
