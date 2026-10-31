// What the Interview process step says. Actions answer with codes; nothing here
// names a person or a job, so nothing in an answer needs fencing.

export const SAVE_ERRORS = {
  forbidden: "Only an admin at your company can change the interview process.",
  invalid: "That drawing is too big, or has something in it that can't be saved. Nothing was saved.",
  rate_limited: "You've made 300 changes in the last hour, the limit. Nothing was saved. Try again later.",
  // A write can fail after it landed, so this cannot promise that nothing changed.
  failed: "That didn't save, and it may not have gone through. Reload and check.",
} as const;

export type SaveError = keyof typeof SAVE_ERRORS;

export type SaveAnswer =
  | { ok: true; updatedAt: string; changed: boolean }
  /** Someone saved since this page read it. Theirs is `latest`; saving over it names that. */
  | { ok: false; stale: true; latest: string | null }
  | { ok: false; error: SaveError };

export const STALE_SAVE = "Someone else saved the process after you opened it, so yours wasn't saved. Yours is still here: save it over theirs, or reload to see theirs.";
export const STALE_APPLY = "Someone saved the process since you opened it. Reload to apply what's saved now.";

export const APPLY_ERRORS = {
  forbidden: "Only an admin at your company can apply the process to jobs.",
  stale: STALE_APPLY,
  invalid: "The saved process has problems to fix first, so nothing was applied.",
  rate_limited: "You've made 300 changes in the last hour, the limit. Try again later.",
  failed: "That didn't work, and some jobs may have changed. Reload and check.",
} as const;

export type ApplyError = keyof typeof APPLY_ERRORS;

/** Why a job is left as it is. */
export const SKIP_REASONS = {
  no_path: "No way through for its team, so it was left alone.",
  no_interviews: "No interviews on the way through for its team, so its plan was left alone.",
  refused: "You can see this job but not change its plan. A confidential job is its own team's.",
  not_found: "You can't see this job now. A confidential job is its own team's.",
  invalid: "Its team's way through can't be a plan.",
  rate_limited: "Not reached: you hit the limit of 300 changes an hour.",
  failed: "That didn't work, and it may not have gone through.",
} as const;

export type SkipReason = keyof typeof SKIP_REASONS;
