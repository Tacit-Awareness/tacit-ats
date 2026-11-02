// What Settings says after connecting or disconnecting Gmail. The routes
// redirect with a code and the page looks the sentence up here, so nothing
// else rides in a URL.
export const MAILBOX_NOTICES = {
  mailbox_connected: "Your Gmail is connected. Email you send candidates now goes out from it, and their replies come back to the Inbox.",
  mailbox_connected_send_only:
    "Your Gmail is connected for sending. Replies stay in your Gmail only, since Tacit wasn't allowed to read them: connect again and leave both boxes ticked to see them in the Inbox.",
  mailbox_disconnected: "Gmail is disconnected. Email you send candidates goes out from Tacit's address again.",
} as const;

export const MAILBOX_ERRORS = {
  mailbox_not_set_up: "Gmail connections are not set up on this Tacit deployment yet.",
  mailbox_denied: "Google didn't grant access, so nothing was connected.",
  mailbox_expired: "That took too long or came from another tab. Try connecting again.",
  mailbox_missing_scopes: "Tacit needs permission to send email as you. Try again and leave sending ticked.",
  mailbox_no_refresh_token: "Google didn't give Tacit lasting access. Try again.",
  mailbox_no_email: "Google didn't say which account this is. Try again.",
  mailbox_exchange_failed: "Google didn't complete the connection. Try again.",
  mailbox_failed: "That didn't work. Nothing was changed.",
} as const;

export type MailboxNotice = keyof typeof MAILBOX_NOTICES;
export type MailboxError = keyof typeof MAILBOX_ERRORS;

export const isMailboxNotice = (v: unknown): v is MailboxNotice => typeof v === "string" && Object.hasOwn(MAILBOX_NOTICES, v);
export const isMailboxError = (v: unknown): v is MailboxError => typeof v === "string" && Object.hasOwn(MAILBOX_ERRORS, v);
