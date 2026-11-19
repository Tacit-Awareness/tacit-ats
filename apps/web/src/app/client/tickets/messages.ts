// What Tickets says after a command, by the code in the URL (tickets/actions.ts).

export const TICKET_NOTICES = {
  retry: "Asked the bot to try again.",
  nudge: "Asked the bot to nudge them.",
  cancel: "Asked the bot to stop.",
} as const;

export const TICKET_ERRORS = {
  not_found: "That task isn't one you can see any more.",
  forbidden: "You can't act on this candidate's application.",
  closed: "That task has already finished.",
  failed: "That didn't work. Nothing was sent to the bot.",
} as const;

export const isTicketNotice = (v: unknown): v is keyof typeof TICKET_NOTICES => typeof v === "string" && Object.hasOwn(TICKET_NOTICES, v);
export const isTicketError = (v: unknown): v is keyof typeof TICKET_ERRORS => typeof v === "string" && Object.hasOwn(TICKET_ERRORS, v);
