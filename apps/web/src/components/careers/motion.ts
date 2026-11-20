"use client";

// The careers pages' motion (design/careers' GSAP timelines, redrawn on the Web
// Animations API so the pages carry no animation library): the row that opens
// into a role's sheet, the way back, the tabs' swap and the folders' fold. The
// eases are GSAP's, as cubic-beziers. Nothing here is needed to use the pages:
// with reduced motion, or no script, every step happens at once.

export const EASE = {
  /** power3.out */
  out: "cubic-bezier(0.215, 0.61, 0.355, 1)",
  /** power2.in */
  in: "cubic-bezier(0.55, 0.085, 0.68, 0.53)",
  /** power3.inOut */
  inOut: "cubic-bezier(0.645, 0.045, 0.355, 1)",
  /** expo.inOut, the row's flight into the sheet */
  expo: "cubic-bezier(0.87, 0, 0.13, 1)",
  /** back.out(2), a small overshoot */
  back: "cubic-bezier(0.34, 1.8, 0.64, 1)",
} as const;

export function still(): boolean {
  return typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A click the page may take over: the main button, no modifier (a new tab or window stays the browser's). */
export function plainClick(e: React.MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
}

/** Fade elements up into place, one after another (the prototype's `fromTo(parts, {opacity: 0, y}, ...)`). */
export function riseIn(els: Iterable<Element>, { y = 10, duration = 500, stagger = 60, delay = 0 } = {}): Animation[] {
  if (still()) return [];
  return [...els].map((el, i) =>
    el.animate([{ opacity: 0, transform: `translateY(${y}px)` }, { opacity: 1, transform: "none" }], {
      duration,
      delay: delay + i * stagger,
      easing: EASE.out,
      fill: "backwards",
    }),
  );
}

/** Fade an element out and slightly along, then resolve; it stays hidden until the page that replaces it draws. */
export async function fadeOut(el: Element | null, { y = 6, duration = 200 } = {}): Promise<void> {
  if (!el || still()) return;
  await el
    .animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateY(${y}px)` }], { duration, easing: EASE.in, fill: "forwards" })
    .finished.catch(() => undefined);
}

// ---- the row that becomes the sheet ----------------------------------------
// First: a white sheet sits exactly on the clicked row. Last: it fills where
// the role's sheet will be. It flies while the list fades and the role's page
// loads under it; the page then claims it (claimGhost), settles it on the real
// sheet and fades it away as the sheet's parts rise in.

type Ghost = { el: HTMLElement; flight: Animation; slug: string };
let ghost: Ghost | null = null;

/** Where the role's sheet lands: careers.css's `.wrap.role` and `.sheet`, under the 72px top bar. */
function sheetRect(): { left: number; top: number; width: number; height: number } {
  const w = window.innerWidth;
  if (w <= 600) return { left: 12, top: 84, width: w - 24, height: window.innerHeight - 76 };
  const gutter = 20;
  const width = Math.min(1100, w - 2 * gutter);
  return { left: (w - width) / 2, top: 100, width, height: window.innerHeight - 92 };
}

function dropGhost() {
  if (!ghost) return;
  ghost.el.remove();
  ghost = null;
}

/** Start the flight from a role's row. Returns false when the page should just follow the link. */
export function flyRow(row: HTMLElement, slug: string, title: string): boolean {
  if (still() || typeof document.body.animate !== "function") return false;
  dropGhost();
  const r = row.getBoundingClientRect();
  const to = sheetRect();
  const el = document.createElement("div");
  el.className = "careers-ghost";
  el.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "careers-ghost-title";
  label.textContent = title;
  el.append(label);
  Object.assign(el.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
  document.body.append(el);
  // The ghost is drawn at the end and flown from the row, so the flight is one transform and one size change.
  const flight = el.animate(
    [
      { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: "6px" },
      { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, borderRadius: "10px" },
    ],
    { duration: 700, delay: 40, easing: EASE.expo, fill: "both" },
  );
  label.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: 100, fill: "forwards" });
  ghost = { el, flight, slug };
  // A page that never comes (an error, Back pressed mid-flight) must not leave a sheet over everything.
  window.setTimeout(() => {
    if (ghost?.el === el) dropGhost();
  }, 6000);
  return true;
}

/**
 * The role's page draws: if a flight is landing on it, hide the sheet's parts
 * until it lands, settle the ghost on the real sheet, then fade the ghost out
 * as the parts rise in. Returns whether there was one.
 */
export async function claimGhost(sheet: HTMLElement, slug: string): Promise<boolean> {
  const g = ghost;
  if (!g || g.slug !== slug) {
    dropGhost();
    return false;
  }
  // The whole sheet waits under the flight, so only one white sheet is ever seen.
  const parts = [...sheet.children] as HTMLElement[];
  sheet.style.opacity = "0";
  await g.flight.finished.catch(() => undefined);
  const real = sheet.getBoundingClientRect();
  const now = g.el.getBoundingClientRect();
  if (Math.abs(real.top - now.top) + Math.abs(real.left - now.left) + Math.abs(real.width - now.width) > 2) {
    await g.el
      .animate(
        [
          { left: `${now.left}px`, top: `${now.top}px`, width: `${now.width}px`, height: `${now.height}px` },
          { left: `${real.left}px`, top: `${real.top}px`, width: `${real.width}px`, height: `${Math.min(real.height, window.innerHeight - real.top + 8)}px` },
        ],
        { duration: 260, easing: EASE.out, fill: "forwards" },
      )
      .finished.catch(() => undefined);
  }
  sheet.style.opacity = "";
  riseIn(parts, { delay: 80 });
  g.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, easing: "ease-out", fill: "forwards" }).finished.then(
    () => {
      if (ghost === g) dropGhost();
    },
    () => undefined,
  );
  return true;
}

// ---- the way back -----------------------------------------------------------
// The sheet fades down and away; the board, when it draws, fades in from just above.

let returning = false;

export async function leaveRole(main: Element | null): Promise<void> {
  returning = true;
  await fadeOut(main, { y: 6, duration: 220 });
}

/** On the board: fade in if the reader came back from a role. */
export function arriveBoard(board: Element | null): void {
  if (!returning || !board) return;
  returning = false;
  const main = board.closest("main");
  for (const a of main?.getAnimations() ?? []) a.cancel();
  if (still()) return;
  board.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 400, easing: EASE.out, fill: "backwards" });
}

// ---- the tabs ---------------------------------------------------------------
// The panel (and the side column) fade up and out, the page swaps them, and
// the new ones rise in. The underline slides from where it was.

let lastTab: { slug: string; left: number; width: number } | null = null;

export function rememberTab(slug: string, el: HTMLElement | null) {
  if (el) lastTab = { slug, left: el.offsetLeft, width: el.offsetWidth };
}

export function tabFrom(slug: string): { left: number; width: number } | null {
  const from = lastTab && lastTab.slug === slug ? lastTab : null;
  lastTab = null;
  return from;
}
