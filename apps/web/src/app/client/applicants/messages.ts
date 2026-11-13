import { SEND_ERRORS } from "@/lib/client/email-messages";

// What /client/applicants says after routing someone, sending a reply or
// adding someone. The action redirects with a code and the page looks the
// sentence up here, so no name rides in a URL.
export const APPLICANT_NOTICES = {
  interview: "Moved to interviewing.",
  decline: "Declined.",
  sent: "Sent. They stay here until you route them.",
  added: "Added. They're in New Applicants now.",
  added_existing: "Added. They were already in your company's records, so that person was added to the job.",
  added_no_note: "Added, but the note didn't save. Add it on their page.",
  added_no_file: "Added, but the resume didn't save.",
  added_no_extras: "Added, but the note and the resume didn't save. Add the note on their page.",
  exists: "They're already in that job's pipeline, so nothing changed.",
} as const;

/** What the "Add applicant" composer says under its box when the add is refused: one sentence, and what was typed stays. */
export const INTAKE_ERRORS = {
  invalid_name: "Their name is missing or too long.",
  invalid_email: "That email address doesn't look right.",
  invalid_linkedin: "That isn't a LinkedIn profile link.",
  invalid_file: "A resume is a PDF, Word, text, PNG or JPEG file of at most 3 MB.",
  invalid_job: "Pick a job.",
  forbidden: "You can't add people to that job.",
  rate_limited: "You've made 300 changes in the last hour, the limit. Nobody was added. Try again later.",
  failed: "That didn't work. Nobody was added.",
} as const;

export type IntakeError = keyof typeof INTAKE_ERRORS;

/** What addApplicantAction answers the composer on a refusal: a code, worded in place. Once added it redirects. */
export type IntakeState = { status: "idle" } | { status: "error"; error: IntakeError };

export const APPLICANT_ERRORS = {
  not_found: "That application isn't one you can see any more.",
  forbidden: "You can't move people in that job's pipeline.",
  changed: "Someone already moved them on, so nothing was changed.",
  reason_required: "Pick a rejection reason to decline.",
  failed: "That didn't work. Nothing was changed.",
  ...SEND_ERRORS,
} as const;

export type ApplicantNotice = keyof typeof APPLICANT_NOTICES;
export type ApplicantError = keyof typeof APPLICANT_ERRORS;

/** What the reply box's draft comes back with: a sentence for the form, never a URL. */
export type ReplyState = { error?: string };

export const isApplicantNotice = (v: unknown): v is ApplicantNotice => typeof v === "string" && Object.hasOwn(APPLICANT_NOTICES, v);
export const isApplicantError = (v: unknown): v is ApplicantError => typeof v === "string" && Object.hasOwn(APPLICANT_ERRORS, v);
