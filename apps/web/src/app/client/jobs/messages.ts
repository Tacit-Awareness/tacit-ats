// What the posting editor says. The actions answer with a code and the editor
// looks the sentence up here, as every other page in the client area does; a
// notice also rides in the URL after a new role is made, so only a code does.

export const POSTING_NOTICES = {
  saved: "Saved.",
  saved_live: "Saved. A live post changes for applicants at once.",
  published: "Published. It's on the careers page.",
  closed: "Closed. It's off the careers page and takes no more applications.",
  posted: "Posted. It's on the careers page.",
  drafted: "Saved as a draft. Nothing is public until you publish it.",
} as const;

export const POSTING_ERRORS = {
  invalid: "That couldn't be read. Nothing was saved.",
  title_required: "Give the role a title first.",
  title_too_long: "A title is at most 200 characters.",
  location_too_long: "A location is at most 200 characters.",
  description_too_long: "The posting is at most 20,000 characters.",
  question_too_long: "A question is at most 300 characters.",
  too_many_questions: "An application asks at most 40 questions.",
  options_needed: "A dropdown needs at least two different choices, each 200 characters or fewer, and at most 50 in all.",
  invalid_questions: "One of the questions couldn't be saved. Nothing was saved.",
  too_many_steps: "A job has at most 15 hiring steps.",
  step_too_long: "A hiring step is at most 120 characters.",
  step_repeated: "Two hiring steps have the same name.",
  invalid_department: "That department isn't available any more. Pick another.",
  invalid_post: "The post was refused as it stands. Check its text and questions.",
  invalid_steps: "The hiring steps were refused, though the post's text saved.",
  job_not_open: "The post can't go live while its job isn't open. Anything else you changed is saved.",
  changed: "Someone else saved this post since you opened it.",
  not_found: "That job or post isn't there, or you can't see it.",
  forbidden: "You can't change this job. Ask whoever manages it, or an admin.",
  rate_limited: "You've made 300 changes in the last hour, the limit. Try again later.",
  failed: "That didn't work. What you typed is still here: try again.",
} as const;

export type PostingNotice = keyof typeof POSTING_NOTICES;
export type PostingError = keyof typeof POSTING_ERRORS;

export const isPostingNotice = (v: unknown): v is PostingNotice => typeof v === "string" && Object.hasOwn(POSTING_NOTICES, v);

/** Errors about the form: the editor opens the Application tab to show them. */
export const QUESTION_ERRORS: readonly PostingError[] = ["question_too_long", "too_many_questions", "options_needed", "invalid_questions"];
