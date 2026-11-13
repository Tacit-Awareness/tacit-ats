import { describe, expect, test } from "vitest";
import { buildAgentMap, cleanSteps, layoutBands, shortNames, taskState, taskWords, TEAM_AGENT, wiresCross, wireSpan, type Band, type Lane, type MapInput, type TaskRow } from "./agent-map";

const NOW = Date.parse("2026-11-13T09:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const PRIYA = "a-priya";
const DANIEL = "a-daniel";
const NOOR = "a-noor";
const LENA = "a-lena";
const SAM = "a-sam";
const WEI = "a-wei";

let n = 0;
const row = (over: Partial<TaskRow>): TaskRow => ({
  id: `t${++n}`,
  kind: "other",
  status: "running",
  application_id: null,
  interview_id: null,
  actor_id: null,
  waiting_on_actor_id: null,
  waiting_on_person_id: null,
  waiting_channel: null,
  steps: [],
  error: null,
  needs_you: false,
  created_at: ago(120),
  updated_at: ago(10),
  ...over,
});

const input = (tasks: TaskRow[], over: Partial<MapInput> = {}): MapInput => ({
  tasks,
  members: new Map([
    [PRIYA, "Priya Raman"],
    [DANIEL, "Daniel Okafor"],
    [NOOR, "Noor Haddad"],
    [LENA, "Lena Park"],
    [SAM, "Sam Whitaker"],
    [WEI, "Wei Zhang"],
  ]),
  roster: [PRIYA, DANIEL, NOOR, LENA, SAM, WEI],
  applications: new Map([
    ["app-fatima", { personId: "p-fatima", name: "Fatima Zahra" }],
    ["app-tom", { personId: "p-tom", name: "Tom Becker" }],
    ["app-camille", { personId: "p-camille", name: "Camille Laurent" }],
  ]),
  interviews: new Map([["iv-1", { step: "Founders' round", personId: null }]]),
  people: new Map([["p-camille", "Camille Laurent"]]),
  bot: "connected",
  ...over,
});

describe("taskState", () => {
  test("running is working, a stuck task needs you whatever it was doing, cancelled is not shown", () => {
    expect(taskState("running", false)).toBe("working");
    expect(taskState("waiting", false)).toBe("waiting");
    expect(taskState("waiting", true)).toBe("needs_you");
    expect(taskState("failed", true)).toBe("needs_you");
    expect(taskState("failed", false)).toBe("failed");
    expect(taskState("done", false)).toBe("done");
    expect(taskState("cancelled", false)).toBeNull();
  });
});

describe("taskWords", () => {
  test("says the task in words, with or without a candidate", () => {
    expect(taskWords("get_read", "Fatima Zahra", "Daniel")).toEqual({ doing: "Chasing Daniel's read on Fatima Zahra", thing: "Daniel's read on Fatima Zahra" });
    expect(taskWords("get_read", "Fatima Zahra", null).doing).toBe("Chasing feedback for Fatima Zahra");
    expect(taskWords("schedule_interview", "Arjun Mehta", null).doing).toBe("Booking an interview with Arjun Mehta");
    expect(taskWords("send_testbench", null, null)).toEqual({ doing: "Sending a Testbench", thing: "A Testbench" });
    expect(taskWords("ask_interviewer", "Tom Becker", "Noor").doing).toBe("Asking Noor about Tom Becker");
  });
});

describe("cleanSteps", () => {
  test("keeps labelled steps, newest last, and drops anything else", () => {
    expect(cleanSteps([{ label: " Asked Daniel ", at: "2026-11-12T10:00:00Z" }, { label: "" }, { at: "x" }, "nope", { label: "No time", at: "soon" }])).toEqual([
      { label: "Asked Daniel", at: "2026-11-12T10:00:00Z" },
      { label: "No time", at: null },
    ]);
    expect(cleanSteps({ label: "not an array" })).toEqual([]);
  });
});

describe("shortNames", () => {
  test("first names, unless two people share one", () => {
    const s = shortNames(new Map([["1", "Sam Whitaker"], ["2", "Sam Ortiz"], ["3", "Noor Haddad"]]));
    expect([...s.values()]).toEqual(["Sam Whitaker", "Sam Ortiz", "Noor"]);
  });
});

describe("buildAgentMap", () => {
  test("an agent waiting on a teammate is a live lane between their agents, and the teammate joins the board", () => {
    const t = row({ kind: "get_read", status: "waiting", actor_id: PRIYA, waiting_on_actor_id: DANIEL, waiting_channel: "slack", application_id: "app-fatima", interview_id: "iv-1" });
    const map = buildAgentMap(input([t]), NOW);
    expect(map.agents[PRIYA]).toMatchObject({ state: "waiting", current: t.id });
    expect(map.tasks[t.id]).toMatchObject({
      doing: "Chasing Daniel's read on Fatima Zahra",
      with: { kind: "member", id: DANIEL, short: "Daniel" },
      channel: "slack",
      candidate: { id: "p-fatima", name: "Fatima Zahra" },
      interview: { id: "iv-1", step: "Founders' round" },
    });
    const lane = Object.values(map.lanes)[0];
    expect(lane).toMatchObject({ from: PRIYA, to: { kind: "member", id: DANIEL }, state: "live", tasks: [t.id] });
    expect(map.bands).toHaveLength(1);
    expect(map.bands[0].agents).toEqual([PRIYA, DANIEL]);
    expect(map.agents[DANIEL].state).toBe("idle");
    expect(map.idle).toEqual([LENA, NOOR, SAM, WEI]);
    expect(map.counts).toEqual({ working: 0, waiting: 1, needsYou: 0, failed: 0 });
  });

  test("a wait on a candidate is a lane to them; nobody else joins the board", () => {
    const t = row({ kind: "schedule_interview", status: "waiting", actor_id: LENA, waiting_on_person_id: "p-camille", waiting_channel: "email", application_id: "app-camille" });
    const map = buildAgentMap(input([t]), NOW);
    expect(Object.values(map.lanes)[0]).toMatchObject({ from: LENA, to: { kind: "candidate", id: "p-camille", name: "Camille Laurent" }, state: "live" });
    expect(map.bands[0].agents).toEqual([LENA]);
  });

  test("the most pressing task says what an agent is: needs you, then failed, then working, then waiting", () => {
    const waiting = row({ status: "waiting", actor_id: DANIEL, waiting_on_actor_id: NOOR, updated_at: ago(1) });
    const working = row({ status: "running", actor_id: DANIEL, updated_at: ago(5) });
    let map = buildAgentMap(input([waiting, working]), NOW);
    expect(map.agents[DANIEL]).toMatchObject({ state: "working", current: working.id, tasks: [working.id, waiting.id] });
    const stuck = row({ status: "waiting", needs_you: true, actor_id: DANIEL, waiting_on_actor_id: SAM, updated_at: ago(60 * 26) });
    map = buildAgentMap(input([waiting, working, stuck]), NOW);
    expect(map.agents[DANIEL]).toMatchObject({ state: "needs_you", current: stuck.id });
    expect(map.counts.needsYou).toBe(1);
  });

  test("finished and failed work older than a week drops off; open work never does", () => {
    const oldDone = row({ status: "done", actor_id: WEI, updated_at: ago(60 * 24 * 8) });
    const oldOpen = row({ status: "waiting", actor_id: WEI, updated_at: ago(60 * 24 * 30) });
    const map = buildAgentMap(input([oldDone, oldOpen]), NOW);
    expect(Object.keys(map.tasks)).toEqual([oldOpen.id]);
  });

  test("done work keeps its lane but brings no one onto the board", () => {
    const done = row({ kind: "get_read", status: "done", actor_id: PRIYA, waiting_on_actor_id: SAM });
    const map = buildAgentMap(input([done]), NOW);
    expect(Object.values(map.lanes)[0].state).toBe("done");
    expect(map.bands).toEqual([]);
    expect(map.idle).toContain(PRIYA);
    expect(map.idle).toContain(SAM);
  });

  test("an agent asking its own teammate is no lane; a task for no one is the team's bot", () => {
    const self = row({ kind: "get_read", status: "waiting", actor_id: WEI, waiting_on_actor_id: WEI });
    const team = row({ kind: "send_rejection", status: "running", actor_id: null });
    const map = buildAgentMap(input([self, team]), NOW);
    expect(map.lanes).toEqual({});
    expect(map.tasks[self.id]).toMatchObject({ with: null, withSelf: true, doing: "Chasing Wei's read" });
    expect(map.agents[TEAM_AGENT]).toMatchObject({ name: "Your team's bot", state: "working" });
  });

  test("names it cannot read stay vague, never blank", () => {
    const t = row({ status: "waiting", actor_id: "a-gone", waiting_on_person_id: "p-hidden" });
    const map = buildAgentMap(input([t]), NOW);
    expect(map.agents["a-gone"].name).toBe("A former teammate");
    expect(map.tasks[t.id].with).toMatchObject({ kind: "candidate", name: "A candidate" });
  });
});

describe("layoutBands", () => {
  const lane = (from: string, to: string, state: Lane["state"] = "live"): Lane => ({ id: `${from}>${to}`, from, to: { kind: "member", id: to, name: to, short: to }, state, tasks: [] });
  const toCandidate = (from: string, to: string, state: Lane["state"] = "live"): Lane => ({ id: `${from}>${to}`, from, to: { kind: "candidate", id: to, name: to, short: to }, state, tasks: [] });
  /** Every pair of a band's wires that would cross. */
  const crossings = (band: Band) =>
    band.wires.flatMap((a, i) => band.wires.slice(i + 1).filter((b) => wiresCross(wireSpan(a), wireSpan(b))).map((b) => `${a.key} x ${b.key}`));
  const straight = (band: Band, key: string) => {
    const w = band.wires.find((x) => x.key === key)!;
    return w.card === w.column && w.cardAt === w.laneAt;
  };

  test("agents that talk sit together, the biggest group first, four to a band", () => {
    const bands = layoutBands(["a", "b", "c", "d", "e", "f"], [lane("a", "f"), lane("f", "e"), lane("b", "c")], () => 0);
    expect(bands.map((b) => b.agents)).toEqual([["a", "f", "e", "d"], ["b", "c"]]);
  });

  test("a chain lays out end to end, each lane under its own agent with a straight drop, the teammate it waits on stepping in from beside it", () => {
    const [band] = layoutBands(["daniel", "priya", "noor"], [lane("priya", "daniel"), lane("daniel", "noor")], () => 0);
    expect(band.agents).toEqual(["priya", "daniel", "noor"]);
    expect(band.columns).toEqual({ "priya>daniel": 0, "daniel>noor": 1 });
    expect(straight(band, "priya>daniel:from")).toBe(true);
    expect(straight(band, "daniel>noor:from")).toBe(true);
    expect(band.wires.map((w) => w.key).sort()).toEqual(["daniel>noor:from", "daniel>noor:to", "priya>daniel:from", "priya>daniel:to"]);
    expect(crossings(band)).toEqual([]);
  });

  test("a lane to someone off the band takes its agent's column first; a lane between two then sits between them, nearest its own", () => {
    const [band] = layoutBands(["a", "b", "c"], [lane("a", "x", "done"), lane("a", "b"), lane("b", "c")], () => 0);
    expect(band.columns).toEqual({ "a>x": 0, "a>b": 1, "b>c": 2 });
    expect(band.lanes).toEqual(["a>x", "a>b", "b>c"]);
    // a's handoff to b hangs under b, b's own drop straight into it and a's stepping across: nothing crosses, one level of runs.
    expect(straight(band, "a>b:to")).toBe(true);
    expect(crossings(band)).toEqual([]);
    expect(band.levels).toBe(1);
  });

  test("the demo's board: two bands, every wire drawn, none crossing, one level of runs each", () => {
    const order = ["aisha", "marcus", "daniel", "jonah", "lena", "priya", "noor", "theo"];
    const urgency: Record<string, number> = { aisha: 0, marcus: 1, daniel: 2, jonah: 2, lena: 3, priya: 3 };
    const lanes = [lane("priya", "daniel"), lane("priya", "sam", "done"), lane("daniel", "noor"), toCandidate("lena", "camille"), toCandidate("marcus", "diego", "failed"), lane("aisha", "theo", "stuck")];
    const bands = layoutBands(order, lanes, (id) => urgency[id] ?? 9);
    expect(bands.map((b) => b.agents)).toEqual([
      ["priya", "daniel", "noor", "marcus"],
      ["aisha", "theo", "jonah", "lena"],
    ]);
    expect(bands[0].columns).toEqual({ "priya>sam": 0, "priya>daniel": 1, "daniel>noor": 2, "marcus>diego": 3 });
    expect(bands[1].columns).toEqual({ "aisha>theo": 0, "lena>camille": 3 });
    expect(bands.flatMap((b) => b.wires)).toHaveLength(9);
    for (const b of bands) {
      expect(crossings(b)).toEqual([]);
      expect(b.levels).toBe(1);
      expect(b.width).toBe(4);
    }
  });

  test("a connector up to the teammate waited on is left out rather than cross another; the lane's own is always drawn", () => {
    // Priya's agent waits on three teammates: the one it cannot reach cleanly keeps its lane, named in the title, with no wire up to its card.
    const [band] = layoutBands(["priya", "daniel", "sam", "noor"], [lane("priya", "daniel"), lane("priya", "sam"), lane("priya", "noor")], () => 0);
    expect(band.wires.filter((w) => w.end === "from")).toHaveLength(3);
    expect(band.wires.filter((w) => w.end === "to").length).toBeLessThan(3);
    expect(crossings(band)).toEqual([]);
    // Two runs leaving one card the same way lie on two levels, the one setting off further back lower.
    const runs = band.wires.filter((w) => w.end === "from" && w.card !== w.column).sort((a, b) => a.cardAt - b.cardAt);
    expect(runs).toHaveLength(2);
    expect(runs[0].level).toBeGreaterThan(runs[1].level);
  });

  test("more lanes than columns grow the band a column at a time", () => {
    const lanes = ["p", "q", "r", "s", "t"].map((to) => toCandidate("a", to));
    const [band] = layoutBands(["a"], lanes, () => 0);
    expect(Object.values(band.columns).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(band.width).toBe(5);
    expect(crossings(band)).toEqual([]);
  });
});

describe("wiresCross", () => {
  test("a straight drop crosses a run passing over it, not one that stops short of it", () => {
    expect(wiresCross({ a: 1.5, b: 1.5 }, { a: 0.5, b: 2.3 })).toBe(true);
    expect(wiresCross({ a: 1.5, b: 1.5 }, { a: 0.5, b: 1.2 })).toBe(false);
  });

  test("runs heading opposite ways cross where they overlap", () => {
    expect(wiresCross({ a: 0.6, b: 1.3 }, { a: 1.4, b: 0.7 })).toBe(true);
    expect(wiresCross({ a: 0.6, b: 1.3 }, { a: 2.4, b: 1.7 })).toBe(false);
  });

  test("runs heading the same way cross only when one lies wholly inside the other", () => {
    expect(wiresCross({ a: 0.5, b: 2.5 }, { a: 1.0, b: 2.0 })).toBe(true);
    expect(wiresCross({ a: 0.5, b: 1.5 }, { a: 1.0, b: 2.5 })).toBe(false);
  });
});
