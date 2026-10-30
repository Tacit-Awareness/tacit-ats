import { SOURCE_GROUPS, sourceGroup, type SourceGroup } from "./client/analytics-metrics";
import { PIPELINE_COLUMNS, isColumnKey, type ColumnKey } from "./client/pipeline-columns";

// design/tats's saved views: Pipeline filters with a name, pinned to the
// sidebar, kept in this browser (components/app-shell/shell-memory.tsx). The
// pure half. A view is only a set of filters, and its link spells them out in
// the URL (`?stage=&source=&tag=&department=&view=`): the server applies the
// URL and never needs the browser's copy, so a link works with storage blocked
// and for a teammate, and `view` only names it in the crumb.
//
// The prototype's filters, where the data has them: department (its team),
// stage (the board's columns; its Closed is left out, the board has none),
// source (Analytics' channels) and label (the org's tags). Its "Strong
// Testbench" view and `minTb` are not here: no score is recorded on a person.

export const VIEW_NAME_MAX = 60;
/** Views you can make: a sidebar, not a report. */
export const VIEWS_MAX = 50;
const DESC_MAX = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A view made here: `v` and the time, as the prototype. Nothing stored can take a built-in's id. */
const CUSTOM_ID = /^v\d{1,20}$/;

export type ViewFilters = { department: string | null; stage: ColumnKey | null; source: SourceGroup | null; tag: string | null };
export type SavedView = ViewFilters & { id: string; name: string; desc: string };
export type ViewsState = { pins: string[]; custom: SavedView[] };

export const NO_VIEWS: ViewsState = { pins: [], custom: [] };

export const BUILT_IN_VIEWS: readonly SavedView[] = [
  { id: "referrals", name: "Referrals", department: null, stage: null, source: "referral", tag: null, desc: "Referred by someone" },
];

const isSource = (v: unknown): v is SourceGroup => SOURCE_GROUPS.some((s) => s.key === v);
/** Lower case, as the database's own: a filter compares it with the ids a read gives back. */
const uuidOf = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null);

/** The view's filters out of the URL; anything we did not write is no filter, as `?department=` already is. */
export function parseViewFilters(raw: { department?: string; stage?: string; source?: string; tag?: string }): ViewFilters {
  return {
    department: uuidOf(raw.department),
    stage: isColumnKey(raw.stage) ? raw.stage : null,
    source: isSource(raw.source) ? raw.source : null,
    tag: uuidOf(raw.tag),
  };
}

/** `?view=`, only ever a name for the crumb: a built-in's id or one made here. */
export const parseViewId = (raw: string | undefined): string | null =>
  raw && (CUSTOM_ID.test(raw) || BUILT_IN_VIEWS.some((v) => v.id === raw)) ? raw : null;

export const hasFilters = (f: ViewFilters) => !!(f.department || f.stage || f.source || f.tag);

export function viewHref(v: ViewFilters & { id: string }): string {
  const params = new URLSearchParams();
  if (v.department) params.set("department", v.department);
  if (v.stage) params.set("stage", v.stage);
  if (v.source) params.set("source", v.source);
  if (v.tag) params.set("tag", v.tag);
  params.set("view", v.id);
  return `/client/pipeline?${params.toString()}`;
}

/** What the filters say, for the row's tooltip and a crumb with no name: "Referred · Interview booked". */
export function describeFilters(f: ViewFilters, names: { department?: string | null; tag?: string | null }): string {
  const parts = [
    f.department ? names.department : null,
    PIPELINE_COLUMNS.find((c) => c.key === f.stage)?.label,
    SOURCE_GROUPS.find((s) => s.key === f.source)?.label,
    f.tag ? names.tag : null,
  ];
  return parts.filter(Boolean).join(" · ") || "All applicants";
}

/** What a view can filter on, of one board entry: no name in it, so the Views page can send these to the browser. */
export type ViewRow = { roleId: string; column: ColumnKey; source: SourceGroup; tagIds: string[] };
export const rowSource = (e: { source: string; sourceDetail: string | null }) => sourceGroup(e.source, e.sourceDetail);

/**
 * Whether a view keeps a row. `departmentRoles` is the jobs of the department,
 * null when the view names none or one no longer on offer, which then narrows
 * nothing, as `?department=` does on the board.
 */
export function viewKeeps(f: ViewFilters, row: ViewRow, departmentRoles: ReadonlySet<string> | null): boolean {
  return (
    (!departmentRoles || departmentRoles.has(row.roleId)) &&
    (!f.stage || row.column === f.stage) &&
    (!f.source || row.source === f.source) &&
    (!f.tag || row.tagIds.includes(f.tag))
  );
}

function parseView(raw: unknown): SavedView | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== "string" || !CUSTOM_ID.test(v.id) || typeof v.name !== "string") return null;
  const name = v.name.trim();
  if (!name || name.length > VIEW_NAME_MAX) return null;
  return {
    id: v.id,
    name,
    desc: typeof v.desc === "string" ? v.desc.slice(0, DESC_MAX) : "",
    department: uuidOf(v.department),
    stage: isColumnKey(v.stage) ? v.stage : null,
    source: isSource(v.source) ? v.source : null,
    tag: uuidOf(v.tag),
  };
}

/** What storage held, whatever it holds: a bad entry is dropped, never a crash in the sidebar. */
export function parseViews(raw: unknown): ViewsState {
  if (typeof raw !== "object" || raw === null) return NO_VIEWS;
  const r = raw as { pins?: unknown; custom?: unknown };
  const custom = new Map<string, SavedView>();
  for (const item of Array.isArray(r.custom) ? r.custom : []) {
    const v = parseView(item);
    if (v && !custom.has(v.id) && custom.size < VIEWS_MAX) custom.set(v.id, v);
  }
  const known = new Set([...BUILT_IN_VIEWS.map((v) => v.id), ...custom.keys()]);
  const pins = (Array.isArray(r.pins) ? r.pins : []).filter((p): p is string => typeof p === "string" && known.has(p));
  return { pins: [...new Set(pins)], custom: [...custom.values()] };
}

export const allViews = (s: ViewsState): SavedView[] => [...BUILT_IN_VIEWS, ...s.custom];
export const viewById = (s: ViewsState, id: string | null | undefined) => allViews(s).find((v) => v.id === id) ?? null;
export const pinnedViews = (s: ViewsState): SavedView[] => s.pins.flatMap((id) => viewById(s, id) ?? []);

export const togglePin = (s: ViewsState, id: string): ViewsState => ({
  ...s,
  pins: s.pins.includes(id) ? s.pins.filter((p) => p !== id) : [...s.pins, id],
});

export const removeView = (s: ViewsState, id: string): ViewsState => ({
  pins: s.pins.filter((p) => p !== id),
  custom: s.custom.filter((v) => v.id !== id),
});

/** A free id from the clock: `v` and the time, one up when two land in the same millisecond. */
export function newViewId(s: ViewsState, now: number): string {
  let t = now;
  while (s.custom.some((v) => v.id === `v${t}`)) t += 1;
  return `v${t}`;
}

/** The state with a new view, or null when the name is empty or too long, or there are too many. */
export function addView(s: ViewsState, input: ViewFilters & { id: string; name: string; desc: string; pin: boolean }): ViewsState | null {
  const name = input.name.trim();
  if (!name || name.length > VIEW_NAME_MAX || s.custom.length >= VIEWS_MAX) return null;
  const { pin, ...view } = input;
  return { pins: pin ? [...s.pins, view.id] : s.pins, custom: [...s.custom, { ...view, name }] };
}
