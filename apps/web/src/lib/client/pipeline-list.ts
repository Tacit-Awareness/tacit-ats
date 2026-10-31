import type { PipelineEntry } from "./pipeline";
import { SOURCE_GROUPS } from "./analytics-metrics";
import { rowSource } from "../saved-views";
import { PIPELINE_COLUMNS, ago, lastInterviewAt, nextInterviewAt, until, type ColumnKey } from "./pipeline-columns";

// The Pipeline's list (design/tats's "Pipeline at scale"), the pure half: which
// mode a URL means, the stage bar's numbers, and one email-like row per person.
// "Stuck" is core's own `stalled` (no touch in a week, or a next action
// overdue), not the prototype's per-stage targets, which would be a new setting.

/** Rows a stage shows in Everyone before "Show all". Stuck shows everyone who is stuck. */
export const ROW_PREVIEW = 12;

export type PipelineMode = "stuck" | "everyone";

/**
 * A board only reads for one job (design/tats's `view`), so across jobs it's the
 * list and the switch's Board is off. With one job picked the board is where it
 * opens, and `?layout=list` the other way; the prototype opens on the list, but
 * everything that links a job here means its board.
 */
export type PipelineLayout = "list";

export const parseLayout = (raw: string | undefined): PipelineLayout | null => (raw === "list" ? raw : null);

/** What in a URL says someone came for particular people, so Stuck would hide what they asked for. */
export type ModeContext = {
  stage: string | null;
  source: string | null;
  tag: string | null;
  view: string | null;
  all: string | null;
  q: string | null;
};

/**
 * The page opens on Stuck, but a saved view, a Home link to a whole stage
 * (`?all=`) or a name search means Everyone: Stuck would silently hide most of
 * what they name. `?mode=` overrides either way.
 */
export const defaultMode = (c: ModeContext): PipelineMode => (Object.values(c).some(Boolean) ? "everyone" : "stuck");

export const resolveMode = (raw: string | undefined, c: ModeContext): PipelineMode => (raw === "stuck" || raw === "everyone" ? raw : defaultMode(c));

/** `?mode=` for a link: nothing when that URL would open on it anyway, so the plain URLs stay plain. */
export const modeParam = (mode: PipelineMode, c: ModeContext): PipelineMode | null => (mode === defaultMode(c) ? null : mode);

export type PipelineUrl = Omit<ModeContext, "stage" | "all"> & {
  department: string | null;
  job: string | null;
  mode: PipelineMode;
  stage: ColumnKey | null;
  all: ColumnKey | null;
  /** Only with a job picked: the list instead of its board. */
  layout?: PipelineLayout | null;
};
export type PipelineLink = {
  department?: string | null;
  job?: string | null;
  all?: ColumnKey | null;
  mode?: PipelineMode;
  /** The stage bar's pick, or a job dropping it. Either way the URL is no longer the saved view, so `view` goes; its source and label stay. */
  stage?: ColumnKey | null;
  /** Off the saved view altogether, filters included: a department. */
  leaveView?: boolean;
  /** List or board, for a job. Across jobs there is only the list, so it means nothing without one. */
  layout?: PipelineLayout | null;
  /** The application whose pop-up this link opens. No link carries one on: anything else closes it. */
  open?: string;
};

/** A link from the page as it stands, changing only what `next` names. */
export function pipelineHref(cur: PipelineUrl, next: PipelineLink): string {
  const d = next.department === undefined ? cur.department : next.department;
  const j = next.job === undefined ? cur.job : next.job;
  const all = next.all === undefined ? cur.all : next.all;
  const kept = { stage: cur.stage, source: cur.source, tag: cur.tag, view: cur.view };
  const onView = next.leaveView ? { stage: null, source: null, tag: null, view: null } : next.stage === undefined ? kept : { ...kept, stage: next.stage, view: null };
  const m = modeParam(next.mode ?? cur.mode, { ...onView, all, q: cur.q });
  const params = new URLSearchParams();
  if (d) params.set("department", d);
  if (j) params.set("job", j);
  if (cur.q) params.set("q", cur.q);
  if (all) params.set("all", all);
  if (m) params.set("mode", m);
  for (const [k, v] of Object.entries(onView)) if (v) params.set(k, v);
  const layout = next.layout === undefined ? cur.layout : next.layout;
  if (j && layout) params.set("layout", layout);
  if (next.open) params.set("open", next.open);
  const qs = params.toString();
  return `/client/pipeline${qs ? `?${qs}` : ""}`;
}

export const isStuck = (e: Pick<PipelineEntry, "stalled">) => e.stalled.length > 0;

export type StageCount = { key: ColumnKey; label: string; total: number; stuck: number; /** Of `total`, 0 to 100. */ share: number };

/** One card per stage, empty ones included, so the bar never changes shape. */
export function stageCounts(entries: Pick<PipelineEntry, "column" | "stalled">[]): StageCount[] {
  return PIPELINE_COLUMNS.map(({ key, label }) => {
    const here = entries.filter((e) => e.column === key);
    const stuck = here.filter(isStuck).length;
    return { key, label, total: here.length, stuck, share: here.length ? Math.round((stuck / here.length) * 100) : 0 };
  });
}

/** The card's one status line: what is happening, or what is next. */
export function statusOf(e: PipelineEntry, now: number): string {
  switch (e.column) {
    case "booked": {
      const next = nextInterviewAt(e.interviews, now);
      return next ? `Interview ${until(next, now)}` : "Interview booked";
    }
    case "decide": {
      const last = lastInterviewAt(e.interviews, now);
      return last ? `Interviewed ${ago(last, now)}` : "Interviewed";
    }
    case "new":
      return e.sourceDetail ?? `Added ${ago(e.addedAt, now)}`;
    case "scheduling":
      return e.nextAction ?? "No interview booked";
    default:
      return e.nextAction ?? `Touched ${ago(e.lastTouchAt, now)}`;
  }
}

/**
 * Within a column, what needs looking at first: the soonest interview, the
 * longest wait for a decision, the stalest card; New shows the newest first.
 */
export function sortKey(e: PipelineEntry, now: number): number {
  if (e.column === "booked") return Date.parse(nextInterviewAt(e.interviews, now) ?? e.lastTouchAt);
  if (e.column === "decide") return Date.parse(lastInterviewAt(e.interviews, now) ?? e.lastTouchAt);
  if (e.column === "new") return -Date.parse(e.addedAt);
  return Date.parse(e.lastTouchAt);
}

const STALLED_COPY: Record<string, string> = {
  no_touch: "No touch in a week",
  overdue: "Next action overdue",
};

/** The grey facts: only what is recorded. An unnamed "Other" source says nothing, so it is left out. */
export function factsOf(e: PipelineEntry): string[] {
  const group = rowSource(e);
  return [
    e.roleTitle,
    e.stageName?.name ?? null,
    ...e.stalled.map((r) => STALLED_COPY[r] ?? null),
    e.ownerName,
    group === "other" ? null : (SOURCE_GROUPS.find((s) => s.key === group)?.label ?? null),
    e.headline,
  ].filter((f): f is string => !!f);
}

/** "<1h", "5h", "3d", as design/tats's `plDur`. */
export function shortSpan(iso: string, now: number): string {
  const hours = (now - Date.parse(iso)) / 3_600_000;
  if (hours < 1) return "<1h";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

export type PipelineRow = {
  applicationId: string;
  href: string;
  name: string;
  status: string;
  facts: string;
  /**
   * Since the last stage move or logged touch: no entered-this-stage time is
   * read, and `last_touch_at` is what a move sets.
   */
  time: string;
  stuck: boolean;
};

export const toRow = (e: PipelineEntry, now: number): PipelineRow => ({
  applicationId: e.applicationId,
  href: `/client/candidates/${e.personId}`,
  name: e.personName?.trim() || "Unnamed",
  status: statusOf(e, now),
  facts: factsOf(e).join(" · "),
  time: shortSpan(e.lastTouchAt, now),
  stuck: isStuck(e),
});

export type RowGroup = {
  key: ColumnKey;
  label: string;
  total: number;
  rows: PipelineRow[];
  /** Everyone's "Show all"; `all` is the `?all=` a link should set. */
  more: { all: ColumnKey | null; label: string } | null;
};

/**
 * The people a mode and a stage leave, one group per stage with anyone in it.
 * Stuck: longest quiet first, nobody held back. Everyone: the board's order and
 * ROW_PREVIEW a stage, the expanded one in full.
 */
export function rowGroups(entries: PipelineEntry[], o: { mode: PipelineMode; stage: ColumnKey | null; expanded: ColumnKey | null; now: number }): RowGroup[] {
  const left = entries.filter((e) => (o.mode !== "stuck" || isStuck(e)) && (!o.stage || e.column === o.stage));
  const groups: RowGroup[] = [];
  for (const { key, label } of PIPELINE_COLUMNS) {
    const here = left.filter((e) => e.column === key);
    if (!here.length) continue;
    const sorted = here.sort((a, b) => (o.mode === "stuck" ? Date.parse(a.lastTouchAt) - Date.parse(b.lastTouchAt) : sortKey(a, o.now) - sortKey(b, o.now)));
    const capped = o.mode === "everyone" && sorted.length > ROW_PREVIEW;
    const open = !capped || o.expanded === key;
    groups.push({
      key,
      label,
      total: sorted.length,
      rows: (open ? sorted : sorted.slice(0, ROW_PREVIEW)).map((e) => toRow(e, o.now)),
      more: capped ? (open ? { all: null, label: "Show fewer" } : { all: key, label: `Show all ${sorted.length} in ${label}` }) : null,
    });
  }
  return groups;
}
