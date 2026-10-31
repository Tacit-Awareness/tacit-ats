// What the candidate page says after an edit. The actions redirect with a
// code and the page looks the sentence up here, so no name rides in a URL. The
// note form is the one that stays on the page: its answer is a NoteState, so
// what was typed is never in a URL either and survives a refusal.
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
  note_empty: "Write the note first.",
  note_long: "A note is at most 5,000 characters. Nothing was saved.",
  note_gone: "That candidate isn't one you can see any more. Nothing was saved.",
  rate_limited: "You've made 300 changes in the last hour, the limit. Nothing was changed. Try again later.",
  failed: "That didn't work. Nothing was changed.",
  unsure: "That didn't finish, so they may or may not have moved. Check where they are before trying again.",
  label_forbidden: "You can't change this candidate's labels.",
  label_gone: "That label or candidate isn't one you can use any more. Nothing was changed.",
  label_archived: "That label is archived, so it goes on no one new.",
  label_unsure: "That didn't finish, so the label may or may not have changed. Check it before trying again.",
} as const;

export type CandidateNotice = keyof typeof CANDIDATE_NOTICES;
export type CandidateError = keyof typeof CANDIDATE_ERRORS;

/** The note form's answer: how many it has added, and if this one was refused, why, with the words to put back in the box. */
export type NoteState = { added: number } | { added: number; error: CandidateError; text: string };

export const isCandidateNotice = (v: unknown): v is CandidateNotice => typeof v === "string" && Object.hasOwn(CANDIDATE_NOTICES, v);
export const isCandidateError = (v: unknown): v is CandidateError => typeof v === "string" && Object.hasOwn(CANDIDATE_ERRORS, v);
