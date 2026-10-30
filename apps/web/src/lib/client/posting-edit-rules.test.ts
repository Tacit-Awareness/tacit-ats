import { describe, expect, test } from "vitest";
import { parseDraft, parseSeenJob } from "./posting-edit-rules";

const DEPT = "f5e00000-0000-4000-8000-0000000000f1";
const QUESTIONS = [
  { type: "name", label: "Full name", required: true },
  { type: "email", label: "Email", required: true },
];
const DRAFT = { title: "Engineer", location: "Paris", departmentId: null, description: "Hello", steps: ["Screen"], questions: QUESTIONS };
const error = (patch: Record<string, unknown>) => {
  const parsed = parseDraft({ ...DRAFT, ...patch });
  return parsed.ok ? null : parsed.error;
};
const questions = (...extra: unknown[]) => {
  const parsed = parseDraft({ ...DRAFT, questions: [...QUESTIONS, ...extra] });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.draft.questions;
};

describe("parseDraft", () => {
  test("reads a draft, tidying what was typed", () => {
    expect(parseDraft({ ...DRAFT, title: "  Staff\n Engineer ", location: "  ", description: "\n Hi \n", departmentId: DEPT, steps: [" Screen ", "", "  Onsite"] })).toEqual({
      ok: true,
      draft: { title: "Staff Engineer", location: null, departmentId: DEPT, description: "Hi", steps: ["Screen", "Onsite"], questions: QUESTIONS },
    });
  });

  test.each([null, undefined, "text", 3, [], { title: "x" }])("anything not a draft is refused: %j", (raw) => {
    expect(parseDraft(raw).ok).toBe(false);
  });

  test("the title is needed and bounded", () => {
    expect(error({ title: "   " })).toBe("title_required");
    expect(error({ title: 7 })).toBe("title_required");
    expect(error({ title: "x".repeat(201) })).toBe("title_too_long");
    expect(error({ title: "x".repeat(200) })).toBeNull();
  });

  test("the location and description are bounded", () => {
    expect(error({ location: "x".repeat(201) })).toBe("location_too_long");
    expect(error({ description: "x".repeat(20_001) })).toBe("description_too_long");
    expect(error({ description: "x".repeat(20_000) })).toBeNull();
  });

  test("a department is an id or nothing", () => {
    expect(error({ departmentId: "" })).toBeNull();
    expect(error({ departmentId: "Engineering" })).toBe("invalid_department");
    expect(error({ departmentId: 4 })).toBe("invalid_department");
  });

  test("steps follow the plan's limits, and a repeat in any case is refused", () => {
    expect(error({ steps: Array.from({ length: 16 }, (_, i) => `Step ${i}`) })).toBe("too_many_steps");
    expect(error({ steps: ["x".repeat(121)] })).toBe("step_too_long");
    expect(error({ steps: ["Onsite", " onsite "] })).toBe("step_repeated");
    expect(error({ steps: "Onsite" })).toBe("invalid");
  });

  test("a blank custom question is dropped, as the prototype's", () => {
    expect(questions({ type: "short_text", label: "   ", required: true })).toEqual(QUESTIONS);
  });

  test("a question is bounded, and a type must be one the database takes", () => {
    expect(error({ questions: [...QUESTIONS, { type: "short_text", label: "x".repeat(301) }] })).toBe("question_too_long");
    expect(error({ questions: [...QUESTIONS, { type: "date", label: "Start" }] })).toBe("invalid_questions");
    expect(error({ questions: Array.from({ length: 41 }, () => ({ type: "short_text", label: "Q" })) })).toBe("too_many_questions");
  });

  test("name and email stay required whatever was posted", () => {
    const parsed = parseDraft({ ...DRAFT, questions: [{ type: "name", required: false }, { type: "email", required: false }] });
    expect(parsed).toMatchObject({ ok: true, draft: { questions: [{ type: "name", required: true }, { type: "email", required: true }] } });
  });

  test("a built-in appears once", () => {
    expect(error({ questions: [...QUESTIONS, { type: "phone" }, { type: "phone" }] })).toBe("invalid_questions");
  });

  test("a custom id is checked; a built-in's is ignored", () => {
    expect(error({ questions: [...QUESTIONS, { type: "yes_no", label: "Q", questionId: "../etc" }] })).toBe("invalid_questions");
    expect(questions({ type: "yes_no", label: "Q", questionId: "q_abcd1234" })[2]).toMatchObject({ questionId: "q_abcd1234" });
    expect(questions({ type: "phone", label: "Phone", questionId: "q_abcd1234" })[2]).not.toHaveProperty("questionId");
  });

  test("a dropdown has two different choices at least; blanks do not count", () => {
    const select = (options: unknown) => ({ questions: [...QUESTIONS, { type: "select", label: "Pick", options }] });
    expect(error(select(["One", " "]))).toBe("options_needed");
    expect(error(select(["One", " One "]))).toBe("options_needed");
    expect(error(select(["x".repeat(201), "y"]))).toBe("options_needed");
    expect(error(select(Array.from({ length: 51 }, (_, i) => `o${i}`)))).toBe("options_needed");
    expect(error(select("One"))).toBe("options_needed");
    expect(questions({ type: "select", label: "Pick", options: [" One ", "", "Two"] })[2]).toMatchObject({ options: ["One", "Two"] });
  });

  test("only a dropdown carries choices", () => {
    expect(questions({ type: "short_text", label: "Q", options: ["a", "b"] })[2]).not.toHaveProperty("options");
  });

  test("what the database or the plan would refuse never gets as far as making a job", () => {
    const parsed = parseDraft({
      ...DRAFT,
      title: "Staff\u0000 Engineer\ud83d",
      location: "Par\u0007is",
      description: "Hello\u0000 \ud83d world 🙂",
      steps: ["Sc\u0007reen", "\u001b"],
      questions: [...QUESTIONS, { type: "select", label: "Pi\u0000ck", options: ["O\u0000ne", "T\udc00wo"] }],
    });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(JSON.stringify(parsed.draft)).not.toMatch(/\\u00|\\ud[89a-f]/);
    expect(parsed.draft.steps).toEqual(["Sc reen"]);
    expect(parsed.draft.description).toBe("Hello  world 🙂");
  });
});

describe("parseSeenJob", () => {
  test("reads what the editor opened, tidied the way the draft is", () => {
    expect(parseSeenJob({ steps: [" Screen  one ", ""], departmentId: DEPT })).toEqual({ steps: ["Screen one"], departmentId: DEPT });
    expect(parseSeenJob({ steps: [], departmentId: "" })).toEqual({ steps: [], departmentId: null });
  });

  test.each([null, undefined, "x", 3, [], { steps: "Screen" }, { steps: [] }, { steps: [], departmentId: 4 }])("anything else is no record at all: %j", (raw) => {
    expect(parseSeenJob(raw)).toBeNull();
  });
});
