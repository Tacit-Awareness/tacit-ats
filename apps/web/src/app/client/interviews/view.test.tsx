import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { RouteNode, RouteView } from "@/lib/client/interview-loop";
import { Loop, type LoopRound, type Reader } from "./view";

const round = (n: number, over: Partial<LoopRound>): LoopRound => ({
  key: `step-${n}`, n, name: `Round ${n}`, status: "Not booked", people: [], when: null, place: "later", next: false, href: null, ...over,
});

const reader = (rounds: LoopRound[], partial = false): Reader => ({
  title: "", sub: "", verdict: null, candidate: "Ada", tag: "Round 2 of 3", loopLine: "Engineer · 2 of 3 rounds held", rounds, route: null, editProcess: null, partial, feedback: [], feedbackNote: null,
});

const rounds = [
  round(1, { status: "Held", place: "past", when: "3d ago", href: "/client/interviews?i=a", people: [{ name: "Ana", state: "Filed", tone: "done" }] }),
  round(2, { status: "Held", place: "current", people: [{ name: "Ben", state: "Not filed", tone: "waiting" }] }),
  round(3, { next: true }),
  round(4, {}),
];

describe("the loop as a path", () => {
  const html = renderToStaticMarkup(<Loop reader={reader(rounds)} />);

  test("keeps its accessible label and lists the rounds in order", () => {
    expect(html).toContain('aria-label="Interview loop"');
    expect(html).toContain("<ol");
    expect(html.match(/<li/g)).toHaveLength(4);
  });

  test("says each state in words, not only in colour", () => {
    expect(html).toContain("This interview");
    expect(html.match(/Up next/g)).toHaveLength(1);
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Held · 3d ago");
    expect(html).toContain("Filed");
    expect(html).toContain("Not filed");
  });

  test("a round links to its interview when it has one, and no further", () => {
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="/client/interviews?i=a"');
  });

  test("one arrow between each pair of rounds", () => {
    expect(html.match(/border-l-current/g)).toHaveLength(3);
  });

  test("the partial note shows only for a member seeing their own rounds", () => {
    expect(html).not.toContain("You see the rounds you interview on");
    expect(renderToStaticMarkup(<Loop reader={reader(rounds, true)} />)).toContain("You see the rounds you interview on");
  });

  test("with no rounds there is no row", () => {
    expect(renderToStaticMarkup(<Loop reader={reader([])} />)).not.toContain("<ol");
  });
});

describe("the routing graph", () => {
  const node = (id: string, over: Partial<RouteNode<LoopRound>>): RouteNode<LoopRound> => ({
    id, kind: "stage", label: id, state: "todo", flag: null, who: "Engineering", round: null, x: 0, y: 0, w: 176, h: 58, ...over,
  });
  const route: RouteView<LoopRound> = {
    width: 400,
    height: 200,
    tag: "1 round left before the offer",
    edges: [{ id: "a-b", d: "M0 0", arrow: "M0 0", tone: "up" }],
    offPlan: [round(9, { key: "iv-x", name: "Extra chat", status: "Held", place: "past" })],
    nodes: [
      node("pre", { kind: "pre", label: "Applied", state: "done" }),
      node("view", { state: "view", flag: "This interview", label: "Onsite", round: round(1, { status: "Held", place: "current", people: [{ name: "Ben", state: "Filed", tone: "done" }] }) }),
      node("other", { state: "off", label: "Pitch", who: "Sales" }),
      node("up", { state: "up", flag: "Up next", label: "Final" }),
      node("end", { kind: "end", label: "Offer" }),
    ],
  };
  const withRoute = (over: Partial<Reader> = {}) => ({ ...reader(rounds), route, ...over });
  const html = renderToStaticMarkup(<Loop reader={withRoute()} />);

  test("draws the graph and not the row, in order, each state in words", () => {
    expect(html).toContain("The way through the interview process");
    expect(html.indexOf("Applied")).toBeLessThan(html.indexOf("Onsite"));
    expect(html).toContain("another team&#x27;s branch");
    expect(html).toContain("This interview");
    expect(html).toContain("Up next");
    expect(html).toContain('aria-current="step"');
    expect(html).not.toContain("Round 1");
  });

  test("who filed, and off-plan rounds under it", () => {
    expect(html).toContain("Filed");
    expect(html).toContain("Not on the plan");
    expect(html).toContain("Extra chat");
    expect(renderToStaticMarkup(<Loop reader={withRoute({ route: { ...route, offPlan: [] } })} />)).not.toContain("Not on the plan");
  });

  test("it scrolls in its own box at full width, the phone's way of fitting it", () => {
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("width:400px");
  });

  test("an admin gets a link to the process, nobody else, and the graph itself edits nothing", () => {
    expect(html).not.toContain("Edit the process");
    const admin = renderToStaticMarkup(<Loop reader={withRoute({ editProcess: "/client/onboarding/process" })} />);
    expect(admin).toContain('href="/client/onboarding/process"');
    expect(admin).toContain("Edit the process");
  });

  test("colours are tokens, so dark mode follows", () => {
    // An avatar's own colour is per name, on purpose, in both themes.
    expect(html.replace(/--c:#[0-9a-f]+/gi, "")).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});
