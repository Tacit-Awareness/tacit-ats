// A banner's rules (components/banner.tsx), pure of React and of the browser
// so the tests can reach them: design/tats's `banner()`, after Fluid
// Functionalism's. Five statuses, each with its glyph; up to three actions,
// laid out primary, secondary, then ghost; a dismissed banner stays dismissed
// in this browser (`tats.banners`, a list of ids, as the prototype keeps it).

export const BANNER_STATUSES = ["default", "info", "success", "warning", "error"] as const;
export type BannerStatus = (typeof BANNER_STATUSES)[number];

export type BannerActionVariant = "primary" | "secondary" | "ghost";

/** The prototype's glyphs, a 16px box drawn in strokes. */
export const BANNER_ICONS: Record<BannerStatus, string> = {
  default: "M8 2.5A3.5 3.5 0 0 0 4.5 6v2.5L3 10.5h10l-1.5-2V6A3.5 3.5 0 0 0 8 2.5ZM6.5 12.5a1.5 1.5 0 0 0 3 0",
  info: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12ZM8 7.5V11M8 5h.01",
  success: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12ZM5.5 8l1.8 1.8L10.5 6.5",
  warning: "M8 2.5 14 13H2L8 2.5ZM8 6.5v3M8 11.2h.01",
  error: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12ZM6 6l4 4M10 6l-4 4",
};

/** A warning or an error interrupts a screen reader; the rest wait their turn. */
export const bannerRole = (status: BannerStatus): "alert" | "status" => (status === "error" || status === "warning" ? "alert" : "status");

const ORDER: Record<BannerActionVariant, number> = { primary: 0, secondary: 1, ghost: 2 };

/** The first three, primary first and ghost last; a missing variant is secondary. Stable within a variant. */
export function orderActions<T extends { variant?: BannerActionVariant }>(actions: readonly T[]): T[] {
  return actions.slice(0, 3).sort((a, b) => ORDER[a.variant ?? "secondary"] - ORDER[b.variant ?? "secondary"]);
}

/** The storage key, one list for the browser. Ids are page-made and never hold candidate text. */
export const DISMISSED_KEY = "tats.banners";
/** The most ids kept: the oldest go first, and a banner that comes back after that is shown again. */
export const DISMISSED_MAX = 50;

/** What storage held, as a list of ids; anything else is nothing dismissed. */
export function parseDismissed(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 200).slice(-DISMISSED_MAX);
}

/** The list with this id added last, once. */
export const addDismissed = (list: readonly string[], id: string): string[] => [...list.filter((x) => x !== id), id].slice(-DISMISSED_MAX);

/**
 * A short, stable tag for what a banner says, so a dismissed banner comes back
 * when what it is about changes (someone else goes away), not when the page
 * renders again. FNV-1a, in base 36.
 */
export function bannerTag(parts: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const ch of parts.join("\u0000")) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
