import { describe, expect, test } from "vitest";
import type { DepartmentNode } from "./department-tree";
import {
  ZOOM_MAX, ZOOM_MIN, canConnect, clampZoom, edgePath, editorKey, editorReducer, editorState, fitView, leftOf, newId, newNode, toWorld, zoomAt,
  type EditorAction, type EditorState,
} from "./process-editor";
import { cleanGraph, defaultGraph, type ProcessDoc } from "./process-graph";

const ENG: DepartmentNode = { id: "eng", name: "Engineering", parentId: null, archived: false };
const OLD: DepartmentNode = { id: "old", name: "Old", parentId: null, archived: true };

const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, state);
const start = () => editorState(defaultGraph());
const add = (id = "n1") => ({ type: "add", node: newNode("stage", id, { x: 100, y: 100 }) }) as const;
const labels = (s: EditorState) => s.graph.nodes.map((n) => n.label);
const review = (s: EditorState) => s.graph.nodes.find((n) => n.id === "review")!;

describe("undo and redo", () => {
  test("nothing to undo or redo leaves the state alone", () => {
    const s = start();
    expect(editorReducer(s, { type: "undo" })).toBe(s);
    expect(editorReducer(s, { type: "redo" })).toBe(s);
  });

  test("an add undoes and redoes", () => {
    const added = run(start(), add());
    expect(added.graph.nodes).toHaveLength(6);
    expect(added.selection).toEqual({ t: "n", id: "n1" });
    const undone = run(added, { type: "undo" });
    expect(undone.graph).toEqual(defaultGraph());
    expect(undone.selection).toBeNull();
    expect(run(undone, { type: "redo" }).graph).toEqual(added.graph);
  });

  test("a new change clears what could be redone", () => {
    const s = run(start(), add("a"), { type: "undo" }, add("b"));
    expect(s.future).toEqual([]);
    expect(editorReducer(s, { type: "redo" })).toBe(s);
  });

  test("keeps eighty steps", () => {
    let s = start();
    for (let i = 0; i < 100; i++) s = run(s, add(`n${i}`));
    expect(s.past).toHaveLength(80);
    for (let i = 0; i < 100; i++) s = run(s, { type: "undo" });
    expect(s.graph.nodes).toHaveLength(5 + 20);
  });

  test("keystrokes in one field are one undo", () => {
    const type = (label: string): EditorAction => ({ type: "patchNode", id: "review", patch: { label }, typing: "label:review" });
    const s = run(start(), type("S"), type("Sc"), type("Scr"));
    expect(s.past).toHaveLength(1);
    expect(review(run(s, { type: "undo" })).label).toBe("Application review");
  });

  test("a different field, or stepping away and back, is another undo", () => {
    const name = (label: string): EditorAction => ({ type: "patchNode", id: "review", patch: { label }, typing: "label:review" });
    const away = run(start(), name("A"), { type: "select", selection: null }, name("AB"));
    expect(away.past).toHaveLength(2);
    const other = run(start(), name("A"), { type: "patchNode", id: "team", patch: { label: "B" }, typing: "label:team" });
    expect(other.past).toHaveLength(2);
  });

  test("a pick that is not typing is its own undo", () => {
    const pick: EditorAction = { type: "patchNode", id: "review", patch: { mins: 30 } };
    expect(run(start(), pick, pick).past).toHaveLength(2);
  });

  test("selecting is not something to undo", () => {
    expect(run(start(), { type: "select", selection: { t: "n", id: "review" } }).past).toEqual([]);
  });

  test("history shares the graph rather than copying it", () => {
    const s = start();
    const next = run(s, add());
    expect(next.past[0]).toBe(s.graph);
    expect(s.graph.nodes).toHaveLength(5);
  });
});

describe("dragging", () => {
  const drag = (x: number, y: number): EditorAction => ({ type: "drag", id: "review", x, y });

  test("a whole drag is one undo, back to where it began", () => {
    const before = review(start());
    const s = run(start(), drag(301, 201), drag(320, 240), drag(400, 300), { type: "dragEnd" });
    expect(review(s)).toMatchObject({ x: 400, y: 300 });
    expect(s.past).toHaveLength(1);
    expect(review(run(s, { type: "undo" }))).toMatchObject({ x: before.x, y: before.y });
  });

  test("snaps to the four-pixel grid", () => {
    expect(review(run(start(), drag(301, 202)))).toMatchObject({ x: 300, y: 204 });
  });

  test("a press that moved nothing leaves no undo", () => {
    const s = start();
    const { x, y } = review(s);
    const same = run(s, drag(x, y), { type: "dragEnd" });
    expect(same.graph).toBe(s.graph);
    expect(same.past).toEqual([]);
  });

  test("a drag clears what could be redone only once it lands", () => {
    const s = run(start(), add(), { type: "undo" }, drag(400, 300));
    expect(s.future).toHaveLength(1);
    expect(run(s, { type: "dragEnd" }).future).toEqual([]);
  });
});

describe("connecting", () => {
  const graph: ProcessDoc = {
    nodes: [
      { id: "s", kind: "start", x: 0, y: 0, label: "s" },
      { id: "r", kind: "route", x: 0, y: 0, label: "r" },
      { id: "a", kind: "stage", x: 0, y: 0, label: "a", team: "eng" },
      { id: "b", kind: "stage", x: 0, y: 0, label: "b", team: "own" },
      { id: "c", kind: "stage", x: 0, y: 0, label: "c", team: "old" },
      { id: "e", kind: "end", x: 0, y: 0, label: "e" },
      { id: "n", kind: "note", x: 0, y: 0, label: "n" },
    ],
    edges: [{ id: "x", from: "s", to: "r", label: "" }],
  };
  const connect = (from: string, to: string): EditorAction => ({ type: "connect", id: "new", from, to, departments: [ENG, OLD] });

  test.each([
    ["to itself", "a", "a"], ["into the start", "a", "s"], ["into a note", "a", "n"], ["out of a note", "n", "a"],
    ["out of the end", "e", "a"], ["twice", "s", "r"], ["from nothing", "gone", "a"], ["to nothing", "a", "gone"],
  ])("refuses a connection %s", (_, from, to) => {
    expect(canConnect(graph, from, to)).toBe(false);
    const s = editorState(graph);
    expect(editorReducer(s, connect(from, to))).toBe(s);
  });

  test("a new edge is selected and undoes", () => {
    const s = run(editorState(graph), connect("a", "e"));
    expect(s.graph.edges[1]).toEqual({ id: "new", from: "a", to: "e", label: "" });
    expect(s.selection).toEqual({ t: "e", id: "new" });
    expect(run(s, { type: "undo" }).graph).toBe(graph);
  });

  test("a split's edge to a team's step starts as that team's branch", () => {
    expect(run(editorState(graph), connect("r", "a")).graph.edges[1].department).toBe("eng");
  });

  test("a split's edge to any other step is the default, an archived team's too", () => {
    expect(run(editorState(graph), connect("r", "b")).graph.edges[1].department).toBeUndefined();
    expect(run(editorState(graph), connect("r", "c")).graph.edges[1].department).toBeUndefined();
  });

  test("a step's edge is no branch, whoever runs what it leads to", () => {
    expect(run(editorState(graph), connect("b", "a")).graph.edges[1].department).toBeUndefined();
  });

  test("a loop can be drawn: validation says what is wrong with it", () => {
    expect(canConnect({ ...graph, edges: [{ id: "x", from: "a", to: "b", label: "" }] }, "b", "a")).toBe(true);
  });
});

describe("removing", () => {
  const select = (id: string, t: "n" | "e" = "n"): EditorAction => ({ type: "select", selection: { t, id } });

  test("a step goes with its edges, and comes back with them", () => {
    const s = run(start(), select("team"), { type: "remove" });
    expect(labels(s)).not.toContain("Team interview");
    expect(s.graph.edges.some((e) => e.from === "team" || e.to === "team")).toBe(false);
    expect(s.selection).toBeNull();
    expect(run(s, { type: "undo" }).graph).toEqual(defaultGraph());
  });

  test("an edge goes alone", () => {
    const s = run(start(), select("e1", "e"), { type: "remove" });
    expect(s.graph.nodes).toHaveLength(5);
    expect(s.graph.edges.map((e) => e.id)).toEqual(["e0", "e2", "e3"]);
  });

  test.each(["applied", "offer"])("the start and end stay: %s", (id) => {
    const s = run(start(), select(id));
    expect(editorReducer(s, { type: "remove" })).toBe(s);
  });

  test("with nothing selected nothing happens", () => {
    const s = start();
    expect(editorReducer(s, { type: "remove" })).toBe(s);
    const gone = run(s, select("nothing"));
    expect(editorReducer(gone, { type: "remove" })).toBe(gone);
  });
});

describe("patches", () => {
  test("an unknown node or edge is left alone", () => {
    const s = start();
    expect(editorReducer(s, { type: "patchNode", id: "x", patch: { label: "y" } })).toBe(s);
    expect(editorReducer(s, { type: "patchEdge", id: "x", patch: { label: "y" } })).toBe(s);
  });

  test("clearing pinned people leaves a graph a save takes", () => {
    const s = run(start(), { type: "patchNode", id: "review", patch: { who: ["a"] } }, { type: "patchNode", id: "review", patch: { team: "own", who: undefined } });
    expect(review(s).who).toBeUndefined();
    expect(cleanGraph(JSON.parse(JSON.stringify(s.graph)))).toEqual(JSON.parse(JSON.stringify(s.graph)));
  });
});

describe("reset", () => {
  test("is a change like any other", () => {
    const s = run(start(), add(), { type: "reset", graph: defaultGraph() });
    expect(s.graph).toEqual(defaultGraph());
    expect(run(s, { type: "undo" }).graph.nodes).toHaveLength(6);
  });
});

describe("newNode", () => {
  test("is centred on the point, and what a save takes", () => {
    expect(newNode("stage", "a", { x: 200, y: 100 })).toMatchObject({ x: 112, y: 62, type: "interview", team: "own", mins: 60, label: "New interview" });
    expect(newNode("route", "b", { x: 0, y: 0 })).toEqual({ id: "b", kind: "route", x: -72, y: -24, label: "Split by team" });
    expect(newNode("note", "c", { x: 0, y: 0 }).label).toBe("A note for the team");
    expect(cleanGraph({ nodes: [newNode("stage", "a", { x: 0, y: 0 })], edges: [] })).not.toBeNull();
  });

  test("ids are ones a save takes", () => {
    expect(cleanGraph({ nodes: [newNode("note", newId("n"), { x: 0, y: 0 })], edges: [] })).not.toBeNull();
    expect(newId("e", () => 0.5, () => 35)).toBe("ezi");
  });
});

describe("editorKey", () => {
  const key = (k: string, extra: Partial<Parameters<typeof editorKey>[0]> = {}) => ({
    key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false, target: null, ...extra,
  });

  test("⌘Z and Ctrl+Z undo, with shift they redo, in any case", () => {
    expect(editorKey(key("z", { metaKey: true }), false)).toBe("undo");
    expect(editorKey(key("z", { ctrlKey: true }), false)).toBe("undo");
    expect(editorKey(key("Z", { metaKey: true, shiftKey: true }), false)).toBe("redo");
  });

  test("Z alone is nothing, ⌘ with anything else is the browser's", () => {
    expect(editorKey(key("z"), false)).toBeNull();
    expect(editorKey(key("k", { metaKey: true }), false)).toBeNull();
    expect(editorKey(key("Delete", { metaKey: true }), false)).toBeNull();
  });

  test("Delete, Backspace and Esc", () => {
    expect(editorKey(key("Delete"), false)).toBe("remove");
    expect(editorKey(key("Backspace"), false)).toBe("remove");
    expect(editorKey(key("Escape"), false)).toBe("deselect");
  });

  test("stands down while typing, behind a modal, and once handled", () => {
    const input = { tagName: "INPUT" } as unknown as EventTarget;
    expect(editorKey(key("z", { metaKey: true, target: input }), false)).toBeNull();
    expect(editorKey(key("Backspace", { target: input }), false)).toBeNull();
    expect(editorKey(key("z", { metaKey: true }), true)).toBeNull();
    expect(editorKey(key("z", { metaKey: true, defaultPrevented: true }), false)).toBeNull();
    expect(editorKey(key("z", { metaKey: true, altKey: true }), false)).toBeNull();
  });
});

describe("the view", () => {
  test("a point round the view and back", () => {
    expect(toWorld({ x: 40, y: 80, z: 2 }, { x: 140, y: 180 })).toEqual({ x: 50, y: 50 });
  });

  test("zooming keeps what is under the pointer", () => {
    const view = { x: 40, y: 80, z: 1 };
    const at = { x: 300, y: 200 };
    const zoomed = zoomAt(view, at, 1.5);
    expect(toWorld(zoomed, at)).toEqual(toWorld(view, at));
    expect(zoomed.z).toBe(1.5);
  });

  test("zoom has limits, and the limit still keeps the point", () => {
    expect(clampZoom(9)).toBe(ZOOM_MAX);
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    const view = { x: 0, y: 0, z: 1 };
    const at = { x: 100, y: 100 };
    const zoomed = zoomAt(view, at, 50);
    expect(zoomed.z).toBe(ZOOM_MAX);
    expect(toWorld(zoomed, at).x).toBeCloseTo(100);
  });

  test("fit puts the whole graph in the viewport", () => {
    const graph = defaultGraph();
    const v = fitView(graph, 900, 560)!;
    const right = graph.nodes.at(-1)!;
    expect(v.x + graph.nodes[0].x * v.z).toBeGreaterThanOrEqual(0);
    expect(v.x + (right.x + 124) * v.z).toBeLessThanOrEqual(900);
  });

  test("fit never zooms past its limits", () => {
    expect(fitView(defaultGraph(), 100, 100)!.z).toBeCloseTo(0.42);
    expect(fitView({ nodes: [defaultGraph().nodes[0]], edges: [] }, 2000, 2000)!.z).toBeCloseTo(1.1);
  });

  test("fit has nothing to do with no graph or no room", () => {
    expect(fitView({ nodes: [], edges: [] }, 500, 500)).toBeNull();
    expect(fitView(defaultGraph(), 0, 0)).toBeNull();
  });

  test("an edge runs from a node's right to another's left", () => {
    const graph = defaultGraph();
    const [a, b] = graph.nodes;
    expect(leftOf(b)).toEqual({ x: 164, y: 150 });
    expect(edgePath(a, leftOf(b))).toBe("M124 150C160 150 128 150 164 150");
  });
});
