"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseArchiveForm, parseTemplateForm } from "@/lib/client/email-template-rules";
import { archiveTemplate, saveTemplate } from "@/lib/client/email-templates";
import { requireClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import { TEMPLATE_FORM_ERRORS, type TemplateError, type TemplateNotice, type TemplateState } from "./messages";

// Settings > Email templates: make, change, archive and bring back the
// company's templates, through clientTools on the member's own client, so the
// policies decide (admins write; core asks first only to answer with a
// sentence). Posted fields are request data, so they are read back
// (email-template-rules.ts) before core checks them again. A name, subject or
// body never goes in the URL or the log: a refused save stays on its form.

const PAGE = "/client/settings/templates";

// Only codes go in the URL.
const back = (params: { notice?: TemplateNotice; error?: TemplateError }): never => {
  const qs = new URLSearchParams();
  if (params.notice) qs.set("notice", params.notice);
  if (params.error) qs.set("error", params.error);
  const q = qs.toString();
  return redirect(q ? `${PAGE}?${q}` : PAGE);
};

/** New template, or Save on one: refusals come back to the form, with what was typed. */
export async function saveTemplateAction(_: TemplateState, form: FormData): Promise<TemplateState> {
  const member = await requireClient();
  if (member.accessLevel !== "admin") return { error: "Only an admin at your company makes or changes email templates." };
  const parsed = parseTemplateForm(form);
  if (!parsed.ok) return { error: TEMPLATE_FORM_ERRORS[parsed.error] };

  let outcome: Awaited<ReturnType<typeof saveTemplate>>;
  try {
    outcome = await saveTemplate(member.db, toolCtx(member), parsed.template);
  } catch (err) {
    console.error("[client-templates] save failed:", err instanceof Error ? err.message : err);
    return { error: "That didn't work. Nothing was saved." };
  }
  if (!outcome.ok) return { error: outcome.error };

  revalidatePath(PAGE);
  revalidatePath("/client/applicants");
  return back({ notice: !outcome.changed ? "unchanged" : parsed.template.templateId ? "saved" : "created" });
}

/** Archive (kept; drafts already written from it untouched) or bring back. */
export async function archiveTemplateAction(form: FormData): Promise<void> {
  const member = await requireClient();
  const input = parseArchiveForm(form);
  if (!input) return back({ error: "gone" });
  if (member.accessLevel !== "admin") return back({ error: "forbidden" });

  let outcome: Awaited<ReturnType<typeof archiveTemplate>>;
  try {
    outcome = await archiveTemplate(member.db, toolCtx(member), input);
  } catch (err) {
    console.error("[client-templates] archive failed:", err instanceof Error ? err.message : err);
    return back({ error: "failed" });
  }
  if (!outcome.ok) return back({ error: /admin/.test(outcome.error) ? "forbidden" : /isn't there/.test(outcome.error) ? "gone" : "failed" });

  revalidatePath(PAGE);
  revalidatePath("/client/applicants");
  return back({ notice: !outcome.changed ? "unchanged" : input.archived ? "archived" : "restored" });
}
