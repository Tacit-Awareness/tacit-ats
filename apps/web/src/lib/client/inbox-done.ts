import { instanceId, isIssueReason, issueKind, type Issue, type IssueInstance, type IssueKind } from "./inbox-issues";

// The Inbox's Done tab, the pure half (design/tats's `cleared`, "resolved and
// dismissed issues are listed under Done"). inbox_dismissals holds ids and
// timestamps, deliberately no wording, so a row is worded here: from the live
// issue while it still stands, else from what the member can still read about
// it (a job they lost, a merged application, an erased draft drop off the list).
// The prototype shows an issue as it was when it left, which needs a snapshot of
// wording that can carry a candidate's name or an email's subject.

export const ISSUE_KEY = /^(app|appr|draft)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Only what `Date.parse` and the column's check both read the same way: a date in Postgres's or JavaScript's form. */
const INSTANT = /^(\d{4})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** A key this page may name: for `?i=` and for a dismissal. */
export const isIssueKey = (v: unknown): v is string => typeof v === "string" && ISSUE_KEY.test(v);

/**
 * The instance a form names, re-read: posted fields are request data. `key` is
 * passed when the action already knows it from the ids it acted on, so a form
 * can't record a fix against something else. Null for anything the table
 * wouldn't hold.
 */
export function parseInstance(form: FormData, key: unknown = form.get("issueKey")): IssueInstance | null {
  const reason = form.get("issueReason");
  const at = form.get("issueAt");
  if (!isIssueKey(key) || !isIssueReason(reason) || typeof at !== "string") return null;
  const year = INSTANT.exec(at)?.[1];
  if (!year || year === "0000" || Number.isNaN(Date.parse(at))) return null;
  return { key, reason, at };
}

export type Dismissal = { id: string; key: string; reason: string; at: string; how: "dismissed" | "resolved"; dismissedAt: string };

/** What the member can still read of something no longer in the queue. */
export type DoneSubject = {
  candidate: { id: string; name: string } | null;
  jobId: string | null;
  jobTitle: string | null;
  approvalKind: "offer" | "job_open" | null;
};

export type DoneItem = {
  /** The row's id, `?i=` on this tab: one application can have several rows. */
  id: string;
  how: Dismissal["how"];
  dismissedAt: string;
  kind: IssueKind;
  what: string;
  line: string;
  candidate: { id: string; name: string } | null;
  /** The instance still holds, whichever way it left. */
  stands: boolean;
  /** Moving it back would put it in the queue: a resolved row never hid anything. */
  canMoveBack: boolean;
};

function gone(reason: IssueInstance["reason"], s: DoneSubject): Pick<DoneItem, "what" | "line"> {
  const name = s.candidate?.name ?? "this candidate";
  const what =
    reason === "feedback"
      ? "Feedback outstanding"
      : reason === "overdue"
        ? "Next action overdue"
        : reason === "quiet"
          ? "Nobody had been in touch"
          : reason === "decide"
            ? `Decide on ${name}`
            : reason === "draft"
              ? `Draft to ${name}`
              : s.approvalKind === "offer"
                ? "Approval for an offer"
                : "Approval to open a job";
  const candidate = s.candidate && !what.includes(s.candidate.name) ? s.candidate.name : null;
  return { what, line: [candidate, s.jobTitle].filter(Boolean).join(" · ") };
}

/** The list, in the order given (newest first). A row with no live issue and no subject is left out. */
export function doneItems(rows: Dismissal[], standing: Issue[], subjects: Map<string, DoneSubject>): DoneItem[] {
  const live = new Map(standing.map((i) => [instanceId(i), i]));
  return rows.flatMap((r): DoneItem[] => {
    const { reason } = r;
    if (!isIssueReason(reason)) return [];
    const issue = live.get(instanceId({ key: r.key, reason, at: r.at }));
    const base = { id: r.id, how: r.how, dismissedAt: r.dismissedAt, kind: issueKind(reason) };
    if (issue) {
      const line = [issue.candidate && !issue.what.includes(issue.candidate.name) ? issue.candidate.name : null, issue.job.title].filter(Boolean).join(" · ");
      return [{ ...base, what: issue.what, line, candidate: issue.candidate, stands: true, canMoveBack: r.how === "dismissed" }];
    }
    const subject = subjects.get(r.key);
    if (!subject) return [];
    return [{ ...base, ...gone(reason, subject), candidate: subject.candidate, stands: false, canMoveBack: false }];
  });
}

/** Their page, for someone who can read them: an approver not on the job has the name, no story, and would get a 404. */
export const doneCandidateHref = (x: DoneItem, story: unknown[] | null) => (x.candidate && story ? `/client/candidates/${x.candidate.id}` : null);

/** `?i=` on Done: the row asked for, else the newest. */
export const selectedDone = (items: DoneItem[], id: string | null | undefined): DoneItem | null => items.find((x) => x.id === id) ?? items[0] ?? null;
