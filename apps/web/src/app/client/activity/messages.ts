// What Grokbot Activity and the Inbox say after a Retry or a Nudge. The action
// redirects with a code and the page looks the sentence up here, so no name
// rides in a URL. Queued is all a member's press does: the notify tick delivers
// it, so nothing here says the bot has acted.
export const ACTIVITY_NOTICES = {
  retry_queued: "Retry queued for the bot. It hasn't acted yet.",
  nudge_queued: "Nudge queued for the bot. It hasn't acted yet.",
  bot_unchanged: "That had already been dealt with. Nothing was queued.",
} as const;

export const ACTIVITY_ERRORS = {
  bot_gone: "That task isn't one you can see any more. Nothing was queued.",
  bot_forbidden: "You can't change that application, so you can't send its bot a command. Nothing was queued.",
  bot_closed: "That task has already finished. Nothing was queued.",
  bot_failed: "That didn't go through. Nothing was queued. Try again.",
} as const;

export type ActivityNotice = keyof typeof ACTIVITY_NOTICES;
export type ActivityError = keyof typeof ACTIVITY_ERRORS;

export const isActivityNotice = (v: unknown): v is ActivityNotice => typeof v === "string" && Object.hasOwn(ACTIVITY_NOTICES, v);
export const isActivityError = (v: unknown): v is ActivityError => typeof v === "string" && Object.hasOwn(ACTIVITY_ERRORS, v);
