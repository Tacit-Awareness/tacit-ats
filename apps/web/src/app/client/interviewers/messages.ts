// What a save of the profile dialog says. The team's own messages are Onboarding's (../onboarding/messages.ts).
export const PROFILE_NOTICES = {
  profile_saved: "Profile saved.",
  profile_unchanged: "Nothing had changed, so nothing was saved.",
} as const;

// The profile dialog stays open on a refusal, so these are shown in it and need no code in a URL.
export const PROFILE_ERRORS = {
  forbidden: "Only an admin can change someone else's interviewer profile.",
  member_gone: "That person is no longer on the team.",
  stale: "Someone else just saved this profile. Cancel to see what it says now, or Save again to replace it with this.",
  rate_limited: "You've made 300 changes in the last hour, the limit. Nothing was saved. Try again later.",
  // A write can fail after it landed, so this cannot promise that nothing changed.
  failed: "That didn't save, and it may not have gone through. Close this and check.",
} as const;

export type ProfileError = keyof typeof PROFILE_ERRORS;

/** What a save tells the dialog: `invalid` carries the tool's sentence, which names no one, and its field. */
export type ProfileAnswer =
  | { ok: true; notice: keyof typeof PROFILE_NOTICES }
  | { ok: false; error: ProfileError }
  | { ok: false; invalid: string; field?: string };
