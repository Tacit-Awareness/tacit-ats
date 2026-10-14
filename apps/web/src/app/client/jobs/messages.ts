// What a job page says after an action. The actions redirect with a code and
// the page looks the sentence up here, so no name or address rides in a URL.
export const JOB_NOTICES = {
  added: "Added to the pipeline.",
  added_existing: "They were already in your company's records, so that person was added.",
  exists: "They're already in this job's pipeline. Nothing changed.",
} as const;

export const JOB_ERRORS = {
  invalid_name: "Enter their name.",
  invalid_email: "That email address doesn't look right.",
  invalid_linkedin: "That isn't a LinkedIn profile link.",
  forbidden: "You can't add people to this job.",
  failed: "That didn't work. Try again.",
} as const;

export type JobNotice = keyof typeof JOB_NOTICES;
export type JobError = keyof typeof JOB_ERRORS;

export const isJobNotice = (v: unknown): v is JobNotice => typeof v === "string" && Object.hasOwn(JOB_NOTICES, v);
export const isJobError = (v: unknown): v is JobError => typeof v === "string" && Object.hasOwn(JOB_ERRORS, v);
