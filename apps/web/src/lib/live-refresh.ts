import { isTyping } from "./keys";

// The Pipeline and the Inbox follow work done elsewhere (design/tats's tabs,
// which a BroadcastChannel kept in step) without a reload. The pure half;
// components/live-refresh.tsx runs it. A visible tab asks `GET /client/live`
// for a stamp of the newest application and application event the member can
// read, a few rows on their own token, and only when that stamp moves does the
// page re-read itself (`router.refresh()`, the whole server render). A hidden
// tab asks nothing and has no timer; coming back asks at once. A change that
// lands while the member is busy (typing, dragging a card, a pop-up, a dialog
// or a menu open) waits until they are not, so nothing moves under a hand.
//
// Supabase Realtime would push instead, but none of tacit-internal's tables are
// in the `supabase_realtime` publication, and a socket needs the member's token
// in the browser, where the WorkOS session keeps it out of reach on purpose.

/** How often a visible tab looks at the clock: cheap, no request. */
export const LIVE_TICK_MS = 5_000;
/** How often a visible tab asks for the stamp. */
export const LIVE_CHECK_MS = 30_000;
/** Coming back to the tab asks at once, unless it asked this recently. */
export const LIVE_BACK_MS = 5_000;

/** `stamp`: the last answer (null until one came); `asked`: when; `due`: a newer stamp the page has not re-read for. */
export type Live = { stamp: string | null; asked: number | null; due: boolean };
export const LIVE_START: Live = { stamp: null, asked: null, due: false };

/** Mounting, the interval's tick, or the tab coming back (focus, visible again). */
export type LiveWhy = "start" | "tick" | "back";

/** Whether to ask for the stamp now. Never from a hidden tab. */
export function shouldAsk(live: Live, now: number, why: LiveWhy, hidden: boolean): boolean {
  if (hidden) return false;
  if (live.asked === null || why === "start") return true;
  return now - live.asked >= (why === "back" ? LIVE_BACK_MS : LIVE_CHECK_MS);
}

export const asked = (live: Live, now: number): Live => ({ ...live, asked: now });

/**
 * The answer. The first is the baseline for the page as drawn, not a change. A
 * failed one (null: offline, signed out) knows nothing and changes nothing.
 */
export function answered(live: Live, stamp: string | null): Live {
  if (stamp === null) return live;
  if (live.stamp === null) return { ...live, stamp };
  return stamp === live.stamp ? live : { ...live, stamp, due: true };
}

/** Re-read now: something changed, the tab is seen, and the member is not in the middle of something. */
export const shouldRefresh = (live: Live, hidden: boolean, held: boolean) => live.due && !hidden && !held;

export const refreshed = (live: Live): Live => ({ ...live, due: false });

/** `GET /client/live`'s answer: anything else is no answer. */
export function parseStamp(raw: unknown): string | null {
  const s = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).stamp : null;
  return typeof s === "string" && s.length > 0 ? s : null;
}

type DocLike = { activeElement: unknown; querySelector(selector: string): unknown };

/** What a re-read must not land under: an open pop-up, dialog or menu. */
export const HOLDING = '[role="dialog"], dialog[open], [role="menu"]';

/** True while the member is busy: typing in a field, dragging, or with a pop-up, dialog or menu open. */
export function held(doc: DocLike, dragging: boolean): boolean {
  return dragging || isTyping(doc.activeElement as EventTarget | null) || doc.querySelector(HOLDING) !== null;
}
