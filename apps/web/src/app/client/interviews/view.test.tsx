import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Loop, type LoopRound, type Reader } from "./view";

const round = (n: number, over: Partial<LoopRound>): LoopRound => ({
  key: `step-${n}`, n, name: `Round ${n}`, status: "Not booked", people: [], when: null, place: "later", next: false, href: null, ...over,
});

const reader = (rounds: LoopRound[], partial = false): Reader => ({
  title: "", sub: "", verdict: null, candidate: "Ada", tag: "Round 2 of 3", loopLine: "Engineer · 2 of 3 rounds held", rounds, partial, feedback: [], feedbackNote: null,
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
