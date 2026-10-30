// What the candidate page says after an edit. The actions redirect with a
// code and the page looks the sentence up here, so no name rides in a URL.
export const CANDIDATE_NOTICES = {
  moved: "Stage moved.",
  owner: "Owner changed.",
  next_action: "Next action saved.",
  touched: "Touch logged.",
  unchanged: "Nothing to change.",
} as const;

export const CANDIDATE_ERRORS = {
  not_found: "That application isn't one you can see any more.",
  forbidden: "You can't edit that job's pipeline.",
  changed: "Someone already moved them, so nothing was changed. This is where they are now.",
  reason_required: "Pick a reason of the right kind to reject or withdraw them.",
  not_member: "Pick an owner from your team.",
  invalid_due: "A due date needs a next action and a real date.",
  rate_limited: "You've made 300 changes in the last hour, the limit. Nothing was changed. Try again later.",
  failed: "That didn't work. Nothing was changed.",
  unsure: "That didn't finish, so they may or may not have moved. Check where they are before trying again.",
} as const;

export type CandidateNotice = keyof typeof CANDIDATE_NOTICES;
export type CandidateError = keyof typeof CANDIDATE_ERRORS;

export const isCandidateNotice = (v: unknown): v is CandidateNotice => typeof v === "string" && Object.hasOwn(CANDIDATE_NOTICES, v);
export const isCandidateError = (v: unknown): v is CandidateError => typeof v === "string" && Object.hasOwn(CANDIDATE_ERRORS, v);
