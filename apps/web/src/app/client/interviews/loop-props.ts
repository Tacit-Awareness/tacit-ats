import type { clientTools } from "@tacit-ats/core";
import { RECOMMENDATION_LABEL, verdictOf, type Recommendation } from "@/lib/client/interview-groups";
import { loopRounds, routeView, stageIsOpen } from "@/lib/client/interview-loop";
import type { InterviewRoute } from "@/lib/client/interviews";
import { ago } from "@/lib/client/pipeline-columns";
import type { FeedbackCard, LoopProps } from "./view";

// The loop and the feedback as props, pure: the Interviews reader's, and the
// Inbox's whole ticket for a decision, draw the same two blocks.

export function loopProps(input: {
  candidate: string;
  jobTitle: string;
  progress: clientTools.PlanProgress;
  /** The round being read: outlined, and where "Round n of m" comes from. */
  selectedId: string;
  listed: ReadonlySet<string>;
  href: (interviewId: string) => string;
  stage: string | null;
  routing: InterviewRoute | null;
  isAdmin: boolean;
  now: number;
}): LoopProps {
  const { progress, stage, routing, now } = input;
  const rounds = loopRounds(progress, input.selectedId, input.listed, now, stageIsOpen(stage)).map(({ interviewId, ...r }) => ({ ...r, href: interviewId ? input.href(interviewId) : null }));
  const route = routing && progress.seesAllInterviews ? routeView({ ...routing, rounds, stepCount: progress.steps.length, stage }) : null;
  const current = rounds.find((r) => r.place === "current");
  const held = rounds.filter((r) => r.status === "Held").length;
  return {
    candidate: input.candidate,
    tag: route?.tag ?? (current ? `Round ${current.n} of ${rounds.length}` : `${rounds.length} rounds`),
    loopLine: `${input.jobTitle} · ${held} of ${rounds.length} ${rounds.length === 1 ? "round" : "rounds"} held`,
    rounds,
    route,
    // As design/tats's processTree: always there for an admin, with or without the graph. Before
    // anything is saved, or while this job's plan doesn't match, the sheet is where they fix that.
    editProcess: input.isAdmin ? "/client/onboarding/process" : null,
    partial: !progress.seesAllInterviews,
  };
}

export function feedbackCards(summary: clientTools.FeedbackSummary, now: number): FeedbackCard[] {
  return summary.feedback.map((f) => ({
    feedbackId: f.feedbackId,
    interviewer: f.mine ? "You" : (f.interviewer ?? "Someone"),
    recommendation: RECOMMENDATION_LABEL[f.recommendation as Recommendation] ?? f.recommendation,
    verdict: verdictOf([f.recommendation]),
    rating: f.rating,
    submitted: `Filed ${ago(f.submittedAt, now)}`,
    ratings: f.ratings.map((r) => ({ attribute: r.attribute ?? "Scorecard item", rating: r.rating, note: r.note })),
    notes: f.notes,
  }));
}
