import { describe, expect, test } from "vitest";
import type { clientTools } from "@tacit-ats/core";
import { clientTools as tools } from "@tacit-ats/core";
import { defaultQuestions, draftFromPost, draftPayload, editorBlocks, newRoleDraft, previewQuestions } from "./posting-draft";
import { parseDraft } from "./posting-edit-rules";

const QUESTIONS: clientTools.Question[] = [
  { questionId: "name", type: "name", label: "Full name", required: true },
  { questionId: "email", type: "email", label: "Email", required: true },
  { questionId: "q_abcd1234", type: "select", label: "Team", required: false, options: ["A", "B"] },
];
const JOB = { title: "Engineer", location: "Paris" };

describe("editorBlocks", () => {
  test("nothing yet: a paragraph to type in and the prototype's two sections", () => {
    expect(editorBlocks(null)).toEqual([
      { kind: "text", text: "" },
      { kind: "list", heading: "What you'll do", lines: [""] },
      { kind: "list", heading: "You might be a fit if", lines: [""] },
    ]);
  });

  test("a post's own lists are all it gets", () => {
    expect(editorBlocks("Intro\n\nPerks\n- Lunch")).toEqual([
      { kind: "text", text: "Intro" },
      { kind: "list", heading: "Perks", lines: ["Lunch"] },
    ]);
  });

  test("a list first still gets the paragraph ahead of it", () => {
    expect(editorBlocks("- One")).toEqual([{ kind: "text", text: "" }, { kind: "list", heading: "", lines: ["One"] }]);
  });

  test("the sections it adds are dropped again if nobody fills them, so opening a post changes nothing", () => {
    for (const text of ["Two paragraphs\n\nof plain text", "Intro\n\nPerks\n- Lunch\n\nOutro", "- One"]) {
      const draft = draftFromPost({ job: JOB, departmentId: null, steps: [], post: { title: "T", location: null, description: text, questions: QUESTIONS } });
      expect(draftPayload(draft).description).toBe(text);
    }
  });
});

describe("draftFromPost", () => {
  test("a post is what it says", () => {
    const draft = draftFromPost({ job: JOB, departmentId: "d1", steps: ["Screen"], post: { title: "Post title", location: "Rome", description: "Hi", questions: QUESTIONS } });
    expect(draft).toMatchObject({ title: "Post title", location: "Rome", departmentId: "d1", steps: ["Screen"] });
    expect(draft.questions.map((q) => q.key)).toEqual(["name", "email", "q_abcd1234"]);
    expect(draft.questions[2].options).toEqual(["A", "B"]);
  });

  test("a job with no post starts from the job, with the default form", () => {
    const draft = draftFromPost({ job: JOB, departmentId: null, steps: [], post: null });
    expect(draft).toMatchObject({ title: "Engineer", location: "Paris", departmentId: "" });
    expect(draft.questions).toEqual(defaultQuestions());
  });

  test("a post with no location of its own shows the job's", () => {
    expect(draftFromPost({ job: JOB, departmentId: null, steps: [], post: { title: "T", location: null, description: null, questions: QUESTIONS } }).location).toBe("Paris");
  });
});

describe("draftPayload", () => {
  test("carries no keys, the steps filled in, and choices only on a dropdown", () => {
    const draft = draftFromPost({ job: JOB, departmentId: null, steps: ["Screen", "  "], post: { title: "T", location: null, description: "Hi", questions: QUESTIONS } });
    draft.questions[2] = { ...draft.questions[2], options: ["A", " ", "B "] };
    draft.questions.push({ key: "new-1", type: "short_text", label: "Why?", required: true, options: ["left over"] });
    const payload = draftPayload(draft);
    expect(payload.departmentId).toBeNull();
    expect(payload.steps).toEqual(["Screen"]);
    expect(payload.questions[2]).toEqual({ questionId: "q_abcd1234", type: "select", label: "Team", required: false, options: ["A", "B"] });
    expect(payload.questions[3]).toEqual({ type: "short_text", label: "Why?", required: true });
  });

  test("what the editor sends passes the server's rules, and core's", () => {
    const parsed = parseDraft(draftPayload({ ...newRoleDraft(null), title: "Engineer" }));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.draft.questions.map((q) => q.type)).toEqual(["name", "email", "phone", "linkedin", "resume", "yes_no", "yes_no", "short_text"]);
    expect(tools.buildQuestions(parsed.draft.questions)).toHaveLength(8);
  });
});

describe("previewQuestions", () => {
  test("is what a save keeps: no blank questions, no blank choices", () => {
    const draft = newRoleDraft(null);
    draft.questions = [
      ...draft.questions.slice(0, 2),
      { key: "a", type: "short_text", label: "  ", required: true, options: [] },
      { key: "b", type: "select", label: "Pick", required: false, options: ["One", " "] },
    ];
    expect(previewQuestions(draft).slice(2)).toEqual([{ questionId: "b", type: "select", label: "Pick", required: false, options: ["One"] }]);
  });
});
