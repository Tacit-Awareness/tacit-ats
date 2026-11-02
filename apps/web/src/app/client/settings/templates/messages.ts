import type { TemplateFormError } from "@/lib/client/email-template-rules";

// What /client/settings/templates says after a save or an archive. The action
// redirects with a code and the page looks the sentence up here, so no
// template's name or words ride in a URL. A save that is refused comes back to
// the form instead (TemplateState), with what was typed kept.

export const TEMPLATE_NOTICES = {
  created: "Template saved. It's in the reply box now.",
  saved: "Template saved.",
  unchanged: "Nothing changed.",
  archived: "Archived. Drafts already written from it are untouched.",
  restored: "Brought back. It's in the reply box again.",
} as const;

export const TEMPLATE_ERRORS = {
  forbidden: "Only an admin at your company makes or changes email templates.",
  gone: "That template isn't there any more.",
  failed: "That didn't work. Nothing was changed.",
} as const;

export const TEMPLATE_FORM_ERRORS: Record<TemplateFormError, string> = {
  missing: "A template needs a name, a subject and a body.",
  too_long: "That is too long. A name is at most 100 characters, a subject 300 and a body 20,000.",
};

export type TemplateNotice = keyof typeof TEMPLATE_NOTICES;
export type TemplateError = keyof typeof TEMPLATE_ERRORS;

/** What a save comes back with when it is refused: a sentence for the form, never a URL. */
export type TemplateState = { error?: string };

export const isTemplateNotice = (v: unknown): v is TemplateNotice => typeof v === "string" && Object.hasOwn(TEMPLATE_NOTICES, v);
export const isTemplateError = (v: unknown): v is TemplateError => typeof v === "string" && Object.hasOwn(TEMPLATE_ERRORS, v);
