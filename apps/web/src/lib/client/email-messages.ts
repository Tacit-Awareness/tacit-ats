// What a member reads when an email doesn't go out, shared by the two pages
// that send (Applicant Tickets and the Inbox). Pure. The actions redirect with
// a code and the page looks the sentence up here, so no name or message rides
// in a URL.
export const SEND_ERRORS = {
  send_off: "Sending isn't set up on this deployment, so nothing was sent. The draft is kept.",
  send_gone: "That draft isn't one you can see any more. Nothing was sent.",
  send_forbidden: "You can't email this candidate any more, or that draft isn't yours. Nothing was sent.",
  send_already: "That email has already gone out, or is going out now. Nothing was sent again.",
  send_address: "Their email on file changed after this draft was written, so nothing was sent. Write a new one.",
  send_stale: "You've written to them again since this draft, so it wasn't sent. Only your newest can go out.",
  send_refused: "The email provider refused it, so it wasn't sent. Write a new draft to try again.",
  send_no_reply_to: "Your own email address isn't on file, so a reply would have nowhere to go. Nothing was sent.",
  send_rate: "You've reached the hourly limit, so nothing was sent. Try again later.",
  // Not "nothing was sent": the draft may have reached the provider before this failed.
  send_failed: "That didn't work, and it may have gone out. Look at the candidate's emails before trying again.",
} as const;

export type SendError = keyof typeof SEND_ERRORS;
