// What /client/interviewers says after an action. The actions redirect with a code
// and the page looks the sentence up here, so no name or address rides in a URL.
export const TEAM_NOTICES = {
  invited: "Invitation sent.",
  resent: "They were already invited and hadn't signed in yet, so the invitation was sent again.",
  withdrawn: "Invitation withdrawn.",
  access_changed: "Access changed.",
  access_unchanged: "They already had that access, so nothing was changed.",
  profile_saved: "Profile saved.",
  profile_unchanged: "Nothing had changed, so nothing was saved.",
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

// The profile dialog stays open on a refusal, so these are shown in it and need no code in a URL.
export const PROFILE_ERRORS = {
  forbidden: "Only an admin can change someone else's interviewer profile.",
  member_gone: "That person is no longer on the team.",
  stale: "Someone else just saved this profile. Cancel to see what it says now, or Save again to replace it with this.",
  rate_limited: "You've made 300 changes in the last hour, the limit. Nothing was saved. Try again later.",
  failed: "That didn't save. Nothing was changed.",
} as const;

export type TeamNotice = keyof typeof TEAM_NOTICES;
export type TeamError = keyof typeof TEAM_ERRORS;
export type ProfileError = keyof typeof PROFILE_ERRORS;

/** What a save tells the dialog: `invalid` carries the tool's sentence, which names no one, and its field. */
export type ProfileAnswer =
  | { ok: true; notice: "profile_saved" | "profile_unchanged" }
  | { ok: false; error: ProfileError }
  | { ok: false; invalid: string; field?: string };

export const isTeamNotice = (v: unknown): v is TeamNotice => typeof v === "string" && Object.hasOwn(TEAM_NOTICES, v);
export const isTeamError = (v: unknown): v is TeamError => typeof v === "string" && Object.hasOwn(TEAM_ERRORS, v);
