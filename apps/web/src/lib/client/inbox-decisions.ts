import { clientTools } from "@tacit-ats/core";
import { idOf, NOTE_MAX, parseMove, textOf, type Fields, type MoveInput } from "./candidate-edit-rules";
import type { Issue, IssueFix } from "./inbox-issues";

// The Inbox's decisions (design/tats's A, O, R), pure: which buttons an issue
// gets, what each confirmation says will happen, the posted fields read back,
// and an offer's terms as lines. On the server only (page.tsx, actions.ts):
// app/client/inbox/decision-bar.tsx takes these as props. The writes are
// lib/client/inbox.ts. Nothing here goes in a URL or a log: a reason, a note
// and an offer's terms stay on the page and in the database.

/** The stage the team's call stands on: "Your call" is an interviewing application (pipeline-columns.ts). */
const DECISION_STAGE = "interviewing";

/** What a dialog posts: on an approval, approve or reject it; on the team's call, move to offer or reject the candidate. */
export type ConfirmMode = "approve" | "reject" | "offer" | "close";

export type ConfirmCopy = { title: string; body: string; confirm: string; danger: boolean };

export type DecisionAction =
  | { key: string; label: string; primary: boolean; mode: ConfirmMode; copy: ConfirmCopy }
  | { key: string; label: string; primary: boolean; href: string };

export type DecisionProps = {
  /** Changes with the issue, so an open dialog never survives a move to the next one. */
  key: string;
  /** The hidden field naming what is decided. */
  target: { name: "requestId" | "applicationId"; value: string };
  actions: DecisionAction[];
  /** The longest reason or note. */
  textMax: number;
  /** The org's reasons a candidate can be rejected for. */
  reasons: { reasonId: string; name: string }[];
};

type Subject = { approval: "offer" | "job_open" | null; candidate: string | null; job: string | null };

/** The dialog's words: exactly what will change, and what won't. */
export function confirmCopy(mode: ConfirmMode, s: Subject): ConfirmCopy {
  const who = s.candidate ?? "this candidate";
  const job = s.job ?? "this job";
  switch (mode) {
    case "approve":
      return s.approval === "job_open"
        ? { title: `Approve opening ${job}?`, body: "This passes your step. After the last step the job can be opened.", confirm: "Approve", danger: false }
        : { title: `Approve the offer for ${who}?`, body: `This passes your step. After the last step the offer can be extended. Nothing is sent to ${who}.`, confirm: "Approve", danger: false };
    case "reject":
      return s.approval === "job_open"
        ? { title: `Reject opening ${job}?`, body: "The job stays as it is. Whoever asked sees your reason and can ask again.", confirm: "Reject", danger: true }
        : { title: `Reject the offer for ${who}?`, body: "The offer stays a draft. Whoever asked sees your reason and can ask again.", confirm: "Reject", danger: true };
    case "offer":
      return { title: `Move ${who} to offer?`, body: `This moves them from Interviewing to Offer on ${job}. No offer is drafted or sent.`, confirm: "Move to offer", danger: false };
    case "close":
      return { title: `Reject ${who}?`, body: `This closes their application for ${job}. No email goes out.`, confirm: "Reject", danger: true };
  }
}

/** The bar for an issue whose fix is a decision, in order. Only a link goes without a confirmation. Null for any other fix. */
export function decisionProps(fix: IssueFix, issue: Pick<Issue, "key" | "candidate" | "job">, reasons: { reasonId: string; name: string }[]): DecisionProps | null {
  const subject = (approval: Subject["approval"]): Subject => ({ approval, candidate: issue.candidate?.name ?? null, job: issue.job.title });
  const textMax = Math.min(clientTools.APPROVAL_REASON_MAX, NOTE_MAX);
  if (fix.type === "approval") {
    const s = subject(fix.kind);
    return {
      key: issue.key,
      target: { name: "requestId", value: fix.requestId },
      textMax,
      reasons: [],
      actions: [
        { key: "a", label: "Approve", primary: true, mode: "approve", copy: confirmCopy("approve", s) },
        { key: "r", label: "Reject", primary: false, mode: "reject", copy: confirmCopy("reject", s) },
      ],
    };
  }
  if (fix.type === "decide") {
    const s = subject(null);
    return {
      key: issue.key,
      target: { name: "applicationId", value: fix.applicationId },
      textMax,
      reasons: reasons.map((r) => ({ reasonId: r.reasonId, name: r.name })),
      actions: [
        { key: "a", label: "Next round", primary: true, href: fix.nextRoundHref },
        { key: "o", label: "Move to offer", primary: false, mode: "offer", copy: confirmCopy("offer", s) },
        { key: "r", label: "Reject", primary: false, mode: "close", copy: confirmCopy("close", s) },
      ],
    };
  }
  return null;
}

export type Decision = { on: "approval"; requestId: string; decision: "approve" | "reject"; reason: string | null } | { on: "application"; move: MoveInput };

/** A decision form, or null for one the page never sent. */
export function parseDecision(f: Fields): Decision | null {
  const decision = f.get("decision");
  if (decision === "approve" || decision === "reject") {
    const requestId = idOf(f, "requestId");
    return requestId ? { on: "approval", requestId, decision, reason: textOf(f, "reason", clientTools.APPROVAL_REASON_MAX) } : null;
  }
  if (decision !== "offer" && decision !== "close") return null;
  const stage = decision === "offer" ? "offer" : "rejected";
  const move = parseMove({ get: (k) => (k === "stage" ? stage : k === "expectedStage" ? DECISION_STAGE : f.get(k)) });
  return move ? { on: "application", move } : null;
}

/** What the page says after a decision on an approval, as a code for inbox/messages.ts. */
export function approvalNotice(outcome: clientTools.DecisionResult["outcome"], kind: clientTools.ApprovalKind) {
  switch (outcome) {
    case "advanced":
      return "approved_step" as const;
    case "approved":
      return kind === "offer" ? ("approved_offer" as const) : ("approved_job" as const);
    case "rejected":
      return kind === "offer" ? ("rejected_offer" as const) : ("rejected_job" as const);
    case "not_pending":
      return "already_decided" as const;
  }
}

export type TermLine = { label: string; value: string };

/** An offer's terms as lines, for the approver's eyes only. The ones not set are left out. */
export function offerTermLines(terms: NonNullable<clientTools.MyApproval["terms"]>): TermLine[] {
  const lines: [string, string | null][] = [
    ["Salary", terms.salary === null ? null : [terms.salary.toLocaleString("en-US"), terms.currency].filter(Boolean).join(" ")],
    ["Bonus", terms.bonus],
    ["Equity", terms.equity],
    ["Start date", terms.startDate],
    ["Expires", terms.expiresOn],
  ];
  return lines.flatMap(([label, value]) => (value ? [{ label, value }] : []));
}
