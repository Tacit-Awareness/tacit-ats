import { cn } from "@/lib/utils";

// What the Interviewers table and a person's pop-up say about one interviewer,
// in the words a recruiter uses, shared by the server-rendered rows (view.tsx)
// and the pop-up (profile-editor.tsx, a client component), so this file has no
// directive and no server-only imports. Every number carries its label or sits
// under a heading that is one; a week reads against their weekly limit when
// they set one ("2 of 4" beside a short meter), as "1 interview" when not, and
// a week over the limit is red. An empty week is a faint "None".

export type Feedback = { onTime: number; late: number; notFiled: number; notVisible: number };

/** What the pop-up shows beyond the profile: the row's counts and every job. */
export type PersonFacts = {
  jobs: string[];
  thisWeek: number;
  nextWeek: number;
  last30: number;
  /** Null: nothing ended in the last 30 days that they owe feedback on. */
  feedback: Feedback | null;
  /** Whether the member may read feedback at all (admins, and whoever manages a job). */
  feedbackShown: boolean;
  /** "Away through Nov 14". Null when they are not away. */
  away: string | null;
};

/** A week's interviews: "2 of 4" against a limit, "2 interviews" without one, "None" for an empty week with no limit. */
export const booked = (n: number, cap: number | null): string =>
  cap !== null ? `${n} of ${cap}` : n === 0 ? "None" : `${n} ${n === 1 ? "interview" : "interviews"}`;

/** Booked past their weekly limit: the week's one red. */
export const overLimit = (n: number, cap: number | null) => cap !== null && n > cap;

/**
 * The hover title of a week's count. `cap` undefined: the member may not read
 * their profile, so nothing is said about a limit. `away`, "Away through Nov
 * 18", is said after it.
 */
export function bookedTitle(n: number, cap: number | null | undefined, week: "this week" | "next week", away?: string | null): string {
  const count = `${n} ${n === 1 ? "interview" : "interviews"} ${week}, Monday to Sunday (UTC)`;
  const said = cap === undefined ? count : cap === null ? `${count}. No weekly limit set.` : n > cap ? `${count}, over their weekly limit of ${cap}.` : n === cap ? `${count}, their weekly limit.` : `${count}. Their weekly limit is ${cap}.`;
  return away ? `${said} ${away}.` : said;
}

/**
 * Testbench's `.meter`: a short rounded track, filled as far as the week is
 * booked against the limit. A limit of 0 reads as full. Ink, red over the
 * limit, and grey (Testbench's `.meter.soft`) while they are away, so an away
 * week's empty track doesn't read as room to book.
 */
export function Meter({ n, cap, away = false }: { n: number; cap: number; away?: boolean }) {
  const share = cap === 0 ? 1 : Math.min(n, cap) / cap;
  const fill = overLimit(n, cap) ? "bg-negative" : away ? "bg-[color:var(--ink-4)]" : "bg-[color:var(--ink)]";
  return (
    <span aria-hidden className="relative h-1.5 w-10 shrink-0 overflow-hidden rounded-[3px] bg-[color:var(--soft-strong)]">
      <i className={cn("absolute inset-y-0 left-0 rounded-[3px]", fill)} style={{ width: `${share * 100}%` }} />
    </span>
  );
}

/**
 * A week's count, with its meter when there is a limit and `meter` is on. The
 * count's slot is as wide as "12 of 20", so the meters line up down a column.
 * An empty week is faint, a week over the limit red.
 */
export function Week({ n, cap, meter = true, away = false, title }: { n: number; cap: number | null; meter?: boolean; away?: boolean; title?: string }) {
  const bar = meter && cap !== null;
  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap tabular-nums" title={title}>
      <span className={cn(bar && "min-w-[8ch]", overLimit(n, cap) ? "text-negative" : n === 0 && "text-faint")}>{booked(n, cap)}</span>
      {bar ? <Meter n={n} cap={cap} away={away} /> : null}
    </span>
  );
}

/** Skills as Testbench's outlined chips, each its own, since one can hold a comma. */
export function SkillTags({ areas }: { areas: string[] }) {
  return (
    <ul className="m-0 flex min-w-0 list-none flex-wrap gap-1.5 p-0">
      {areas.map((a) => (
        <li key={a} className="inline-flex min-h-[26px] max-w-full items-center rounded-[6px] px-[9px] py-0.5 text-[12.5px] shadow-[inset_0_0_0_1px_var(--line-strong)] [overflow-wrap:anywhere]">
          {a}
        </li>
      ))}
    </ul>
  );
}

/** Feedback owed in the window: filed on time, filed late, or not filed yet (hidden ones are unknown, so not counted). */
export const feedbackDue = (f: Feedback) => f.onTime + f.late + f.notFiled;

/** "1 of 3 on time": how much of what they owed came in on time, the row's and the pop-up's words. */
export const onTimeText = (f: Feedback) => `${f.onTime} of ${feedbackDue(f)} on time`;

/** The feedback cell's hover title: every count, in words. */
export function feedbackTitle(f: Feedback): string {
  const parts = [`${f.onTime} on time`, `${f.late} filed late`, `${f.notFiled} not filed`];
  if (f.notVisible > 0) parts.push(`${f.notVisible} hidden from you by your company's feedback setting`);
  return `Interviews that ended in the last 30 days: ${parts.join(", ")}. On time is within 24 hours of the interview's end.`;
}

/**
 * The first of a list and how many more, "Founding Engineer, Infra and 1 more",
 * the whole list in the hover title, one a line. A title can hold a comma, so
 * the list is never joined into one line on screen. It wraps between words
 * only: a word wider than the column ends in an ellipsis rather than breaking
 * across lines ("Infrastructu…"), and "and 1 more" stays whole. Nothing when
 * it is empty.
 */
export function FirstAndMore({ items, className }: { items: string[]; className?: string }) {
  if (!items.length) return null;
  return (
    <span className={cn("block min-w-0 overflow-hidden text-ellipsis [overflow-wrap:normal]", className)} title={items.join("\n")}>
      {items[0]}
      {items.length > 1 ? (
        <>
          {" "}
          <span className="whitespace-nowrap text-faint">and {items.length - 1} more</span>
        </>
      ) : null}
    </span>
  );
}
