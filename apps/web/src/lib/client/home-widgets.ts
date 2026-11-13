// Home's widgets (design/tats's WIDGETS): which blocks the Overview shows, in
// what order and how wide. The layout is the member's own and stays in this
// browser, in a cookie rather than the prototype's localStorage, like the
// sidebar, so the server draws it on the first paint and the page never jumps.
// Pure: app/client/home-board.tsx edits it, app/client/home-view.tsx draws
// what it names.

export const WIDGETS_COOKIE = "tacit-home-widgets";

/** 1 is a column of the grid, 2 two, 3 the whole width. */
export type WidgetSize = 1 | 2 | 3;

export const SIZE_NAMES: Record<WidgetSize, string> = { 1: "Small", 2: "Wide", 3: "Full" };

/** Every widget: its name and line in the gallery, and the sizes its size pill cycles, the first a new one's. */
export const WIDGETS = {
  apps: { name: "New applications", desc: "Applications coming in, against the period before", sizes: [1, 2] },
  active: { name: "Candidates in process", desc: "Everyone open, split by stage", sizes: [1, 2] },
  review: { name: "Waiting for review", desc: "How long new candidates wait for an answer", sizes: [1, 2] },
  sched: { name: "Waiting to be scheduled", desc: "How long since they moved to interviewing", sizes: [1, 2] },
  cards: { name: "Interviewer feedback on time", desc: "Interview ending to the interviewer's feedback", sizes: [1, 2] },
  load: { name: "Interview workload", desc: "Interviewer hours, held and booked", sizes: [1, 2] },
  trend: { name: "Applications over time", desc: "This period against the last, day by day", sizes: [2, 3] },
  hires: { name: "Hires", desc: "Hired, week by week, last 12 weeks", sizes: [1, 2] },
  sources: { name: "Where applicants come from", desc: "Careers page, Tacit, referrals and the rest", sizes: [1, 2] },
  offers: { name: "Offers awaiting approval", desc: "Offers waiting on your sign-off", sizes: [1, 2] },
  bottlenecks: { name: "Bottlenecks", desc: "What's waiting longest, and where to clear it", sizes: [1, 2] },
  stages: { name: "Time in stage", desc: "Each stage of your process: how many, how long", sizes: [2, 3] },
  stays: { name: "Average stay in each stage", desc: "How long candidates spent in each stage", sizes: [1, 2] },
  byiv: { name: "Time to feedback, by interviewer", desc: "Typical time from interview to feedback", sizes: [1, 2] },
  eff: { name: "Interview efficiency", desc: "Pass-through by round, and interviews per hire", sizes: [1, 2] },
  outfb: { name: "Outstanding feedback", desc: "Interviews whose feedback hasn't come in", sizes: [1, 2] },
} as const satisfies Record<string, { name: string; desc: string; sizes: readonly WidgetSize[] }>;

export type WidgetKey = keyof typeof WIDGETS;
export type Placed = { k: WidgetKey; w: WidgetSize };

export const WIDGET_KEYS = Object.keys(WIDGETS) as WidgetKey[];

const isKey = (k: string): k is WidgetKey => Object.hasOwn(WIDGETS, k);
const sizesOf = (k: WidgetKey): readonly WidgetSize[] => WIDGETS[k].sizes;

/**
 * The Overview a member starts with (no cookie), and goes back to with Reset: it
 * fills one screen, so it can go on a projector as it is, and says each thing
 * once, in the funnel's order. Applications over time has the whole top row and
 * carries New applications' target; New applications, which showed the same
 * number and change, waits in the gallery.
 */
export const defaultWidgets = (): Placed[] => [
  { k: "trend", w: 3 },
  { k: "active", w: 1 },
  { k: "review", w: 1 },
  { k: "sched", w: 1 },
  { k: "cards", w: 1 },
  { k: "load", w: 1 },
  { k: "hires", w: 1 },
];

/** A layout with nothing on it, which is a choice and not a missing cookie. */
const NONE = "none";

/** "apps.1,trend.2", or "none". */
export const formatWidgets = (layout: Placed[]): string => (layout.length ? layout.map((x) => `${x.k}.${x.w}`).join(",") : NONE);

/** No cookie is the default. Anything it should not hold is dropped: a widget since removed, a repeat, a size that one doesn't take. */
export function parseWidgets(value: string | undefined | null): Placed[] {
  if (!value) return defaultWidgets();
  if (value === NONE) return [];
  const out: Placed[] = [];
  for (const part of value.split(",")) {
    const [k, w] = part.split(".");
    if (!isKey(k) || out.some((x) => x.k === k)) continue;
    const size = Number(w) as WidgetSize;
    out.push({ k, w: sizesOf(k).includes(size) ? size : sizesOf(k)[0] });
  }
  return out;
}

/** Added at the end at its first size; one already placed stays where it is. */
export const addWidget = (layout: Placed[], k: WidgetKey): Placed[] => (layout.some((x) => x.k === k) ? layout : [...layout, { k, w: sizesOf(k)[0] }]);

export const removeWidget = (layout: Placed[], k: WidgetKey): Placed[] => layout.filter((x) => x.k !== k);

/** The next size its pill offers, round to the first. */
export function cycleSize(layout: Placed[], k: WidgetKey): Placed[] {
  return layout.map((x) => {
    if (x.k !== k) return x;
    const sizes = sizesOf(k);
    return { ...x, w: sizes[(sizes.indexOf(x.w) + 1) % sizes.length] };
  });
}

/**
 * Moves one widget onto another's place: going forward it lands after it,
 * going back before it, as the prototype's drag, so passing over a widget
 * always swaps them. The layout may hold widgets this member isn't shown, and
 * those stay among the rest.
 */
export function moveWidget(layout: Placed[], k: WidgetKey, over: WidgetKey): Placed[] {
  const from = layout.findIndex((x) => x.k === k);
  const to = layout.findIndex((x) => x.k === over);
  if (from < 0 || to < 0 || from === to) return layout;
  const next = layout.filter((x) => x.k !== k);
  next.splice(next.findIndex((x) => x.k === over) + (from < to ? 1 : 0), 0, layout[from]);
  return next;
}
