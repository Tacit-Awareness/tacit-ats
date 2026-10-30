import type { StalledReason } from "@tacit/core";
import { ago, lastInterviewAt, type ColumnKey, type InterviewTimes } from "./pipeline-columns";

// The Inbox's queue (design/tats's #inbox): what is stuck and waiting on
// someone, computed from what the pages already read. No issue is stored, so
// one leaves the queue by being dealt with, never by being marked. An
// application has at most one issue, the first that holds of: feedback
// outstanding, the next action overdue, the team's call waiting, nobody
// touching it. A pending approval takes the place of its application's issue.
// Pure: lib/client/inbox.ts reads, this sorts and words. Next-action text,
// names and a draft's subject are plain text, never markup.

export const ISSUE_KINDS = [
  { key: "draft", label: "Unsent drafts" },
  { key: "late", label: "Overdue" },
  { key: "decide", label: "Decisions" },
] as const;

export type IssueKind = (typeof ISSUE_KINDS)[number]["key"];
export type IssueReason = "draft" | "feedback" | "overdue" | "quiet" | "decide" | "approval";

/** A draft older than this is forgotten, not being written (the prototype's two hours for an invite). */
export const DRAFT_LATE_MS = 2 * 3_600_000;

const KIND: Record<IssueReason, IssueKind> = { draft: "draft", feedback: "late", overdue: "late", quiet: "late", decide: "decide", approval: "decide" };

/** A live application on an open job, as the Pipeline board reads it. */
export type InboxCard = {
  applicationId: string;
  personId: string;
  personName: string;
  roleId: string;
  roleTitle: string;
  column: ColumnKey;
  ownerName: string | null;
  lastTouchAt: string;
  nextAction: string | null;
  nextActionDue: string | null;
  nextActionOwnerName: string | null;
  stalled: StalledReason[];
  interviews: InterviewTimes[];
};

/** One interviewer's missing feedback, from core's interviewerActivity. Whether, never what. */
export type InboxOutstanding = { interviewId: string; applicationId: string; interviewerName: string | null; endsAt: string };

/** An approval waiting on this member, from core's listMyApprovals, without the offer's terms. */
export type InboxApproval = {
  requestId: string;
  kind: "offer" | "job_open";
  jobId: string;
  jobTitle: string;
  applicationId: string | null;
  candidateId: string | null;
  candidateName: string | null;
  requestedBy: string | null;
  requestedAt: string;
  waitingStep: number;
  steps: number;
};

/** One of the member's own unsent `candidate_emails`. */
export type InboxDraft = {
  draftId: string;
  personId: string;
  personName: string;
  jobTitle: string | null;
  toEmail: string;
  subject: string;
  body: string;
  updatedAt: string;
};

export type Issue = {
  /** Stable while the issue stands: `?i=` in the URL, so ids only. */
  key: string;
  kind: IssueKind;
  reason: IssueReason;
  /** When it started waiting, for the order and the row's age. */
  at: string;
  /** The row's and the reader's heading. */
  what: string;
  why: string;
  /** Who it is waiting on, when that is someone. */
  who: string | null;
  candidate: { id: string; name: string } | null;
  job: { id: string | null; title: string | null };
  applicationId: string | null;
  /** Feedback: the interview to open, the first one outstanding. */
  interviewId: string | null;
  /** Overdue: the next action as written. */
  nextAction: string | null;
  draft: InboxDraft | null;
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

function feedbackIssue(missing: InboxOutstanding[], now: number): Partial<Issue> {
  const oldest = [...missing].sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt))[0]!;
  const people = [...new Set(missing.map((m) => m.interviewerName ?? "An interviewer"))];
  const one = people.length === 1 ? people[0]! : null;
  return {
    reason: "feedback",
    at: oldest.endsAt,
    what: one ? `${one === "An interviewer" ? one : firstName(one)} hasn't sent feedback` : `${people.length} interviewers haven't sent feedback`,
    why: `Interview ended ${ago(oldest.endsAt, now)}`,
    who: one === "An interviewer" ? null : one,
    interviewId: oldest.interviewId,
  };
}

function applicationIssue(card: InboxCard, missing: InboxOutstanding[], now: number): Issue | null {
  let found: Partial<Issue> | null = null;
  if (missing.length) {
    found = feedbackIssue(missing, now);
  } else if (card.stalled.includes("overdue") && card.nextActionDue) {
    const at = `${card.nextActionDue}T00:00:00Z`;
    found = {
      reason: "overdue",
      at,
      what: card.nextAction ? `Overdue: ${card.nextAction}` : "Next action overdue",
      why: `Was due ${ago(at, now)}`,
      who: card.nextActionOwnerName ?? card.ownerName,
      nextAction: card.nextAction,
    };
  } else if (card.column === "decide") {
    const at = lastInterviewAt(card.interviews, now) ?? card.lastTouchAt;
    found = { reason: "decide", at, what: `Decide on ${card.personName}`, why: `Interviewed ${ago(at, now)}, nothing booked next`, who: null };
  } else if (card.stalled.includes("no_touch")) {
    found = { reason: "quiet", at: card.lastTouchAt, what: "Nobody has been in touch", why: `Last touched ${ago(card.lastTouchAt, now)}`, who: card.ownerName };
  }
  if (!found) return null;
  return {
    key: `app-${card.applicationId}`,
    kind: KIND[found.reason!],
    reason: found.reason!,
    at: found.at!,
    what: found.what!,
    why: found.why!,
    who: found.who ?? null,
    candidate: { id: card.personId, name: card.personName },
    job: { id: card.roleId, title: card.roleTitle },
    applicationId: card.applicationId,
    interviewId: found.interviewId ?? null,
    nextAction: found.nextAction ?? null,
    draft: null,
  };
}

function approvalIssue(a: InboxApproval): Issue {
  return {
    key: `appr-${a.requestId}`,
    kind: "decide",
    reason: "approval",
    at: a.requestedAt,
    what: a.kind === "offer" ? `Approve the offer for ${a.candidateName ?? "this candidate"}` : `Approve opening ${a.jobTitle}`,
    why: a.steps > 1 ? `Your approval, step ${a.waitingStep} of ${a.steps}` : "Your approval",
    who: a.requestedBy,
    candidate: a.candidateId ? { id: a.candidateId, name: a.candidateName ?? "This candidate" } : null,
    job: { id: a.jobId, title: a.jobTitle },
    applicationId: a.applicationId,
    interviewId: null,
    nextAction: null,
    draft: null,
  };
}

function draftIssue(d: InboxDraft): Issue {
  return {
    key: `draft-${d.draftId}`,
    kind: "draft",
    reason: "draft",
    at: d.updatedAt,
    what: `Draft to ${d.personName} not sent`,
    why: d.subject,
    who: null,
    candidate: { id: d.personId, name: d.personName },
    job: { id: null, title: d.jobTitle },
    applicationId: null,
    interviewId: null,
    nextAction: null,
    draft: d,
  };
}

/** The whole queue: unsent drafts, then overdue, then decisions, newest first in each, as the prototype sorts. */
export function inboxIssues(
  input: { cards: InboxCard[]; outstanding: InboxOutstanding[]; approvals: InboxApproval[]; drafts: InboxDraft[] },
  now: number,
): Issue[] {
  const missing = new Map<string, InboxOutstanding[]>();
  for (const o of input.outstanding) missing.set(o.applicationId, [...(missing.get(o.applicationId) ?? []), o]);
  const approving = new Set(input.approvals.map((a) => a.applicationId));

  const issues = [
    ...input.drafts.filter((d) => now - Date.parse(d.updatedAt) > DRAFT_LATE_MS).map(draftIssue),
    ...input.cards.filter((c) => !approving.has(c.applicationId)).flatMap((c) => applicationIssue(c, missing.get(c.applicationId) ?? [], now) ?? []),
    ...input.approvals.map(approvalIssue),
  ];
  const rank = (i: Issue) => ISSUE_KINDS.findIndex((k) => k.key === i.kind);
  return issues.sort((a, b) => rank(a) - rank(b) || Date.parse(b.at) - Date.parse(a.at));
}

/** The row's second line: who it waits on, the candidate unless the heading names them, and why. */
export function issueLine(i: Issue): string {
  const candidate = i.candidate && !i.what.includes(i.candidate.name) ? i.candidate.name : null;
  return [i.who, candidate, i.why].filter(Boolean).join(" · ");
}

/** Who the page opens: the one asked for, else the first. */
export const selectedIssue = (issues: Issue[], key: string | null | undefined): Issue | null => issues.find((i) => i.key === key) ?? issues[0] ?? null;

/** Who to open once this one is dealt with: the one below it, else the one above. */
export function nextIssue(issues: Issue[], key: string): Issue | null {
  const i = issues.findIndex((x) => x.key === key);
  if (i < 0) return null;
  return issues[i + 1] ?? issues[i - 1] ?? null;
}

/** The one thing that deals with an issue: a write the member may make here, or the page that has it. */
export type IssueFix = { type: "write"; write: "done" | "touch"; label: string; applicationId: string; /** What "Mark it done" clears, so a changed one is left alone. */ nextAction: string | null } | { type: "link"; label: string; href: string };

const candidateHref = (i: Issue) => (i.candidate ? `/client/candidates/${i.candidate.id}` : i.job.id ? `/client/jobs/${i.job.id}` : "/client/pipeline");

export function issueFix(i: Issue, canEdit: boolean): IssueFix {
  if (i.reason === "overdue" && canEdit && i.applicationId) return { type: "write", write: "done", label: "Mark it done", applicationId: i.applicationId, nextAction: i.nextAction };
  if (i.reason === "quiet" && canEdit && i.applicationId) return { type: "write", write: "touch", label: "Log a touch", applicationId: i.applicationId, nextAction: null };
  if (i.reason === "feedback" && i.interviewId) return { type: "link", label: "Open the interview", href: `/client/interviews?i=${i.interviewId}` };
  if (i.reason === "decide") return { type: "link", label: "Decide", href: candidateHref(i) };
  if (i.reason === "approval" && !i.candidate) return { type: "link", label: "Open the job", href: candidateHref(i) };
  return { type: "link", label: "Open candidate", href: candidateHref(i) };
}

/** The candidate's page as a second way out, when the fix is not already it. */
export function secondaryHref(i: Issue, fix: IssueFix): string | null {
  if (!i.candidate) return null;
  const href = candidateHref(i);
  return fix.type === "link" && fix.href === href ? null : href;
}
