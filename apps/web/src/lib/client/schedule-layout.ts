// The Calendar's arithmetic, pure: which days a view shows, the window of
// interviews the server reads for it, and where each interview sits in a day
// column. Every clock time is laid out in an IANA time zone passed in (the
// browser's, read in the page's client component), never the server's, so a
// 9:00 interview in New York sits at 9:00 for a member in New York whether
// the server runs in UTC or not.
//
// Days are calendar dates, "YYYY-MM-DD", with no zone of their own: the URL's
// `?date=` is one, and the arithmetic on them runs in UTC where no day is ever
// 23 or 25 hours long.

export const SCHEDULE_VIEWS = ["day", "week", "month", "list"] as const;
export type ScheduleView = (typeof SCHEDULE_VIEWS)[number];
export const isScheduleView = (v: string): v is ScheduleView => (SCHEDULE_VIEWS as readonly string[]).includes(v);

/** A calendar date, "YYYY-MM-DD". */
export type Ymd = string;

const DAY_MS = 86_400_000;
const MINUTES_IN_DAY = 24 * 60;

const toUtc = (ymd: Ymd) => Date.parse(`${ymd}T00:00:00Z`);
const fromUtc = (ms: number): Ymd => new Date(ms).toISOString().slice(0, 10);

// Near enough that the arithmetic stays in four-digit years: `?date=9999-12-31`
// walks past what "YYYY-MM-DD" can hold, and the read window with it.
const YEARS = { first: 1900, last: 2200 } as const;

/** The `?date=` value when it is a real date in a sane year, else null. */
export function parseYmd(raw: string | null | undefined): Ymd | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const year = Number(raw.slice(0, 4));
  if (year < YEARS.first || year > YEARS.last) return null;
  const ms = toUtc(raw);
  return Number.isNaN(ms) || fromUtc(ms) !== raw ? null : raw;
}

export const addDays = (ymd: Ymd, n: number): Ymd => fromUtc(toUtc(ymd) + n * DAY_MS);
/** 0 is Sunday. */
export const weekdayOf = (ymd: Ymd) => new Date(toUtc(ymd)).getUTCDay();
/** Weeks start on Sunday, as design/tats's calendar. */
export const weekStart = (ymd: Ymd): Ymd => addDays(ymd, -weekdayOf(ymd));

function addMonths(ymd: Ymd, n: number): Ymd {
  const d = new Date(toUtc(ymd));
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d.getUTCDate(), last));
  return fromUtc(first.getTime());
}

/** Six weeks, as design/tats's month: the grid keeps its height from one month to the next. */
const MONTH_GRID_DAYS = 42;

/**
 * The days a view shows around `anchor`: the day, its week, the month's six
 * weeks from the Sunday on or before the 1st, or (the list) the month alone.
 */
export function daysOf(view: ScheduleView, anchor: Ymd): Ymd[] {
  if (view === "day") return [anchor];
  if (view === "week") return Array.from({ length: 7 }, (_, i) => addDays(weekStart(anchor), i));
  const first = `${anchor.slice(0, 8)}01`;
  if (view === "month") return Array.from({ length: MONTH_GRID_DAYS }, (_, i) => addDays(weekStart(first), i));
  const next = addMonths(first, 1);
  return Array.from({ length: (toUtc(next) - toUtc(first)) / DAY_MS }, (_, i) => addDays(first, i));
}

/** The anchor ← or → moves to: a day, a week, or a month. */
export function stepAnchor(view: ScheduleView, anchor: Ymd, dir: -1 | 1): Ymd {
  if (view === "day") return addDays(anchor, dir);
  if (view === "week") return addDays(anchor, 7 * dir);
  return addMonths(anchor, dir);
}

// Every zone in use is between UTC-12 and UTC+14: a date's local midnight
// falls between 14 hours before and 12 hours after its UTC midnight.
const EARLIEST_OFFSET_MS = 14 * 3_600_000;
const LATEST_OFFSET_MS = 12 * 3_600_000;

/**
 * The interviews the server reads for a view, as a UTC window wide enough for
 * any zone, so the server never needs the member's. With no `?date=` the
 * member's today is the server's UTC date give or take one, so the window
 * covers the view around each of the three.
 */
export function readWindow(view: ScheduleView, anchor: Ymd | null, now: Date): { from: string; to: string } {
  const today = fromUtc(now.getTime());
  const anchors = anchor ? [anchor] : [addDays(today, -1), today, addDays(today, 1)];
  const days = anchors.flatMap((a) => daysOf(view, a)).sort();
  return {
    from: new Date(toUtc(days[0]!) - EARLIEST_OFFSET_MS).toISOString(),
    to: new Date(toUtc(addDays(days[days.length - 1]!, 1)) + LATEST_OFFSET_MS).toISOString(),
  };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, f);
  }
  return f;
}

/** An instant as the member's wall clock: the date, and minutes since that date's midnight. */
export function zoned(iso: string | number, timeZone: string): { day: Ymd; minutes: number } {
  const parts = Object.fromEntries(partsFormatter(timeZone).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export const todayIn = (timeZone: string, now: number): Ymd => zoned(now, timeZone).day;

/**
 * The instant a wall-clock time names in `timeZone`, as UTC ISO: `minutes`
 * after that date's midnight, which may run past it into the next day. Across
 * a daylight-saving change, a time the clocks skip lands an hour on, and one
 * they pass twice is the earlier.
 */
export function zonedInstant(day: Ymd, minutes: number, timeZone: string): string {
  const wall = toUtc(day) + minutes * 60_000;
  const wallAt = (ms: number) => {
    const z = zoned(ms, timeZone);
    return toUtc(z.day) + z.minutes * 60_000;
  };
  // The offsets in force a day either side: the same one, or both sides of a change.
  const before = wallAt(wall - DAY_MS) - (wall - DAY_MS);
  const after = wallAt(wall + DAY_MS) - (wall + DAY_MS);
  const real = [wall - before, wall - after].filter((t) => wallAt(t) === wall);
  return new Date(real.length ? Math.min(...real) : wall - before).toISOString();
}

/**
 * The instants a date field, a time and a length stand for, or null when the
 * date is not one yet: a date field gives a value for every digit of the year,
 * and past four digits it is one `Date` cannot read, so this runs in a render.
 */
export function spanAt(day: string, minutes: number, length: number, timeZone: string): { startsAt: string; endsAt: string } | null {
  const real = parseYmd(day);
  if (!real) return null;
  const startsAt = zonedInstant(real, minutes, timeZone);
  return { startsAt, endsAt: new Date(Date.parse(startsAt) + length * 60_000).toISOString() };
}

/** What a drag on the grid snaps to, as in design/tats. */
export const SNAP_MINUTES = 15;

/** The minutes after midnight a pointer `offsetPx` down a day's grid stands for, snapped and kept on the grid. */
export function minutesAt(offsetPx: number, hourPx: number, span: { first: number; last: number }): number {
  const raw = span.first * 60 + (offsetPx / hourPx) * 60;
  const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.max(span.first * 60, Math.min(span.last * 60 - SNAP_MINUTES, snapped));
}

export type Timed = { startsAt: string; endsAt: string };

export type Placed<T> = {
  event: T;
  /** Minutes after the day's midnight, clipped to the day. */
  start: number;
  end: number;
  /** Side by side with the interviews it overlaps: its lane, of `lanes`. */
  lane: number;
  lanes: number;
  /** It began the day before, or runs on into the next. */
  startsBefore: boolean;
  endsAfter: boolean;
};

/** Below this a block is still drawn, and counted as overlapping, this long. */
export const MIN_BLOCK_MINUTES = 15;

/**
 * The interviews on one day of the member's calendar, each with its place:
 * clipped to the day when it crosses midnight, and in side-by-side lanes
 * where it overlaps others. Lanes are counted per cluster of overlapping
 * interviews, so one clash does not narrow every block of the day.
 */
export function placeDay<T extends Timed>(events: readonly T[], day: Ymd, timeZone: string): Placed<T>[] {
  const onDay: Placed<T>[] = [];
  for (const event of events) {
    const s = zoned(event.startsAt, timeZone);
    const e = zoned(event.endsAt, timeZone);
    if (s.day > day || e.day < day) continue;
    const startsBefore = s.day < day;
    const endsAfter = e.day > day;
    const start = startsBefore ? 0 : s.minutes;
    const end = endsAfter ? MINUTES_IN_DAY : Math.max(e.minutes, start);
    // Ending at this day's midnight is not being on it.
    if (startsBefore && end === 0) continue;
    onDay.push({ event, start, end, lane: 0, lanes: 1, startsBefore, endsAfter });
  }
  onDay.sort((a, b) => a.start - b.start || b.end - a.end);

  const reach = (p: Placed<T>) => Math.max(p.end, p.start + MIN_BLOCK_MINUTES);
  let cluster: Placed<T>[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const close = () => {
    for (const p of cluster) p.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const p of onDay) {
    if (p.start >= clusterEnd) close();
    let lane = laneEnds.findIndex((t) => t <= p.start);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = reach(p);
    p.lane = lane;
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, reach(p));
  }
  close();
  return onDay;
}

export const DEFAULT_HOURS = { first: 8, last: 19 } as const;

/** The hours a day or week grid shows: the working day, widened to fit every interview placed. */
export function hourSpan(placed: readonly { start: number; end: number }[]): { first: number; last: number } {
  let first: number = DEFAULT_HOURS.first;
  let last: number = DEFAULT_HOURS.last;
  for (const p of placed) {
    first = Math.min(first, Math.floor(p.start / 60));
    last = Math.max(last, Math.ceil(Math.max(p.end, p.start + MIN_BLOCK_MINUTES) / 60));
  }
  return { first, last: Math.min(24, last) };
}

/** The list and the month: interviews starting on the view's days, by day, each day in time order. */
export function groupByDay<T extends Timed>(events: readonly T[], days: readonly Ymd[], timeZone: string): { day: Ymd; events: T[] }[] {
  const wanted = new Set(days);
  const by = new Map<Ymd, T[]>();
  for (const e of [...events].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))) {
    const day = zoned(e.startsAt, timeZone).day;
    if (wanted.has(day)) by.set(day, [...(by.get(day) ?? []), e]);
  }
  return days.filter((d) => by.has(d)).map((day) => ({ day, events: by.get(day)! }));
}

/** Interviews a month cell lists before it says "N more", as design/tats. */
export const MONTH_CELL_EVENTS = 3;

export type MonthCell<T> = {
  day: Ymd;
  /** In the anchor's month, not the weeks either side that fill the grid. */
  inMonth: boolean;
  /** The interviews starting that day, soonest first. */
  events: T[];
  /** The ones the cell has room for. */
  listed: T[];
  /** How many it leaves off, for the day view to show. */
  more: number;
};

/** The month grid: all its days, each with the interviews starting on it in the member's zone. */
export function monthCells<T extends Timed>(events: readonly T[], anchor: Ymd, timeZone: string): MonthCell<T>[] {
  const days = daysOf("month", anchor);
  const month = anchor.slice(0, 7);
  const byDay = new Map(groupByDay(events, days, timeZone).map((g) => [g.day, g.events]));
  return days.map((day) => {
    const onDay = byDay.get(day) ?? [];
    return { day, inMonth: day.slice(0, 7) === month, events: onDay, listed: onDay.slice(0, MONTH_CELL_EVENTS), more: Math.max(0, onDay.length - MONTH_CELL_EVENTS) };
  });
}

/** A place on the Calendar. A null `date` is the browser's today. */
export type ScheduleLink = { view: ScheduleView; date: Ymd | null; dept: string | null; q?: string | null };

export function scheduleHref({ view, date, dept, q }: ScheduleLink): string {
  const parts = [`view=${view}`];
  if (date) parts.push(`date=${date}`);
  if (dept) parts.push(`dept=${encodeURIComponent(dept)}`);
  if (q) parts.push(`q=${encodeURIComponent(q)}`);
  return `/client/schedule?${parts.join("&")}`;
}

/** The Calendar's keys that go somewhere, as `useKeys` names them. */
export const SCHEDULE_KEYS = ["d", "w", "m", "l", "ArrowLeft", "ArrowRight", "."] as const;
const VIEW_OF_KEY: Record<string, ScheduleView> = { d: "day", w: "week", m: "month", l: "list" };

/**
 * Where a key goes from where the member is, or null when it does nothing
 * there. `anchor` is the `?date=`, `shown` that or the browser's today. A view
 * key and `.` leave a search; the arrows have no dates to step through in one.
 */
export function scheduleKeyHref(key: string, at: { view: ScheduleView; anchor: Ymd | null; shown: Ymd; dept: string | null; q: string | null }): string | null {
  const { view, anchor, shown, dept, q } = at;
  const to = VIEW_OF_KEY[key];
  if (to) return scheduleHref({ view: to, date: anchor, dept });
  if (key === ".") return scheduleHref({ view, date: null, dept });
  if (q) return null;
  if (key === "ArrowLeft") return scheduleHref({ view, date: stepAnchor(view, shown, -1), dept });
  if (key === "ArrowRight") return scheduleHref({ view, date: stepAnchor(view, shown, 1), dept });
  return null;
}

// design/tats's event tones (`--ev-*` in globals.css). Grey is for a job in no department.
export const DEPARTMENT_TONES = ["blue", "mint", "pink", "peach", "lav"] as const;
export type EventTone = (typeof DEPARTMENT_TONES)[number] | "gray";

type DepartmentRow = { departmentId: string; name: string; parentId: string | null };

/**
 * Each department's tone and the name it is shown under: the outermost
 * department it sits in (Engineering for Engineering > Platform), the
 * outermost ones taking the tones in name order.
 */
export function departmentTones(rows: readonly DepartmentRow[]): Map<string, { tone: EventTone; name: string }> {
  const byId = new Map(rows.map((r) => [r.departmentId, r]));
  const rootOf = (r: DepartmentRow) => {
    const seen = new Set([r.departmentId]);
    let at = r;
    for (let p = at.parentId; p && !seen.has(p) && byId.has(p); p = at.parentId) {
      seen.add(p);
      at = byId.get(p)!;
    }
    return at;
  };
  const roots = [...new Set(rows.map(rootOf))].sort((a, b) => a.name.localeCompare(b.name) || a.departmentId.localeCompare(b.departmentId));
  const toneOfRoot = new Map(roots.map((r, i) => [r.departmentId, DEPARTMENT_TONES[i % DEPARTMENT_TONES.length]!]));
  return new Map(rows.map((r) => {
    const root = rootOf(r);
    return [r.departmentId, { tone: toneOfRoot.get(root.departmentId)!, name: root.name }];
  }));
}

/**
 * A job's tone: its department's, grey for none. A department the member may
 * not read (an interviewer reads no department names) still gets a steady
 * tone from its id.
 */
export function toneFor(departmentId: string | null, tones: ReadonlyMap<string, { tone: EventTone }>): EventTone {
  if (!departmentId) return "gray";
  const known = tones.get(departmentId);
  if (known) return known.tone;
  let h = 0;
  for (const ch of departmentId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return DEPARTMENT_TONES[h % DEPARTMENT_TONES.length]!;
}
