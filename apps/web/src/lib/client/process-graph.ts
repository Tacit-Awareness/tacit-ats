import type { DepartmentNode } from "./department-tree";

// The company's interview process as a flowchart (design/tats's `state.flow`), the
// pure half: what a stored graph means. Core stores it as an opaque object
// (client-tools/process.ts); everything about its shape is here. One process per
// company with a branch per team. A job's own plan (`roles.interview_steps`) stays
// the truth for scheduling: `jobSteps` is only what an explicit Apply would write.
//
// Type imports only, since the editor runs in the browser. The limits are core's,
// repeated, and process-graph.test.ts holds the two together.

export const NODE_KINDS = ["start", "end", "stage", "route", "note"] as const;
export const STAGE_TYPES = ["review", "testbench", "interview"] as const;

export type NodeKind = (typeof NODE_KINDS)[number];
export type StageType = (typeof STAGE_TYPES)[number];

/** Who runs a step, when it is not a team (a department's id) or pinned people. */
export const OWNERS = { job_owner: "Job owner", own: "Their team", partner: "Another team" } as const;
export type Owner = keyof typeof OWNERS;

export type ProcessNode = {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  label: string;
  /** A step's kind. Only `interview` goes on a job's plan. */
  type?: StageType;
  /** An Owner, or a department's id. Descriptive: nothing routes people by it. */
  team?: string;
  /** Members a step is pinned to, ahead of `team`. */
  who?: string[];
  mins?: number;
};

export type ProcessEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  /** On an edge out of a split: the team it is the branch for. None means everyone else. */
  department?: string;
};

export type ProcessDoc = { nodes: ProcessNode[]; edges: ProcessEdge[] };

/** As core's plans.ts: PLAN_STEPS_MAX and STEP_NAME_MAX. */
export const PATH_STEPS_MAX = 15;
export const STEP_NAME_MAX = 120;
export const NOTE_MAX = 2000;
export const NODES_MAX = 200;
export const EDGES_MAX = 400;
const WHO_MAX = 50;
const MINS_MAX = 1440;
const COORD_MAX = 100_000;
const ID = /^[\w-]{1,64}$/;

/** width, height on the canvas. */
export const NODE_SIZE: Record<NodeKind, readonly [number, number]> = {
  stage: [176, 76],
  route: [144, 48],
  start: [124, 44],
  end: [124, 44],
  note: [176, 92],
};

// ---------------------------------------------------------------------------
// Reading what is stored
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const clampCoord = (n: number) => Math.round(Math.max(-COORD_MAX, Math.min(COORD_MAX, n)));

function nodeOf(raw: unknown): ProcessNode | null {
  if (!isObject(raw) || typeof raw.id !== "string" || !ID.test(raw.id) || !oneOf(NODE_KINDS, raw.kind)) return null;
  if (typeof raw.x !== "number" || !Number.isFinite(raw.x) || typeof raw.y !== "number" || !Number.isFinite(raw.y)) return null;
  if (typeof raw.label !== "string" || raw.label.length > (raw.kind === "note" ? NOTE_MAX : STEP_NAME_MAX * 2)) return null;
  const node: ProcessNode = { id: raw.id, kind: raw.kind, x: clampCoord(raw.x), y: clampCoord(raw.y), label: raw.label };
  if (raw.kind !== "stage") return node;
  node.type = oneOf(STAGE_TYPES, raw.type) ? raw.type : "interview";
  if (typeof raw.team === "string" && ID.test(raw.team)) node.team = raw.team;
  if (Array.isArray(raw.who)) {
    const who = [...new Set(raw.who.filter((w): w is string => typeof w === "string" && ID.test(w)))].slice(0, WHO_MAX);
    if (who.length) node.who = who;
  }
  if (typeof raw.mins === "number" && Number.isInteger(raw.mins) && raw.mins > 0 && raw.mins <= MINS_MAX) node.mins = raw.mins;
  return node;
}

function edgeOf(raw: unknown): ProcessEdge | null {
  if (!isObject(raw) || typeof raw.id !== "string" || !ID.test(raw.id)) return null;
  if (typeof raw.from !== "string" || typeof raw.to !== "string") return null;
  const label = typeof raw.label === "string" ? raw.label : "";
  if (label.length > STEP_NAME_MAX) return null;
  const edge: ProcessEdge = { id: raw.id, from: raw.from, to: raw.to, label };
  if (typeof raw.department === "string" && ID.test(raw.department)) edge.department = raw.department;
  return edge;
}

/** What can be drawn of a stored graph. Something else wrote it, perhaps, so anything unreadable is left out. */
export function readGraph(raw: unknown): ProcessDoc {
  const rawNodes = isObject(raw) && Array.isArray(raw.nodes) ? raw.nodes : [];
  const rawEdges = isObject(raw) && Array.isArray(raw.edges) ? raw.edges : [];
  const seen = new Set<string>();
  const nodes = rawNodes.flatMap((n) => {
    const node = nodeOf(n);
    if (!node || seen.has(node.id)) return [];
    seen.add(node.id);
    return [node];
  });
  const edges = rawEdges.flatMap((e) => {
    const edge = edgeOf(e);
    return edge && seen.has(edge.from) && seen.has(edge.to) ? [edge] : [];
  });
  return { nodes, edges };
}

/** A graph as a save takes it: what came from the page, every part readable, or null. Nothing is dropped quietly. */
export function cleanGraph(raw: unknown): ProcessDoc | null {
  if (!isObject(raw) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null;
  if (raw.nodes.length > NODES_MAX || raw.edges.length > EDGES_MAX) return null;
  const graph = readGraph(raw);
  if (graph.nodes.length !== raw.nodes.length || graph.edges.length !== raw.edges.length) return null;
  if (new Set(graph.edges.map((e) => e.id)).size !== graph.edges.length) return null;
  return graph;
}

/** Where a company starts: neutral, no teams and nobody named, nothing saved until they save it. */
export function defaultGraph(): ProcessDoc {
  const y = (kind: NodeKind) => 150 - NODE_SIZE[kind][1] / 2;
  const stage = (id: string, x: number, label: string, type: StageType, team: Owner, mins?: number): ProcessNode => ({
    id, kind: "stage", x, y: y("stage"), label, type, team, ...(mins ? { mins } : {}),
  });
  const nodes: ProcessNode[] = [
    { id: "applied", kind: "start", x: 0, y: y("start"), label: "Applied" },
    stage("review", 164, "Application review", "review", "job_owner"),
    stage("team", 380, "Team interview", "interview", "own", 60),
    stage("final", 596, "Final interview", "interview", "job_owner", 45),
    { id: "offer", kind: "end", x: 812, y: y("end"), label: "Offer" },
  ];
  const pairs = [["applied", "review"], ["review", "team"], ["team", "final"], ["final", "offer"]];
  return { nodes, edges: pairs.map(([from, to], i) => ({ id: `e${i}`, from, to, label: "" })) };
}

// ---------------------------------------------------------------------------
// Walking it
// ---------------------------------------------------------------------------

const byId = (graph: ProcessDoc) => new Map(graph.nodes.map((n) => [n.id, n]));

/** The edges a candidate can take out of each node: notes are not on the way. */
function flowEdges(graph: ProcessDoc): Map<string, ProcessEdge[]> {
  const nodes = byId(graph);
  const out = new Map<string, ProcessEdge[]>();
  for (const e of graph.edges) {
    const to = nodes.get(e.to);
    if (!to || to.kind === "note" || nodes.get(e.from)?.kind === "note") continue;
    out.set(e.from, [...(out.get(e.from) ?? []), e]);
  }
  return out;
}

/** The department and those it sits in, nearest first. A loop or a missing parent stops the walk. */
export function departmentChain(departments: DepartmentNode[], id: string | null): string[] {
  if (!id) return [];
  const parents = new Map(departments.map((d) => [d.id, d.parentId]));
  const chain = [id];
  for (let p = parents.get(id) ?? null; p && !chain.includes(p); p = parents.get(p) ?? null) chain.push(p);
  return chain;
}

/** At a split: the branch for the nearest department with one, else the default edge. */
function pickBranch(outs: ProcessEdge[], chain: string[]): ProcessEdge | null {
  for (const id of chain) {
    const hit = outs.find((e) => e.department === id);
    if (hit) return hit;
  }
  return outs.find((e) => !e.department) ?? null;
}

export type PathStop = "no_start" | "no_branch" | "dead_end" | "loop";

export type ProcessPath = {
  nodes: ProcessNode[];
  /** It reached the end. */
  complete: boolean;
  /** Why not, and at which node. */
  stop: PathStop | null;
  stoppedAt: ProcessNode | null;
};

/** The way through for a job in this department (null for one in none): design/tats's flowPath. */
export function pathFor(graph: ProcessDoc, departmentId: string | null, departments: DepartmentNode[]): ProcessPath {
  const nodes = byId(graph);
  const start = graph.nodes.find((n) => n.kind === "start");
  if (!start) return { nodes: [], complete: false, stop: "no_start", stoppedAt: null };
  const outs = flowEdges(graph);
  const chain = departmentChain(departments, departmentId);
  const path: ProcessNode[] = [];
  const seen = new Set<string>();
  for (let cur = start; ; ) {
    if (seen.has(cur.id)) return { nodes: path, complete: false, stop: "loop", stoppedAt: cur };
    seen.add(cur.id);
    path.push(cur);
    if (cur.kind === "end") return { nodes: path, complete: true, stop: null, stoppedAt: null };
    const here = outs.get(cur.id) ?? [];
    if (!here.length) return { nodes: path, complete: false, stop: "dead_end", stoppedAt: cur };
    const edge = cur.kind === "route" ? pickBranch(here, chain) : here[0];
    if (!edge) return { nodes: path, complete: false, stop: "no_branch", stoppedAt: cur };
    const next = nodes.get(edge.to);
    if (!next) return { nodes: path, complete: false, stop: "dead_end", stoppedAt: cur };
    cur = next;
  }
}

const stagesOf = (nodes: ProcessNode[]) => nodes.filter((n) => n.kind === "stage");
const stepKey = (label: string) => label.trim().toLowerCase();

/**
 * What Apply would write to a job in this department, or null if there is no way
 * through. Only interviews, as design/tats's loop reads the path: a review or a
 * Testbench is never scheduled, and on a plan it would stay "Up next" for ever.
 */
export function jobSteps(graph: ProcessDoc, departmentId: string | null, departments: DepartmentNode[]): string[] | null {
  const path = pathFor(graph, departmentId, departments);
  if (!path.complete) return null;
  return stagesOf(path.nodes).filter((n) => n.type === "interview").map((n) => n.label.trim());
}

/**
 * The steps in order, steps side by side one level: how many steps a candidate has
 * passed on reaching each, by the longest way there (design/tats's processNames).
 * Only what can be reached from the start. A loop cannot run it away: it stops
 * after as many passes as there are nodes.
 */
export function levelsOf(graph: ProcessDoc): ProcessNode[][] {
  const nodes = byId(graph);
  const start = graph.nodes.find((n) => n.kind === "start");
  if (!start) return [];
  const edges = [...flowEdges(graph).values()].flat();
  const depth = new Map([[start.id, 0]]);
  for (let pass = 0, moved = true; moved && pass < graph.nodes.length; pass++) {
    moved = false;
    for (const e of edges) {
      const from = depth.get(e.from);
      const to = nodes.get(e.to);
      if (from === undefined || !to) continue;
      const d = from + (to.kind === "stage" ? 1 : 0);
      if ((depth.get(to.id) ?? -1) < d) {
        depth.set(to.id, d);
        moved = true;
      }
    }
  }
  const levels: ProcessNode[][] = [];
  for (const n of stagesOf(graph.nodes)) {
    const d = depth.get(n.id);
    if (d) (levels[d - 1] ||= []).push(n);
  }
  return levels.filter(Boolean);
}

/** A branch's name: what it was called, else its team, else the default. */
export function edgeName(edge: ProcessEdge, departments: DepartmentNode[]): string {
  if (edge.label.trim()) return edge.label.trim();
  if (edge.department) return departments.find((d) => d.id === edge.department)?.name ?? "A team no longer here";
  return "Everyone else";
}

// ---------------------------------------------------------------------------
// Who runs it
// ---------------------------------------------------------------------------

export type ProcessMember = { id: string; name: string };
export type ProcessLookup = { departments: DepartmentNode[]; members: ProcessMember[] };

export type StepWho = {
  tag: string;
  /** Points at a team that is archived or gone, or people who left. Drawn as a gap, never an error. */
  gap: boolean;
};

/** Who runs a step, said the way a person would (design/tats's stageWho). */
export function stepWho(node: ProcessNode, { departments, members }: ProcessLookup): StepWho {
  if (node.type === "testbench") return { tag: "The candidate", gap: false };
  if (node.who?.length) {
    const names = node.who.flatMap((id) => members.find((m) => m.id === id)?.name.split(" ")[0] ?? []);
    const left = node.who.length - names.length;
    if (!left) return { tag: names.join(", "), gap: false };
    const gone = `${left} ${left === 1 ? "person" : "people"} left`;
    return { tag: names.length ? `${names.join(", ")}, ${gone}` : gone, gap: true };
  }
  const team = node.team ?? "own";
  if (team in OWNERS) return { tag: OWNERS[team as Owner], gap: false };
  const dept = departments.find((d) => d.id === team);
  if (!dept) return { tag: "A team no longer here", gap: true };
  return dept.archived ? { tag: `${dept.name} (archived)`, gap: true } : { tag: dept.name, gap: false };
}

export const formatMins = (m: number | undefined): string => (!m ? "" : m >= 60 ? `${m % 60 ? (m / 60).toFixed(1) : m / 60}h` : `${m}m`);

/** The line under the canvas: design/tats's fcSummary. Each interview counts an hour until it says. */
export function summaryOf(graph: ProcessDoc): { steps: number; interviews: number; mins: number } {
  const stages = stagesOf(graph.nodes);
  const interviews = stages.filter((n) => n.type === "interview");
  return { steps: stages.length, interviews: interviews.length, mins: interviews.reduce((m, n) => m + (n.mins ?? 60), 0) };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ProblemCode =
  | "no_start" | "many_starts" | "no_end" | "many_ends" | "cycle" | "fork" | "two_defaults" | "two_branches"
  | "dead_end" | "no_branch" | "too_many_steps" | "duplicate_step" | "unnamed_step" | "bad_step_name";

export type Problem = { code: ProblemCode; message: string; nodeId?: string };

/** Something to know that stops nothing: a team or person gone, a step off every path. */
export type Gap = { code: "archived_team" | "person_left" | "unreached"; message: string; nodeId?: string; edgeId?: string };

export type Validation = {
  /** Apply is off until there are none. A save can still keep the draft. */
  problems: Problem[];
  gaps: Gap[];
};

const named = (n: ProcessNode) => n.label.trim() || "A step";
const list = (names: string[]) => (names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

function structure(graph: ProcessDoc, push: (p: Problem) => void) {
  const starts = graph.nodes.filter((n) => n.kind === "start");
  const ends = graph.nodes.filter((n) => n.kind === "end");
  if (!starts.length) push({ code: "no_start", message: "The process needs a start." });
  if (starts.length > 1) push({ code: "many_starts", message: "The process has more than one start.", nodeId: starts[1].id });
  if (!ends.length) push({ code: "no_end", message: "The process needs an end." });
  if (ends.length > 1) push({ code: "many_ends", message: "The process has more than one end.", nodeId: ends[1].id });
  for (const [from, outs] of flowEdges(graph)) {
    const node = graph.nodes.find((n) => n.id === from);
    if (!node || node.kind === "end") continue;
    if (node.kind !== "route") {
      if (outs.length > 1) push({ code: "fork", message: `${named(node)} goes two ways. Only a split can do that.`, nodeId: from });
      continue;
    }
    if (outs.filter((e) => !e.department).length > 1) push({ code: "two_defaults", message: `${named(node)} has more than one branch for everyone else. Give each a team, or keep one.`, nodeId: from });
    const teams = outs.flatMap((e) => e.department ?? []);
    if (new Set(teams).size < teams.length) push({ code: "two_branches", message: `${named(node)} has two branches for one team.`, nodeId: from });
  }
}

/** A node on a cycle, or null: repeatedly takes out whatever nothing leads to. */
function onCycle(graph: ProcessDoc): ProcessNode | null {
  const edges = [...flowEdges(graph).values()].flat();
  const waiting = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of edges) waiting.set(e.to, (waiting.get(e.to) ?? 0) + 1);
  const ready = [...waiting].filter(([, n]) => n === 0).map(([id]) => id);
  for (let id = ready.pop(); id !== undefined; id = ready.pop()) {
    waiting.delete(id);
    for (const e of edges) {
      if (e.from !== id) continue;
      const left = (waiting.get(e.to) ?? 0) - 1;
      waiting.set(e.to, left);
      if (left === 0) ready.push(e.to);
    }
  }
  const stuck = [...waiting.keys()][0];
  return stuck === undefined ? null : (graph.nodes.find((n) => n.id === stuck) ?? null);
}

/** Every step's name, as plans.ts would take it. */
function names(graph: ProcessDoc, push: (p: Problem) => void) {
  for (const n of stagesOf(graph.nodes)) {
    const label = n.label.trim();
    if (!label) push({ code: "unnamed_step", message: "A step needs a name.", nodeId: n.id });
    else if (label.length > STEP_NAME_MAX) push({ code: "bad_step_name", message: `A step name is at most ${STEP_NAME_MAX} characters.`, nodeId: n.id });
    // eslint-disable-next-line no-control-regex
    else if (/[\u0000-\u001f\u007f]/.test(label)) push({ code: "bad_step_name", message: `"${label}" has to be one line of text.`, nodeId: n.id });
  }
}

/** Every department's way through: it reaches the end, in at most 15 steps, none named twice. */
function paths(graph: ProcessDoc, departments: DepartmentNode[], push: (p: Problem) => void) {
  const live = departments.filter((d) => !d.archived);
  const required: Array<string | null> = live.length ? live.map((d) => d.id) : [null];
  // Who else can be on a path: a job in no department, and any team named on a branch, archived or not.
  const scopes = [...new Set<string | null>([...required, null, ...graph.edges.flatMap((e) => e.department ?? [])])];
  const nameOf = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "a job with no team";
  const unbranched = new Map<string, { node: ProcessNode; teams: string[] }>();
  for (const scope of scopes) {
    const path = pathFor(graph, scope, departments);
    if (!path.complete) {
      if (!required.includes(scope)) continue;
      const at = path.stoppedAt;
      if (path.stop === "dead_end" && at) push({ code: "dead_end", message: `${named(at)} leads nowhere. Connect it to what comes next.`, nodeId: at.id });
      if (path.stop === "no_branch" && at) {
        const row = unbranched.get(at.id) ?? { node: at, teams: [] };
        row.teams.push(nameOf(scope));
        unbranched.set(at.id, row);
      }
      continue;
    }
    const stages = stagesOf(path.nodes);
    if (stages.length > PATH_STEPS_MAX) {
      push({ code: "too_many_steps", message: `The way through for ${nameOf(scope)} has ${stages.length} steps. The most is ${PATH_STEPS_MAX}.` });
    }
    const seen = new Set<string>();
    for (const n of stages) {
      const key = stepKey(n.label);
      if (key && seen.has(key)) push({ code: "duplicate_step", message: `"${n.label.trim()}" is on one way through twice. Each step needs its own name.`, nodeId: n.id });
      seen.add(key);
    }
  }
  for (const { node, teams } of unbranched.values()) {
    push({ code: "no_branch", message: `${named(node)} has no branch for ${list(teams)}, and no branch for everyone else.`, nodeId: node.id });
  }
}

function gapsOf(graph: ProcessDoc, { departments, members }: ProcessLookup): Gap[] {
  const gaps: Gap[] = [];
  const archived = (id: string) => {
    const d = departments.find((x) => x.id === id);
    return !d || d.archived;
  };
  const reached = new Set(levelsOf(graph).flat().map((n) => n.id));
  for (const n of stagesOf(graph.nodes)) {
    if (n.team && !(n.team in OWNERS) && archived(n.team)) gaps.push({ code: "archived_team", message: `${named(n)} names a team that is archived or gone.`, nodeId: n.id });
    const left = (n.who ?? []).filter((id) => !members.some((m) => m.id === id)).length;
    if (left) gaps.push({ code: "person_left", message: `${named(n)} names ${left === 1 ? "someone who has" : `${left} people who have`} left.`, nodeId: n.id });
    if (!reached.has(n.id)) gaps.push({ code: "unreached", message: `${named(n)} isn't connected, so no job goes through it.`, nodeId: n.id });
  }
  for (const e of graph.edges) {
    if (e.department && archived(e.department)) gaps.push({ code: "archived_team", message: `A branch names a team that is archived or gone.`, edgeId: e.id });
  }
  return gaps;
}

/**
 * What stops a graph being applied, and what is only worth knowing. A team
 * archived or a member gone is a gap: the graph outlives them, and neither is
 * the admin's mistake.
 */
export function validateGraph(graph: ProcessDoc, lookup: ProcessLookup): Validation {
  const problems: Problem[] = [];
  const seen = new Set<string>();
  const push = (p: Problem) => {
    const key = `${p.code}:${p.nodeId ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    problems.push(p);
  };
  structure(graph, push);
  names(graph, push);
  const cycle = onCycle(graph);
  if (cycle) push({ code: "cycle", message: `${named(cycle)} loops back on itself. A process only goes forward.`, nodeId: cycle.id });
  else if (graph.nodes.some((n) => n.kind === "start")) paths(graph, lookup.departments, push);
  return { problems, gaps: gapsOf(graph, lookup) };
}

// ---------------------------------------------------------------------------
// What Apply changes on a job
// ---------------------------------------------------------------------------

export type PlanChange = {
  same: boolean;
  kept: string[];
  added: string[];
  removed: string[];
  /** A step that went and one that came in its place. A guess, so the dialog says "looks renamed". */
  renamed: Array<{ from: string; to: string }>;
};

const keptBefore = (steps: string[], at: number, others: Set<string>) => steps.slice(0, at).filter((s) => others.has(s.toLowerCase())).length;

/** How a job's plan changes. Interviews match a step without regard to case, so a change of case is kept. */
export function planChange(current: string[], next: string[]): PlanChange {
  const nowKeys = new Set(current.map((s) => s.toLowerCase()));
  const nextKeys = new Set(next.map((s) => s.toLowerCase()));
  const gone = current.filter((s) => !nextKeys.has(s.toLowerCase()));
  const come = next.filter((s) => !nowKeys.has(s.toLowerCase()));
  const renamed: PlanChange["renamed"] = [];
  const free = new Set(come);
  for (const from of gone) {
    const slot = keptBefore(current, current.indexOf(from), nextKeys);
    const to = come.find((s) => free.has(s) && keptBefore(next, next.indexOf(s), nowKeys) === slot);
    if (to === undefined) continue;
    free.delete(to);
    renamed.push({ from, to });
  }
  const paired = new Set(renamed.flatMap((r) => [r.from, r.to]));
  return {
    same: current.length === next.length && current.every((s, i) => s === next[i]),
    kept: next.filter((s) => nowKeys.has(s.toLowerCase())),
    added: come.filter((s) => !paired.has(s)),
    removed: gone.filter((s) => !paired.has(s)),
    renamed,
  };
}
