// design/tats's sidebar marks: no counts, a faint red tint on a link only when
// something arrived since you last opened that page. The pure half;
// components/app-shell/shell-memory.tsx holds the state. "Seen" is what the
// page showed you last time (`MarkSeen`), kept in this browser as ids only.
// Never seen means anything there is new, as the prototype. With storage
// blocked that is every load until the page is opened, which is the most a
// browser that keeps nothing can say.

export const MARKS = ["inbox", "tickets", "activity"] as const;
export type MarkKey = (typeof MARKS)[number];

/** What is on each page now (`GET /client/marks`, or the page itself), or what it last showed. Null is not known. */
export type MarkLists = Record<MarkKey, string[] | null>;
export const NO_MARKS: MarkLists = { inbox: null, tickets: null, activity: null };

const ids = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null);

/** Storage's copy, or `/client/marks`' answer: anything else knows nothing. */
export function parseMarks(raw: unknown): MarkLists {
  if (typeof raw !== "object" || raw === null) return NO_MARKS;
  const r = raw as Record<string, unknown>;
  return { inbox: ids(r.inbox), tickets: ids(r.tickets), activity: ids(r.activity) };
}

/** True when something is there now that the page did not show last time. */
export function hasNew(current: string[] | null, seen: string[] | null): boolean {
  if (!current?.length) return false;
  if (!seen) return true;
  const known = new Set(seen);
  return current.some((id) => !known.has(id));
}

/** Reading the marks costs what the Inbox costs: no more often than this on navigating or coming back to the tab. */
export const MARKS_TTL_MS = 120_000;
export const marksStale = (last: number | null, now: number) => last === null || now - last >= MARKS_TTL_MS;
