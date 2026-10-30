"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { ignoreKey, keyName, stepIndex } from "@/lib/keys";
import { cn } from "@/lib/utils";

// design/tats's keyboard model, the React half (lib/keys.ts is the pure
// half). A page registers its keys with useKeys and lists them for the `?`
// sheet with useKeyHelp; the shell (app-shell/shell-keys.tsx) owns G-then-a-
// letter and `?`. Keys are shortcuts: every one has a button or link that
// does the same thing.

export type KeyHandler = (e: KeyboardEvent) => void;

/**
 * Binds keys on the window while mounted: `{ j: next, Enter: open }`, letters
 * lower-case. Skips typing, ⌘ / Ctrl / Alt and handled events (lib/keys.ts's
 * ignoreKey), and anything while a <dialog> is open; a bound key's default is
 * prevented, so nothing else acts on it.
 */
export function useKeys(bindings: Record<string, KeyHandler>, enabled = true) {
  const ref = useRef(bindings);
  ref.current = bindings;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      // A modal owns the keyboard: nothing behind it acts, and Esc stays the dialog's to close it.
      if (ignoreKey(e) || document.querySelector("dialog[open]")) return;
      const run = ref.current[keyName(e.key)];
      if (!run) return;
      e.preventDefault();
      run(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/** One line of the `?` sheet: the keys as shown ("J / K", "G then H") and what they do. */
export type KeyHelpRow = { keys: string; label: string };
export type KeyHelpSection = { title: string; rows: KeyHelpRow[] };

// The sections the mounted page has registered, for the shell's sheet.
let sections: { id: number; section: KeyHelpSection }[] = [];
let nextId = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => sections;
const none: typeof sections = [];
const serverSnapshot = () => none;

/** Lists this page's keys in the `?` sheet while mounted. Sections with the same title merge. */
export function useKeyHelp(title: string, rows: KeyHelpRow[]) {
  const key = JSON.stringify(rows);
  useEffect(() => {
    const id = nextId++;
    sections = [...sections, { id, section: { title, rows: JSON.parse(key) as KeyHelpRow[] } }];
    emit();
    return () => {
      sections = sections.filter((s) => s.id !== id);
      emit();
    };
  }, [title, key]);
}

/** The registered sections, merged by title in mount order. */
export function usePageKeyHelp(): KeyHelpSection[] {
  const all = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const out: KeyHelpSection[] = [];
  for (const { section } of all) {
    const same = out.find((s) => s.title === section.title);
    if (same) same.rows = [...same.rows, ...section.rows];
    else out.push({ title: section.title, rows: [...section.rows] });
  }
  return out;
}

/** A key as a small keycap, as design/tats's `.kbd`. Hidden from screen readers when it only decorates a labelled button. */
export function Kbd({ children, className, decorative = false }: { children: React.ReactNode; className?: string; decorative?: boolean }) {
  return (
    <kbd
      aria-hidden={decorative || undefined}
      className={cn(
        "inline-grid h-[18px] min-w-[18px] place-items-center rounded-[5px] border border-[color:var(--line-strong)] px-1 font-sans text-[11px] leading-none font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * J/K through a list of links. `select` (a list beside a reader: Applicant
 * Tickets, Interviews) follows the next link, so the URL (`?a=`, `?i=`)
 * moves; `focus` (a table: the CRM) only moves focus, and Enter opens the
 * focused link as it always does. The focused row is the highlighted one,
 * so it shows with the focus ring. Items are the elements matching `items`
 * inside the wrapper; the current one is the focused item, else the
 * `aria-current` one.
 */
export function KeyList({
  title,
  next,
  mode,
  items = "[data-key-item]",
  className,
  role,
  "aria-label": ariaLabel,
  "data-tour": tour,
  children,
}: {
  /** The `?` sheet's heading for these keys: the page's name. */
  title: string;
  /** What J does, for the sheet: "Next ticket". */
  next: string;
  mode: "select" | "focus";
  items?: string;
  className?: string;
  role?: string;
  "aria-label"?: string;
  /** What the tutorial spotlights it as (lib/tour.ts). */
  "data-tour"?: string;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const step = (d: 1 | -1) => {
    const all = Array.from(box.current?.querySelectorAll<HTMLElement>(items) ?? []);
    // A row's item may not be what has focus: the CRM's checkbox and Interviews' check sit beside their links.
    const active = document.activeElement;
    const focused = all.findIndex((el) => el === active || (active && el.closest("[role=row], [data-key-row]")?.contains(active)));
    const cur = focused >= 0 ? focused : all.findIndex((el) => el.hasAttribute("aria-current"));
    const i = stepIndex(cur, all.length, d);
    const el = all[i];
    if (!el || i === cur) return el?.focus();
    el.focus();
    if (mode === "select") el.click();
  };
  // Not the arrows, as design/tats had: on a page they scroll, and stay so.
  useKeys({ j: () => step(1), k: () => step(-1) });
  useKeyHelp(title, [
    { keys: "J / K", label: `${next}, previous` },
    ...(mode === "focus" ? [{ keys: "↵", label: "Open" }] : []),
  ]);
  return (
    <div
      ref={box}
      role={role}
      aria-label={ariaLabel}
      data-tour={tour}
      className={cn("[&_:is(a,button):focus-visible]:outline-2 [&_:is(a,button):focus-visible]:-outline-offset-2 [&_:is(a,button):focus-visible]:outline-[color:var(--accent)]", mode === "focus" && "[&>a:focus-visible]:bg-[color:var(--sel)]", className)}
    >
      {children}
    </div>
  );
}
