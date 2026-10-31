import type { StalledReason } from "@tacit/core";
import { ago, lastInterviewAt, type ColumnKey, type InterviewTimes } from "./pipeline-columns";

// The Inbox's queue (design/tats's #inbox): what is stuck and waiting on
// someone, computed from what the pages already read. No issue is stored: one
// leaves the queue by being dealt with, or for this member alone by a row in
// inbox_dismissals naming that one instance (IssueInstance). An application
// shows at most one issue, the first that holds and isn't dismissed of:
// feedback outstanding, the next action overdue, the team's call waiting,
// nobody touching it. So setting one aside never hides the next thing wrong
// with them. A pending approval takes the place of its application's issue.
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

export const issueKind = (reason: IssueReason): IssueKind => KIND[reason];
export const isIssueReason = (v: unknown): v is IssueReason => typeof v === "string" && Object.hasOwn(KIND, v);

/**
 * One instance of an issue, what a dismissal names. `key` alone is the same for
 * every issue an application ever has; the reason and when it started tell them
 * apart, so a later one is not hidden by this one's dismissal.
 */
export type IssueInstance = { key: string; reason: IssueReason; at: string };

/** As instants, not strings: a timestamp comes back from Postgres in its own format. */
export const instanceId = (i: IssueInstance) => `${i.key}|${i.reason}|${Date.parse(i.at)}`;

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
  applicationId: string | null;
  toEmail: string;
  subject: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

/** What makes a draft out of date: a newer email by the same member on the same application. */
export type LaterEmail = { applicationId: string; createdAt: string };

/**
 * The drafts still worth a place in the queue. A draft can't be changed or
 * discarded (the database's "an email does not change once drafted"), so
 * changing one writes another. The older one stays a draft for good, and is
 * dropped here: once a newer draft, or an email sent, exists for that
 * application, it is out of date and must not be offered to send. A draft on no
 * application is never out of date.
 */
export function currentDrafts<T extends { applicationId: string | null; createdAt: string }>(drafts: T[], later: LaterEmail[]): T[] {
  const newest = new Map<string, number>();
  for (const e of [...later, ...drafts]) {
    if (e.applicationId) newest.set(e.applicationId, Math.max(newest.get(e.applicationId) ?? 0, Date.parse(e.createdAt)));
  }
  return drafts.filter((d) => !d.applicationId || Date.parse(d.createdAt) >= (newest.get(d.applicationId) ?? 0));
}

export type Issue = {
  /** Stable while the issue stands: `?i=` in the URL, so ids only. */
  key: string;
  kind: IssueKind;
  reason: IssueReason;
  /** Which instance this is, what a dismissal names: a new wait gets a new one. */
  at: string;
  /** When it started waiting, where that isn't `at`. Read it with waitingSince. */
  since?: string;
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
  /** An approval: the request to decide. Its terms are never here: readIssue fetches them for the one open. */
  approval: { requestId: string; kind: InboxApproval["kind"] } | null;
  draft: InboxDraft | null;
};

/** For the order and the row's age. */
export const waitingSince = (i: Pick<Issue, "at" | "since">) => i.since ?? i.at;

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * Worded from the oldest missing, the most overdue, but `at` is the newest: a
 * dismissal of the first round's must not hide the next round's, by someone else.
 */
function feedbackIssue(missing: InboxOutstanding[], now: number): Partial<Issue> {
  const ended = [...missing].sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt));
  const oldest = ended[0]!;
  const people = [...new Set(missing.map((m) => m.interviewerName ?? "An interviewer"))];
  const one = people.length === 1 ? people[0]! : null;
  return {
    reason: "feedback",
    at: ended.at(-1)!.endsAt,
    since: oldest.endsAt,
    what: one ? `${one === "An interviewer" ? one : firstName(one)} hasn't sent feedback` : `${people.length} interviewers haven't sent feedback`,
    why: `Interview ended ${ago(oldest.endsAt, now)}`,
    who: one === "An interviewer" ? null : one,
    interviewId: oldest.interviewId,
  };
}

/** What holds for an application, most pressing first. */
function applicationIssues(card: InboxCard, missing: InboxOutstanding[], now: number): Issue[] {
  const found: Partial<Issue>[] = [];
  if (missing.length) found.push(feedbackIssue(missing, now));
  if (card.stalled.includes("overdue") && card.nextActionDue) {
    const at = `${card.nextActionDue}T00:00:00Z`;
    found.push({
      reason: "overdue",
      at,
      what: card.nextAction ? `Overdue: ${card.nextAction}` : "Next action overdue",
      why: `Was due ${ago(at, now)}`,
      who: card.nextActionOwnerName ?? card.ownerName,
      nextAction: card.nextAction,
    });
  }
  if (card.column === "decide") {
    const at = lastInterviewAt(card.interviews, now) ?? card.lastTouchAt;
    found.push({ reason: "decide", at, what: `Decide on ${card.personName}`, why: `Interviewed ${ago(at, now)}, nothing booked next`, who: null });
  }
  if (card.stalled.includes("no_touch")) {
    found.push({ reason: "quiet", at: card.lastTouchAt, what: "Nobody has been in touch", why: `Last touched ${ago(card.lastTouchAt, now)}`, who: card.ownerName });
  }
  return found.map((f) => ({
    key: `app-${card.applicationId}`,
    kind: KIND[f.reason!],
    reason: f.reason!,
    at: f.at!,
    since: f.since,
    what: f.what!,
    why: f.why!,
    who: f.who ?? null,
    candidate: { id: card.personId, name: card.personName },
    job: { id: card.roleId, title: card.roleTitle },
    applicationId: card.applicationId,
    interviewId: f.interviewId ?? null,
    nextAction: f.nextAction ?? null,
    approval: null,
    draft: null,
  }));
}

/**
 * The request keeps one date through its steps, so this moves it on a
 * millisecond a step: reaching this approver again at a later step is a new
 * wait, and a dismissal at the earlier one must not hide it.
 */
const approvalAt = (a: InboxApproval) => (a.waitingStep > 1 ? new Date(Date.parse(a.requestedAt) + a.waitingStep - 1).toISOString() : a.requestedAt);

function approvalIssue(a: InboxApproval): Issue {
  return {
    key: `appr-${a.requestId}`,
    kind: "decide",
    reason: "approval",
    at: approvalAt(a),
    since: a.requestedAt,
    what: a.kind === "offer" ? `Approve the offer for ${a.candidateName ?? "this candidate"}` : `Approve opening ${a.jobTitle}`,
    why: a.steps > 1 ? `Your approval, step ${a.waitingStep} of ${a.steps}` : "Your approval",
    who: a.requestedBy,
    candidate: a.candidateId ? { id: a.candidateId, name: a.candidateName ?? "This candidate" } : null,
    job: { id: a.jobId, title: a.jobTitle },
    applicationId: a.applicationId,
    interviewId: null,
    nextAction: null,
    approval: { requestId: a.requestId, kind: a.kind },
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
    approval: null,
    draft: d,
  };
}

export type InboxInput = { cards: InboxCard[]; outstanding: InboxOutstanding[]; approvals: InboxApproval[]; drafts: InboxDraft[] };

function missingByApplication(outstanding: InboxOutstanding[]) {
  const missing = new Map<string, InboxOutstanding[]>();
  for (const o of outstanding) missing.set(o.applicationId, [...(missing.get(o.applicationId) ?? []), o]);
  return missing;
}

const lateDrafts = (drafts: InboxDraft[], now: number) => drafts.filter((d) => now - Date.parse(d.updatedAt) > DRAFT_LATE_MS).map(draftIssue);

/**
 * Everything that holds right now, dismissed or not, including what a more
 * pressing issue on the same application stands in front of: what a dismissal
 * can match, and what the Done tab asks to tell "set aside" from "gone since".
 */
export function standingIssues(input: InboxInput, now: number): Issue[] {
  const missing = missingByApplication(input.outstanding);
  return [
    ...lateDrafts(input.drafts, now),
    ...input.cards.flatMap((c) => applicationIssues(c, missing.get(c.applicationId) ?? [], now)),
    ...input.approvals.map(approvalIssue),
  ];
}

/**
 * The queue: unsent drafts, then overdue, then decisions, newest first in each,
 * as the prototype sorts. `dismissed` is instanceId()s: only those instances go,
 * so a dismissed approval gives its place back to its application's issue, and
 * a dismissed issue to the next that holds.
 */
export function inboxIssues(input: InboxInput, now: number, dismissed: ReadonlySet<string> = new Set()): Issue[] {
  const kept = (i: Issue) => !dismissed.has(instanceId(i));
  const missing = missingByApplication(input.outstanding);
  const approvals = input.approvals.map(approvalIssue).filter(kept);
  const approving = new Set(approvals.map((a) => a.applicationId));

  const issues = [
    ...lateDrafts(input.drafts, now).filter(kept),
    ...input.cards.filter((c) => !approving.has(c.applicationId)).flatMap((c) => applicationIssues(c, missing.get(c.applicationId) ?? [], now).find(kept) ?? []),
    ...approvals,
  ];
  const rank = (i: Issue) => ISSUE_KINDS.findIndex((k) => k.key === i.kind);
  return issues.sort((a, b) => rank(a) - rank(b) || Date.parse(waitingSince(b)) - Date.parse(waitingSince(a)));
}

/** The row's second line: who it waits on, the candidate unless the heading names them, and why. */
export function issueLine(i: Issue): string {
  const candidate = i.candidate && !i.what.includes(i.candidate.name) ? i.candidate.name : null;
  return [i.who, candidate, i.why].filter(Boolean).join(" · ");
}

/** Who the pop-up opens: the one asked for. Nobody asked, or one that has gone, is the card alone: the first in line doesn't throw up a pop-up. */
export const selectedIssue = (issues: Issue[], key: string | null | undefined): Issue | null => issues.find((i) => i.key === key) ?? null;

/** Who to open once this one is dealt with: the one below it, else the one above. */
export function nextIssue(issues: Issue[], key: string): Issue | null {
  const i = issues.findIndex((x) => x.key === key);
  if (i < 0) return null;
  return issues[i + 1] ?? issues[i - 1] ?? null;
}

/**
 * The one thing that deals with an issue: a write the member may make here,
 * the page that has it, or a decision (A / O / R, each confirmed first:
 * inbox/decision-bar.tsx).
 */
export type IssueFix =
  | { type: "write"; write: "done" | "touch"; label: string; applicationId: string; /** What "Mark it done" clears, so a changed one is left alone. */ nextAction: string | null }
  | { type: "link"; label: string; href: string }
  | { type: "approval"; requestId: string; kind: InboxApproval["kind"] }
  /** An unsent draft: Send here, always after a dialog showing it. `canSend` false: no mailer here, so the button is off and says why. */
  | { type: "send"; label: string; draftId: string; canSend: boolean }
  | { type: "decide"; applicationId: string; /** Where A goes: booking a round isn't in the web app, so it is their page. */ nextRoundHref: string };

const candidateHref = (i: Issue) => (i.candidate ? `/client/candidates/${i.candidate.id}` : i.job.id ? `/client/jobs/${i.job.id}` : "/client/pipeline");

export function issueFix(i: Issue, canEdit: boolean, canSend = false): IssueFix {
  if (i.draft) return { type: "send", label: "Send here", draftId: i.draft.draftId, canSend };
  if (i.reason === "overdue" && canEdit && i.applicationId) return { type: "write", write: "done", label: "Mark it done", applicationId: i.applicationId, nextAction: i.nextAction };
  if (i.reason === "quiet" && canEdit && i.applicationId) return { type: "write", write: "touch", label: "Log a touch", applicationId: i.applicationId, nextAction: null };
  if (i.reason === "feedback" && i.interviewId) return { type: "link", label: "Open the interview", href: `/client/interviews?i=${i.interviewId}` };
  if (i.approval) return { type: "approval", requestId: i.approval.requestId, kind: i.approval.kind };
  if (i.reason === "decide" && canEdit && i.applicationId) return { type: "decide", applicationId: i.applicationId, nextRoundHref: candidateHref(i) };
  if (i.reason === "decide") return { type: "link", label: "Decide", href: candidateHref(i) };
  return { type: "link", label: "Open candidate", href: candidateHref(i) };
}

/** The page behind the issue as a second way out, when the fix is not already it and the member can open it. */
export function secondaryLink(i: Issue, fix: IssueFix, canOpen = true): { label: string; href: string } | null {
  if (fix.type === "decide" || !canOpen) return null;
  if (!i.candidate) return fix.type === "approval" ? { label: "Open the job", href: candidateHref(i) } : null;
  const href = candidateHref(i);
  return fix.type === "link" && fix.href === href ? null : { label: "Open candidate", href };
}
