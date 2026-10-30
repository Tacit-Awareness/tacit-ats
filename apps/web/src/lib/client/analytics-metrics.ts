import type { Channel } from "../public/channel";
import { PIPELINE_COLUMNS, type ColumnKey } from "./pipeline-columns";

// Analytics' arithmetic (design/tats's #analytics): the careers page's views
// and applications per UTC day against the period before, where they came
// from, and the Pipeline explorer's measure × slice × segment. Pure:
// lib/client/analytics.ts reads, this counts, the page draws.
//
// Days are UTC calendar days: an org has no time zone yet (the Interviewers
// page counts weeks the same way), job_post_views is by UTC day, and a chart
// needs dated points.

const DAY = 86_400_000;

export const RANGES = {
  week: { days: 7, label: "Week", long: "Last 7 days" },
  month: { days: 30, label: "Month", long: "Last 30 days" },
  quarter: { days: 90, label: "Quarter", long: "Last 90 days" },
} as const;
export type RangeKey = keyof typeof RANGES;
export const RANGE_KEYS = Object.keys(RANGES) as RangeKey[];

/** `?range=` as one of the ranges; anything else is a month, the prototype's default. */
export function parseRange(raw: string | undefined): RangeKey {
  return raw && Object.hasOwn(RANGES, raw) ? (raw as RangeKey) : "month";
}

// ---------------------------------------------------------------------------
// Where an application came from
// ---------------------------------------------------------------------------

/** design/tats's channels where the data has them, warmest first; the order is the legend's and the chart's. */
export const SOURCE_GROUPS = [
  { key: "referral", label: "Referred" },
  { key: "tacit", label: "Sent by Tacit" },
  { key: "careers", label: "Careers page" },
  { key: "sourced", label: "Sourced" },
  { key: "agency", label: "Agency" },
  { key: "event", label: "Event" },
  { key: "other", label: "Other" },
] as const;
export type SourceGroup = (typeof SOURCE_GROUPS)[number]["key"];

/** Referrals and Tacit's submissions: someone vouched for them (design/tats's "warm"). */
const WARM: readonly SourceGroup[] = ["referral", "tacit"];

/**
 * An application's `source` (core's CANDIDATE_SOURCES, plus `candidate`,
 * which submit_job_application has written) as a channel. Tacit submits like
 * an agency, its `source_detail` reading "Tacit · <teammate>"; any other
 * agency is an agency.
 */
export function sourceGroup(source: string, detail: string | null): SourceGroup {
  switch (source) {
    case "referral":
      return "referral";
    case "agency":
      return /^Tacit(\s*·|$)/.test(detail?.trim() ?? "") ? "tacit" : "agency";
    case "job_board":
    case "applicant":
    case "candidate":
      return "careers";
    case "sourced":
    case "suggested":
      return "sourced";
    case "event":
      return "event";
    default:
      return "other";
  }
}

/**
 * "Where they came from" and the export: the groups, with the public form's
 * applications split by the channel it recorded. "Careers page" is then what
 * has no channel, everything from before channels were recorded. The explorer
 * keeps the groups: the prototype splits it coarser than this, and its stacks
 * have no colours for more.
 */
export const ORIGINS = [
  { key: "referral", label: "Referred" },
  { key: "tacit", label: "Sent by Tacit" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "hackernews", label: "Hacker News" },
  { key: "direct", label: "Direct" },
  { key: "site", label: "Other sites" },
  { key: "careers", label: "Careers page, not recorded" },
  { key: "sourced", label: "Sourced" },
  { key: "agency", label: "Agency" },
  { key: "event", label: "Event" },
  { key: "other", label: "Other" },
] as const;
export type Origin = (typeof ORIGINS)[number]["key"];

/** The channel only ever counts on an application from the public form, the one thing that sets it. */
export function originOf(group: SourceGroup, channel: Channel | null): Origin {
  if (group !== "careers" || !channel) return group;
  return channel === "other" ? "site" : channel;
}

// ---------------------------------------------------------------------------
// The careers page: views, applications per day and the period before
// ---------------------------------------------------------------------------

/** One application, as the careers page counts it. */
export type CareersApp = { createdAt: string; roleId: string; group: SourceGroup; channel: Channel | null };

/** One post's views on one UTC day (`YYYY-MM-DD`). */
export type CareersViews = { day: string; roleId: string; views: number };

/** What the careers page counts; `viewsFrom` is the first day any view was recorded, or null. */
export type CareersData = { apps: CareersApp[]; views: CareersViews[]; viewsFrom: string | null };

export type Totals = {
  applications: number;
  warm: number;
  views: number;
  /** Applications the public form recorded a channel on, on the days views were being recorded: the rate's top half. */
  viewed: number;
  /** Views began after this period did, so it is no fair comparison. */
  viewsPartial: boolean;
  bySource: Record<SourceGroup, number>;
  byOrigin: Record<Origin, number>;
  byJob: Map<string, number>;
};

const utcDay = (ms: number) => Math.floor(ms / DAY);

/** The first UTC day a view was recorded; with none yet, a day never reached. */
const firstViewDay = (data: CareersData) => (data.viewsFrom ? utcDay(Date.parse(data.viewsFrom)) : Infinity);

/** The first UTC day the read must reach: the start of the period before this one. */
export function readFrom(range: RangeKey, now: number): string {
  return new Date((utcDay(now) - 2 * RANGES[range].days + 1) * DAY).toISOString();
}

/** Totals over the UTC days [first, last]. */
function totalsIn(data: CareersData, first: number, last: number): Totals {
  const bySource = Object.fromEntries(SOURCE_GROUPS.map((g) => [g.key, 0])) as Record<SourceGroup, number>;
  const byOrigin = Object.fromEntries(ORIGINS.map((o) => [o.key, 0])) as Record<Origin, number>;
  const byJob = new Map<string, number>();
  const viewsFrom = firstViewDay(data);
  let applications = 0;
  let viewed = 0;
  for (const a of data.apps) {
    const d = utcDay(Date.parse(a.createdAt));
    if (d < first || d > last) continue;
    applications += 1;
    bySource[a.group] += 1;
    byOrigin[originOf(a.group, a.channel)] += 1;
    byJob.set(a.roleId, (byJob.get(a.roleId) ?? 0) + 1);
    // Not the group alone: a member can add someone as job_board or applicant, and only the form writes a channel.
    if (a.group === "careers" && a.channel && d >= viewsFrom) viewed += 1;
  }
  let views = 0;
  for (const v of data.views) {
    const d = utcDay(Date.parse(v.day));
    if (d >= first && d <= last) views += v.views;
  }
  return { applications, warm: WARM.reduce((s, g) => s + bySource[g], 0), views, viewed, viewsPartial: viewsFrom > first, bySource, byOrigin, byJob };
}

/** This period (the last `days` UTC days, today included) and the one before. */
export function periodTotals(data: CareersData, range: RangeKey, now: number): { current: Totals; previous: Totals } {
  const n = RANGES[range].days;
  const today = utcDay(now);
  return { current: totalsIn(data, today - n + 1, today), previous: totalsIn(data, today - 2 * n + 1, today - n) };
}

/** design/tats's four, in its order. `digits` are a share's decimals. */
export const METRICS = {
  views: { label: "Page views", def: "Times your public job posts were opened: page loads, not people", share: false, digits: 0 },
  applications: { label: "Applications", def: "Applications added in the period, from every source", share: false, digits: 0 },
  rate: { label: "Views that apply", def: "Applications made on your public job posts, per page view", share: true, digits: 1 },
  warm: { label: "Warm applicants", def: "Share of applications that were referred or sent by Tacit", share: true, digits: 0 },
} as const;
export type MetricKey = keyof typeof METRICS;
export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

export function parseMetric(raw: string | undefined): MetricKey {
  return raw && Object.hasOwn(METRICS, raw) ? (raw as MetricKey) : "applications";
}

/**
 * A metric's value: a count, or for a share a percentage (null with nothing to
 * share). The rate counts only public form applications, since a referral, a
 * submission or someone a member added never opened the post, and only those on
 * days views were being recorded, so the months of applications before the
 * first view cannot read as 300%. Nothing caps it at 100: a browser with no
 * scripts applies uncounted.
 */
export function metricValue(metric: MetricKey, t: Totals): number | null {
  if (metric === "warm") return t.applications ? (t.warm / t.applications) * 100 : null;
  if (metric === "rate") return t.views ? (t.viewed / t.views) * 100 : null;
  return t[metric];
}

/**
 * Against the period before: a count's change in percent, a share's in
 * points. Null when there is nothing to compare with, which is also a period
 * before that views only reach part of.
 */
export function metricChange(metric: MetricKey, current: Totals, previous: Totals): number | null {
  if ((metric === "views" || metric === "rate") && previous.viewsPartial) return null;
  const c = metricValue(metric, current);
  const p = metricValue(metric, previous);
  if (c === null || p === null) return null;
  if (METRICS[metric].share) return c - p;
  return p ? ((c - p) / p) * 100 : null;
}

export type SeriesPoint = { label: string; current: number | null; previous: number | null };

const dayLabel = (day: number) => new Date(day * DAY).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * One point per UTC day, per week for a quarter (the last week cut short),
 * for this period and, at the same offset, the one before. A point is
 * labelled with its first day. Views on a point wholly before the first
 * recorded view are null: nothing was counting then, which is not zero.
 */
export function series(data: CareersData, metric: MetricKey, range: RangeKey, now: number): { step: number; points: SeriesPoint[] } {
  const n = RANGES[range].days;
  const step = range === "quarter" ? 7 : 1;
  const first = utcDay(now) - n + 1;
  const viewsFrom = firstViewDay(data);
  const value = (from: number, to: number) => (metric === "views" && to < viewsFrom ? null : metricValue(metric, totalsIn(data, from, to)));
  const points: SeriesPoint[] = [];
  for (let i = 0; i < n; i += step) {
    const from = first + i;
    const to = Math.min(first + n - 1, from + step - 1);
    points.push({
      label: dayLabel(from),
      current: value(from, to),
      previous: value(from - n, to - n),
    });
  }
  return { step, points };
}

/** The export: one row per UTC day of this period, its views (empty before the first was recorded) and applications by where they came from. */
export function dailyRows(data: CareersData, range: RangeKey, now: number): string[][] {
  const n = RANGES[range].days;
  const first = utcDay(now) - n + 1;
  const viewsFrom = firstViewDay(data);
  const rows = [["Date (UTC)", "Page views", "Applications", ...ORIGINS.map((o) => o.label)]];
  for (let d = first; d < first + n; d++) {
    const t = totalsIn(data, d, d);
    rows.push([new Date(d * DAY).toISOString().slice(0, 10), d < viewsFrom ? "" : String(t.views), String(t.applications), ...ORIGINS.map((o) => String(t.byOrigin[o.key]))]);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// The Pipeline explorer
// ---------------------------------------------------------------------------

/** A live application in an open job (the Pipeline board's), with what the explorer slices it by. */
export type ExplorerApp = {
  applicationId: string;
  roleId: string;
  column: ColumnKey;
  group: SourceGroup;
  departmentId: string | null;
  /** Its interviews but cancelled ones, each with who sits on it. */
  interviews: { interviewerIds: string[] }[];
};

export const MEASURES = {
  applicants: { label: "Applicants", unit: ["applicant", "applicants"] },
  interviews: { label: "Interviews", unit: ["interview", "interviews"] },
} as const;
export type MeasureKey = keyof typeof MEASURES;

export const SLICES = {
  stage: { label: "Stage" },
  job: { label: "Job" },
  department: { label: "Department" },
  interviewer: { label: "Interviewer" },
} as const;
export type SliceKey = keyof typeof SLICES;

/** design/tats's Priority segment has no field behind it; Stage stands in beside Source. */
export const SEGMENTS = {
  source: { label: "Source" },
  stage: { label: "Stage" },
} as const;
export type SegmentKey = keyof typeof SEGMENTS;

// Own keys only: "toString" is `in` every object.
const pick = <K extends string>(map: Record<K, unknown>, raw: string | undefined, fallback: K): K => (raw && Object.hasOwn(map, raw) ? (raw as K) : fallback);
export const parseMeasure = (raw: string | undefined) => pick<MeasureKey>(MEASURES, raw, "applicants");
export const parseSlice = (raw: string | undefined) => pick<SliceKey>(SLICES, raw, "stage");
export const parseSegment = (raw: string | undefined) => pick<SegmentKey>(SEGMENTS, raw, "source");

export type ExplorerNames = {
  /** The jobs to show, in order (open jobs the member can see). */
  jobs: { id: string; title: string }[];
  /** The departments to show, in path order, with their path as the label. */
  departments: { id: string; label: string }[];
  interviewers: Record<string, string>;
};

export type ExplorerRow = { key: string; label: string; by: number[]; total: number };
export type Explorer = { segments: { key: string; label: string }[]; rows: ExplorerRow[]; total: number };

export const NO_DEPARTMENT = "none";

/**
 * Count the measure per slice group, split by segment. Stage and Job keep
 * their empty rows (the board's columns, the open jobs); Department and
 * Interviewer show only who has some. An applicant counts once under each
 * interviewer who has interviewed them, and an interview with two
 * interviewers under each, so those rows can sum past the total, which
 * counts everything once.
 */
export function explore(apps: ExplorerApp[], names: ExplorerNames, measure: MeasureKey, slice: SliceKey, segment: SegmentKey): Explorer {
  const segments: { key: string; label: string }[] = segment === "source" ? SOURCE_GROUPS.map((g) => ({ key: g.key, label: g.label })) : PIPELINE_COLUMNS.map((c) => ({ key: c.key, label: c.label }));
  const segOf = (a: ExplorerApp) => segments.findIndex((s) => s.key === (segment === "source" ? a.group : a.column));

  const rows = new Map<string, ExplorerRow>();
  const order: { key: string; label: string; keep: boolean }[] =
    slice === "stage"
      ? PIPELINE_COLUMNS.map((c) => ({ key: c.key, label: c.label, keep: true }))
      : slice === "job"
        ? names.jobs.map((j) => ({ key: j.id, label: j.title, keep: true }))
        : slice === "department"
          ? [...names.departments.map((d) => ({ key: d.id, label: d.label, keep: false })), { key: NO_DEPARTMENT, label: "No department", keep: false }]
          : [];
  for (const o of order) rows.set(o.key, { key: o.key, label: o.label, by: segments.map(() => 0), total: 0 });

  const add = (key: string, label: string, seg: number, n: number) => {
    if (!n) return;
    const row = rows.get(key) ?? { key, label, by: segments.map(() => 0), total: 0 };
    row.by[seg] += n;
    row.total += n;
    rows.set(key, row);
  };

  let total = 0;
  for (const a of apps) {
    const seg = segOf(a);
    if (seg < 0) continue;
    if (slice === "interviewer") {
      const per = new Map<string, number>();
      for (const iv of a.interviews) for (const id of new Set(iv.interviewerIds)) per.set(id, (per.get(id) ?? 0) + 1);
      for (const [id, n] of per) add(id, names.interviewers[id] ?? "Someone you can't see", seg, measure === "applicants" ? 1 : n);
      total += measure === "applicants" ? (per.size ? 1 : 0) : a.interviews.filter((iv) => iv.interviewerIds.length).length;
      continue;
    }
    const n = measure === "applicants" ? 1 : a.interviews.length;
    const key = slice === "stage" ? a.column : slice === "job" ? a.roleId : (a.departmentId ?? NO_DEPARTMENT);
    // A job or department outside the names (another department's, or one they cannot read) is not shown.
    if (!rows.has(key)) continue;
    add(key, key, seg, n);
    total += n;
  }

  const keep = new Set(order.filter((o) => o.keep).map((o) => o.key));
  let out = [...rows.values()].filter((r) => r.total || keep.has(r.key));
  if (slice === "interviewer") out = out.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  return { segments, rows: out, total };
}

/**
 * A chart axis' top: four gridlines a round step apart, the step 1, 1.5, 2,
 * 2.5, 3, 4, 5, 6, 7.5 or 8 times a power of ten (1.25 too from the
 * hundreds), whole below ten, so no label reads 62.5 or 12.5. At least 4.
 */
export function axisTop(peak: number): number {
  const v = peak / 4;
  if (v <= 1) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const factors = p < 10 ? [1, 2, 3, 4, 5, 6, 8, 10] : p < 100 ? [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10] : [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10];
  return factors.find((f) => f * p >= v)! * p * 4;
}
