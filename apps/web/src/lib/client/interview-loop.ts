import type { clientTools } from "@tacit-ats/core";
import { ago, until } from "./pipeline-columns";
import { pathFor, stepWho, type ProcessDoc, type ProcessLookup, type ProcessNode } from "./process-graph";

// The reader's loop, from core's getInterviewPlan: the job's plan steps in
// order, then any interview off the plan by date, each a round with who ran it
// and whether they filed. Pure, so the page and the tests share it. Who filed,
// never what: the feedback itself is getFeedback's.

type PlanInterview = clientTools.PlanInterview;
type FeedbackState = clientTools.FeedbackState;

export type LoopPerson = { name: string; state: string; tone: "done" | "waiting" | "hidden" | "none" };
export type LoopRound = {
  key: string;
  n: number;
  name: string;
  status: string;
  people: LoopPerson[];
  when: string | null;
  /** The interview this round opens in the list, when it is in the list and not the one already open. */
  interviewId: string | null;
  place: "past" | "current" | "later";
  /** The round the candidate reaches next; see loopRounds. */
  next: boolean;
};

function personState(feedback: FeedbackState | null, held: boolean): Pick<LoopPerson, "state" | "tone"> {
  if (feedback === "filed") return { state: "Filed", tone: "done" };
  if (feedback === "hidden") return { state: "Not visible to you", tone: "hidden" };
  return held ? { state: "Not filed", tone: "waiting" } : { state: "Booked", tone: "none" };
}

const isHeld = (i: PlanInterview, now: number) => i.status === "done" || (i.status === "scheduled" && Date.parse(i.endsAt) < now);

/** The round's interview to show: the latest one not cancelled, else the latest. */
function lead(interviews: PlanInterview[]): PlanInterview | null {
  const live = interviews.filter((i) => i.status !== "cancelled");
  const pick = live.length ? live : interviews;
  return pick.length ? pick.reduce((a, b) => (Date.parse(b.startsAt) > Date.parse(a.startsAt) ? b : a)) : null;
}

type RawRound = Pick<LoopRound, "key" | "name" | "status" | "people" | "when"> & { ids: string[]; leadId: string | null };

function round(key: string, name: string, interviews: PlanInterview[], fallback: string, now: number): RawRound {
  const i = lead(interviews);
  if (!i) return { key, name, status: fallback, people: [], when: null, ids: [], leadId: null };
  const held = isHeld(i, now);
  const status = i.status === "cancelled" ? "Cancelled" : held ? "Held" : "Booked";
  const people = i.status === "cancelled" ? [] : i.interviewers.map((p) => ({ name: p.name ?? "Someone", ...personState(p.feedback, held) }));
  const when = held || i.status === "cancelled" ? ago(i.startsAt, now) : until(i.startsAt, now);
  return { key, name, status, people, when, ids: interviews.map((x) => x.interviewId), leadId: i.interviewId };
}

const STEP_STATUS: Record<clientTools.StepState, string> = {
  not_scheduled: "Not booked",
  not_visible: "Not yours",
  scheduled: "Booked",
  done: "Held",
  cancelled: "Cancelled",
};

/** Application stages that end the loop: nobody has a next round after these. */
const CLOSED_STAGES: ReadonlySet<string> = new Set(["hired", "rejected", "withdrawn"]);
export const stageIsOpen = (stage: string | null | undefined) => !!stage && !CLOSED_STAGES.has(stage);

const STILL_TO_HAPPEN: ReadonlySet<string> = new Set(["Booked", STEP_STATUS.not_scheduled]);

/**
 * `open` is whether the application is still going. The next round is the first,
 * left to right, still to happen: booked or not booked yet, as design/tats does.
 * A cancelled round is not it, and a member who sees only their own rounds gets
 * none, since one they cannot see may come first.
 */
export function loopRounds(
  progress: clientTools.PlanProgress,
  selectedId: string,
  listed: ReadonlySet<string>,
  now: number,
  open: boolean,
): LoopRound[] {
  const raw = [
    ...progress.steps.map((s) => round(`step-${s.position}`, s.step, s.interviews, STEP_STATUS[s.state], now)),
    ...[...progress.offPlan]
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
      .map((i) => round(`iv-${i.interviewId}`, i.step ?? "Interview", [i], "", now)),
  ];
  const current = raw.findIndex((r) => r.ids.includes(selectedId));
  const next = open && progress.seesAllInterviews ? raw.findIndex((r) => STILL_TO_HAPPEN.has(r.status)) : -1;
  return raw.map(({ ids: _ids, leadId, ...r }, n) => ({
    ...r,
    n: n + 1,
    interviewId: leadId && leadId !== selectedId && listed.has(leadId) ? leadId : null,
    place: current < 0 || n < current ? "past" : n === current ? "current" : "later",
    next: n === next,
  }));
}

/** The last interview held, or null with none: the round a decision comes after. */
export function lastHeld(progress: clientTools.PlanProgress, now: number): string | null {
  const held = [...progress.steps.flatMap((s) => s.interviews), ...progress.offPlan].filter((i) => isHeld(i, now));
  return held.length ? held.reduce((a, b) => (Date.parse(b.startsAt) > Date.parse(a.startsAt) ? b : a)).interviewId : null;
}

/** Interviewers on this interview whose feedback the member cannot see. */
export function hiddenOn(progress: clientTools.PlanProgress, interviewId: string): number {
  const all = [...progress.steps.flatMap((s) => s.interviews), ...progress.offPlan];
  return all.find((i) => i.interviewId === interviewId)?.interviewers.filter((p) => p.feedback === "hidden").length ?? 0;
}

// ---------------------------------------------------------------------------
// The routing graph (design/tats's processTree)
// ---------------------------------------------------------------------------

export type RouteState = "done" | "view" | "up" | "todo" | "off" | "closed";

export type RouteNode<R> = {
  id: string;
  kind: "pre" | "route" | "stage" | "end";
  label: string;
  state: RouteState;
  /** "This interview", "Up next". In words, so nothing rests on colour. */
  flag: string | null;
  /** Who runs it, for a step nobody has been put on yet. */
  who: string | null;
  /** This candidate's round on this step. Null on another team's branch. */
  round: R | null;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type RouteEdge = { id: string; d: string; arrow: string; tone: "off" | "todo" | "done" | "up" };

export type RouteView<R> = {
  nodes: RouteNode<R>[];
  edges: RouteEdge[];
  width: number;
  height: number;
  /** "2 rounds left before the offer". */
  tag: string;
  /** Interviews the plan has no step for, which the graph has no place for. */
  offPlan: R[];
};

type RoundFacts = Pick<LoopRound, "key" | "name" | "status" | "people" | "place" | "next">;

const NODE_W = { pre: 100, route: 112, stage: 176, end: 96 } as const;
const NODE_H = { pre: 34, route: 32, end: 34 } as const;
/** A step's name and status line; each interviewer adds a line. */
const STAGE_H = 58;
const PERSON_H = 22;
const GAP = 30;
const STACK_GAP = 10;

type Column = Array<ProcessNode | "pre">;

const idOf = (n: ProcessNode | "pre") => (n === "pre" ? "pre" : n.id);

/** What came before the interviews as one step, then the rest of the way through; at a split, every branch stacked. */
function columns(graph: ProcessDoc, path: ProcessNode[]): Column[] {
  const firstInterview = path.findIndex((n) => n.kind === "route" || (n.kind === "stage" && n.type === "interview"));
  const from = Math.max(1, firstInterview);
  const onPath = new Set(path.map((n) => n.id));
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const cols: Column[] = [["pre"]];
  path.slice(from).forEach((n, i, rest) => {
    const before = rest[i - 1];
    if (before?.kind !== "route") {
      cols.push([n]);
      return;
    }
    // A branch that rejoins the way through further on is drawn there, not here.
    const branches = graph.edges.filter((e) => e.from === before.id).flatMap((e) => {
      const to = nodes.get(e.to);
      return to && to.kind !== "note" && (to.id === n.id || !onPath.has(to.id)) ? [to] : [];
    });
    cols.push([...new Map(branches.map((b) => [b.id, b])).values()].sort((a, b) => a.y - b.y));
  });
  return cols;
}

function teamWord(n: ProcessNode, departmentId: string | null, lookup: ProcessLookup): string {
  const own = n.team === "own" && !n.who?.length ? lookup.departments.find((d) => d.id === departmentId)?.name : undefined;
  return own ?? stepWho(n, lookup).tag;
}

function edgePath(sx: number, sy: number, tx: number, ty: number) {
  const dx = Math.max(10, (tx - sx) / 2);
  return { d: `M${sx} ${sy}C${sx + dx} ${sy} ${tx - dx} ${ty} ${tx} ${ty}`, arrow: `M${tx} ${ty}l-6 -4v8z` };
}

const TONE_ORDER: RouteEdge["tone"][] = ["off", "todo", "done", "up"];

/**
 * The candidate's way through the company's process, the branch for their job's team
 * lit and the others faded, or null when it cannot be drawn from what they have: then
 * the page keeps the loop as a row. Who filed and never what: `people` is the rounds'.
 * `rounds` is loopRounds', plan steps first, and `stepCount` how many of them are.
 */
export function routeView<R extends RoundFacts>(input: {
  graph: ProcessDoc;
  departmentId: string | null;
  lookup: ProcessLookup;
  rounds: R[];
  stepCount: number;
  /** The application's stage; null when it could not be read. */
  stage: string | null;
}): RouteView<R> | null {
  const { graph, departmentId, lookup, rounds, stepCount, stage } = input;
  if (stage === null) return null;
  const path = pathFor(graph, departmentId, lookup.departments);
  if (!path.complete) return null;

  const byStep = new Map(rounds.slice(0, stepCount).map((r) => [r.name.trim().toLowerCase(), r]));
  const interviews = path.nodes.filter((n) => n.kind === "stage" && n.type === "interview");
  if (interviews.length !== byStep.size || interviews.some((n) => !byStep.has(n.label.trim().toLowerCase()))) return null;

  const onPath = new Set(path.nodes.map((n) => n.id));
  const roundOf = (n: ProcessNode) => (n.kind === "stage" && n.type === "interview" ? (byStep.get(n.label.trim().toLowerCase()) ?? null) : null);
  const open = stageIsOpen(stage);
  const left = interviews.filter((n) => byStep.get(n.label.trim().toLowerCase())?.status !== "Held").length;
  const someoneNext = interviews.some((n) => roundOf(n)?.next);

  const stateOf = (n: ProcessNode): RouteState => {
    if (!onPath.has(n.id)) return "off";
    if (n.kind === "end") {
      if (stage === "hired") return "done";
      if (!open) return "closed";
      return stage === "offer" || !someoneNext ? "up" : "todo";
    }
    if (n.kind === "stage" && n.type === "interview") {
      const r = roundOf(n);
      return r?.place === "current" ? "view" : r?.next ? "up" : r?.status === "Held" ? "done" : "todo";
    }
    return "done";
  };
  const flagOf = (n: ProcessNode, state: RouteState): string | null => {
    if (n.kind === "end") return state === "up" ? (stage === "offer" ? "Here now" : "Up next") : null;
    const r = roundOf(n);
    return [r?.place === "current" ? "This interview" : null, r?.next ? "Up next" : null].filter(Boolean).join(" · ") || null;
  };

  const sizeOf = (n: ProcessNode | "pre"): readonly [number, number] => {
    if (n === "pre") return [NODE_W.pre, NODE_H.pre];
    if (n.kind === "stage") return [NODE_W.stage, STAGE_H + (roundOf(n)?.people.length ?? 0) * PERSON_H];
    return n.kind === "route" ? [NODE_W.route, NODE_H.route] : [NODE_W.end, NODE_H.end];
  };
  const cols = columns(graph, path.nodes);
  const stackOf = (c: Column) => c.reduce((h, n) => h + sizeOf(n)[1], 0) + (c.length - 1) * STACK_GAP;
  const height = Math.max(...cols.map(stackOf));

  const place = new Map<string, { x: number; y: number; w: number; h: number }>();
  let x = 0;
  for (const c of cols) {
    const colW = Math.max(...c.map((n) => sizeOf(n)[0]));
    let y = (height - stackOf(c)) / 2;
    for (const n of c) {
      const [w, h] = sizeOf(n);
      place.set(idOf(n), { x: x + (colW - w) / 2, y, w, h });
      y += h + STACK_GAP;
    }
    x += colW + GAP;
  }

  const nodes: RouteNode<R>[] = cols.flat().map((n) => {
    const at = place.get(idOf(n))!;
    if (n === "pre") return { id: "pre", kind: "pre", label: "Applied", state: "done", flag: null, who: null, round: null, ...at };
    const state = stateOf(n);
    const stageNode = n.kind === "stage";
    return {
      id: n.id,
      kind: stageNode ? "stage" : n.kind === "end" ? "end" : "route",
      label: n.label.trim() || (stageNode ? "A step" : ""),
      state,
      flag: flagOf(n, state),
      who: stageNode ? teamWord(n, departmentId, lookup) : null,
      round: roundOf(n),
      ...at,
    };
  });

  const stateById = new Map(nodes.map((n) => [n.id, n.state]));
  const edges: RouteEdge[] = [];
  cols.forEach((c, i) => {
    if (!i) return;
    for (const before of cols[i - 1]) {
      for (const n of c) {
        if (before !== "pre" && !graph.edges.some((e) => e.from === before.id && e.to === idOf(n))) continue;
        const a = place.get(idOf(before))!;
        const b = place.get(idOf(n))!;
        const to = stateById.get(idOf(n));
        const tone = to === "off" || stateById.get(idOf(before)) === "off" ? "off" : to === "up" ? "up" : to === "done" || to === "view" ? "done" : "todo";
        edges.push({ id: `${idOf(before)}-${idOf(n)}`, tone, ...edgePath(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2) });
      }
    }
  });
  edges.sort((a, b) => TONE_ORDER.indexOf(a.tone) - TONE_ORDER.indexOf(b.tone));

  const tag =
    stage === "hired" ? "Hired"
    : !open ? "Closed"
    : stage === "offer" ? "At the offer"
    : left ? `${left} ${left === 1 ? "round" : "rounds"} left before the offer`
    : "Next: the offer";

  return { nodes, edges, width: x - GAP, height, tag, offPlan: rounds.slice(stepCount) };
}
