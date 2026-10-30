// The Pipeline board's columns (design/tats's board: New, With Grokbots,
// Interview booked, Your call), computed from what the database records: an
// application's stage, and for `interviewing` its interviews. No column is
// stored, so a column can never disagree with the stage behind it. Pure: the
// page reads, this sorts.

export const PIPELINE_COLUMNS = [
  { key: "new", label: "New" },
  { key: "screening", label: "Screening" },
  { key: "scheduling", label: "Scheduling" },
  { key: "booked", label: "Interview booked" },
  { key: "decide", label: "Your call" },
  { key: "offer", label: "Offer" },
] as const;

export type ColumnKey = (typeof PIPELINE_COLUMNS)[number]["key"];

export const isColumnKey = (v: unknown): v is ColumnKey => PIPELINE_COLUMNS.some((c) => c.key === v);

/**
 * Why a card cannot be dropped on a column that only its interviews fill: no
 * stage puts it there. Every other column has a stage behind it.
 */
export const NO_DROP: Partial<Record<ColumnKey, string>> = {
  scheduling: "Scheduling is for candidates with no interview booked or held.",
  booked: "Candidates land here once an interview is booked.",
  decide: "Candidates land here once an interview has been held.",
};

/** One of an application's interviews, as the board needs it. */
export type InterviewTimes = { startsAt: string; endsAt: string; status: string };

/** A scheduled interview that has not ended yet (one under way counts). */
const upcoming = (i: InterviewTimes, now: number) => i.status === "scheduled" && Date.parse(i.endsAt) > now;
/** Marked done, or scheduled and over: nobody marks every interview done. */
const held = (i: InterviewTimes, now: number) => i.status === "done" || (i.status === "scheduled" && Date.parse(i.endsAt) <= now);

/**
 * Where an application sits on the board, or null when it is closed (hired,
 * rejected, withdrawn), which the board leaves out. While `interviewing`:
 * anything booked ahead wins (the next round is set), else interviews held
 * mean the decision is the team's, else an interviewer is still being found.
 * A cancelled interview counts for nothing.
 */
export function columnOf(stage: string, interviews: InterviewTimes[], now: number): ColumnKey | null {
  switch (stage) {
    case "sourced":
    case "contacted":
      return "new";
    case "screening":
      return "screening";
    case "offer":
      return "offer";
    case "interviewing":
      if (interviews.some((i) => upcoming(i, now))) return "booked";
      if (interviews.some((i) => held(i, now))) return "decide";
      return "scheduling";
    default:
      return null;
  }
}

/** The next interview's start, for "Interview in 2d". */
export function nextInterviewAt(interviews: InterviewTimes[], now: number): string | null {
  const next = interviews.filter((i) => upcoming(i, now)).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  return next?.startsAt ?? null;
}

/** When the last held interview ended, for "Interviewed 3d ago". */
export function lastInterviewAt(interviews: InterviewTimes[], now: number): string | null {
  const last = interviews.filter((i) => held(i, now)).sort((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt))[0];
  return last?.endsAt ?? null;
}

const DAY = 86_400_000;

/**
 * "in 40m", "in 5h", "in 3d". Relative to the server's `now`, so it is right
 * in every time zone; a clock time would need the member's zone.
 */
export function until(iso: string, now: number): string {
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return "now";
  if (ms < 3_600_000) return `in ${Math.max(1, Math.round(ms / 60_000))}m`;
  if (ms < DAY) return `in ${Math.round(ms / 3_600_000)}h`;
  return `in ${Math.round(ms / DAY)}d`;
}

/** "today", "3d ago", "5w ago", like the job board. */
export function ago(iso: string, now: number): string {
  const days = Math.floor((now - Date.parse(iso)) / DAY);
  if (days < 1) return "today";
  if (days < 14) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}
