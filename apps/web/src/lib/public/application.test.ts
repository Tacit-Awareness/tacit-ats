import { describe, expect, test } from "vitest";
import { formNotice, formSections, guideProgress, guideSteps, questionLabel } from "./application";
import type { PublicQuestion } from "./jobs";

const q = (id: string, type: PublicQuestion["type"], required = true): PublicQuestion => ({ id, type, label: id, required });
const QUESTIONS = [q("name", "name"), q("resume", "resume"), q("email", "email"), q("phone", "phone", false), q("q_why1", "long_text"), q("q_note", "short_text", false)];
const steps = guideSteps(QUESTIONS, (x) => `a_${x.id}`);

describe("formSections", () => {
  test("splits the resume, the built-ins and the post's own questions", () => {
    const { resume, about, custom } = formSections(QUESTIONS);
    expect(resume.map((x) => x.id)).toEqual(["resume"]);
    expect(about.map((x) => x.id)).toEqual(["name", "email", "phone"]);
    expect(custom.map((x) => x.id)).toEqual(["q_why1", "q_note"]);
  });
});

describe("formNotice", () => {
  test("words each code the route sends back", () => {
    expect(formNotice("required", "Email")).toBe("Please answer: Email");
    expect(formNotice("required", null)).toBe("Please answer every required question.");
    expect(formNotice("busy", null)).toContain("Too many applications");
  });

  test("anything else in the URL is no notice, an object's own keys included", () => {
    for (const code of [undefined, "", "nope", "constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(formNotice(code, null)).toBeNull();
    }
  });
});

describe("guideSteps", () => {
  test("asks only for required questions, and drops a section with none", () => {
    expect(steps.map((s) => [s.key, s.items.map((i) => i.field)])).toEqual([
      ["resume", ["a_resume"]],
      ["about", ["a_name", "a_email"]],
      ["questions", ["a_q_why1"]],
    ]);
    expect(guideSteps([q("name", "name")], (x) => x.id).map((s) => s.key)).toEqual(["about"]);
  });
});

describe("guideProgress", () => {
  test("counts what is done and points at the next item and its step", () => {
    expect(guideProgress(steps, new Set(["a_resume", "a_name"]))).toMatchObject({ total: 4, finished: 2, next: { field: "a_email" }, current: "about" });
  });

  test("everything done has no next", () => {
    expect(guideProgress(steps, new Set(["a_resume", "a_name", "a_email", "a_q_why1"]))).toMatchObject({ finished: 4, next: null, current: null });
  });
});

describe("questionLabel", () => {
  test("the old default asks for a link, so it reads as Resume; anything a team typed stays", () => {
    expect(questionLabel({ type: "resume", label: "Link to your resume" })).toBe("Resume");
    expect(questionLabel({ type: "resume", label: "Your CV" })).toBe("Your CV");
    expect(questionLabel({ type: "short_text", label: "Link to your resume" })).toBe("Link to your resume");
  });

  test("and the file's own refusals have words", () => {
    expect(formNotice("resume_too_big", null)).toMatch(/over 3 MB/);
    expect(formNotice("resume_invalid", null)).toMatch(/PDF/);
  });
});
