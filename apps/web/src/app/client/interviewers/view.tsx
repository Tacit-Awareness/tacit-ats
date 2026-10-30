import * as React from "react";
import { Avatar, Count, Empty, Page, PageBar } from "@/components/page";
import { cn } from "@/lib/utils";

// The Interviewers page's markup, props only (page.tsx does the reads):
// design/tats's interviewer table (`.cardbox` around `.ptable`), one card in
// a 1040px column, with a ruled subhead per department when there are any. A
// row is the person (and their jobs, faint under the name), their interviews
// this week as a bar against the busiest on the team, next week and in the
// last 30 days, and feedback on time / late / not filed (only for a member
// who may read it). Counts only: never what anyone wrote. Colour only for
// meaning: feedback not filed reads red.

export type InterviewerViewRow = {
  actorId: string;
  name: string;
  thisWeek: number;
  nextWeek: number;
  last30: number;
  /** Null: nothing ended in the last 30 days that they owe feedback on. */
  feedback: { onTime: number; late: number; notFiled: number; notVisible: number } | null;
  jobs: string[];
};

/** `label` null: no departments, one list without subheads. */
export type InterviewerViewGroup = { label: string | null; rows: InterviewerViewRow[] };

const gridOf = (feedback: boolean) =>
  cn(
    "grid items-center gap-3.5 px-3.5",
    feedback
      ? "grid-cols-[minmax(200px,1.5fr)_150px_80px_96px_minmax(240px,1.3fr)]"
      : "grid-cols-[minmax(200px,1.5fr)_150px_80px_96px]",
  );

/** The most pips a bar draws; past that, each pip stands for more than one interview. */
const MAX_PIPS = 10;

/** design/tats's `.lbar`: pips to the team's busiest week, the ones lit for this person, and the number. */
function LoadBar({ n, max }: { n: number; max: number }) {
  const pips = Math.min(Math.max(max, 1), MAX_PIPS);
  const lit = max <= MAX_PIPS ? n : n > 0 ? Math.max(1, Math.round((n / max) * MAX_PIPS)) : 0;
  return (
    <span className="flex items-center gap-2" title={`${n} this week; the busiest on the team has ${max}`}>
      <span aria-hidden className="inline-flex gap-0.5">
        {Array.from({ length: pips }, (_, i) => (
          <i key={i} className={cn("h-3 w-[7px] rounded-[2px]", i < lit ? "bg-foreground opacity-70" : "bg-[color:var(--soft-strong)]")} />
        ))}
      </span>
      <span className={cn("tabular-nums", n === 0 && "text-faint")}>{n}</span>
    </span>
  );
}

function Num({ n }: { n: number }) {
  return <span className={cn("tabular-nums", n === 0 && "text-faint")}>{n}</span>;
}

function FeedbackCell({ f }: { f: InterviewerViewRow["feedback"] }) {
  if (!f) return <span className="text-faint">None due</span>;
  const parts: React.ReactNode[] = [
    <span key="on">{f.onTime} on time</span>,
    <span key="late" className={cn(f.late === 0 && "text-faint")}>
      {f.late} late
    </span>,
    <span key="not" className={cn(f.notFiled > 0 ? "text-negative" : "text-faint")}>{f.notFiled} not filed</span>,
  ];
  if (f.notVisible > 0) {
    parts.push(
      <span key="hidden" className="text-faint" title="Whether they filed is hidden from you by your company's feedback setting">
        {f.notVisible} hidden
      </span>,
    );
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12.5px] tabular-nums">
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 ? <span className="text-faint">·</span> : null}
          {p}
        </span>
      ))}
    </span>
  );
}

function Rows({ rows, feedback, max }: { rows: InterviewerViewRow[]; feedback: boolean; max: number }) {
  const grid = gridOf(feedback);
  return rows.map((r) => (
    <div role="row" key={r.actorId} className={cn(grid, "min-h-14 border-b border-[color:var(--line)] text-[13px] last:border-b-0")}>
      <span role="cell" className="flex min-w-0 items-center gap-2.5 py-2">
        <Avatar name={r.name} size="lg" />
        <span className="grid min-w-0">
          <b className="truncate font-medium">{r.name}</b>
          <span className="truncate text-xs text-faint" title={r.jobs.length > 1 ? r.jobs.join(", ") : undefined}>
            {r.jobs.length ? `${r.jobs[0]}${r.jobs.length > 1 ? ` +${r.jobs.length - 1}` : ""}` : "No jobs"}
          </span>
        </span>
      </span>
      <span role="cell">
        <LoadBar n={r.thisWeek} max={max} />
      </span>
      <span role="cell">
        <Num n={r.nextWeek} />
      </span>
      <span role="cell">
        <Num n={r.last30} />
      </span>
      {feedback ? (
        <span role="cell" className="min-w-0">
          <FeedbackCell f={r.feedback} />
        </span>
      ) : null}
    </div>
  ));
}

export function InterviewersView({
  groups,
  feedback,
  note,
  empty,
  notices,
  children,
}: {
  groups: InterviewerViewGroup[];
  /** Whether the feedback column is shown. */
  feedback: boolean;
  /** A line under the table, such as the read stopping short. */
  note: string | null;
  empty: string | null;
  /** What the last invite or withdrawal said, above the table. */
  notices?: React.ReactNode;
  /** The team and invitations, under the table. */
  children?: React.ReactNode;
}) {
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const max = Math.max(0, ...groups.flatMap((g) => g.rows.map((r) => r.thisWeek)));
  const grid = gridOf(feedback);
  return (
    <Page className="max-w-[1040px]" bar={<PageBar title="Interviewers" count={empty ? undefined : total} />}>
      {notices}
      <section aria-label="Interviewers" className="grid min-w-0 overflow-hidden rounded-[10px] border border-[color:var(--line)] bg-[color:var(--paper)]">
        <h2 className="m-0 flex min-h-10 items-center gap-2 border-b border-[color:var(--line)] px-3.5 text-[13.5px] font-medium">
          Interviewers
          {empty ? null : <Count>{total}</Count>}
        </h2>
        {empty ? (
          <Empty className="px-3.5 py-3">{empty}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <div role="table" aria-label="Interviewers" className={cn("grid", feedback ? "min-w-[860px]" : "min-w-[600px]")}>
              <div role="row" className={cn(grid, "h-[34px] border-b border-[color:var(--line)] text-xs whitespace-nowrap text-faint")}>
                <span role="columnheader">Interviewer</span>
                <span role="columnheader" title="Interviews starting this week, Monday to Sunday (UTC), against the busiest on the team">
                  This week
                </span>
                <span role="columnheader" title="Interviews starting next week, Monday to Sunday (UTC)">
                  Next week
                </span>
                <span role="columnheader" title="Interviews that started in the last 30 days">
                  Last 30 days
                </span>
                {feedback ? (
                  <span role="columnheader" title="Interviews that ended in the last 30 days on jobs you manage: feedback within 24 hours is on time">
                    Feedback, 30 days
                  </span>
                ) : null}
              </div>
              {groups.map((g) =>
                g.label === null ? (
                  <Rows key="all" rows={g.rows} feedback={feedback} max={max} />
                ) : (
                  <div role="rowgroup" key={g.label} aria-label={g.label} className="grid border-b border-[color:var(--line)] last:border-b-0">
                    <div role="row" className="flex h-9 items-center gap-2 border-b border-[color:var(--line)] bg-[color:var(--soft)] px-3.5 text-[12.5px] font-medium text-muted-foreground">
                      <span role="rowheader">{g.label}</span>
                      <Count>{g.rows.length}</Count>
                    </div>
                    <Rows rows={g.rows} feedback={feedback} max={max} />
                  </div>
                ),
              )}
            </div>
          </div>
        )}
      </section>
      {note ? <p className="m-0 text-xs text-faint">{note}</p> : null}
      {children}
    </Page>
  );
}
