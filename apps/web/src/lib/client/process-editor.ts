import { isTyping, modalOpen, type KeyEventLike } from "@/lib/keys";
import type { DepartmentNode } from "./department-tree";
import { NODE_SIZE, OWNERS, type NodeKind, type Owner, type ProcessDoc, type ProcessEdge, type ProcessNode } from "./process-graph";

// The flowchart editor, the pure half (design/tats's fcCommit, fcUndo, fcAddNode,
// fcRemoveNode and its pointer math): a reducer over the graph with undo, and the
// view's arithmetic. onboarding/process/canvas.tsx is the half that touches the DOM,
// and every pointer position reaches here already in CSS pixels (lib/ui-scale.ts).

export type Selection = { t: "n" | "e"; id: string } | null;

export type EditorState = {
  graph: ProcessDoc;
  past: ProcessDoc[];
  future: ProcessDoc[];
  selection: Selection;
  /** The field being typed in: keystrokes in one field are one undo. */
  typing: string | null;
  /** The graph a drag started from: the drag is one undo, on the way out. */
  dragFrom: ProcessDoc | null;
};

export type EditorAction =
  | { type: "select"; selection: Selection }
  | { type: "add"; node: ProcessNode }
  | { type: "remove" }
  | { type: "connect"; id: string; from: string; to: string; departments: DepartmentNode[] }
  | { type: "patchNode"; id: string; patch: Partial<ProcessNode>; typing?: string }
  | { type: "patchEdge"; id: string; patch: Partial<ProcessEdge>; typing?: string }
  | { type: "drag"; id: string; x: number; y: number }
  | { type: "dragEnd" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; graph: ProcessDoc };

/** As design/tats. */
const HISTORY_MAX = 80;
const SNAP = 4;

export const editorState = (graph: ProcessDoc): EditorState => ({ graph, past: [], future: [], selection: null, typing: null, dragFrom: null });

function commit(state: EditorState, graph: ProcessDoc, selection: Selection = state.selection, typing: string | null = null): EditorState {
  const sameField = typing !== null && typing === state.typing;
  return {
    ...state,
    graph,
    selection,
    typing,
    future: [],
    past: sameField ? state.past : [...state.past, state.graph].slice(-HISTORY_MAX),
  };
}

/** Whether an edge may be drawn: into a step, a split or the end, from anything that leads on, and not twice. */
export function canConnect(graph: ProcessDoc, from: string, to: string): boolean {
  const a = graph.nodes.find((n) => n.id === from);
  const b = graph.nodes.find((n) => n.id === to);
  if (!a || !b || a.id === b.id) return false;
  if (a.kind === "end" || a.kind === "note" || b.kind === "start" || b.kind === "note") return false;
  return !graph.edges.some((e) => e.from === from && e.to === to);
}

/** A step's team, if it is a live department: a split's new branch then starts as that team's. */
function teamOf(node: ProcessNode | undefined, departments: DepartmentNode[]): string | undefined {
  const team = node?.team;
  return team && !(team in OWNERS) && departments.some((d) => d.id === team && !d.archived) ? team : undefined;
}

/** A step out, and its edges with it: design/tats's fcRemoveNode without the join, as Delete does. */
function withoutNode(graph: ProcessDoc, id: string): ProcessDoc {
  return { nodes: graph.nodes.filter((n) => n.id !== id), edges: graph.edges.filter((e) => e.from !== id && e.to !== id) };
}

function remove(state: EditorState): EditorState {
  const { selection, graph } = state;
  if (!selection) return state;
  if (selection.t === "e") {
    if (!graph.edges.some((e) => e.id === selection.id)) return state;
    return commit(state, { ...graph, edges: graph.edges.filter((e) => e.id !== selection.id) }, null);
  }
  const node = graph.nodes.find((n) => n.id === selection.id);
  if (!node || node.kind === "start" || node.kind === "end") return state;
  return commit(state, withoutNode(graph, node.id), null);
}

const snap = (n: number) => Math.round(n / SNAP) * SNAP;

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const { graph } = state;
  switch (action.type) {
    case "select":
      return { ...state, selection: action.selection, typing: null };
    case "add":
      return commit(state, { ...graph, nodes: [...graph.nodes, action.node] }, { t: "n", id: action.node.id });
    case "remove":
      return remove(state);
    case "connect": {
      if (!canConnect(graph, action.from, action.to)) return state;
      const from = graph.nodes.find((n) => n.id === action.from);
      const department = from?.kind === "route" ? teamOf(graph.nodes.find((n) => n.id === action.to), action.departments) : undefined;
      const edge: ProcessEdge = { id: action.id, from: action.from, to: action.to, label: "", ...(department ? { department } : {}) };
      return commit(state, { ...graph, edges: [...graph.edges, edge] }, { t: "e", id: edge.id });
    }
    case "patchNode": {
      if (!graph.nodes.some((n) => n.id === action.id)) return state;
      const nodes = graph.nodes.map((n) => (n.id === action.id ? { ...n, ...action.patch } : n));
      return commit(state, { ...graph, nodes }, state.selection, action.typing ?? null);
    }
    case "patchEdge": {
      if (!graph.edges.some((e) => e.id === action.id)) return state;
      const edges = graph.edges.map((e) => (e.id === action.id ? { ...e, ...action.patch } : e));
      return commit(state, { ...graph, edges }, state.selection, action.typing ?? null);
    }
    case "drag": {
      const node = graph.nodes.find((n) => n.id === action.id);
      if (!node) return state;
      const x = snap(action.x);
      const y = snap(action.y);
      if (node.x === x && node.y === y) return state;
      const nodes = graph.nodes.map((n) => (n.id === action.id ? { ...n, x, y } : n));
      return { ...state, graph: { ...graph, nodes }, dragFrom: state.dragFrom ?? graph };
    }
    case "dragEnd": {
      if (!state.dragFrom) return state;
      return { ...state, past: [...state.past, state.dragFrom].slice(-HISTORY_MAX), future: [], dragFrom: null, typing: null };
    }
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return { ...state, graph: previous, past: state.past.slice(0, -1), future: [...state.future, graph], selection: null, typing: null };
    }
    case "redo": {
      const next = state.future[state.future.length - 1];
      if (!next) return state;
      return { ...state, graph: next, future: state.future.slice(0, -1), past: [...state.past, graph], selection: null, typing: null };
    }
    case "reset":
      return commit(state, action.graph, null);
  }
}

/** A new node, centred on a point: design/tats's fcAddNode. */
export function newNode(kind: Extract<NodeKind, "stage" | "route" | "note">, id: string, at: { x: number; y: number }): ProcessNode {
  const [w, h] = NODE_SIZE[kind];
  const base = { id, kind, x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2) };
  if (kind === "note") return { ...base, label: "A note for the team" };
  if (kind === "route") return { ...base, label: "Split by team" };
  return { ...base, label: "New interview", type: "interview", team: "own" satisfies Owner, mins: 60 };
}

/** A fresh id a graph's check takes. The time and some randomness, as design/tats's fcUid. */
export const newId = (prefix: "n" | "e", random = Math.random, now = Date.now): string => `${prefix}${now().toString(36)}${random().toString(36).slice(2, 7)}`;

// ---------------------------------------------------------------------------
// The keyboard
// ---------------------------------------------------------------------------

export type EditorKey = "undo" | "redo" | "remove" | "deselect";

/**
 * The editor's keys. Its own guard, not ignoreKey, which skips ⌘ and so ⌘Z: ⌘Z
 * is the point. It still stands down while typing, where ⌘Z is the field's own,
 * behind a modal, and once something else has taken the event.
 */
export function editorKey(e: KeyEventLike & { shiftKey: boolean }, modal = modalOpen(e.target)): EditorKey | null {
  if (modal || e.defaultPrevented || e.altKey || isTyping(e.target)) return null;
  if (e.metaKey || e.ctrlKey) return e.key.toLowerCase() === "z" ? (e.shiftKey ? "redo" : "undo") : null;
  if (e.key === "Delete" || e.key === "Backspace") return "remove";
  return e.key === "Escape" ? "deselect" : null;
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export type View = { x: number; y: number; z: number };
export type Point = { x: number; y: number };

export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 2;
const FIT_MIN = 0.42;
const FIT_MAX = 1.1;

export const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

/** A point in the viewport's CSS pixels, on the graph. */
export const toWorld = (view: View, at: Point): Point => ({ x: (at.x - view.x) / view.z, y: (at.y - view.y) / view.z });

/** Zoom keeping what is under `at` where it is. */
export function zoomAt(view: View, at: Point, z: number): View {
  const next = clampZoom(z);
  return { x: at.x - ((at.x - view.x) * next) / view.z, y: at.y - ((at.y - view.y) * next) / view.z, z: next };
}

/** The whole graph in a viewport this size, with room for the toolbar: design/tats's fcFit. */
export function fitView(graph: ProcessDoc, width: number, height: number): View | null {
  if (!graph.nodes.length || width <= 0 || height <= 0) return null;
  const x0 = Math.min(...graph.nodes.map((n) => n.x));
  const y0 = Math.min(...graph.nodes.map((n) => n.y));
  const x1 = Math.max(...graph.nodes.map((n) => n.x + NODE_SIZE[n.kind][0]));
  const y1 = Math.max(...graph.nodes.map((n) => n.y + NODE_SIZE[n.kind][1]));
  const room = width - 48;
  const z = Math.max(FIT_MIN, Math.min(FIT_MAX, room / (x1 - x0), (height - 140) / (y1 - y0)));
  return { x: 24 + (room - (x1 - x0) * z) / 2 - x0 * z, y: (height - 64 - (y1 - y0) * z) / 2 - y0 * z, z };
}

/** The curve from a node's right side to another's left. */
export function edgePath(a: ProcessNode, b: Point): string {
  const sx = a.x + NODE_SIZE[a.kind][0];
  const sy = a.y + NODE_SIZE[a.kind][1] / 2;
  const dx = Math.max(36, Math.abs(b.x - sx) / 2);
  return `M${sx} ${sy}C${sx + dx} ${sy} ${b.x - dx} ${b.y} ${b.x} ${b.y}`;
}

export const leftOf = (n: ProcessNode): Point => ({ x: n.x, y: n.y + NODE_SIZE[n.kind][1] / 2 });
