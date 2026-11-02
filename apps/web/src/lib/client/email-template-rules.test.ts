import { clientTools } from "@tacit-ats/core";
import { describe, expect, test } from "vitest";
import {
  TEMPLATE_BODY_MAX, TEMPLATE_NAME_MAX, TEMPLATE_SUBJECT_MAX, fillTemplate, parseArchiveForm, parseTemplateForm, templateRefusal, templateStarters, type ShownTemplate,
} from "./email-template-rules";

const ID = "55555555-5555-4555-8555-555555555555";
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("the limits are core's", () => {
  test("name, subject and body", () => {
    expect(TEMPLATE_NAME_MAX).toBe(clientTools.TEMPLATE_NAME_MAX);
    expect(TEMPLATE_SUBJECT_MAX).toBe(clientTools.EMAIL_SUBJECT_MAX);
    expect(TEMPLATE_BODY_MAX).toBe(clientTools.EMAIL_BODY_MAX);
  });

  test("fillTemplate knows every placeholder core fills", () => {
    const v = { candidateName: "Nia Long", jobTitle: "Engineer", company: "Acme", sender: "Ada Byron" };
    for (const key of Object.keys(clientTools.EMAIL_PLACEHOLDERS)) expect(fillTemplate(`{{${key}}}`, v)).not.toContain("{{");
  });
});

describe("parseTemplateForm", () => {
  const good = { name: "  Intro   call ", subject: " Hello {{candidate_first_name}} ", body: "Hi,\r\n\r\nThanks" };

  test("a new one: the name's spaces folded, the subject trimmed, the body's line ends core's", () => {
    expect(parseTemplateForm(form(good))).toEqual({ ok: true, template: { templateId: null, name: "Intro call", subject: "Hello {{candidate_first_name}}", body: "Hi,\n\nThanks" } });
  });

  test("an existing one, by id", () => {
    const out = parseTemplateForm(form({ ...good, templateId: ID }));
    expect(out.ok && out.template.templateId).toBe(ID);
  });

  test.each([
    ["no name", { ...good, name: "  " }],
    ["no subject", { ...good, subject: "" }],
    ["a blank body", { ...good, body: " \n " }],
    ["no fields", {}],
    ["an id that isn't one", { ...good, templateId: "1 or 1=1" }],
  ])("%s is refused", (_, fields) => {
    expect(parseTemplateForm(form(fields as Record<string, string>))).toEqual({ ok: false, error: "missing" });
  });

  test.each([
    ["name", { ...good, name: "x".repeat(TEMPLATE_NAME_MAX + 1) }],
    ["subject", { ...good, subject: "x".repeat(TEMPLATE_SUBJECT_MAX + 1) }],
    ["body", { ...good, body: "x".repeat(TEMPLATE_BODY_MAX + 1) }],
  ])("a %s past core's limit is refused", (_, fields) => {
    expect(parseTemplateForm(form(fields))).toEqual({ ok: false, error: "too_long" });
  });

  test("a body at the limit counted with core's line ends, not the textarea's", () => {
    const body = "x\r\n".repeat(TEMPLATE_BODY_MAX / 2);
    expect(parseTemplateForm(form({ ...good, body })).ok).toBe(true);
  });
});

describe("parseArchiveForm", () => {
  test("which one, and which way", () => {
    expect(parseArchiveForm(form({ templateId: ID, archived: "true" }))).toEqual({ templateId: ID, archived: true });
    expect(parseArchiveForm(form({ templateId: ID, archived: "false" }))).toEqual({ templateId: ID, archived: false });
  });

  test.each([
    ["no id", { archived: "true" }],
    ["a name for an id", { templateId: "Intro", archived: "true" }],
    ["no direction", { templateId: ID }],
    ["any other direction", { templateId: ID, archived: "yes" }],
  ])("%s is nothing", (_, fields) => {
    expect(parseArchiveForm(form(fields as Record<string, string>))).toBeNull();
  });
});

describe("fillTemplate", () => {
  const v = { candidateName: "Nia  Long", jobTitle: "Staff Engineer", company: "Acme", sender: "Ada Byron" };

  test("fills what draftEmail fills, spaces inside the braces too", () => {
    expect(fillTemplate("Hi {{candidate_first_name}} ({{ candidate_name }}), {{job_title}} at {{company_name}}. {{sender_first_name}} / {{sender_name}}", v)).toBe(
      "Hi Nia (Nia Long), Staff Engineer at Acme. Ada / Ada Byron",
    );
  });

  test("leaves what it can't fill as written, for core to fill or refuse", () => {
    expect(fillTemplate("{{job_title}} {{nickname}}", { ...v, jobTitle: null })).toBe("{{job_title}} {{nickname}}");
  });

  test("a sender known only by their email signs nothing", () => {
    expect(fillTemplate("{{sender_first_name}}", { ...v, sender: "ada@acme.test" })).toBe("{{sender_first_name}}");
  });

  test("braces in a name can't make a placeholder", () => {
    const out = fillTemplate("Hi {{candidate_name}}", { ...v, candidateName: "{{job_title}}" });
    expect(out).not.toContain("{");
  });
});

describe("templateStarters", () => {
  const t = (over: Partial<ShownTemplate>): ShownTemplate => ({ templateId: ID, name: "Intro", subject: "For {{job_title}}", body: "Hi {{candidate_first_name}}", archived: false, ...over });

  test("live templates only, filled for this email", () => {
    const out = templateStarters([t({}), t({ templateId: "x", name: "Old", archived: true })], { candidateName: "Nia", jobTitle: "Engineer", company: "Acme", sender: "Ada" });
    expect(out).toEqual([{ templateId: ID, name: "Intro", subject: "For Engineer", body: "Hi Nia" }]);
  });

  test("a subject stays one line however it fills", () => {
    const [out] = templateStarters([t({ subject: "{{job_title}}" })], { candidateName: "Nia", jobTitle: "A\nB", company: "Acme", sender: "Ada" });
    expect(out.subject).not.toMatch(/[\r\n]/);
  });
});

describe("templateRefusal", () => {
  test("core's sentences that name a connector tool get the page's own", () => {
    for (const m of [
      "A template by that name is archived. update_email_template with archived: false brings it back.",
      "A template by that name already exists. Change it with update_email_template.",
      "A template by that name was just made. Look in list_email_templates.",
      "No email template by that name or id. list_email_templates has them.",
      "Something else about create_email_template.",
    ]) expect(templateRefusal(m)).not.toMatch(/_email_template/);
  });

  test("the rest are core's as they are", () => {
    expect(templateRefusal("Only an admin at your company makes or changes email templates.")).toBe("Only an admin at your company makes or changes email templates.");
    expect(templateRefusal("A subject is at most 300 characters.")).toBe("A subject is at most 300 characters.");
  });
});
