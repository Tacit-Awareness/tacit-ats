import { ACTIVE_STAGES } from "@tacit/core";
import { PIPELINE_COLUMNS, type ColumnKey, type InterviewTimes } from "./pipeline-columns";
import type { StageName } from "./process-stages";

// Home's arithmetic (design/tats's Recruiting Overview): the period and its
// comparison, applications per day or week, how long the people in each
// pipeline column have waited, the bottlenecks, interview hours and feedback
// follow-through. Pure: lib/client/home.ts reads, this counts, the view draws.

const H = 3_600_000;
const DAY = 24 * H;

export const HOME_PERIODS = [7, 30, 90] as const;
export type HomePeriod = (typeof HOME_PERIODS)[number];

/** `?days=` as one of the periods; anything else is the first. */
export function parsePeriod(raw: string | undefined): HomePeriod {
  const n = Number(raw);
  return (HOME_PERIODS as readonly number[]).includes(n) ? (n as HomePeriod) : HOME_PERIODS[0];
}

/** The middle value (the lower of the two middles for an even count), or null for none. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

// ---------------------------------------------------------------------------
// New applications
// ---------------------------------------------------------------------------

export type PeriodCount = { current: number; previous: number; /** (current - previous) / previous, or null with nothing before. */ change: number | null };

/** Applications in the last `days` against the `days` before that. */
export function periodCount(createdAts: string[], days: number, now: number): PeriodCount {
  const from = now - days * DAY;
  const prevFrom = from - days * DAY;
  let current = 0;
  let previous = 0;
  for (const iso of createdAts) {
    const t = Date.parse(iso);
    if (t >= from && t <= now) current += 1;
    else if (t >= prevFrom && t < from) previous += 1;
  }
  return { current, previous, change: previous ? (current - previous) / previous : null };
}

export type Bin = { /** Days before now this bin starts and ends, e.g. 14 and 7. */ fromDaysAgo: number; toDaysAgo: number; n: number };

/**
 * The period in bins ending now: a day each for a week, a week each past
 * that (the last bin is cut short when the period is not whole weeks).
 * Relative to `now`, not calendar days, so it needs no time zone.
 */
export function bins(createdAts: string[], days: number, now: number): Bin[] {
  const step = days > 7 ? 7 : 1;
  const out: Bin[] = [];
  for (let to = 0; to < days; to += step) out.unshift({ fromDaysAgo: Math.min(days, to + step), toDaysAgo: to, n: 0 });
  for (const iso of createdAts) {
    const ago = (now - Date.parse(iso)) / DAY;
    if (ago < 0 || ago >= days) continue;
    const bin = out.find((b) => ago >= b.toDaysAgo && ago < b.fromDaysAgo);
    if (bin) bin.n += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Waiting: how long each live candidate has been where they are
// ---------------------------------------------------------------------------

/** A stage move, as application_events records it. */
export type StageMove = { toStage: string; at: string };

/**
 * When a candidate started waiting where they are now. In "Your call", since
 * their last interview ended (the decision is what they wait on). Otherwise
 * since the last move into their current stage, or since they were added
 * when nothing recorded the move.
 */
export function waitingSince(
  e: { stage: string; column: ColumnKey; addedAt: string; interviews: InterviewTimes[] },
  moves: StageMove[],
  now: number,
): string {
  if (e.column === "decide") {
    const ended = e.interviews
      .filter((i) => i.status === "done" || (i.status === "scheduled" && Date.parse(i.endsAt) <= now))
      .map((i) => i.endsAt)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    if (ended) return ended;
  }
  const entered = moves
    .filter((m) => m.toStage === e.stage)
    .map((m) => m.at)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  return entered ?? e.addedAt;
}

/** design/tats's wait buckets, the way people talk about them. */
export const AGE_BUCKETS = [
  { label: "<1d", lo: 0, hi: 24 },
  { label: "1–2d", lo: 24, hi: 48 },
  { label: "2–3d", lo: 48, hi: 72 },
  { label: "3–5d", lo: 72, hi: 120 },
  { label: "5d+", lo: 120, hi: Infinity },
] as const;

export function ageBuckets(hours: number[]): { label: string; lo: number; n: number }[] {
  return AGE_BUCKETS.map((b) => ({ label: b.label, lo: b.lo, n: hours.filter((h) => h >= b.lo && h < b.hi).length }));
}

/** Time in stage's three segments: under a day, one to three, over three. */
export const WAIT_SEGMENTS = [
  { label: "Under a day", lo: 0, hi: 24 },
  { label: "1 to 3 days", lo: 24, hi: 72 },
  { label: "Over 3 days", lo: 72, hi: Infinity },
] as const;

export type Waiting = {
  applicationId: string;
  personId: string;
  roleId: string;
  roleTitle: string;
  personName: string;
  column: ColumnKey;
  /** The company's name for where they are; null on a job that does not follow the process. */
  stage?: StageName | null;
  hours: number;
  stalled: boolean;
  lastTouchAt: string;
};

export type StageRow = {
  key: ColumnKey;
  label: string;
  /** Longest wait first. */
  people: Waiting[];
  /** Counts per WAIT_SEGMENTS entry. */
  segments: number[];
  medianHours: number | null;
  longestHours: number | null;
};

function waitRow(waiting: Waiting[]): Omit<StageRow, "key" | "label"> {
  const people = [...waiting].sort((a, b) => b.hours - a.hours);
  const hours = people.map((p) => p.hours);
  return {
    people,
    segments: WAIT_SEGMENTS.map((s) => hours.filter((h) => h >= s.lo && h < s.hi).length),
    medianHours: median(hours),
    longestHours: people[0]?.hours ?? null,
  };
}

/** One row per board column, in board order, every column present. */
export function stageRows(waiting: Waiting[]): StageRow[] {
  return PIPELINE_COLUMNS.map(({ key, label }) => ({ key, label, ...waitRow(waiting.filter((w) => w.column === key)) }));
}

export type TimeRow = Omit<StageRow, "key"> & {
  key: string;
  /** The board column it is, for a link to it. Null for a stage of the process, which can span columns. */
  column: ColumnKey | null;
};

/**
 * Time in stage's rows. With a process, one row per stage of it, every stage
 * present, then a board column for anyone on a job that does not follow the
 * process, only where there is someone: they keep today's labels, and the rows
 * still add up to everyone active. With none, the board's columns.
 */
export function timeRows(waiting: Waiting[], stages: StageName[] | null): TimeRow[] {
  if (!stages) return stageRows(waiting).map((r) => ({ ...r, column: r.key }));
  const named = stages.map(({ name, order }) => ({ key: `stage-${order}`, label: name, column: null, ...waitRow(waiting.filter((w) => w.stage?.order === order)) }));
  const rest = stageRows(waiting.filter((w) => !w.stage)).filter((r) => r.people.length);
  return [...named, ...rest.map((r) => ({ ...r, column: r.key }))];
}

/** A chart's short label for a stage: its first word, as design/tats's procAbbr. */
export const stageAbbr = (name: string) => name.split(/[\s/]+/)[0].slice(0, 5);

// ---------------------------------------------------------------------------
// Bottlenecks
// ---------------------------------------------------------------------------

export type BottleneckKey = "review" | "schedule" | "decide" | "feedback" | "stalled";

export type Bottleneck = {
  key: BottleneckKey;
  n: number;
  /** The oldest wait, when there is one to tell. */
  oldestHours: number | null;
  /** Its oldest has waited past the company's target for that step. */
  overTarget: boolean;
};

/** Home's targets for the steps a bottleneck waits on, in hours, and how long the oldest outstanding feedback has waited. */
export type BottleneckTargets = { review?: number | null; schedule?: number | null; feedback?: number | null; oldestFeedbackHours?: number | null };

/**
 * What is waiting: candidates not yet screened, waiting to be scheduled,
 * waiting on the team's call; interviews whose feedback is not in; and
 * candidates core calls stalled. Nothing waiting, no row. Whatever is over its
 * target comes first, as design/tats, then the oldest; feedback has no
 * `oldestHours`, so it comes last on its side. A step with no target is never
 * over one, and neither is a decision or a stall, which take none.
 */
export function bottlenecks(waiting: Waiting[], outstandingFeedback: number | null, now: number, targets: BottleneckTargets = {}): Bottleneck[] {
  const oldest = (ws: Waiting[]) => (ws.length ? Math.max(...ws.map((w) => w.hours)) : null);
  const of = (c: ColumnKey) => waiting.filter((w) => w.column === c);
  const stalled = waiting.filter((w) => w.stalled);
  const over = (hours: number | null | undefined, target: number | null | undefined) => hours !== null && hours !== undefined && target !== null && target !== undefined && hours > target;
  const rows: Bottleneck[] = [
    { key: "review", n: of("new").length, oldestHours: oldest(of("new")), overTarget: over(oldest(of("new")), targets.review) },
    { key: "schedule", n: of("scheduling").length, oldestHours: oldest(of("scheduling")), overTarget: over(oldest(of("scheduling")), targets.schedule) },
    { key: "decide", n: of("decide").length, oldestHours: oldest(of("decide")), overTarget: false },
    { key: "feedback", n: outstandingFeedback ?? 0, oldestHours: null, overTarget: over(targets.oldestFeedbackHours, targets.feedback) },
    {
      key: "stalled",
      n: stalled.length,
      oldestHours: stalled.length ? Math.max(...stalled.map((w) => (now - Date.parse(w.lastTouchAt)) / H)) : null,
      overTarget: false,
    },
  ];
  return rows.filter((r) => r.n > 0).sort((a, b) => Number(b.overTarget) - Number(a.overTarget) || (b.oldestHours ?? -1) - (a.oldestHours ?? -1));
}

// ---------------------------------------------------------------------------
// Interview workload
// ---------------------------------------------------------------------------

export type WorkloadInterview = { startsAt: string; endsAt: string; interviewerIds: string[] };

export type Workload = {
  interviews: number;
  held: number;
  booked: number;
  /** Interviewer hours: an interview's length once per interviewer on it. */
  hours: number;
  /** Most hours first. */
  byInterviewer: { id: string; hours: number; interviews: number }[];
};

/**
 * Interviews held in the last `days` and booked in the next `days`
 * (cancelled ones are never passed in), in interviewer hours.
 */
export function workload(interviews: WorkloadInterview[], days: number, now: number): Workload {
  const lo = now - days * DAY;
  const hi = now + days * DAY;
  const per = new Map<string, { id: string; hours: number; interviews: number }>();
  let held = 0;
  let booked = 0;
  let hours = 0;
  for (const i of interviews) {
    const start = Date.parse(i.startsAt);
    if (start < lo || start >= hi) continue;
    if (Date.parse(i.endsAt) <= now) held += 1;
    else booked += 1;
    const length = Math.max(0, Date.parse(i.endsAt) - start) / H;
    for (const id of i.interviewerIds) {
      const row = per.get(id) ?? { id, hours: 0, interviews: 0 };
      row.hours += length;
      row.interviews += 1;
      per.set(id, row);
      hours += length;
    }
  }
  return { interviews: held + booked, held, booked, hours, byInterviewer: [...per.values()].sort((a, b) => b.hours - a.hours || a.id.localeCompare(b.id)) };
}

// ---------------------------------------------------------------------------
// Interviewer feedback
// ---------------------------------------------------------------------------

/** The fields of @tacit-ats/core's InterviewerRow this page reads. */
export type FeedbackRow = { userId: string; name: string | null; interviews: number; feedbackFiled: number; onTime: number; late: number; notFiled: number; medianHoursToFeedback: number | null };

export type FeedbackSummary = {
  filed: number;
  onTime: number;
  /** onTime / filed, 0 to 1, or null with nothing filed. */
  onTimeShare: number | null;
  outstanding: number;
  /** Slowest first; who has none filed yet but owes some comes after. */
  interviewers: FeedbackRow[];
};

export function feedbackSummary(rows: FeedbackRow[]): FeedbackSummary {
  const filed = rows.reduce((n, r) => n + r.feedbackFiled, 0);
  const onTime = rows.reduce((n, r) => n + r.onTime, 0);
  const interviewers = rows
    .filter((r) => r.feedbackFiled > 0 || r.notFiled > 0)
    .sort((a, b) => (b.medianHoursToFeedback ?? -1) - (a.medianHoursToFeedback ?? -1) || b.notFiled - a.notFiled);
  return { filed, onTime, onTimeShare: filed ? onTime / filed : null, outstanding: rows.reduce((n, r) => n + r.notFiled, 0), interviewers };
}

/** A stage's line in pipelineReport, as far as the average stay goes. */
export type ReportStay = { stage: string; avgDaysInStage: number | null; stays: number };

/**
 * The average stay in each live stage over one or more pipelineReports (one
 * per job of a department), weighted by how many stays each average is over.
 * The reports round to a tenth of a day, so a merged average can be a
 * twentieth of a day off the exact one. Hired and the exits have no stay.
 */
export function mergeStays(reports: { stages: ReportStay[] }[]): { stage: string; avgDays: number | null; stays: number }[] {
  return ACTIVE_STAGES.map((stage) => {
    let stays = 0;
    let days = 0;
    for (const r of reports) {
      const row = r.stages.find((s) => s.stage === stage);
      if (!row || row.avgDaysInStage === null || !row.stays) continue;
      stays += row.stays;
      days += row.avgDaysInStage * row.stays;
    }
    return { stage, avgDays: stays ? Math.round((days / stays) * 10) / 10 : null, stays };
  });
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** design/tats's hours: "40m", "5h", "2.5d" past two days. */
export function fmtHours(h: number): string {
  if (h >= 48) return `${(h / 24).toFixed(1).replace(/\.0$/, "")}d`;
  if (h >= 1) return `${Math.round(h)}h`;
  return `${Math.max(1, Math.round(h * 60))}m`;
}
