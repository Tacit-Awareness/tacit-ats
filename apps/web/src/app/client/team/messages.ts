// What /client/team says after an action. The actions redirect with a code
// and the page looks the sentence up here, so no name or address rides in a URL.
export const TEAM_NOTICES = {
  invited: "Invitation sent.",
  resent: "They were already invited and hadn't signed in yet, so the invitation was sent again.",
  withdrawn: "Invitation withdrawn.",
} as const;

export const TEAM_ERRORS = {
  forbidden: "Only an admin can invite or withdraw.",
  invalid: "Check the name and email address and try again.",
  already_member: "That address is already on the team.",
  provider_failed: "The invitation email couldn't be sent, so nobody was invited. Try again.",
  not_found: "That invitation was already accepted or withdrawn.",
  failed: "That didn't work. Nothing was changed.",
} as const;

export type TeamNotice = keyof typeof TEAM_NOTICES;
export type TeamError = keyof typeof TEAM_ERRORS;

export const isTeamNotice = (v: unknown): v is TeamNotice => typeof v === "string" && Object.hasOwn(TEAM_NOTICES, v);
export const isTeamError = (v: unknown): v is TeamError => typeof v === "string" && Object.hasOwn(TEAM_ERRORS, v);
