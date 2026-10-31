import { describe, expect, test } from "vitest";
import { defaultGraph, type ProcessDoc, type ProcessEdge, type ProcessNode } from "./process-graph";
import { jobStages, nextPlanStep, planMatches, processStages, stageList, stageNameFor, stepSeeds } from "./process-stages";

const ENG = "eng";
const SALES = "sales";
const departments = [
  { id: ENG, name: "Engineering", parentId: null, archived: false },
  { id: SALES, name: "Sales", parentId: null, archived: false },
];

const start: ProcessNode = { id: "in", kind: "start", x: 0, y: 0, label: "Applied" };
const end: ProcessNode = { id: "out", kind: "end", x: 0, y: 0, label: "Offer letter" };
const step = (id: string, label: string, type: ProcessNode["type"] = "interview"): ProcessNode => ({ id, kind: "stage", x: 0, y: 0, label, type });
const edge = (from: string, to: string, department?: string): ProcessEdge => ({ id: `${from}-${to}`, from, to, label: "", ...(department ? { department } : {}) });

/** Review, Testbench, a split to Tech or Pitch, a shared Final. */
const GRAPH: ProcessDoc = {
  nodes: [start, step("rev", "Application review", "review"), step("tb", "Testbench", "testbench"), { id: "split", kind: "route", x: 0, y: 0, label: "Split" }, step("tech", "Tech"), step("pitch", "Pitch"), step("final", "Final"), end],
  edges: [edge("in", "rev"), edge("rev", "tb"), edge("tb", "split"), edge("split", "tech", ENG), edge("split", "pitch", SALES), edge("tech", "final"), edge("pitch", "final"), edge("final", "out")],
};
const process = processStages(GRAPH, departments);
const eng = jobStages(process, { departmentId: ENG, steps: ["Tech", "Final"] });

describe("the levels", () => {
  test("parallel steps after a split are one stage, named by both", () => {
    expect(stageList(process).map((s) => s.name)).toEqual(["Application review", "Testbench", "Tech / Pitch", "Final", "Offer letter"]);
  });

  test("the same step on each branch is named once, in any case", () => {
    const same: ProcessDoc = {
      nodes: [start, { id: "split", kind: "route", x: 0, y: 0, label: "Split" }, step("a", "Team interview"), step("b", "team interview"), end],
      edges: [edge("in", "split"), edge("split", "a", ENG), edge("split", "b", SALES), edge("a", "out"), edge("b", "out")],
    };
    expect(stageList(processStages(same, departments))[0].name).toBe("Team interview");
  });
});

describe("a job's plan matching the process", () => {
  test("the same steps in any case match; another order, an extra step or none does not", () => {
    expect(planMatches(["tech", "FINAL"], ["Tech", "Final"])).toBe(true);
    expect(planMatches(["Final", "Tech"], ["Tech", "Final"])).toBe(false);
    expect(planMatches(["Tech"], ["Tech", "Final"])).toBe(false);
    expect(planMatches([], ["Tech", "Final"])).toBe(false);
    expect(planMatches([], null)).toBe(false);
  });

  test("a job that does not match, or has no way through, has no names", () => {
    expect(jobStages(process, { departmentId: ENG, steps: ["Pitch", "Final"] })).toBeNull();
    expect(jobStages(process, { departmentId: null, steps: ["Tech", "Final"] })).toBeNull();
  });
});

describe("a stage's name", () => {
  test("the three early stages land on the steps before the first interview, in order", () => {
    expect(stageNameFor(eng, "sourced", null)?.name).toBe("Application review");
    expect(stageNameFor(eng, "contacted", null)?.name).toBe("Application review");
    expect(stageNameFor(eng, "screening", null)?.name).toBe("Testbench");
  });

  test("with one step before the interviews, all three are that step; with three, one each", () => {
    const one = jobStages(processStages(defaultGraph(), []), { departmentId: null, steps: ["Team interview", "Final interview"] });
    expect(["sourced", "contacted", "screening"].map((s) => stageNameFor(one, s, null)?.name)).toEqual(["Application review", "Application review", "Application review"]);
    const three: ProcessDoc = {
      nodes: [start, step("a", "A", "review"), step("b", "B", "review"), step("c", "C", "testbench"), step("d", "D"), end],
      edges: [edge("in", "a"), edge("a", "b"), edge("b", "c"), edge("c", "d"), edge("d", "out")],
    };
    const job = jobStages(processStages(three, []), { departmentId: null, steps: ["D"] });
    expect(["sourced", "contacted", "screening"].map((s) => stageNameFor(job, s, null)?.name)).toEqual(["A", "B", "C"]);
  });

  test("interviewing is the level of the next step, the last with none left", () => {
    expect(stageNameFor(eng, "interviewing", "tech")?.name).toBe("Tech / Pitch");
    expect(stageNameFor(eng, "interviewing", "Final")?.name).toBe("Final");
    expect(stageNameFor(eng, "interviewing", null)?.name).toBe("Final");
    expect(stageNameFor(eng, "interviewing", "Tech")?.order).toBe(2);
  });

  test("offer is the end node, and a closed stage is no step", () => {
    expect(stageNameFor(eng, "offer", null)).toEqual({ name: "Offer letter", order: 4 });
    for (const closed of ["hired", "rejected", "withdrawn"]) expect(stageNameFor(eng, closed, null)).toBeNull();
  });

  test("no job, no leading step or a nameless end keeps today's label", () => {
    expect(stageNameFor(null, "screening", null)).toBeNull();
    const bare: ProcessDoc = { nodes: [start, step("a", "Chat"), { ...end, label: " " }], edges: [edge("in", "a"), edge("a", "out")] };
    const job = jobStages(processStages(bare, []), { departmentId: null, steps: ["Chat"] });
    expect(stageNameFor(job, "sourced", null)).toBeNull();
    expect(stageNameFor(job, "offer", null)).toBeNull();
  });
});

describe("nextPlanStep", () => {
  test("the first step with nothing scheduled or held, as core's nextStep", () => {
    expect(nextPlanStep(["A", "B"], [])).toBe("A");
    expect(nextPlanStep(["A", "B"], [{ step: "a", status: "done" }])).toBe("B");
    expect(nextPlanStep(["A", "B"], [{ step: "A", status: "scheduled" }, { step: "B", status: "cancelled" }])).toBe("B");
    expect(nextPlanStep(["A"], [{ step: "A", status: "done" }])).toBeNull();
    expect(nextPlanStep(["A"], [{ step: null, status: "done" }])).toBe("A");
  });
});

describe("stepSeeds", () => {
  test("each department's interviews, as Apply would write them", () => {
    expect(stepSeeds(process)).toEqual({ byDepartment: { eng: ["Tech", "Final"], sales: ["Pitch", "Final"] }, none: [] });
  });

  test("a drawing with problems seeds nothing", () => {
    expect(stepSeeds(processStages({ nodes: [start], edges: [] }, []))).toBeNull();
  });
});
