import type { Db } from "@tacit/db";
import type { AccessLevel } from "./session";

// Interviewers > Agents (/client/interviewers/agents): what the team's bot is
// doing for each teammate, and which teammate's agent is waiting on whom.
//
// There is one bot per company (agent_destinations, its Grok bot), and it
// works for people: each bot_tasks row names the teammate it serves
// (actor_id), and while it waits names whose turn it is, a teammate
// (waiting_on_actor_id) or a candidate (waiting_on_person_id), and where it
// asked them (waiting_channel). So "Priya's agent" is the bot's tasks for
// Priya, and a task of Priya's that waits on Daniel is her agent talking to
// his: the bot reaches Daniel in its own Slack thread with him
// (interview_agent_threads, which no member's token can read, so it is not
// read here). A task naming no one is the team's bot itself.
//
// Read on the member's OWN client, so the policies decide: bot_tasks under
// can_read_bot_task (the tasks of applications they can read, and the ones
// serving them), names from org_members, candidates from the applications
// and people they can read, the bot's row for an admin and the bare
// "connected" answer for anyone else (as Settings does). Nothing here writes.
// buildAgentMap is pure, so the tests drive it with rows.

/** How far back finished and failed work stays on the map. */
export const RECENT_DAYS = 7;
const DAY = 86_400_000;
/** Task rows the read stops at, newest first. */
const TASK_MAX = 500;
/** Agents across one band of the board; a band's lanes sit under it. */
export const BAND_SIZE = 4;
/** The team's bot itself, for a task that serves no one in particular. */
export const TEAM_AGENT = "team";

export const TASK_KINDS = ["find_interviewer", "ask_interviewer", "schedule_interview", "get_read", "send_testbench", "send_rejection", "send_invite", "other"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** A task as the page says it: running is working, a stuck one needs you whatever it was doing. */
export type TaskState = "working" | "waiting" | "needs_you" | "failed" | "done";
/** An agent's state is its most pressing task's, or idle with none open. */
export type AgentState = Exclude<TaskState, "done"> | "idle";
/** A lane's connector: live while its newest open item moves, stuck when it needs a person, then failed or done. */
export type LaneState = "live" | "stuck" | "failed" | "done";
export type WaitChannel = "slack" | "imessage" | "email" | "other";

export type Party =
  | { kind: "member"; id: string; name: string; short: string }
  | { kind: "candidate"; id: string; name: string; short: string };

export type MapStep = { label: string; at: string | null };

export type MapTask = {
  id: string;
  kind: TaskKind;
  state: TaskState;
  /** The agent it belongs to: the teammate it serves, or TEAM_AGENT. */
  agentId: string;
  /** "Chasing Daniel's read on Fatima Zahra": what the agent is doing, for open work. */
  doing: string;
  /** "Daniel's read on Fatima Zahra": what is being passed along, for a handoff and closed work. */
  thing: string;
  /** Whose turn it is (or was, once it closed). Null when it waits on no one, or on its own teammate. */
  with: Party | null;
  /** Its own teammate's turn: the agent asking the person it works for. */
  withSelf: boolean;
  channel: WaitChannel | null;
  steps: MapStep[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
  candidate: { id: string; name: string } | null;
  interview: { id: string; step: string | null } | null;
};

export type MapAgent = {
  id: string;
  name: string;
  short: string;
  state: AgentState;
  /** The task its state comes from; null when idle. */
  current: string | null;
  /** Its own tasks: open first, most pressing first, then closed, newest first. */
  tasks: string[];
};

export type Lane = {
  id: string;
  from: string;
  to: Party;
  state: LaneState;
  /** Open first, most pressing first, then closed, newest first. */
  tasks: string[];
};

/**
 * One connector on the board, in column terms (the view turns them into
 * pixels): from a card's bottom edge down into a lane's top edge. `from` is
 * the lane's own agent, `to` the teammate it waits on.
 */
export type BandWire = {
  key: string;
  lane: string;
  end: "from" | "to";
  /** The card's column and the lane's. */
  card: number;
  column: number;
  /** Where it meets the card and the lane, as a share of the column's width. Equal, in one column, for a straight drop. */
  cardAt: number;
  laneAt: number;
  /** Its across-run, 0 the nearest the cards (of `Band.levels`); 0 for a straight drop. */
  level: number;
};

export type Band = {
  /** The cards, left to right, one to a column from the first. */
  agents: string[];
  /** The lanes from this band's agents, left to right. */
  lanes: string[];
  /** The column each lane sits in, by lane id. */
  columns: Record<string, number>;
  /** Columns across: BAND_SIZE, or more when its lanes need them. */
  width: number;
  wires: BandWire[];
  /** How many across-run levels the wires use (at least 1). */
  levels: number;
};

export type BotState = "connected" | "off" | "unverified" | "none" | "unknown";

export type AgentMap = {
  /** Every agent the page names, by id. */
  agents: Record<string, MapAgent>;
  tasks: Record<string, MapTask>;
  lanes: Record<string, Lane>;
  /** The board: agents with work, and teammates an open handoff waits on, in bands. */
  bands: Band[];
  /** Everyone else who interviews, by name. */
  idle: string[];
  counts: { working: number; waiting: number; needsYou: number; failed: number };
  bot: BotState;
};

export type TaskRow = {
  id: string;
  kind: string;
  status: string;
  application_id: string | null;
  interview_id: string | null;
  actor_id: string | null;
  waiting_on_actor_id: string | null;
  waiting_on_person_id: string | null;
  waiting_channel: string | null;
  steps: unknown;
  error: string | null;
  needs_you: boolean;
  created_at: string;
  updated_at: string;
};

export type MapInput = {
  tasks: TaskRow[];
  /** Active teammates the member can see: id to name. */
  members: Map<string, string>;
  /** Who interviews (everyone on a hiring team the member can see), for the idle row. */
  roster: string[];
  /** Application id to its candidate. */
  applications: Map<string, { personId: string; name: string }>;
  interviews: Map<string, { step: string | null; personId: string | null }>;
  /** Candidates by person id, for a wait on one and an interview with no application. */
  people: Map<string, string>;
  bot: BotState;
};

const OPEN: ReadonlySet<TaskState> = new Set(["working", "waiting", "needs_you"]);
/** Most pressing first: what an agent's chip and a lane's order say. */
const URGENCY: Record<TaskState, number> = { needs_you: 0, failed: 1, working: 2, waiting: 3, done: 4 };
const LANE_URGENCY: Record<LaneState, number> = { live: 0, stuck: 1, failed: 2, done: 3 };

const isKind = (k: string): k is TaskKind => (TASK_KINDS as readonly string[]).includes(k);
const isChannel = (c: string | null): c is WaitChannel => c === "slack" || c === "imessage" || c === "email" || c === "other";

export function taskState(status: string, needsYou: boolean): TaskState | null {
  if (status === "running") return needsYou ? "needs_you" : "working";
  if (status === "waiting") return needsYou ? "needs_you" : "waiting";
  if (status === "failed") return needsYou ? "needs_you" : "failed";
  if (status === "done") return "done";
  return null; // cancelled, or a status this page does not know
}

/** Steps as stored are the bot's own [{label, at}], newest last; anything else is dropped. */
export function cleanSteps(raw: unknown): MapStep[] {
  if (!Array.isArray(raw)) return [];
  const out: MapStep[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const { label, at } = s as { label?: unknown; at?: unknown };
    if (typeof label !== "string" || !label.trim()) continue;
    out.push({ label: label.trim(), at: typeof at === "string" && !Number.isNaN(Date.parse(at)) ? at : null });
  }
  return out;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** First names, or the whole name where two people share a first name. */
export function shortNames(names: Map<string, string>): Map<string, string> {
  const seen = new Map<string, number>();
  for (const n of names.values()) seen.set(firstName(n), (seen.get(firstName(n)) ?? 0) + 1);
  return new Map([...names].map(([id, n]) => [id, (seen.get(firstName(n)) ?? 0) > 1 ? n : firstName(n)]));
}

/**
 * What a task is, in words: `doing` while it is open ("Chasing Daniel's read
 * on Fatima Zahra"), `thing` for what is passed along and for closed work
 * ("Daniel's read on Fatima Zahra"). `asked` is the teammate it waits on.
 */
export function taskWords(kind: TaskKind, candidate: string | null, asked: string | null): { doing: string; thing: string } {
  const on = candidate ? ` on ${candidate}` : "";
  const forC = candidate ? ` for ${candidate}` : "";
  const about = candidate ? ` about ${candidate}` : "";
  switch (kind) {
    case "get_read":
      return asked
        ? { doing: `Chasing ${asked}'s read${on}`, thing: `${asked}'s read${on}` }
        : { doing: `Chasing feedback${forC}`, thing: candidate ? `Feedback for ${candidate}` : "Feedback" };
    case "ask_interviewer":
      return { doing: asked ? `Asking ${asked}${about}` : `Asking an interviewer${about}`, thing: candidate ? `A question about ${candidate}` : "A question" };
    case "find_interviewer":
      return { doing: `Finding an interviewer${forC}`, thing: `An interviewer${forC}` };
    case "schedule_interview":
      return candidate
        ? { doing: `Booking an interview with ${candidate}`, thing: `An interview with ${candidate}` }
        : { doing: "Booking an interview", thing: "An interview" };
    case "send_testbench":
      return candidate ? { doing: `Sending ${candidate} a Testbench`, thing: `A Testbench for ${candidate}` } : { doing: "Sending a Testbench", thing: "A Testbench" };
    case "send_rejection":
      return candidate ? { doing: `Sending ${candidate} a rejection`, thing: `A rejection for ${candidate}` } : { doing: "Sending a rejection", thing: "A rejection" };
    case "send_invite":
      return candidate ? { doing: `Sending ${candidate} an invite`, thing: `An invite for ${candidate}` } : { doing: "Sending an invite", thing: "An invite" };
    default:
      return candidate ? { doing: `Working on ${candidate}`, thing: `A task for ${candidate}` } : { doing: "Working on a task", thing: "A task" };
  }
}

/** The chip's words: "Working", "Waiting on Daniel", "Needs you", "Failed", "Idle". */
export function stateWords(state: AgentState | TaskState, waitingOn: string | null): string {
  switch (state) {
    case "working":
      return "Working";
    case "waiting":
      return waitingOn ? `Waiting on ${waitingOn}` : "Waiting";
    case "needs_you":
      return "Needs you";
    case "failed":
      return "Failed";
    case "done":
      return "Done";
    default:
      return "Idle";
  }
}

const newestFirst = (a: { updatedAt: string }, b: { updatedAt: string }) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
const byUrgency = (a: MapTask, b: MapTask) => URGENCY[a.state] - URGENCY[b.state] || newestFirst(a, b);

function laneState(tasks: MapTask[]): LaneState {
  if (tasks.some((t) => t.state === "working" || t.state === "waiting")) return "live";
  if (tasks.some((t) => t.state === "needs_you")) return "stuck";
  if (tasks.some((t) => t.state === "failed")) return "failed";
  return "done";
}

// The connectors' plan, in column terms: a column is 1 wide and its box
// BOX of that (the rest is the gutter). A wire drops from a card's bottom
// edge to a run across the gap, then down into a lane's top edge; in one
// column it is a straight drop. Two wires cross when a straight drop stands
// inside another's run, when two runs heading opposite ways overlap, or when
// one run sits wholly inside another heading the same way; two that overlap
// heading the same way stay clear when the one setting off further back runs
// lower. The tests hold these rules (agent-map.test.ts).
const BOX = 0.94;
/** The space between two ports on one card, as a share of its width. */
const PORT_STEP = 0.1;
const EDGE = 0.08;
const EPS = 0.002;

type Draft = { lane: string; end: "from" | "to"; card: number; column: number };
type Placed = Draft & { cardAt: number; laneAt: number };

/**
 * Where each wire meets its lane and its card. A lane's one wire meets it in
 * the middle when it drops straight, else leaning toward the side it comes
 * from; its two meet at the middle and near the far edge when one drops
 * straight, else at its thirds. On a card, a straight drop keeps its place
 * and the rest step out from it toward where they go, the furthest-going
 * outermost.
 */
function placePorts(drafts: Draft[]): Placed[] {
  const laneAt = new Map<Draft, number>();
  const byLane = new Map<string, Draft[]>();
  for (const d of drafts) byLane.set(d.lane, [...(byLane.get(d.lane) ?? []), d]);
  for (const ends of byLane.values()) {
    ends.sort((a, b) => a.card - b.card);
    const straight = ends.find((d) => d.card === d.column);
    if (ends.length === 1) laneAt.set(ends[0], straight ? 0.5 : ends[0].card < ends[0].column ? 0.3 : 0.7);
    else if (straight) for (const d of ends) laneAt.set(d, d === straight ? 0.5 : d.card < d.column ? 0.2 : 0.8);
    else ends.forEach((d, i) => laneAt.set(d, i === 0 ? 0.36 : 0.64));
  }
  const cardAt = new Map<Draft, number>();
  const byCard = new Map<number, Draft[]>();
  for (const d of drafts) byCard.set(d.card, [...(byCard.get(d.card) ?? []), d]);
  for (const [k, mine] of byCard) {
    const x = (d: Draft) => d.column + BOX * laneAt.get(d)!;
    const straight = mine.find((d) => d.column === k);
    const left = mine.filter((d) => d.column < k).sort((a, b) => x(a) - x(b));
    const right = mine.filter((d) => d.column > k).sort((a, b) => x(a) - x(b));
    const anchor = straight ? laneAt.get(straight)! : 0.5;
    if (straight) cardAt.set(straight, anchor);
    const lStart = straight ? anchor - PORT_STEP : 0.4;
    const rStart = straight ? anchor + PORT_STEP : 0.6;
    const lStep = left.length > 1 ? Math.min(PORT_STEP, (lStart - EDGE) / (left.length - 1)) : PORT_STEP;
    const rStep = right.length > 1 ? Math.min(PORT_STEP, (1 - EDGE - rStart) / (right.length - 1)) : PORT_STEP;
    left.forEach((d, i) => cardAt.set(d, lStart - lStep * (left.length - 1 - i)));
    right.forEach((d, i) => cardAt.set(d, rStart + rStep * i));
  }
  return drafts.map((d) => ({ ...d, cardAt: cardAt.get(d)!, laneAt: laneAt.get(d)! }));
}

type Span = { a: number; b: number };
/** A wire's two ends across the board, in columns: where it leaves its card and where it meets its lane. */
export const wireSpan = (w: Pick<BandWire, "card" | "column" | "cardAt" | "laneAt">): Span => ({ a: w.card + BOX * w.cardAt, b: w.column + BOX * w.laneAt });
const spanOf = wireSpan;
const isStraight = (s: Span) => Math.abs(s.a - s.b) < EPS;

/** Whether two wires cross, wherever their runs are put. */
export function wiresCross(p: Span, q: Span): boolean {
  const ps = isStraight(p);
  const qs = isStraight(q);
  if (ps && qs) return Math.abs(p.a - q.a) < EPS;
  if (ps || qs) {
    const [s, r] = ps ? [p, q] : [q, p];
    return s.a > Math.min(r.a, r.b) + EPS && s.a < Math.max(r.a, r.b) - EPS;
  }
  const [pl, ph] = [Math.min(p.a, p.b), Math.max(p.a, p.b)];
  const [ql, qh] = [Math.min(q.a, q.b), Math.max(q.a, q.b)];
  if (!(pl < qh - EPS && ql < ph - EPS)) return false;
  if (p.b > p.a !== q.b > q.a) return true;
  return (pl <= ql + EPS && qh <= ph + EPS) || (ql <= pl + EPS && ph <= qh + EPS);
}

function crossings(placed: Placed[]): number {
  const spans = placed.map(spanOf);
  let n = 0;
  for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) if (wiresCross(spans[i], spans[j])) n += 1;
  return n;
}

/**
 * Each run's level, 0 the nearest the cards: of two overlapping runs heading
 * the same way, the one setting off further back runs lower; of two heading
 * opposite ways (which cross however they lie), the rightward one. Runs that
 * do not overlap share a level, so a calm board has one.
 */
function runLevels(placed: Placed[]): { levels: number[]; count: number } {
  const spans = placed.map(spanOf);
  const below = spans.map(() => [] as number[]);
  spans.forEach((p, i) =>
    spans.forEach((q, j) => {
      if (i === j || isStraight(p) || isStraight(q)) return;
      const overlap = Math.min(p.a, p.b) < Math.max(q.a, q.b) - EPS && Math.min(q.a, q.b) < Math.max(p.a, p.b) - EPS;
      if (!overlap) return;
      const pr = p.b > p.a;
      const qr = q.b > q.a;
      const lower = pr !== qr ? pr : pr ? p.a < q.a : p.a > q.a;
      if (lower) below[i].push(j);
    }),
  );
  const memo = new Map<number, number>();
  const depth = (i: number, path: Set<number>): number => {
    if (memo.has(i)) return memo.get(i)!;
    if (path.has(i)) return 0;
    path.add(i);
    const d = below[i].length ? 1 + Math.max(...below[i].map((j) => depth(j, path))) : 0;
    path.delete(i);
    memo.set(i, d);
    return d;
  };
  const levels = spans.map((s, i) => (isStraight(s) ? 0 : depth(i, new Set())));
  return { levels, count: Math.max(1, ...levels.map((l) => l + 1)) };
}

/**
 * One band's lanes and connectors. A lane to someone off the band (a
 * candidate, or a teammate in another band) has only its own agent to hang
 * from, so those go first, each under its agent's card or the nearest free
 * column; then each lane between two of the band's agents takes the free
 * column between them nearest its own agent, so a chain's lanes step along
 * under it. A column already holding a lane, or one whose connector would
 * cross another, is passed over, the more pressing lanes choosing first. A
 * lane's own connector is always drawn; the one up to the teammate it waits
 * on only when it crosses nothing (the lane's title still names them). A
 * band with more lanes than columns grows a column at its right.
 */
function arrangeBand(agents: string[], lanes: Lane[], size: number): Band {
  const col = new Map(agents.map((a, i) => [a, i]));
  const targetOf = (l: Lane) => (l.to.kind === "member" && l.to.id !== l.from && col.has(l.to.id) ? col.get(l.to.id)! : null);
  const order = [...lanes].sort(
    (a, b) => Number(targetOf(a) !== null) - Number(targetOf(b) !== null) || LANE_URGENCY[a.state] - LANE_URGENCY[b.state] || col.get(a.from)! - col.get(b.from)!,
  );
  let width = Math.max(size, agents.length);
  const columns: Record<string, number> = {};
  const taken = new Set<number>();
  const own = (): Draft[] => order.filter((l) => l.id in columns).map((l) => ({ lane: l.id, end: "from", card: col.get(l.from)!, column: columns[l.id] }));
  for (const l of order) {
    const s = col.get(l.from)!;
    const t = targetOf(l);
    const all = Array.from({ length: width }, (_, c) => c);
    const between = t === null ? [] : all.filter((c) => c >= Math.min(s, t) && c <= Math.max(s, t)).sort((a, b) => Math.abs(a - s) - Math.abs(b - s));
    const rest = all.filter((c) => !between.includes(c)).sort((a, b) => Math.abs(a - s) - Math.abs(b - s) || a - b);
    let best = -1;
    let bestScore = Infinity;
    [...between, ...rest].forEach((c, rank) => {
      if (taken.has(c)) return;
      const score = crossings(placePorts([...own(), { lane: l.id, end: "from", card: s, column: c }])) * 1000 + rank;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    });
    if (best < 0) best = width++;
    columns[l.id] = best;
    taken.add(best);
  }
  let drafts = own();
  for (const l of [...order].sort((a, b) => LANE_URGENCY[a.state] - LANE_URGENCY[b.state] || col.get(a.from)! - col.get(b.from)!)) {
    const t = targetOf(l);
    if (t === null) continue;
    const next: Draft[] = [...drafts, { lane: l.id, end: "to", card: t, column: columns[l.id] }];
    if (crossings(placePorts(next)) <= crossings(placePorts(drafts))) drafts = next;
  }
  const placed = placePorts(drafts);
  const { levels, count } = runLevels(placed);
  return {
    agents,
    lanes: [...lanes].sort((a, b) => columns[a.id] - columns[b.id]).map((l) => l.id),
    columns,
    width,
    wires: placed.map((w, i) => ({ ...w, key: `${w.lane}:${w.end}`, level: levels[i] })),
    levels: count,
  };
}

/**
 * The board's bands: teammates whose agents talk sit side by side, the
 * biggest group first, packed BAND_SIZE to a band (a group too big for one
 * runs on into the next); then each band's lanes and connectors
 * (arrangeBand).
 */
export function layoutBands(order: string[], lanes: Lane[], urgency: (id: string) => number, size = BAND_SIZE): Band[] {
  const onBoard = new Set(order);
  const links = new Map<string, Set<string>>(order.map((id) => [id, new Set<string>()]));
  for (const l of lanes) {
    if (l.state === "done" || l.to.kind !== "member" || !onBoard.has(l.from) || !onBoard.has(l.to.id) || l.from === l.to.id) continue;
    links.get(l.from)!.add(l.to.id);
    links.get(l.to.id)!.add(l.from);
  }
  // Groups of agents that talk, each walked from an end (its member with the
  // fewest links), so a chain Priya → Daniel → Noor lays out in that order.
  const seen = new Set<string>();
  const groups: string[][] = [];
  const reach = (from: string) => {
    const found = new Set([from]);
    const todo = [from];
    while (todo.length) {
      for (const next of links.get(todo.pop()!)!) {
        if (found.has(next)) continue;
        found.add(next);
        todo.push(next);
      }
    }
    return found;
  };
  for (const any of order) {
    if (seen.has(any)) continue;
    const start = [...reach(any)].sort((a, b) => links.get(a)!.size - links.get(b)!.size || order.indexOf(a) - order.indexOf(b))[0];
    const members: string[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const id = queue.shift()!;
      members.push(id);
      for (const next of [...links.get(id)!].sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    groups.push(members);
  }
  groups.sort((a, b) => b.length - a.length || Math.min(...a.map(urgency)) - Math.min(...b.map(urgency)) || order.indexOf(a[0]) - order.indexOf(b[0]));

  const bands: string[][] = [];
  for (const g of groups) {
    if (g.length > size) {
      for (let i = 0; i < g.length; i += size) bands.push(g.slice(i, i + size));
      continue;
    }
    const room = bands.find((b) => b.length + g.length <= size);
    if (room) room.push(...g);
    else bands.push([...g]);
  }

  return bands.map((agents) => arrangeBand(agents, lanes.filter((l) => agents.includes(l.from)), size));
}

export function buildAgentMap(input: MapInput, now: number): AgentMap {
  const since = now - RECENT_DAYS * DAY;
  const memberShort = shortNames(input.members);
  const memberParty = (id: string): Party => {
    const name = input.members.get(id);
    return name ? { kind: "member", id, name, short: memberShort.get(id) ?? firstName(name) } : { kind: "member", id, name: "A former teammate", short: "a former teammate" };
  };
  const candidateParty = (id: string): Party => {
    const name = input.people.get(id);
    return name ? { kind: "candidate", id, name, short: firstName(name) } : { kind: "candidate", id, name: "A candidate", short: "a candidate" };
  };

  const tasks: Record<string, MapTask> = {};
  for (const row of input.tasks) {
    const state = taskState(row.status, row.needs_you);
    if (!state) continue;
    if ((state === "done" || state === "failed") && Date.parse(row.updated_at) < since) continue;
    const agentId = row.actor_id ?? TEAM_AGENT;
    const app = row.application_id ? input.applications.get(row.application_id) : undefined;
    const iv = row.interview_id ? input.interviews.get(row.interview_id) : undefined;
    const personId = app?.personId ?? iv?.personId ?? null;
    const candidateName = app?.name ?? (personId ? input.people.get(personId) : undefined) ?? null;
    const withSelf = row.waiting_on_actor_id !== null && row.waiting_on_actor_id === row.actor_id;
    const party = row.waiting_on_actor_id && !withSelf ? memberParty(row.waiting_on_actor_id) : row.waiting_on_person_id ? candidateParty(row.waiting_on_person_id) : null;
    const kind = isKind(row.kind) ? row.kind : "other";
    const asked = party?.kind === "member" ? party.short : withSelf && row.actor_id ? (memberShort.get(row.actor_id) ?? null) : null;
    tasks[row.id] = {
      id: row.id,
      kind,
      state,
      agentId,
      ...taskWords(kind, candidateName, asked),
      with: party,
      withSelf,
      channel: isChannel(row.waiting_channel) ? row.waiting_channel : null,
      steps: cleanSteps(row.steps),
      error: row.error?.trim() || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      candidate: personId && candidateName ? { id: personId, name: candidateName } : null,
      interview: row.interview_id ? { id: row.interview_id, step: iv?.step ?? null } : null,
    };
  }

  const list = Object.values(tasks);
  const agents: Record<string, MapAgent> = {};
  const agentOf = (id: string): MapAgent => {
    if (!agents[id]) {
      const name = id === TEAM_AGENT ? "Your team's bot" : (input.members.get(id) ?? "A former teammate");
      agents[id] = { id, name, short: id === TEAM_AGENT ? "Your team's bot" : (memberShort.get(id) ?? firstName(name)), state: "idle", current: null, tasks: [] };
    }
    return agents[id];
  };
  for (const t of [...list].sort(byUrgency)) agentOf(t.agentId).tasks.push(t.id);
  for (const a of Object.values(agents)) {
    const open = a.tasks.map((id) => tasks[id]).filter((t) => t.state !== "done");
    // Its tasks are already most pressing first; the first one that is not done says what the agent is.
    if (open[0]) {
      a.state = open[0].state as AgentState;
      a.current = open[0].id;
    }
    a.tasks = [...open, ...a.tasks.map((id) => tasks[id]).filter((t) => t.state === "done")].map((t) => t.id);
  }

  const lanes: Record<string, Lane> = {};
  for (const t of list) {
    if (!t.with) continue;
    const id = `${t.agentId}>${t.with.kind}:${t.with.id}`;
    (lanes[id] ??= { id, from: t.agentId, to: t.with, state: "done", tasks: [] }).tasks.push(t.id);
  }
  for (const l of Object.values(lanes)) {
    const own = l.tasks.map((id) => tasks[id]).sort(byUrgency);
    l.tasks = own.map((t) => t.id);
    l.state = laneState(own);
  }

  // On the board: every agent with work, then each teammate an open handoff waits on.
  const busy = Object.values(agents).filter((a) => a.state !== "idle");
  const urgency = (id: string) => (agents[id] && agents[id].current ? URGENCY[tasks[agents[id].current!].state] : 9);
  const order = busy.sort((a, b) => urgency(a.id) - urgency(b.id) || a.name.localeCompare(b.name)).map((a) => a.id);
  const onBoard = new Set(order);
  for (const l of Object.values(lanes).sort((a, b) => LANE_URGENCY[a.state] - LANE_URGENCY[b.state])) {
    if (l.state === "done" || l.to.kind !== "member" || onBoard.has(l.to.id) || !onBoard.has(l.from)) continue;
    agentOf(l.to.id);
    order.push(l.to.id);
    onBoard.add(l.to.id);
  }
  // A lane shows on the board only from an agent on it.
  const boardLanes = Object.values(lanes).filter((l) => onBoard.has(l.from));
  const bands = layoutBands(order, boardLanes, urgency);

  // Idle: who interviews, and anyone a task names, that the board does not hold. Former teammates drop off.
  const idle = new Set<string>();
  for (const id of input.roster) if (input.members.has(id) && !onBoard.has(id)) idle.add(id);
  for (const a of Object.values(agents)) if (a.id !== TEAM_AGENT && input.members.has(a.id) && !onBoard.has(a.id)) idle.add(a.id);
  for (const l of Object.values(lanes)) if (l.to.kind === "member" && input.members.has(l.to.id) && !onBoard.has(l.to.id)) idle.add(l.to.id);
  const idleIds = [...idle].map((id) => agentOf(id)).sort((a, b) => a.name.localeCompare(b.name)).map((a) => a.id);

  const counts = { working: 0, waiting: 0, needsYou: 0, failed: 0 };
  for (const a of Object.values(agents)) {
    if (a.state === "working") counts.working += 1;
    else if (a.state === "waiting") counts.waiting += 1;
    else if (a.state === "needs_you") counts.needsYou += 1;
    else if (a.state === "failed") counts.failed += 1;
  }

  return { agents, tasks, lanes, bands, idle: idleIds, counts, bot: input.bot };
}

/** Lanes that end at this teammate: other agents waiting on them. */
export const lanesInto = (map: AgentMap, agentId: string) => Object.values(map.lanes).filter((l) => l.to.kind === "member" && l.to.id === agentId && l.from !== agentId);
/** Lanes from this agent, most pressing first. */
export const lanesFrom = (map: AgentMap, agentId: string) =>
  Object.values(map.lanes)
    .filter((l) => l.from === agentId)
    .sort((a, b) => LANE_URGENCY[a.state] - LANE_URGENCY[b.state]);
export const isOpen = (state: TaskState) => OPEN.has(state);

type Rows<T> = { data: T[] | null; error: { message: string } | null };
const must = <T>(r: Rows<T>, what: string): T[] => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data ?? [];
};

/** Ids in slices, so a long list never makes an over-long URL. */
async function inSlices<T>(ids: string[], read: (slice: string[]) => PromiseLike<Rows<T>>, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) out.push(...must(await read(ids.slice(i, i + 150)), what));
  return out;
}

async function readBot(db: Db, accessLevel: AccessLevel): Promise<BotState> {
  if (accessLevel === "admin") {
    const { data, error } = await db.from("agent_destinations").select("enabled, verified_at").eq("channel", "grok_bot_webhook").maybeSingle();
    if (error) return "unknown";
    if (!data) return "none";
    return !data.enabled ? "off" : data.verified_at ? "connected" : "unverified";
  }
  // Everyone else reads the boolean only (the same definer Settings asks; the vendored types do not name it yet).
  const { data, error } = await (db.rpc as unknown as (fn: string) => Promise<{ data: boolean | null; error: { message: string } | null }>)("bot_destination_connected");
  if (error) return "unknown";
  return data ? "connected" : "none";
}

type AppRow = { id: string; person_id: string; people: { display_name: string | null } | null };

export async function readAgentMap(db: Db, member: { accessLevel: AccessLevel }, now: Date): Promise<AgentMap> {
  const since = new Date(now.getTime() - RECENT_DAYS * DAY).toISOString();
  const [taskRows, memberRows, seats, bot] = await Promise.all([
    db
      .from("bot_tasks")
      .select("id, kind, status, application_id, interview_id, actor_id, waiting_on_actor_id, waiting_on_person_id, waiting_channel, steps, error, needs_you, created_at, updated_at")
      .neq("status", "cancelled")
      .or(`status.in.(running,waiting),updated_at.gte.${since}`)
      .order("updated_at", { ascending: false })
      .limit(TASK_MAX),
    db.from("org_members").select("id, display_name").limit(5000),
    db.from("hiring_team").select("actor_id").limit(5000),
    readBot(db, member.accessLevel),
  ]);
  const rows = must(taskRows, "bot_tasks") as TaskRow[];
  const members = new Map<string, string>();
  for (const m of must(memberRows, "org_members")) if (m.id) members.set(m.id, m.display_name?.trim() || "A teammate");
  const roster = [...new Set(must(seats, "hiring_team").map((s) => s.actor_id))];

  const appIds = [...new Set(rows.map((r) => r.application_id).filter((v): v is string => !!v))];
  const interviewIds = [...new Set(rows.map((r) => r.interview_id).filter((v): v is string => !!v))];
  const [apps, interviews] = await Promise.all([
    inSlices<AppRow>(
      appIds,
      (slice) => db.from("applications").select("id, person_id, people(display_name)").in("id", slice).overrideTypes<AppRow[], { merge: false }>(),
      "applications",
    ),
    inSlices(interviewIds, (slice) => db.from("interviews").select("id, step, person_id").in("id", slice), "interviews"),
  ]);
  const personIds = [...new Set([...rows.map((r) => r.waiting_on_person_id), ...interviews.map((i) => i.person_id)].filter((v): v is string => !!v))];
  const people = new Map<string, string>();
  for (const p of await inSlices(personIds, (slice) => db.from("people").select("id, display_name").in("id", slice), "people")) {
    if (p.display_name?.trim()) people.set(p.id, p.display_name.trim());
  }
  const applications = new Map<string, { personId: string; name: string }>();
  for (const a of apps) {
    const name = a.people?.display_name?.trim();
    if (name) applications.set(a.id, { personId: a.person_id, name });
  }

  return buildAgentMap(
    {
      tasks: rows,
      members,
      roster,
      applications,
      interviews: new Map(interviews.map((i) => [i.id, { step: i.step, personId: i.person_id }])),
      people,
      bot,
    },
    now.getTime(),
  );
}
