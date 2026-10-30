import { PIPELINE_COLUMNS, type ColumnKey } from "./pipeline-columns";

// Analytics' arithmetic (design/tats's #analytics): the careers page's
// applications per UTC day against the period before, where they came from,
// and the Pipeline explorer's measure × slice × segment. Pure:
// lib/client/analytics.ts reads, this counts, the page draws.
//
// Days are UTC calendar days: an org has no time zone yet (the Interviewers
// page counts weeks the same way), and a chart needs dated points.
//
// Nothing here knows page views: the database records none yet (the plan's
// job_post_views, a tacit-internal migration), so the prototype's "Page
// views" and "Views that apply" are left out until it does.

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

// ---------------------------------------------------------------------------
// The careers page: applications per day and the period before
// ---------------------------------------------------------------------------

/** One application, as the careers page counts it. */
export type CareersApp = { createdAt: string; roleId: string; group: SourceGroup };

export type Totals = { applications: number; careers: number; warm: number; bySource: Record<SourceGroup, number>; byJob: Map<string, number> };

const utcDay = (ms: number) => Math.floor(ms / DAY);

/** The first UTC day the read must reach: the start of the period before this one. */
export function readFrom(range: RangeKey, now: number): string {
  return new Date((utcDay(now) - 2 * RANGES[range].days + 1) * DAY).toISOString();
}

/** Totals over the UTC days [first, last]. */
function totalsIn(apps: CareersApp[], first: number, last: number): Totals {
  const bySource = Object.fromEntries(SOURCE_GROUPS.map((g) => [g.key, 0])) as Record<SourceGroup, number>;
  const byJob = new Map<string, number>();
  let applications = 0;
  for (const a of apps) {
    const d = utcDay(Date.parse(a.createdAt));
    if (d < first || d > last) continue;
    applications += 1;
    bySource[a.group] += 1;
    byJob.set(a.roleId, (byJob.get(a.roleId) ?? 0) + 1);
  }
  return { applications, careers: bySource.careers, warm: WARM.reduce((s, g) => s + bySource[g], 0), bySource, byJob };
}

/** This period (the last `days` UTC days, today included) and the one before. */
export function periodTotals(apps: CareersApp[], range: RangeKey, now: number): { current: Totals; previous: Totals } {
  const n = RANGES[range].days;
  const today = utcDay(now);
  return { current: totalsIn(apps, today - n + 1, today), previous: totalsIn(apps, today - 2 * n + 1, today - n) };
}

export const METRICS = {
  applications: { label: "Applications", def: "Applications added in the period, from every source", share: false },
  careers: { label: "Careers page", def: "Applications made on your public job posts", share: false },
  warm: { label: "Warm applicants", def: "Share of applications that were referred or sent by Tacit", share: true },
} as const;
export type MetricKey = keyof typeof METRICS;
export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

export function parseMetric(raw: string | undefined): MetricKey {
  return raw && Object.hasOwn(METRICS, raw) ? (raw as MetricKey) : "applications";
}

/** A metric's value: a count, or for a share a percentage 0 to 100 (null with no applications to share). */
export function metricValue(metric: MetricKey, t: Totals): number | null {
  if (metric === "warm") return t.applications ? (t.warm / t.applications) * 100 : null;
  return t[metric];
}

/**
 * Against the period before: a count's change in percent, a share's in
 * points. Null when there is nothing to compare with.
 */
export function metricChange(metric: MetricKey, current: Totals, previous: Totals): number | null {
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
 * labelled with its first day.
 */
export function series(apps: CareersApp[], metric: MetricKey, range: RangeKey, now: number): { step: number; points: SeriesPoint[] } {
  const n = RANGES[range].days;
  const step = range === "quarter" ? 7 : 1;
  const first = utcDay(now) - n + 1;
  const points: SeriesPoint[] = [];
  for (let i = 0; i < n; i += step) {
    const from = first + i;
    const to = Math.min(first + n - 1, from + step - 1);
    points.push({
      label: dayLabel(from),
      current: metricValue(metric, totalsIn(apps, from, to)),
      previous: metricValue(metric, totalsIn(apps, from - n, to - n)),
    });
  }
  return { step, points };
}

/** The export: one row per UTC day of this period, applications by channel. */
export function dailyRows(apps: CareersApp[], range: RangeKey, now: number): string[][] {
  const n = RANGES[range].days;
  const first = utcDay(now) - n + 1;
  const rows = [["Date (UTC)", "Applications", ...SOURCE_GROUPS.map((g) => g.label)]];
  for (let d = first; d < first + n; d++) {
    const t = totalsIn(apps, d, d);
    rows.push([new Date(d * DAY).toISOString().slice(0, 10), String(t.applications), ...SOURCE_GROUPS.map((g) => String(t.bySource[g.key]))]);
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
