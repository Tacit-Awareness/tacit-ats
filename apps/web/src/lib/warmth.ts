// design/tats's warmth correction (its `WB`): undo Night Shift / True Tone by
// eye. macOS warms a display after the page has drawn, and no web API reports
// it, so each display is corrected once in the account menu and the shell
// reapplies it by itself: the level is remembered per display (size, pixel
// density, colour range) and per day or night, and read again when the window
// moves to another screen or the evening starts. A level pulls red and some
// green down so whites come back to neutral; blue can't go above full, so it
// cools by trimming the others. Off draws no filter at all. Only this browser
// remembers it (localStorage, `components/app-shell/warmth.tsx`); nothing is
// on the server. Pure of React and of `window`, so the tests drive it.

export const WARMTH_STORAGE_KEY = "tats.warmth.v1";

/** Red and green gains per level; 0 is Off. */
export const WARMTH_LEVELS: readonly (readonly [number, number])[] = [
  [1, 1],
  [0.965, 0.985],
  [0.93, 0.97],
  [0.89, 0.95],
  [0.85, 0.93],
];
export const MAX_WARMTH = WARMTH_LEVELS.length - 1;

/** The SVG filter's id, which globals.css's `html.warmth-on` names. */
export const WARMTH_FILTER_ID = "tats-warmth";

/** Level per `warmthKey`; a display with no level is Off and is not stored. */
export type WarmthLevels = Record<string, number>;

/** 7pm to 7am, when Night Shift is usually on. */
export const isNight = (at: Date) => {
  const h = at.getHours();
  return h >= 19 || h < 7;
};

export type DisplayFacts = { width: number; height: number; dpr: number; p3: boolean };

/** One display, as far as a page can tell them apart: `1512x982@2p3`. */
export const displayId = (d: DisplayFacts) => `${d.width}x${d.height}@${d.dpr}${d.p3 ? "p3" : ""}`;

/** Where a level is kept: this display, by day or by night. */
export const warmthKey = (display: string, night: boolean) => `${display}|${night ? "night" : "day"}`;

export const isWarmthLevel = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_WARMTH;

/** What storage held, keeping only real levels: anything else reads as nothing remembered. */
export function parseWarmth(raw: unknown): WarmthLevels {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: WarmthLevels = {};
  for (const [k, v] of Object.entries(raw)) if (k.includes("|") && isWarmthLevel(v)) out[k] = v;
  return out;
}

export const levelAt = (levels: WarmthLevels, key: string) => (isWarmthLevel(levels[key]) ? levels[key] : 0);

/** The levels with this key set; Off removes it rather than storing a 0. */
export function withLevel(levels: WarmthLevels, key: string, level: number): WarmthLevels {
  const next = { ...levels };
  if (isWarmthLevel(level)) next[key] = level;
  else delete next[key];
  return next;
}

/** feColorMatrix's values for a level, or null for Off, which draws no filter. */
export function warmthMatrix(level: number): string | null {
  if (!isWarmthLevel(level)) return null;
  const [r, g] = WARMTH_LEVELS[level];
  return `${r} 0 0 0 0  0 ${g} 0 0 0  0 0 1 0 0  0 0 0 1 0`;
}

/** The account menu's hover text for the control. */
export const warmthHint = (night: boolean) => `Cancels Night Shift and True Tone on this display ${night ? "at night" : "by day"}; remembered per screen`;
