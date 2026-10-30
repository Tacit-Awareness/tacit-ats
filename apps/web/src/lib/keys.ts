// design/tats's keyboard model, the pure half (components/keys.tsx is the
// React half): which key events a page may act on, the G-then-letter chord,
// and stepping through a list. Unit-tested in keys.test.ts.

/** The fields of a KeyboardEvent the guards read, so tests need no DOM. */
export type KeyEventLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  target: EventTarget | null;
};

/** True while the user is typing: an input, textarea, select or contenteditable keeps its keys. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  return !!el && (el.isContentEditable === true || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName ?? ""));
}

/** True while a modal <dialog> is open: the page behind it is inert, so its keys are too. */
export const modalOpen = (): boolean => typeof document !== "undefined" && document.querySelector("dialog:modal") !== null;

/**
 * Whether an element is on screen. A reader on a phone's list is mounted but
 * hidden: its keys must not act on an issue nobody can see, and a modal opened
 * in there draws nothing and leaves the whole page inert.
 */
export const isShown = (el: { getClientRects(): { length: number } } | null): boolean => !!el && el.getClientRects().length > 0;

/**
 * A page key never fires while typing, with ⌘, Ctrl or Alt held (those
 * belong to the browser and the OS, and ⌘K to the shell), once something
 * else has handled the event, or behind a modal dialog. Shift is allowed: `?`
 * needs it.
 */
export function ignoreKey(e: KeyEventLike, modal = modalOpen()): boolean {
  return modal || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target);
}

/** The name a binding is registered under: letters lower-cased, so Shift+J is J; named keys as the browser gives them. */
export const keyName = (key: string): string => (key.length === 1 ? key.toLowerCase() : key);

export type MenuCommand = { kind: "step"; d: 1 | -1 } | { kind: "pick"; index: number } | { kind: "close"; refocus: boolean };

/**
 * One key into an open menu of `count` numbered lines: J/K or the arrows, a
 * digit, Esc, Tab. A menu's keys are page keys, so ignoreKey holds: focus can
 * reach a field with a menu still up, and a digit typed there is not a pick.
 */
export function menuKey(e: KeyEventLike, count: number): MenuCommand | null {
  if (ignoreKey(e)) return null;
  const k = keyName(e.key);
  if (k === "Escape") return { kind: "close", refocus: true };
  if (k === "Tab") return { kind: "close", refocus: false };
  if (k === "j" || k === "ArrowDown") return { kind: "step", d: 1 };
  if (k === "k" || k === "ArrowUp") return { kind: "step", d: -1 };
  return /^[1-9]$/.test(k) && Number(k) <= count ? { kind: "pick", index: Number(k) - 1 } : null;
}

/** How long G waits for its letter, as design/tats. */
export const CHORD_MS = 900;

/**
 * One key into the G chord. `pending` is when G was pressed (null when it
 * was not); the result is the new pending time and the letter that finishes
 * the chord, if this key did.
 */
export function chord(pending: number | null, key: string, now: number, ms = CHORD_MS): { pending: number | null; then: string | null } {
  const k = keyName(key);
  if (pending !== null && now - pending < ms) return { pending: null, then: k };
  if (k === "g") return { pending: now, then: null };
  return { pending: null, then: null };
}

/** The next index in a list of `n` from `cur` (-1 for none yet), clamped at both ends, as design/tats's J/K. */
export function stepIndex(cur: number, n: number, d: 1 | -1): number {
  if (n === 0) return -1;
  if (cur < 0) return d === 1 ? 0 : n - 1;
  return Math.max(0, Math.min(n - 1, cur + d));
}
