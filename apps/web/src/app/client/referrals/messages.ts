// What /client/referrals says after adding one. The action redirects with a
// code and the page looks the sentence up here, so no name or address rides
// in a URL.
export const REFERRAL_NOTICES = {
  added: "Referral added. They're at the top of the list.",
  added_existing: "Referral added. They were already in your company's records, so that person was added to the job.",
  exists: "They're already in that job's pipeline, so nothing changed: they keep the source they came in with.",
} as const;

export const REFERRAL_ERRORS = {
  invalid_name: "Enter their name.",
  invalid_email: "That email address doesn't look right.",
  invalid_linkedin: "That isn't a LinkedIn profile link.",
  invalid_referrer: "Say who referred them, in 200 characters or fewer.",
  invalid_job: "Pick a job.",
  forbidden: "You can't add people to that job.",
  rate_limited: "You've made 300 changes in the last hour, the limit. Nobody was added. Try again later.",
  failed: "That didn't work. Nobody was added.",
} as const;

export type ReferralNotice = keyof typeof REFERRAL_NOTICES;
export type ReferralError = keyof typeof REFERRAL_ERRORS;

export const isReferralNotice = (v: unknown): v is ReferralNotice => typeof v === "string" && Object.hasOwn(REFERRAL_NOTICES, v);
export const isReferralError = (v: unknown): v is ReferralError => typeof v === "string" && Object.hasOwn(REFERRAL_ERRORS, v);
