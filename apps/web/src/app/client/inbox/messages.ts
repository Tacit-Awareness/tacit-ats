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
} as const;

export type InboxNotice = keyof typeof INBOX_NOTICES;
export type InboxError = keyof typeof INBOX_ERRORS;

export const isInboxNotice = (v: unknown): v is InboxNotice => typeof v === "string" && Object.hasOwn(INBOX_NOTICES, v);
export const isInboxError = (v: unknown): v is InboxError => typeof v === "string" && Object.hasOwn(INBOX_ERRORS, v);
