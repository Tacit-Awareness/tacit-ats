import type { clientTools } from "@tacit-ats/core";
import { ago, until } from "./pipeline-columns";

// The reader's loop, from core's getInterviewPlan: the job's plan steps in
// order, then any interview off the plan by date, each a round with who ran it
// and whether they filed. Pure, so the page and the tests share it. Who filed,
// never what: the feedback itself is getFeedback's.

type PlanInterview = clientTools.PlanInterview;
type FeedbackState = clientTools.FeedbackState;

export type LoopPerson = { name: string; state: string; tone: "done" | "waiting" | "hidden" | "none" };
export type LoopRound = {
  key: string;
  n: number;
  name: string;
  status: string;
  people: LoopPerson[];
  when: string | null;
  /** The interview this round opens in the list, when it is in the list and not the one already open. */
  interviewId: string | null;
  place: "past" | "current" | "later";
  /** The round the candidate reaches next; see loopRounds. */
  next: boolean;
};

function personState(feedback: FeedbackState | null, held: boolean): Pick<LoopPerson, "state" | "tone"> {
  if (feedback === "filed") return { state: "Filed", tone: "done" };
  if (feedback === "hidden") return { state: "Not visible to you", tone: "hidden" };
  return held ? { state: "Not filed", tone: "waiting" } : { state: "Booked", tone: "none" };
}

const isHeld = (i: PlanInterview, now: number) => i.status === "done" || (i.status === "scheduled" && Date.parse(i.endsAt) < now);

/** The round's interview to show: the latest one not cancelled, else the latest. */
function lead(interviews: PlanInterview[]): PlanInterview | null {
  const live = interviews.filter((i) => i.status !== "cancelled");
  const pick = live.length ? live : interviews;
  return pick.length ? pick.reduce((a, b) => (Date.parse(b.startsAt) > Date.parse(a.startsAt) ? b : a)) : null;
}

type RawRound = Pick<LoopRound, "key" | "name" | "status" | "people" | "when"> & { ids: string[]; leadId: string | null };

function round(key: string, name: string, interviews: PlanInterview[], fallback: string, now: number): RawRound {
  const i = lead(interviews);
  if (!i) return { key, name, status: fallback, people: [], when: null, ids: [], leadId: null };
  const held = isHeld(i, now);
  const status = i.status === "cancelled" ? "Cancelled" : held ? "Held" : "Booked";
  const people = i.status === "cancelled" ? [] : i.interviewers.map((p) => ({ name: p.name ?? "Someone", ...personState(p.feedback, held) }));
  const when = held || i.status === "cancelled" ? ago(i.startsAt, now) : until(i.startsAt, now);
  return { key, name, status, people, when, ids: interviews.map((x) => x.interviewId), leadId: i.interviewId };
}

const STEP_STATUS: Record<clientTools.StepState, string> = {
  not_scheduled: "Not booked",
  not_visible: "Not yours",
  scheduled: "Booked",
  done: "Held",
  cancelled: "Cancelled",
};

/** Application stages that end the loop: nobody has a next round after these. */
const CLOSED_STAGES: ReadonlySet<string> = new Set(["hired", "rejected", "withdrawn"]);
export const stageIsOpen = (stage: string | null | undefined) => !!stage && !CLOSED_STAGES.has(stage);

const STILL_TO_HAPPEN: ReadonlySet<string> = new Set(["Booked", STEP_STATUS.not_scheduled]);

/**
 * `open` is whether the application is still going. The next round is the first,
 * left to right, still to happen: booked or not booked yet, as design/tats does.
 * A cancelled round is not it, and a member who sees only their own rounds gets
 * none, since one they cannot see may come first.
 */
export function loopRounds(
  progress: clientTools.PlanProgress,
  selectedId: string,
  listed: ReadonlySet<string>,
  now: number,
  open: boolean,
): LoopRound[] {
  const raw = [
    ...progress.steps.map((s) => round(`step-${s.position}`, s.step, s.interviews, STEP_STATUS[s.state], now)),
    ...[...progress.offPlan]
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
      .map((i) => round(`iv-${i.interviewId}`, i.step ?? "Interview", [i], "", now)),
  ];
  const current = raw.findIndex((r) => r.ids.includes(selectedId));
  const next = open && progress.seesAllInterviews ? raw.findIndex((r) => STILL_TO_HAPPEN.has(r.status)) : -1;
  return raw.map(({ ids: _ids, leadId, ...r }, n) => ({
    ...r,
    n: n + 1,
    interviewId: leadId && leadId !== selectedId && listed.has(leadId) ? leadId : null,
    place: current < 0 || n < current ? "past" : n === current ? "current" : "later",
    next: n === next,
  }));
}

/** Interviewers on this interview whose feedback the member cannot see. */
export function hiddenOn(progress: clientTools.PlanProgress, interviewId: string): number {
  const all = [...progress.steps.flatMap((s) => s.interviews), ...progress.offPlan];
  return all.find((i) => i.interviewId === interviewId)?.interviewers.filter((p) => p.feedback === "hidden").length ?? 0;
}
