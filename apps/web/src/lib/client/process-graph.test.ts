import { describe, expect, test } from "vitest";
import { clientTools } from "@tacit-ats/core";
import type { DepartmentNode } from "./department-tree";
import {
  EDGES_MAX, NODES_MAX, PATH_STEPS_MAX, STEP_NAME_MAX, cleanGraph, defaultGraph, departmentChain, edgeName, formatMins, jobSteps, levelsOf, pathFor, planChange,
  readGraph, stepWho, summaryOf, validateGraph,
  type NodeKind, type ProcessDoc, type ProcessEdge, type ProcessLookup, type ProcessNode,
} from "./process-graph";
import { processSummary } from "./setup-checklist";

const dept = (id: string, name: string, parentId: string | null = null, archived = false): DepartmentNode => ({ id, name, parentId, archived });
const ENG = dept("eng", "Engineering");
const PLATFORM = dept("platform", "Platform", "eng");
const KERNEL = dept("kernel", "Kernel", "platform");
const SALES = dept("sales", "Sales");
const OLD = dept("old", "Old team", null, true);
const DEPTS = [ENG, PLATFORM, KERNEL, SALES, OLD];
const lookup = (departments = DEPTS, members = [{ id: "ada", name: "Ada Admin" }]): ProcessLookup => ({ departments, members });

const n = (id: string, kind: NodeKind, label = id, extra: Partial<ProcessNode> = {}): ProcessNode => ({ id, kind, x: 0, y: 0, label, ...extra });
const stage = (id: string, extra: Partial<ProcessNode> = {}) => n(id, "stage", id, { type: "interview", ...extra });
const e = (from: string, to: string, department?: string, label = ""): ProcessEdge => ({ id: `${from}-${to}`, from, to, label, ...(department ? { department } : {}) });

/** start -> screen -> split -> (eng | sales | default) -> final -> end */
function splitGraph(): ProcessDoc {
  return {
    nodes: [
      n("in", "start"), stage("screen", { type: "review" }), n("split", "route"),
      stage("eng-round"), stage("sales-round"), stage("general"), stage("final"), n("out", "end"), n("sticky", "note"),
    ],
    edges: [
      e("in", "screen"), e("screen", "split"), e("split", "eng-round", "eng"), e("split", "sales-round", "sales"), e("split", "general"),
      e("eng-round", "final"), e("sales-round", "final"), e("general", "final"), e("final", "out"),
    ],
  };
}
const line = (...names: string[]): ProcessDoc => {
  const nodes = [n("in", "start"), ...names.map((x, i) => stage(`s${i}`, { label: x })), n("out", "end")];
  return { nodes, edges: nodes.slice(1).map((to, i) => e(nodes[i].id, to.id)) };
};
const codes = (graph: ProcessDoc, l = lookup()) => validateGraph(graph, l).problems.map((p) => p.code);

describe("the limits", () => {
  test("are core's", () => {
    expect(PATH_STEPS_MAX).toBe(clientTools.PLAN_STEPS_MAX);
    expect(STEP_NAME_MAX).toBe(clientTools.STEP_NAME_MAX);
  });
});

describe("defaultGraph", () => {
  test("is neutral, valid, and something the checklist counts", () => {
    const graph = defaultGraph();
    expect(validateGraph(graph, lookup([], []))).toEqual({ problems: [], gaps: [] });
    expect(validateGraph(graph, lookup())).toEqual({ problems: [], gaps: [] });
    expect(graph.nodes.map((x) => x.label)).toEqual(["Applied", "Application review", "Team interview", "Final interview", "Offer"]);
    expect(graph.nodes.some((x) => x.kind === "route" || x.who)).toBe(false);
    expect(processSummary(graph)).toEqual({ steps: 3, interviews: 2 });
    expect(cleanGraph(graph)).toEqual(graph);
  });
});

describe("readGraph", () => {
  test("keeps what it can draw and leaves out the rest", () => {
    const graph = readGraph({
      nodes: [n("a", "start"), n("b", "end"), { id: "c" }, "text", null, n("a", "end"), { ...n("d", "note"), x: "1" }],
      edges: [e("a", "b"), e("a", "missing"), { id: "x" }, 4],
    });
    expect(graph.nodes.map((x) => x.id)).toEqual(["a", "b"]);
    expect(graph.edges.map((x) => x.id)).toEqual(["a-b"]);
  });

  test.each([[null], [[]], ["graph"], [{ nodes: 1, edges: [] }]])("reads %j as nothing", (raw) => {
    expect(readGraph(raw)).toEqual({ nodes: [], edges: [] });
  });

  test("a stage's bad fields fall away, and a step with no kind is an interview", () => {
    const [node] = readGraph({ nodes: [{ ...n("a", "stage"), type: "x", team: "not a team!", who: ["ada", "ada", 3], mins: -5 }], edges: [] }).nodes;
    expect(node).toEqual({ id: "a", kind: "stage", x: 0, y: 0, label: "a", type: "interview", who: ["ada"] });
  });

  test("a route carries no stage fields, and coordinates are bounded whole numbers", () => {
    const [node] = readGraph({ nodes: [{ ...n("a", "route"), x: 1.4, y: 9e9, team: "own", mins: 60 }], edges: [] }).nodes;
    expect(node).toEqual({ id: "a", kind: "route", x: 1, y: 100000, label: "a" });
  });
});

describe("cleanGraph", () => {
  test("refuses rather than dropping", () => {
    expect(cleanGraph({ nodes: [n("a", "start"), { id: "b" }], edges: [] })).toBeNull();
    expect(cleanGraph({ nodes: [n("a", "start")], edges: [e("a", "gone")] })).toBeNull();
    expect(cleanGraph({ nodes: [n("a", "start"), n("b", "end")], edges: [e("a", "b"), e("a", "b")] })).toBeNull();
    expect(cleanGraph({ nodes: [n("a", "start"), n("a", "end")], edges: [] })).toBeNull();
    expect(cleanGraph("graph")).toBeNull();
  });

  test("has a size limit, and a node's id must be a plain one", () => {
    expect(cleanGraph({ nodes: Array.from({ length: NODES_MAX + 1 }, (_, i) => n(`n${i}`, "note")), edges: [] })).toBeNull();
    expect(cleanGraph({ nodes: [], edges: Array.from({ length: EDGES_MAX + 1 }, (_, i) => e("a", `b${i}`)) })).toBeNull();
    expect(cleanGraph({ nodes: [n("<b>", "note")], edges: [] })).toBeNull();
  });
});

describe("departmentChain", () => {
  test("is the department and those it sits in, nearest first", () => {
    expect(departmentChain(DEPTS, "kernel")).toEqual(["kernel", "platform", "eng"]);
    expect(departmentChain(DEPTS, null)).toEqual([]);
    expect(departmentChain(DEPTS, "unknown")).toEqual(["unknown"]);
  });

  test("a loop stops the walk", () => {
    expect(departmentChain([dept("a", "A", "b"), dept("b", "B", "a")], "a")).toEqual(["a", "b"]);
  });
});

describe("pathFor", () => {
  const ids = (departmentId: string | null, graph = splitGraph(), departments = DEPTS) => pathFor(graph, departmentId, departments).nodes.map((x) => x.id);

  test("takes the department's branch", () => {
    expect(ids("eng")).toEqual(["in", "screen", "split", "eng-round", "final", "out"]);
    expect(ids("sales")).toEqual(["in", "screen", "split", "sales-round", "final", "out"]);
  });

  test("a department with no branch takes the default edge, and so does a job in none", () => {
    expect(ids("old")).toEqual(["in", "screen", "split", "general", "final", "out"]);
    expect(ids(null)).toEqual(["in", "screen", "split", "general", "final", "out"]);
  });

  test("a nested department takes its nearest department's branch", () => {
    expect(ids("kernel")).toContain("eng-round");
    const graph = splitGraph();
    graph.nodes.push(stage("platform-round"));
    graph.edges.push(e("split", "platform-round", "platform"), e("platform-round", "final"));
    expect(ids("kernel", graph)).toContain("platform-round");
    expect(ids("platform", graph)).toContain("platform-round");
    expect(ids("eng", graph)).toContain("eng-round");
  });

  test("a job in an archived department still goes down its branch", () => {
    const graph = splitGraph();
    graph.nodes.push(stage("old-round"));
    graph.edges.push(e("split", "old-round", "old"), e("old-round", "final"));
    expect(ids("old", graph)).toContain("old-round");
  });

  test("says where it stopped and why", () => {
    const graph = splitGraph();
    graph.edges = graph.edges.filter((x) => x.to !== "general");
    expect(pathFor(graph, null, DEPTS)).toMatchObject({ complete: false, stop: "no_branch", stoppedAt: { id: "split" } });
    graph.edges = graph.edges.filter((x) => x.from !== "final");
    expect(pathFor(graph, "eng", DEPTS)).toMatchObject({ complete: false, stop: "dead_end", stoppedAt: { id: "final" } });
    expect(pathFor({ nodes: [], edges: [] }, "eng", DEPTS)).toMatchObject({ complete: false, stop: "no_start" });
  });

  test("a loop ends the walk", () => {
    const graph = line("a", "b");
    graph.edges.push(e("s1", "s0"));
    graph.edges = graph.edges.filter((x) => x.to !== "out");
    expect(pathFor(graph, null, DEPTS)).toMatchObject({ complete: false, stop: "loop", stoppedAt: { id: "s0" } });
  });

  test("a note is never on the way", () => {
    const graph = line("a");
    graph.nodes.push(n("sticky", "note"));
    graph.edges = [e("in", "sticky"), ...graph.edges];
    expect(pathFor(graph, null, DEPTS).nodes.map((x) => x.id)).toEqual(["in", "s0", "out"]);
  });
});

describe("jobSteps", () => {
  test("is the path's interviews, trimmed, in order", () => {
    const graph = splitGraph();
    graph.nodes.find((x) => x.id === "final")!.label = "  Final  ";
    expect(jobSteps(graph, "eng", DEPTS)).toEqual(["eng-round", "Final"]);
    expect(jobSteps(graph, "sales", DEPTS)).toEqual(["sales-round", "Final"]);
  });

  test("leaves out reviews and Testbenches", () => {
    const graph = line("a", "b", "c");
    graph.nodes[1].type = "review";
    graph.nodes[2].type = "testbench";
    expect(jobSteps(graph, null, DEPTS)).toEqual(["c"]);
  });

  test("is null with no way through", () => {
    const graph = splitGraph();
    graph.edges = graph.edges.filter((x) => x.to !== "general");
    expect(jobSteps(graph, null, DEPTS)).toBeNull();
    expect(jobSteps(graph, "eng", DEPTS)).not.toBeNull();
  });
});

describe("levelsOf", () => {
  const names = (graph: ProcessDoc) => levelsOf(graph).map((level) => level.map((x) => x.id));

  test("steps side by side after a split are one level", () => {
    expect(names(splitGraph())).toEqual([["screen"], ["eng-round", "sales-round", "general"], ["final"]]);
  });

  test("a step reached by a longer way sits after the longest", () => {
    const graph = splitGraph();
    graph.nodes.push(stage("extra"));
    graph.edges = graph.edges.filter((x) => x.id !== "eng-round-final");
    graph.edges.push(e("eng-round", "extra"), e("extra", "final"));
    expect(names(graph)).toEqual([["screen"], ["eng-round", "sales-round", "general"], ["extra"], ["final"]]);
  });

  test("nested splits", () => {
    const graph: ProcessDoc = {
      nodes: [n("in", "start"), n("a", "route"), n("b", "route"), stage("x"), stage("y"), stage("z"), n("out", "end")],
      edges: [e("in", "a"), e("a", "b", "eng"), e("a", "z"), e("b", "x", "platform"), e("b", "y"), e("x", "out"), e("y", "out"), e("z", "out")],
    };
    expect(names(graph)).toEqual([["x", "y", "z"]]);
    expect(jobSteps(graph, "kernel", DEPTS)).toEqual(["x"]);
    expect(jobSteps(graph, "eng", DEPTS)).toEqual(["y"]);
    expect(jobSteps(graph, "sales", DEPTS)).toEqual(["z"]);
  });

  test("leaves out what cannot be reached, and survives a loop and no start", () => {
    const graph = line("a", "b");
    graph.nodes.push(stage("floating"));
    expect(names(graph)).toEqual([["s0"], ["s1"]]);
    graph.edges.push(e("s1", "s0"));
    expect(names(graph).flat().sort()).toEqual(["s0", "s1"]);
    expect(levelsOf({ nodes: [stage("a")], edges: [] })).toEqual([]);
  });
});

describe("validateGraph", () => {
  test("a split with a branch per team and a default is fine", () => {
    expect(codes(splitGraph())).toEqual([]);
  });

  test("one start, one end", () => {
    const graph = line("a");
    expect(codes({ ...graph, nodes: graph.nodes.slice(1), edges: [] })).toContain("no_start");
    expect(codes({ ...graph, nodes: [...graph.nodes, n("in2", "start")] })).toContain("many_starts");
    expect(codes({ ...graph, nodes: graph.nodes.slice(0, -1), edges: graph.edges.slice(0, -1) })).toContain("no_end");
    expect(codes({ ...graph, nodes: [...graph.nodes, n("out2", "end")] })).toContain("many_ends");
  });

  test("no cycles", () => {
    const graph = line("a", "b", "c");
    graph.edges.push(e("s2", "s0"));
    expect(codes({ ...graph, edges: graph.edges.filter((x) => x.to !== "out") })).toContain("cycle");
    const loop: ProcessDoc = { nodes: [n("in", "start"), stage("a"), stage("b"), n("out", "end")], edges: [e("in", "a"), e("a", "b"), e("b", "a"), e("a", "out")] };
    expect(codes(loop)).toContain("cycle");
  });

  test("a cycle off to one side is still a cycle", () => {
    const graph = line("a");
    graph.nodes.push(stage("x"), stage("y"));
    graph.edges.push(e("x", "y"), e("y", "x"));
    expect(codes(graph)).toEqual(["cycle"]);
  });

  test("at most fifteen steps on a path", () => {
    const steps = (count: number) => Array.from({ length: count }, (_, i) => `Step ${i}`);
    expect(codes(line(...steps(15)))).toEqual([]);
    expect(codes(line(...steps(16)))).toEqual(["too_many_steps"]);
  });

  test("the limit is per path, not on the whole graph", () => {
    // Twelve steps down each of two branches: 26 in the graph, 14 on either way through.
    const graph: ProcessDoc = {
      nodes: [n("in", "start"), stage("first"), n("split", "route"), stage("last"), n("out", "end")],
      edges: [e("in", "first"), e("first", "split"), e("last", "out")],
    };
    for (const [prefix, team] of [["a", "eng"], ["b", undefined]] as const) {
      let from = "split";
      for (let i = 0; i < 12; i++) {
        graph.nodes.push(stage(`${prefix}${i}`));
        graph.edges.push(e(from, `${prefix}${i}`, i === 0 ? team : undefined));
        from = `${prefix}${i}`;
      }
      graph.edges.push(e(from, "last"));
    }
    expect(codes(graph)).toEqual([]);
    graph.nodes.push(stage("more"), stage("again"));
    graph.edges = graph.edges.filter((x) => x.to !== "last" || x.from !== "a11");
    graph.edges.push(e("a11", "more"), e("more", "again"), e("again", "last"));
    expect(codes(graph)).toEqual(["too_many_steps"]);
  });

  test("names on a path are unique, whatever the case", () => {
    expect(codes(line("Onsite", " onsite "))).toEqual(["duplicate_step"]);
  });

  test("the same name on two branches is not a duplicate: nobody takes both", () => {
    const graph = splitGraph();
    for (const id of ["eng-round", "sales-round", "general"]) graph.nodes.find((x) => x.id === id)!.label = "Team interview";
    expect(codes(graph)).toEqual([]);
  });

  test("every step needs a one-line name of a plan's length", () => {
    expect(codes(line("  "))).toEqual(["unnamed_step"]);
    expect(codes(line("x".repeat(STEP_NAME_MAX + 1)))).toEqual(["bad_step_name"]);
    expect(codes(line("two\nlines"))).toEqual(["bad_step_name"]);
    expect(codes(line("x".repeat(STEP_NAME_MAX)))).toEqual([]);
  });

  test("every department has a branch or a default edge", () => {
    const graph = splitGraph();
    graph.edges = graph.edges.filter((x) => x.to !== "general");
    const departments = [...DEPTS, dept("design", "Design"), dept("ops", "Ops")];
    const { problems } = validateGraph(graph, lookup(departments));
    expect(problems).toMatchObject([{ code: "no_branch", nodeId: "split", message: "split has no branch for Design and Ops, and no branch for everyone else." }]);
    // Platform and Kernel are Engineering's, and Old is archived, so none of them is asked for.
    expect(codes(graph)).toEqual([]);
  });

  test("a department nested under a branch is covered by it", () => {
    const graph = splitGraph();
    graph.edges = graph.edges.filter((x) => x.to !== "general" && x.to !== "sales-round");
    const { problems } = validateGraph(graph, lookup([ENG, PLATFORM, KERNEL]));
    expect(problems).toEqual([]);
  });

  test("with no departments at all a split needs its default edge", () => {
    const graph = splitGraph();
    expect(codes(graph, lookup([]))).toEqual([]);
    graph.edges = graph.edges.filter((x) => x.to !== "general");
    expect(codes(graph, lookup([]))).toEqual(["no_branch"]);
  });

  test("a job in no team is not required a way through while teams are", () => {
    const graph = splitGraph();
    graph.edges = graph.edges.filter((x) => x.to !== "general");
    expect(codes(graph, lookup([ENG, SALES]))).toEqual([]);
    expect(jobSteps(graph, null, [ENG, SALES])).toBeNull();
  });

  test("a step that leads nowhere", () => {
    const graph = line("a", "b");
    graph.edges = graph.edges.filter((x) => x.from !== "s1");
    expect(codes(graph)).toEqual(["dead_end"]);
    expect(codes({ ...graph, edges: [] })).toEqual(["dead_end"]);
  });

  test("only a split goes two ways", () => {
    const graph = line("a", "b");
    graph.edges.push(e("s0", "out"));
    expect(codes(graph)).toEqual(["fork"]);
  });

  test("a split has one default and one branch a team", () => {
    const graph = splitGraph();
    graph.edges = [...graph.edges, e("split", "final")];
    expect(codes(graph)).toContain("two_defaults");
    const twice = splitGraph();
    twice.edges = [...twice.edges, { ...e("split", "final", "eng"), id: "again" }];
    expect(codes(twice)).toContain("two_branches");
  });

  test("the same problem from many departments is said once", () => {
    const graph = line("a", "a");
    expect(validateGraph(graph, lookup()).problems).toHaveLength(1);
  });
});

describe("gaps", () => {
  const gaps = (graph: ProcessDoc, l = lookup()) => validateGraph(graph, l);

  test("an archived team is a gap, not an error", () => {
    const graph = line("a");
    graph.nodes[1].team = "old";
    const { problems, gaps: found } = gaps(graph);
    expect(problems).toEqual([]);
    expect(found).toMatchObject([{ code: "archived_team", nodeId: "s0" }]);
    expect(stepWho(graph.nodes[1], lookup())).toEqual({ tag: "Old team (archived)", gap: true });
  });

  test("a team gone altogether is a gap too", () => {
    const graph = line("a");
    graph.nodes[1].team = "deleted-team";
    expect(gaps(graph).problems).toEqual([]);
    expect(stepWho(graph.nodes[1], lookup())).toEqual({ tag: "A team no longer here", gap: true });
  });

  test("a branch for an archived team is a gap, and everyone else is still asked for", () => {
    const graph = splitGraph();
    graph.nodes.push(stage("old-round"));
    graph.edges.push(e("split", "old-round", "old"), e("old-round", "final"));
    const { problems, gaps: found } = gaps(graph);
    expect(problems).toEqual([]);
    expect(found).toMatchObject([{ code: "archived_team", edgeId: "split-old-round" }]);
    expect(edgeName(graph.edges[graph.edges.length - 2], DEPTS)).toBe("Old team");
  });

  test("a removed member is a gap, not an error, and the rest are still named", () => {
    const graph = line("a");
    graph.nodes[1].who = ["ada", "gone"];
    const { problems, gaps: found } = gaps(graph);
    expect(problems).toEqual([]);
    expect(found).toMatchObject([{ code: "person_left", nodeId: "s0" }]);
    expect(stepWho(graph.nodes[1], lookup())).toEqual({ tag: "Ada, 1 person left", gap: true });
    expect(stepWho({ ...graph.nodes[1], who: ["gone", "gone2"] }, lookup())).toEqual({ tag: "2 people left", gap: true });
  });

  test("a step on no path says so and stops nothing", () => {
    const graph = line("a");
    graph.nodes.push(stage("floating"));
    const { problems, gaps: found } = gaps(graph);
    expect(problems).toEqual([]);
    expect(found).toMatchObject([{ code: "unreached", nodeId: "floating" }]);
  });
});

describe("stepWho", () => {
  test("says it the way a person would", () => {
    const l = lookup();
    expect(stepWho(stage("a", { team: "job_owner" }), l).tag).toBe("Job owner");
    expect(stepWho(stage("a", { team: "own" }), l).tag).toBe("Their team");
    expect(stepWho(stage("a", { team: "partner" }), l).tag).toBe("Another team");
    expect(stepWho(stage("a", {}), l).tag).toBe("Their team");
    expect(stepWho(stage("a", { team: "eng" }), l).tag).toBe("Engineering");
    expect(stepWho(stage("a", { type: "testbench", team: "job_owner" }), l).tag).toBe("The candidate");
    expect(stepWho(stage("a", { team: "eng", who: ["ada"] }), l).tag).toBe("Ada");
  });
});

describe("edgeName", () => {
  test("its label, its team or the default", () => {
    expect(edgeName(e("a", "b", "eng", "Builders"), DEPTS)).toBe("Builders");
    expect(edgeName(e("a", "b", "eng"), DEPTS)).toBe("Engineering");
    expect(edgeName(e("a", "b"), DEPTS)).toBe("Everyone else");
    expect(edgeName(e("a", "b", "deleted"), DEPTS)).toBe("A team no longer here");
  });
});

describe("summaryOf and formatMins", () => {
  test("counts steps and interviews, an interview an hour until it says", () => {
    const graph = line("a", "b");
    graph.nodes[1].mins = 45;
    expect(summaryOf(graph)).toEqual({ steps: 2, interviews: 2, mins: 105 });
    expect(summaryOf(graph)).toMatchObject({ steps: processSummary(graph).steps, interviews: processSummary(graph).interviews });
  });

  test("says a length", () => {
    expect([undefined, 30, 60, 90, 180].map(formatMins)).toEqual(["", "30m", "1h", "1.5h", "3h"]);
  });
});

describe("planChange", () => {
  test("nothing changed", () => {
    expect(planChange(["A", "B"], ["A", "B"])).toEqual({ same: true, kept: ["A", "B"], added: [], removed: [], renamed: [] });
  });

  test("a step in the same place under a new name looks renamed", () => {
    expect(planChange(["Screen", "Tech", "Final"], ["Screen", "Technical", "Final"])).toMatchObject({ same: false, renamed: [{ from: "Tech", to: "Technical" }], added: [], removed: [] });
  });

  test("a change of case is kept: interviews match without it", () => {
    expect(planChange(["screen"], ["Screen"])).toMatchObject({ same: false, kept: ["Screen"], renamed: [], removed: [] });
  });

  test("an added step with nothing gone is just added, and one gone is just removed", () => {
    expect(planChange(["A"], ["A", "B"])).toMatchObject({ added: ["B"], renamed: [], removed: [] });
    expect(planChange(["A", "B"], ["A"])).toMatchObject({ added: [], renamed: [], removed: ["B"] });
  });

  test("a step that goes from one end and one that comes at the other are not a rename", () => {
    expect(planChange(["Old", "Keep"], ["Keep", "New"])).toMatchObject({ renamed: [], added: ["New"], removed: ["Old"] });
  });

  test("from an empty plan everything is added", () => {
    expect(planChange([], ["A", "B"])).toMatchObject({ added: ["A", "B"], renamed: [], removed: [] });
  });

  test("a reorder is a change with nothing added or removed", () => {
    expect(planChange(["A", "B"], ["B", "A"])).toMatchObject({ same: false, added: [], removed: [], renamed: [] });
  });
});
