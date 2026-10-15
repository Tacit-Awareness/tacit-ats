// What /client/calendar says after connecting or disconnecting. The routes
// redirect with a code and the page looks the sentence up here, so nothing
// else rides in a URL.
export const CALENDAR_NOTICES = {
  connected: "Your Google Calendar is connected. Claude can now find times and send interview invitations from it.",
  disconnected: "Your calendar is disconnected. Interviews you schedule are recorded in Tacit only until you connect again.",
} as const;

export const CALENDAR_ERRORS = {
  not_set_up: "Calendar connections are not set up on this Tacit deployment yet.",
  denied: "Google didn't grant access, so nothing was connected.",
  expired: "That took too long or came from another tab. Try connecting again.",
  missing_scopes: "Tacit needs both permissions Google asked about: seeing when you're busy, and adding interview events. Try again and leave both checked.",
  no_refresh_token: "Google didn't give Tacit lasting access. Try again.",
  no_email: "Google didn't say which account this is. Try again.",
  exchange_failed: "Google didn't complete the connection. Try again.",
  failed: "That didn't work. Nothing was changed.",
} as const;

export type CalendarNotice = keyof typeof CALENDAR_NOTICES;
export type CalendarError = keyof typeof CALENDAR_ERRORS;

export const isCalendarNotice = (v: unknown): v is CalendarNotice => typeof v === "string" && Object.hasOwn(CALENDAR_NOTICES, v);
export const isCalendarError = (v: unknown): v is CalendarError => typeof v === "string" && Object.hasOwn(CALENDAR_ERRORS, v);
