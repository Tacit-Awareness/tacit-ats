// The sidebar's width and whether it is collapsed to its icon rail
// (design/tats: drag the edge to resize, `[` to collapse). Kept in a cookie
// rather than localStorage, like the theme, so the server renders the right
// width on the first paint and the panel never jumps.
export const SIDEBAR_COOKIE = "tacit-sidebar";

export const SIDEBAR_DEFAULT = 272;
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 380;
/** Dragged narrower than this, the sidebar collapses instead. */
export const SIDEBAR_SNAP = 140;
export const SIDEBAR_RAIL = 60;

export type SidebarState = { width: number; collapsed: boolean };

export const clampSidebar = (w: number) => Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(w)));

/** "c:272" (collapsed) or "o:300" (open); anything else is the default. */
export function parseSidebar(value: string | undefined | null): SidebarState {
  const m = /^([co]):(\d{1,4})$/.exec(value ?? "");
  if (!m) return { width: SIDEBAR_DEFAULT, collapsed: false };
  return { width: clampSidebar(Number(m[2])), collapsed: m[1] === "c" };
}

export function formatSidebar({ width, collapsed }: SidebarState): string {
  return `${collapsed ? "c" : "o"}:${clampSidebar(width)}`;
}
