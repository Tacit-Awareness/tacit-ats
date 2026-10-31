// What Onboarding's People step says after an action. The actions redirect with a
// code and the page looks the sentence up here, so no name or address rides in a URL.
export const TEAM_NOTICES = {
  invited: "Invitation sent.",
  resent: "They were already invited and hadn't signed in yet, so the invitation was sent again.",
  withdrawn: "Invitation withdrawn.",
  access_changed: "Access changed.",
  access_unchanged: "They already had that access, so nothing was changed.",
} as const;

export const TEAM_ERRORS = {
  forbidden: "Only an admin can invite or withdraw.",
  invalid: "Check the name and email address and try again.",
  already_member: "That address is already on the team.",
  provider_failed: "The invitation email couldn't be sent, so nobody was invited. Try again.",
  not_found: "That invitation was already accepted or withdrawn.",
  access_forbidden: "Only an admin can change someone's access.",
  access_invalid: "Pick interviewer, hiring team or admin.",
  last_admin: "Your company needs an admin who has signed in. Make someone else an admin first.",
  member_gone: "That person is no longer on the team.",
  rate_limited: "You've made 300 changes in the last hour, the limit. Nothing was changed. Try again later.",
  failed: "That didn't work. Nothing was changed.",
} as const;

// A title's form stays on the page with what was typed, so these need no code in a URL.
export const TITLE_ERRORS = {
  forbidden: "Only an admin can change someone else's title.",
  member_gone: "That person is no longer on the team.",
  rate_limited: "You've made 300 changes in the last hour, the limit. Nothing was saved. Try again later.",
  // A write can fail after it landed, so this cannot promise that nothing changed.
  failed: "That didn't save, and it may not have gone through. Reload and check.",
} as const;

export type TeamNotice = keyof typeof TEAM_NOTICES;
export type TeamError = keyof typeof TEAM_ERRORS;
export type TitleError = keyof typeof TITLE_ERRORS;

/** What a title's save tells its form: `invalid` carries the tool's sentence, which names no one. */
export type TitleAnswer = { ok: true; changed: boolean } | { ok: false; error: TitleError } | { ok: false; invalid: string };

export const isTeamNotice = (v: unknown): v is TeamNotice => typeof v === "string" && Object.hasOwn(TEAM_NOTICES, v);
export const isTeamError = (v: unknown): v is TeamError => typeof v === "string" && Object.hasOwn(TEAM_ERRORS, v);
