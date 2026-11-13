import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

// The board's markup: cards, lanes and the idle row say who is doing what in
// words, everything that opens a detail is a button, and the page keeps
// Hy's rules (no "·", no initials, sentence case).

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { buildAgentMap, type MapInput, type TaskRow } from "@/lib/client/agent-map";
import { AgentsBoard } from "./view";

const NOW = Date.parse("2026-11-13T09:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const row = (over: Partial<TaskRow>): TaskRow => ({
  id: "t",
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
    ["priya", "Priya Raman"],
    ["daniel", "Daniel Okafor"],
    ["wei", "Wei Zhang"],
  ]),
  roster: ["priya", "daniel", "wei"],
  applications: new Map([["app-f", { personId: "p-f", name: "Fatima Zahra" }]]),
  interviews: new Map(),
  people: new Map(),
  bot: "connected",
  ...over,
});
const board = (tasks: TaskRow[], over: Partial<MapInput> = {}) =>
  renderToStaticMarkup(<AgentsBoard map={buildAgentMap(input(tasks, over), NOW)} now={NOW} setUpHref="/client/settings#bot" />);

describe("the board", () => {
  const waiting = row({
    id: "t1",
    kind: "get_read",
    status: "waiting",
    actor_id: "priya",
    waiting_on_actor_id: "daniel",
    application_id: "app-f",
    steps: [{ label: "Reminded Daniel", at: ago(25) }],
  });

  test("a card per agent at work and per teammate it waits on, the handoff in a lane titled with their names", () => {
    const html = board([waiting]);
    expect(html).toContain('data-agent="priya"');
    expect(html).toContain('data-agent="daniel"');
    expect(html).toContain("Waiting on Daniel");
    expect(html).toContain("Chasing Daniel&#x27;s read on Fatima Zahra");
    // The latest step rides in the card's hover, whole, never cut short on the card.
    expect(html).toMatch(/title="Priya Raman&#x27;s agent\nLast step: Reminded Daniel"/);
    expect(html).toMatch(/data-lane="priya&gt;member:daniel"[^>]*>[\s\S]*?>Priya<svg[\s\S]*?>Daniel</);
    expect(html).toContain("Daniel&#x27;s read on Fatima Zahra");
  });

  test("a teammate whose agent is idle, here only because another waits on them, is a one-line card", () => {
    const html = board([waiting]);
    const daniel = html.slice(html.indexOf('data-agent="daniel"'), html.indexOf("</button>", html.indexOf('data-agent="daniel"')));
    expect(daniel).toContain("self-start");
    expect(daniel).toContain(">Idle<");
    expect(html).not.toContain("Ready for a task");
  });

  test("nothing on the board turns: working is the live square, waiting the still corner", () => {
    const html = board([waiting, row({ id: "t2", status: "running", actor_id: "wei", updated_at: ago(1) })]);
    expect(html).not.toContain("animate-spin");
  });

  test("everyone else who interviews is one quiet row of names, each opening their agent", () => {
    const html = board([waiting]);
    expect(html).toMatch(/aria-label="Idle agents"[\s\S]*Wei Zhang/);
    expect(html.match(/aria-haspopup="dialog"/g)?.length).toBeGreaterThanOrEqual(4);
  });

  test("keeps Hy's rules: no separators, no initials, no all caps", () => {
    const html = board([waiting]);
    expect(html).not.toContain("·");
    expect(html).not.toMatch(/>PR<|>DO<|uppercase/);
  });

  test("a lane shows three items, the third fading, and opens the agent for the rest", () => {
    const four = [1, 2, 3, 4].map((i) => row({ ...waiting, id: `t${i}`, updated_at: ago(i) }));
    const html = board(four);
    expect(html.match(/agents-item/g)?.length).toBe(3);
    expect(html).toContain("agents-fade");
    expect(html).toContain(">1 more<");
  });

  test("with no bot and nothing to show, says so and links an admin to Settings", () => {
    const html = board([], { bot: "none", roster: [] });
    expect(html).toContain("Your team&#x27;s bot is not connected yet.");
    expect(html).toContain('href="/client/settings#bot"');
  });

  test("with the bot connected and nobody at work, the board is quiet and the names stay", () => {
    const html = board([]);
    expect(html).toContain("No agent is working on anything right now.");
    expect(html).toContain("Priya Raman");
  });
});
