// What /client/inbox says after dealing with an issue. The action redirects
// with a code and the page looks the sentence up here, so no name rides in a URL.
export const INBOX_NOTICES = {
  done: "Next action cleared.",
  touched: "Touch logged.",
  unchanged: "That had already been dealt with.",
} as const;

export const INBOX_ERRORS = {
  not_found: "That application isn't one you can see any more.",
  forbidden: "You can't change that job's pipeline.",
  failed: "That didn't work. Nothing was changed.",
} as const;

export type InboxNotice = keyof typeof INBOX_NOTICES;
export type InboxError = keyof typeof INBOX_ERRORS;

export const isInboxNotice = (v: unknown): v is InboxNotice => typeof v === "string" && Object.hasOwn(INBOX_NOTICES, v);
export const isInboxError = (v: unknown): v is InboxError => typeof v === "string" && Object.hasOwn(INBOX_ERRORS, v);
