import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { templateRefusal, type ShownTemplate, type TemplateForm } from "./email-template-rules";

// The company's email templates in the web app: clientTools' list, create and
// update on the member's OWN client, the connector's list_email_templates,
// create_email_template and update_email_template, so the policies decide and
// the rules are the same (read above interviewer, written by admins, a name
// unique ignoring case, archived and never deleted). Core keeps the subject and
// body out of the audit row; here they go back to the page and nowhere else.

/** Every template, archived ones too, for Settings; an interviewer reads none. */
export async function readTemplates(db: Db, ctx: clientTools.ClientToolCtx, input: { includeArchived?: boolean } = {}): Promise<ShownTemplate[]> {
  if (ctx.accessLevel === "limited") return [];
  const rows = await clientTools.listEmailTemplates(db, ctx, input);
  return rows.map(({ templateId, name, subject, body, archived }) => ({ templateId, name, subject, body, archived }));
}

export type TemplateOutcome = { ok: true; changed: boolean } | { ok: false; error: string };

const refused = (err: unknown): TemplateOutcome => {
  if (err instanceof clientTools.ClientToolError) return { ok: false, error: templateRefusal(err.message) };
  throw err;
};

/** A new template, or one changed: name, subject and body as the form posted them. */
export async function saveTemplate(db: Db, ctx: clientTools.ClientToolCtx, form: TemplateForm): Promise<TemplateOutcome> {
  try {
    if (!form.templateId) {
      await clientTools.createEmailTemplate(db, ctx, { name: form.name, subject: form.subject, body: form.body });
      return { ok: true, changed: true };
    }
    const out = await clientTools.updateEmailTemplate(db, ctx, { template: form.templateId, name: form.name, subject: form.subject, body: form.body });
    return { ok: true, changed: out.outcome === "updated" };
  } catch (err) {
    return refused(err);
  }
}

/** Archive one (kept, and drafts already written from it untouched) or bring it back. */
export async function archiveTemplate(db: Db, ctx: clientTools.ClientToolCtx, input: { templateId: string; archived: boolean }): Promise<TemplateOutcome> {
  try {
    const out = await clientTools.updateEmailTemplate(db, ctx, { template: input.templateId, archived: input.archived });
    return { ok: true, changed: out.outcome === "updated" };
  } catch (err) {
    return refused(err);
  }
}
