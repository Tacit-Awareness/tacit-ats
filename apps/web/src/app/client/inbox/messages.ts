import { SEND_ERRORS } from "@/lib/client/email-messages";

// What /client/inbox says after dealing with an issue. The action redirects
// with a code and the page looks the sentence up here, so no name rides in a URL.
export const INBOX_NOTICES = {
  done: "Next action cleared.",
  touched: "Touch logged.",
  unchanged: "That had already been dealt with.",
  approved_step: "Approved. It now waits on the next step.",
  approved_offer: "Approved. That was the last step: the offer can be extended.",
  approved_job: "Approved. That was the last step: the job can be opened.",
  rejected_offer: "Rejected. The offer stays a draft, and whoever asked can change it and ask again.",
  rejected_job: "Rejected. The job stays as it was, and whoever asked can ask again.",
  already_decided: "That approval had already been decided. Nothing was changed.",
  approval_reset: "That request was reset or withdrawn: the terms or the approvers changed. Your decision wasn't recorded.",
  moved_offer: "Moved to offer. No offer has been drafted or sent.",
  closed: "Rejected. No email went out.",
  dismissed: "Moved to Done.",
  restored: "Back in your Inbox.",
  restore_gone: "That was already back in your Inbox.",
  sent: "Sent.",
  read: "Marked read.",
  all_read: "All caught up.",
  all_read_needs: "Marked read. Needs you stays until it's handled.",
} as const;

export const INBOX_ERRORS = {
  not_found: "That application isn't one you can see any more.",
  forbidden: "You can't change that job's pipeline.",
  not_approver: "That approval isn't waiting on you any more. Nothing was changed.",
  changed: "Someone else has moved them since this page loaded. Nothing was changed.",
  reason_required: "A rejection needs a reason. Nothing was changed.",
  rate_limited: "You've made 300 changes in the last hour, the limit. Nothing was changed. Try again later.",
  // Not "nothing changed": a stage can move and its event then fail.
  failed: "That didn't work, and it may be only partly saved. Look at the candidate before trying again.",
  dismiss_refused: "You can't set that aside. Nothing was changed.",
  dismiss_failed: "That didn't work. Nothing was set aside: try again.",
  restore_failed: "That didn't work, so it's still under Done: try again.",
  read_refused: "You can't mark that read. Nothing was changed.",
  read_failed: "That didn't work. Nothing was marked read: try again.",
  ...SEND_ERRORS,
} as const;

export type InboxNotice = keyof typeof INBOX_NOTICES;
export type InboxError = keyof typeof INBOX_ERRORS;

/** The notices that took an issue out of the pop-up and into Done. */
const LEFT_THE_QUEUE: ReadonlySet<InboxNotice> = new Set(["dismissed", "done", "touched", "sent", "moved_offer", "closed", "approved_step", "approved_offer", "approved_job", "rejected_offer", "rejected_job"]);
/** Those whose own sentence says something the member needs: what did not happen, or what comes next. */
const SAYS_MORE: ReadonlySet<InboxNotice> = new Set(["moved_offer", "closed", "approved_step", "approved_offer", "approved_job", "rejected_offer", "rejected_job"]);

/**
 * design/tats's `autoClear` after an action in the pop-up: "Ada moved to Done.
 * Next: Lin." or "... You're all caught up." `next` is who the pop-up opened on;
 * `caughtUp` only when nothing is left, since a stale page's next can have gone
 * while others wait. Null for anything else, which keeps its own sentence.
 */
export function movedToast(notice: InboxNotice, input: { name: string | null; next: string | null; caughtUp: boolean }): string | null {
  if (!LEFT_THE_QUEUE.has(notice)) return null;
  const moved = `${input.name ?? "That"} moved to Done.`;
  const then = input.next ? ` Next: ${input.next}.` : input.caughtUp ? " You're all caught up." : "";
  return `${SAYS_MORE.has(notice) ? `${INBOX_NOTICES[notice]} ` : ""}${moved}${then}`;
}

export const isInboxNotice = (v: unknown): v is InboxNotice => typeof v === "string" && Object.hasOwn(INBOX_NOTICES, v);
export const isInboxError = (v: unknown): v is InboxError => typeof v === "string" && Object.hasOwn(INBOX_ERRORS, v);
