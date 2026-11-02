// Email templates on the web, pure and type-only: the forms on
// /client/settings/templates read back, the reply box's templates filled in,
// and core's refusals put in the page's words. Core's createEmailTemplate and
// updateEmailTemplate check everything again (admins only, a unique name, the
// sizes, the placeholders); this refuses what a form should never send. The
// limits are core's (TEMPLATE_NAME_MAX, EMAIL_SUBJECT_MAX, EMAIL_BODY_MAX),
// repeated here and held together by email-template-rules.test.ts. A subject or
// body is the member's own text: it goes on their page and nowhere else.

export const TEMPLATE_NAME_MAX = 100;
export const TEMPLATE_SUBJECT_MAX = 300;
export const TEMPLATE_BODY_MAX = 20000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A template as the pages show it: core's EmailTemplate without its date. */
export type ShownTemplate = { templateId: string; name: string; subject: string; body: string; archived: boolean };

/** The template form, read back. `templateId` null: a new one. */
export type TemplateForm = { templateId: string | null; name: string; subject: string; body: string };

export type TemplateFormError = "missing" | "too_long";

const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : null;
};

export function parseTemplateForm(form: FormData): { ok: true; template: TemplateForm } | { ok: false; error: TemplateFormError } {
  const rawId = text(form, "templateId");
  if (rawId && !UUID.test(rawId)) return { ok: false, error: "missing" };
  const name = text(form, "name")?.trim().replace(/\s+/g, " ") ?? "";
  const subject = text(form, "subject")?.trim() ?? "";
  // A textarea posts \r\n; core keeps \n, and counts the size after.
  const body = (text(form, "body") ?? "").replace(/\r\n?/g, "\n");
  if (!name || !subject || !body.trim()) return { ok: false, error: "missing" };
  if (name.length > TEMPLATE_NAME_MAX || subject.length > TEMPLATE_SUBJECT_MAX || body.length > TEMPLATE_BODY_MAX) return { ok: false, error: "too_long" };
  return { ok: true, template: { templateId: rawId || null, name, subject, body } };
}

/** Archive or bring back: the template's id and which way, or null. */
export function parseArchiveForm(form: FormData): { templateId: string; archived: boolean } | null {
  const templateId = text(form, "templateId");
  const archived = text(form, "archived");
  if (!templateId || !UUID.test(templateId) || (archived !== "true" && archived !== "false")) return null;
  return { templateId, archived: archived === "true" };
}

/** What the reply box knows about the email, for the placeholders. */
export type TemplateVars = { candidateName: string | null; jobTitle: string | null; company: string; sender: string };

/** Braces go, so a name can't open a placeholder of its own (as reply-starters.ts). */
const plain = (s: string | null) => (s ?? "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
const first = (s: string) => s.split(" ")[0] ?? "";

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * A template's words with the placeholders the page can fill filled, as
 * draftEmail fills them, so the box reads like the email. One it can't (no
 * job, a sender known only by their email) stays as written: core fills it
 * from its own reads, or refuses the draft and says which.
 */
export function fillTemplate(text: string, v: TemplateVars): string {
  const name = plain(v.candidateName);
  // session.ts falls back to the email address for someone with no name: that is no name to sign with.
  const sender = v.sender.includes("@") ? "" : plain(v.sender);
  const values: Record<string, string> = {
    candidate_first_name: first(name),
    candidate_name: name,
    job_title: plain(v.jobTitle),
    company_name: plain(v.company),
    sender_name: sender,
    sender_first_name: first(sender),
  };
  return text.replace(PLACEHOLDER, (whole, key: string) => values[key] || whole);
}

/** Each live template, filled for this email; archived ones are never offered. */
/** A template as the reply box starts from it: its words filled in for this email. */
export type TemplateStarter = { templateId: string; name: string; subject: string; body: string };

export function templateStarters(templates: readonly ShownTemplate[], v: TemplateVars): TemplateStarter[] {
  return templates
    .filter((t) => !t.archived)
    .map((t) => ({ templateId: t.templateId, name: t.name, subject: fillTemplate(t.subject, v).replace(/[\r\n]+/g, " "), body: fillTemplate(t.body, v) }));
}

/**
 * Core's refusal, for the page. Core speaks to Claude, so some of its
 * sentences name a connector tool; those get the page's own. None carries a
 * template's name or words.
 */
export function templateRefusal(message: string): string {
  if (/is archived\. update_email_template/.test(message)) return "A template by that name is archived. Bring it back under Archived, below.";
  if (/already exists\. Change it/.test(message)) return "A template by that name already exists. Change that one instead.";
  if (/was just made/.test(message)) return "A template by that name was just made. Reload to see it.";
  if (/No email template by that name or id/.test(message)) return "That template isn't there any more. Reload to see the current ones.";
  if (/_email_template|list_email_templates/.test(message)) return "That didn't work. Nothing was changed.";
  return message;
}
