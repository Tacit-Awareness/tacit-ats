import { Avatar, Empty, Page, PageHeader, Section } from "@/components/page";
import { cn } from "@/lib/utils";

// The Interviewers page's markup, props only (page.tsx does the reads):
// design/tats's interviewer table, one section per department when there are
// any, else one list. A row is the person, their interviews this week, next
// week and in the last 30 days, feedback on time / late / not filed (only for
// a member who may read it), and the jobs they are on. Counts only: never
// what anyone wrote. Colour only for meaning: feedback not filed reads red.

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

export type InterviewerViewGroup = { label: string; rows: InterviewerViewRow[] };

const gridOf = (feedback: boolean) =>
  cn(
    "grid items-center",
    feedback
      ? "grid-cols-[minmax(200px,1.3fr)_96px_96px_110px_minmax(300px,1.3fr)_minmax(180px,1.2fr)]"
      : "grid-cols-[minmax(200px,1.3fr)_96px_96px_110px_minmax(180px,1.2fr)]",
  );

function Num({ n }: { n: number }) {
  return <span className={cn("px-4 tabular-nums", n === 0 && "text-faint")}>{n}</span>;
}

function FeedbackCell({ f }: { f: InterviewerViewRow["feedback"] }) {
  if (!f) return <span className="px-4 text-faint">None due</span>;
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
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 px-4 text-[12.5px] tabular-nums">
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 ? <span className="text-faint">·</span> : null}
          {p}
        </span>
      ))}
    </span>
  );
}

function Table({ label, rows, feedback }: { label: string; rows: InterviewerViewRow[]; feedback: boolean }) {
  const grid = gridOf(feedback);
  return (
    <div className="overflow-x-auto">
      <div role="table" aria-label={label} className={cn("grid", feedback ? "min-w-[1010px]" : "min-w-[700px]")}>
        <div role="row" className={cn(grid, "h-10 border-b border-[color:var(--line)] text-[12.5px] whitespace-nowrap text-muted-foreground")}>
          <span role="columnheader" className="px-4">
            Interviewer
          </span>
          <span role="columnheader" className="px-4" title="Interviews starting this week, Monday to Sunday (UTC)">
            This week
          </span>
          <span role="columnheader" className="px-4" title="Interviews starting next week, Monday to Sunday (UTC)">
            Next week
          </span>
          <span role="columnheader" className="px-4" title="Interviews that started in the last 30 days">
            Last 30 days
          </span>
          {feedback ? (
            <span role="columnheader" className="px-4" title="Interviews that ended in the last 30 days on jobs you manage: feedback within 24 hours is on time">
              Feedback, 30 days
            </span>
          ) : null}
          <span role="columnheader" className="px-4">
            Jobs
          </span>
        </div>
        {rows.map((r) => (
          <div role="row" key={r.actorId} className={cn(grid, "min-h-[50px] border-b border-[color:var(--line)] text-[13.5px] last:border-b-0")}>
            <span role="cell" className="flex min-w-0 items-center gap-2.5 px-4 py-2">
              <Avatar name={r.name} />
              <b className="truncate font-medium">{r.name}</b>
            </span>
            <span role="cell">
              <Num n={r.thisWeek} />
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
            <span role="cell" className="flex min-w-0 items-center gap-1.5 px-4">
              {r.jobs.length ? (
                <>
                  <span className="inline-flex h-6 min-w-0 items-center truncate rounded-md bg-[color:var(--soft)] px-2 text-[12.5px]">{r.jobs[0]}</span>
                  {r.jobs.length > 1 ? (
                    <span className="text-xs text-faint" title={r.jobs.slice(1).join(", ")}>
                      +{r.jobs.length - 1}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-faint">None</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function InterviewersView({
  groups,
  feedback,
  note,
  empty,
}: {
  groups: InterviewerViewGroup[];
  /** Whether the feedback column is shown. */
  feedback: boolean;
  /** A line under the tables, such as the read stopping short. */
  note: string | null;
  empty: string | null;
}) {
  return (
    <Page>
      <PageHeader title="Interviewers" subtitle="Who interviews, how many they have coming up, and whether their feedback comes in." />
      {empty ? (
        <Section>
          <Empty>{empty}</Empty>
        </Section>
      ) : (
        groups.map((g) => (
          <Section key={g.label} flush title={g.label} count={g.rows.length}>
            <Table label={g.label} rows={g.rows} feedback={feedback} />
          </Section>
        ))
      )}
      {note ? <p className="m-0 text-xs text-faint">{note}</p> : null}
    </Page>
  );
}
