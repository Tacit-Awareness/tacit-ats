import { describe, expect, test } from "vitest";
import { SETUP_STEPS, processSummary, setupChecklist, stepHref, stepOf, type SetupFacts } from "./setup-checklist";

const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({ people: ["a", "b"], teams: [], types: [], process: null, ...over });
const item = (f: SetupFacts, key: string) => setupChecklist(f).items.find((i) => i.key === key)!;

describe("the steps", () => {
  test("are the prototype's five, in order, each with its own page", () => {
    expect(SETUP_STEPS.map((s) => s.label)).toEqual(["People", "Teams", "Interview skills", "Interview process", "Review"]);
    expect(stepHref("process")).toBe("/client/onboarding/process");
  });

  test("a path names its step, and anything else is the first", () => {
    expect(stepOf("/client/onboarding/skills")).toBe("skills");
    expect(stepOf("/client/onboarding")).toBe("people");
    expect(stepOf("/client/onboarding/nope")).toBe("people");
  });
});

describe("People", () => {
  test("is not done with only the first admin, and is with anyone else", () => {
    expect(item(facts({ people: ["a"] }), "people")).toMatchObject({ done: false, detail: "Just you so far" });
    expect(item(facts(), "people")).toMatchObject({ done: true, detail: "2 people" });
  });
});

describe("Teams", () => {
  test("needs a team, with everyone on one", () => {
    expect(item(facts(), "teams")).toMatchObject({ done: false, detail: "No teams yet" });
    expect(item(facts({ teams: [{ members: ["a"] }] }), "teams")).toMatchObject({ done: false, detail: "1 team, 1 of 2 people on one" });
    expect(item(facts({ teams: [{ members: ["a"] }, { members: ["b", "a"] }] }), "teams")).toMatchObject({ done: true, detail: "2 teams, 2 of 2 people on one" });
  });

  test("someone who left does not stand in for someone who has not been placed", () => {
    expect(item(facts({ teams: [{ members: ["a", "gone"] }] }), "teams").done).toBe(false);
  });
});

describe("Interview skills", () => {
  test("needs a type, with everyone running one, and counts the types covered", () => {
    expect(item(facts(), "skills")).toMatchObject({ done: false, detail: "No interview types yet" });
    expect(item(facts({ types: [{ interviewers: ["a"] }, { interviewers: [] }] }), "skills")).toMatchObject({ done: false, detail: "1 of 2 interview types covered" });
    expect(item(facts({ types: [{ interviewers: ["a", "b"] }, { interviewers: [] }] }), "skills").done).toBe(true);
  });
});

describe("Interview process", () => {
  test("needs an interview in it", () => {
    expect(item(facts(), "process")).toMatchObject({ done: false, detail: "Not drawn yet" });
    expect(item(facts({ process: { steps: 2, interviews: 0 } }), "process")).toMatchObject({ done: false, detail: "2 steps, 0 interviews" });
    expect(item(facts({ process: { steps: 3, interviews: 1 } }), "process")).toMatchObject({ done: true, detail: "3 steps, 1 interview" });
  });

  test("the summary counts stage nodes and survives what it cannot read", () => {
    const nodes = [{ kind: "start" }, { kind: "stage", type: "review" }, { kind: "stage", type: "interview" }, null, "x", 3, { type: "interview" }];
    expect(processSummary({ nodes })).toEqual({ steps: 2, interviews: 1 });
    expect(processSummary({ nodes: [] })).toEqual({ steps: 0, interviews: 0 });
  });
});

describe("the whole list", () => {
  const all = facts({ teams: [{ members: ["a", "b"] }], types: [{ interviewers: ["a", "b"] }], process: { steps: 1, interviews: 1 } });

  test("Review is done when the other four are, and nothing else marks it", () => {
    expect(setupChecklist(all)).toMatchObject({ done: 5, total: 5, complete: true });
    expect(item(all, "review")).toMatchObject({ done: true, detail: "All set" });
  });

  test("undoing one takes the tick back: nothing is stored", () => {
    const undone = setupChecklist({ ...all, process: null });
    expect(undone).toMatchObject({ done: 3, complete: false });
    expect(undone.items.at(-1)).toMatchObject({ done: false, detail: "1 step to go" });
  });

  test("a company with nothing set up has nothing ticked", () => {
    expect(setupChecklist(facts({ people: [] }))).toMatchObject({ done: 0, complete: false });
  });
});
