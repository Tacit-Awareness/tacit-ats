// design/tats's UI scale, for the signed-in shell: the layout is drawn for a
// ~1440 x 840 window, and a larger one zooms it by the smaller of the two ratios,
// up to 1.6. Sizes here are mostly px, so the zoom is CSS `zoom` on the body
// (globals.css, only while the shell is on the page) and not rem. Rects and
// pointer positions then come back in screen pixels, while the lengths written
// to `style` are multiplied by the zoom, so what turns one into the other goes
// through cssPx or cssRect. No global shim, unlike the prototype's.

export const UI_BASE = { width: 1440, height: 840 };
export const UI_MAX = 1.6;

/** The zoom for a window this size, in hundredths, so a pixel's resize doesn't redraw everything. */
export const fitScale = (width: number, height: number) => Math.round(Math.max(1, Math.min(UI_MAX, width / UI_BASE.width, height / UI_BASE.height)) * 100) / 100;

/** Run before paint, so the first frame is already the right size: fitScale, in a string. */
export const UI_SCALE_SCRIPT = `document.documentElement.style.setProperty("--ui-scale",String(Math.round(Math.max(1,Math.min(${UI_MAX},innerWidth/${UI_BASE.width},innerHeight/${UI_BASE.height}))*100)/100))`;

export function setUiScale() {
  document.documentElement.style.setProperty("--ui-scale", String(fitScale(innerWidth, innerHeight)));
}

export function uiScale(): number {
  if (typeof document === "undefined") return 1;
  return parseFloat(document.documentElement.style.getPropertyValue("--ui-scale")) || 1;
}

/** A screen length (a pointer position, a window size) in the page's own CSS pixels. */
export const cssPx = (n: number) => n / uiScale();

/** A rect from getBoundingClientRect in the page's own CSS pixels. */
export function cssRect(r: DOMRect): DOMRect {
  const z = uiScale();
  return z === 1 ? r : new DOMRect(r.x / z, r.y / z, r.width / z, r.height / z);
}
