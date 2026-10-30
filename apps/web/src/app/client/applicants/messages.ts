// What /client/applicants says after routing someone. The action redirects
// with a code and the page looks the sentence up here, so no name rides in a URL.
export const APPLICANT_NOTICES = {
  screening: "Moved to screening.",
  interview: "Moved to interviewing.",
  decline: "Declined.",
} as const;

export const APPLICANT_ERRORS = {
  not_found: "That application isn't one you can see any more.",
  forbidden: "You can't move people in that job's pipeline.",
  changed: "Someone already moved them on, so nothing was changed.",
  reason_required: "Pick a rejection reason to decline.",
  failed: "That didn't work. Nothing was changed.",
} as const;

export type ApplicantNotice = keyof typeof APPLICANT_NOTICES;
export type ApplicantError = keyof typeof APPLICANT_ERRORS;

export const isApplicantNotice = (v: unknown): v is ApplicantNotice => typeof v === "string" && Object.hasOwn(APPLICANT_NOTICES, v);
export const isApplicantError = (v: unknown): v is ApplicantError => typeof v === "string" && Object.hasOwn(APPLICANT_ERRORS, v);
