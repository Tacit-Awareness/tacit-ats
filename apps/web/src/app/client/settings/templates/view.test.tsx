import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

// What the templates page draws, to markup. The actions are stubs.

vi.mock("./actions", () => ({ saveTemplateAction: vi.fn(), archiveTemplateAction: vi.fn() }));

import type { ShownTemplate } from "@/lib/client/email-template-rules";
import { TemplatesView } from "./view";

const t = (over: Partial<ShownTemplate>): ShownTemplate => ({ templateId: "t1", name: "Intro call", subject: "Your application", body: "Hi {{candidate_first_name}}", archived: false, ...over });
const html = (templates: ShownTemplate[], admin: boolean) =>
  renderToStaticMarkup(<TemplatesView templates={templates} admin={admin} placeholders={[["job_title", "the job's title"]]} notice={null} error={null} />);

describe("TemplatesView", () => {
  test("an admin can make, edit and archive, and sees the archived ones to bring back", () => {
    const out = html([t({}), t({ templateId: "t2", name: "Old one", archived: true })], true);
    expect(out).toContain("New template");
    expect(out).toContain(">Edit<");
    expect(out).toContain(">Archive<");
    expect(out).toContain("Old one");
    expect(out).toContain(">Bring back<");
  });

  test("anyone else reads the live ones only, and changes nothing", () => {
    const out = html([t({}), t({ templateId: "t2", name: "Old one", archived: true })], false);
    expect(out).toContain("Intro call");
    expect(out).toContain("Your application");
    expect(out).not.toContain("Old one");
    for (const control of ["New template", ">Edit<", ">Archive<", "<form"]) expect(out).not.toContain(control);
    expect(out).toContain("Only an admin can make or change them");
  });

  test("a template's words are text, never markup", () => {
    const out = html([t({ name: "<b>x</b>", body: "<img src=x onerror=alert(1)>" })], true);
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b>x</b>");
  });

  test("with none yet it says so", () => {
    expect(html([], true)).toContain("No templates yet");
  });

  test("goes back to Settings", () => {
    expect(html([], false)).toContain('href="/client/settings"');
  });
});
