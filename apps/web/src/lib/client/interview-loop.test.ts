import { describe, expect, test } from "vitest";
import type { clientTools } from "@tacit-ats/core";
import { hiddenOn, loopRounds, routeView, stageIsOpen } from "./interview-loop";
import type { ProcessDoc, ProcessEdge, ProcessLookup, ProcessNode } from "./process-graph";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const H = 3_600_000;
const at = (h: number) => new Date(NOW + h * H).toISOString();

const interview = (
  id: string,
  step: string | null,
  h: number,
  status: string,
  interviewers: clientTools.PlanInterview["interviewers"],
): clientTools.PlanInterview => ({ interviewId: id, step, startsAt: at(h), endsAt: at(h + 1), status, interviewers });

const progress: clientTools.PlanProgress = {
  applicationId: "app",
  seesAllInterviews: true,
  steps: [
    { position: 1, step: "Screen", state: "done", interviews: [interview("i1", "Screen", -72, "done", [{ userId: "u1", name: "Ana", feedback: "filed" }])] },
    {
      position: 2,
      step: "Onsite",
      state: "scheduled",
      interviews: [
        interview("i0", "Onsite", -30, "cancelled", [{ userId: "u2", name: "Ben", feedback: null }]),
        interview("i2", "Onsite", -26, "scheduled", [
          { userId: "u2", name: "Ben", feedback: "not_filed" },
          { userId: "u3", name: "Cy", feedback: "hidden" },
        ]),
      ],
    },
    { position: 3, step: "Final", state: "not_scheduled", interviews: [] },
  ],
  offPlan: [interview("i3", null, 24, "scheduled", [{ userId: "u1", name: "Ana", feedback: "not_filed" }])],
  nextStep: "Final",
};

describe("loopRounds", () => {
  const rounds = loopRounds(progress, "i2", new Set(["i1", "i2", "i3"]), NOW, true);

  test("the plan's steps in order, then off-plan interviews, numbered", () => {
    expect(rounds.map((r) => [r.n, r.name, r.status])).toEqual([
      [1, "Screen", "Held"],
      [2, "Onsite", "Held"],
      [3, "Final", "Not booked"],
      [4, "Interview", "Booked"],
    ]);
  });

  test("this round is current, earlier ones past, later ones faded", () => {
    expect(rounds.map((r) => r.place)).toEqual(["past", "current", "later", "later"]);
  });

  test("a round shows its live interview's people and whether each filed, never what", () => {
    expect(rounds[1]!.people).toEqual([
      { name: "Ben", state: "Not filed", tone: "waiting" },
      { name: "Cy", state: "Not visible to you", tone: "hidden" },
    ]);
    expect(rounds[0]!.people).toEqual([{ name: "Ana", state: "Filed", tone: "done" }]);
    expect(rounds[3]!.people).toEqual([{ name: "Ana", state: "Booked", tone: "none" }]);
    expect(rounds[3]!.when).toBe("in 1d");
  });

  test("other listed rounds link to their interview; this one and unlisted ones do not", () => {
    expect(rounds.map((r) => r.interviewId)).toEqual(["i1", null, null, "i3"]);
    expect(loopRounds(progress, "i2", new Set(["i2"]), NOW, true).map((r) => r.interviewId)).toEqual([null, null, null, null]);
  });

  test("the next round is the first still to happen, and there is only one", () => {
    expect(rounds.map((r) => r.next)).toEqual([false, false, true, false]);
  });

  test("a booked round can be next, and so can the one being read", () => {
    const ahead = { ...progress, steps: progress.steps.slice(0, 1) };
    expect(loopRounds(ahead, "i3", new Set(), NOW, true).map((r) => [r.place, r.next])).toEqual([["past", false], ["current", true]]);
  });

  test("a cancelled round is passed over", () => {
    const steps = [
      { position: 1, step: "Screen", state: "cancelled" as const, interviews: [interview("c", "Screen", -5, "cancelled", [])] },
      { position: 2, step: "Final", state: "not_scheduled" as const, interviews: [] },
    ];
    expect(loopRounds({ ...progress, steps, offPlan: [] }, "c", new Set(), NOW, true).map((r) => r.next)).toEqual([false, true]);
  });

  test("nothing is next once every round is held, or the application closed", () => {
    expect(loopRounds({ ...progress, steps: progress.steps.slice(0, 2), offPlan: [] }, "i2", new Set(), NOW, true).some((r) => r.next)).toBe(false);
    expect(loopRounds(progress, "i2", new Set(), NOW, false).some((r) => r.next)).toBe(false);
  });

  test("a member who sees only their own rounds is told of no next one", () => {
    expect(loopRounds({ ...progress, seesAllInterviews: false }, "i2", new Set(), NOW, true).some((r) => r.next)).toBe(false);
  });

  test("an interviewer who sees only their own rounds", () => {
    const own = loopRounds({ ...progress, seesAllInterviews: false, steps: [{ position: 1, step: "Screen", state: "not_visible", interviews: [] }], offPlan: [] }, "x", new Set(), NOW, true);
    expect(own).toEqual([{ key: "step-1", n: 1, name: "Screen", status: "Not yours", people: [], when: null, interviewId: null, place: "past", next: false }]);
  });
});

test("stageIsOpen: a closed stage, or none read, has no next round", () => {
  expect(["interviewing", "offer"].map(stageIsOpen)).toEqual([true, true]);
  expect(["hired", "rejected", "withdrawn", null, undefined].map(stageIsOpen)).toEqual([false, false, false, false, false]);
});

test("hiddenOn counts the interviewers whose feedback the member cannot see", () => {
  expect(hiddenOn(progress, "i2")).toBe(1);
  expect(hiddenOn(progress, "i1")).toBe(0);
  expect(hiddenOn(progress, "nope")).toBe(0);
});

describe("routeView", () => {
  const step = (id: string, label: string, y = 0, extra: Partial<ProcessNode> = {}): ProcessNode => ({ id, kind: "stage", x: 0, y, label, type: "interview", ...extra });
  const edge = (from: string, to: string, department?: string): ProcessEdge => ({ id: `${from}-${to}`, from, to, label: "", ...(department ? { department } : {}) });
  const graph: ProcessDoc = {
    nodes: [
      { id: "in", kind: "start", x: 0, y: 0, label: "Applied" },
      step("rev", "Application review", 0, { type: "review" }),
      { id: "split", kind: "route", x: 0, y: 0, label: "Split by team" },
      step("onsite", "Onsite", 0, { team: "own" }),
      step("pitch", "Pitch", 100, { team: "sales" }),
      step("screen", "Screen", -100, { who: ["u1"] }),
      step("final", "Final"),
      { id: "out", kind: "end", x: 0, y: 0, label: "Offer" },
      { id: "note", kind: "note", x: 0, y: 0, label: "A note" },
    ],
    edges: [
      edge("in", "rev"), edge("rev", "screen"), edge("screen", "split"), edge("split", "onsite", "eng"), edge("split", "pitch", "sales"),
      edge("onsite", "final"), edge("pitch", "final"), edge("final", "out"), edge("note", "final"),
    ],
  };
  const lookup: ProcessLookup = {
    departments: [{ id: "eng", name: "Engineering", parentId: null, archived: false }, { id: "sales", name: "Sales", parentId: null, archived: false }],
    members: [{ id: "u1", name: "Ana Lee" }],
  };
  const route = (over: { selected?: string; stage?: string | null; open?: boolean; base?: clientTools.PlanProgress } = {}) => {
    const base = over.base ?? progress;
    const stage = over.stage === undefined ? "interviewing" : over.stage;
    const rounds = loopRounds(base, over.selected ?? "i2", new Set(["i1", "i2", "i3"]), NOW, over.open ?? stageIsOpen(stage));
    return routeView({ graph, departmentId: "eng", lookup, rounds, stepCount: base.steps.length, stage });
  };
  const node = (id: string, over?: Parameters<typeof route>[0]) => route(over)!.nodes.find((n) => n.id === id)!;

  test("what came before the interviews is one step, then the way through in order", () => {
    expect(route()!.nodes.map((n) => n.id)).toEqual(["pre", "screen", "split", "onsite", "pitch", "final", "out"]);
    expect(node("pre").label).toBe("Applied");
  });

  test("the member's branch is lit and the other team's faded, on no round", () => {
    expect(node("onsite")).toMatchObject({ state: "view", flag: "This interview", round: { name: "Onsite" } });
    expect(node("pitch")).toMatchObject({ state: "off", round: null, who: "Sales" });
    expect(route()!.edges.find((e) => e.id === "split-pitch")!.tone).toBe("off");
    expect(route()!.edges.find((e) => e.id === "split-onsite")!.tone).toBe("done");
  });

  test("held, up next, and what is left before the offer", () => {
    expect(node("screen")).toMatchObject({ state: "done" });
    expect(node("final")).toMatchObject({ state: "up", flag: "Up next" });
    expect(node("out").state).toBe("todo");
    expect(route()!.tag).toBe("1 round left before the offer");
  });

  test("who runs a step: their own team by name, pinned people by first name", () => {
    expect(node("onsite").who).toBe("Engineering");
    expect(node("screen").who).toBe("Ana");
  });

  test("off-plan rounds are handed back for the page to show", () => {
    expect(route()!.offPlan.map((r) => r.name)).toEqual(["Interview"]);
  });

  test("with every round held the offer is next", () => {
    const held = { ...progress, offPlan: [], nextStep: null, steps: progress.steps.map((s) => ({ ...s, state: "done" as const, interviews: [interview(`h${s.position}`, s.step, -5 * s.position, "done", [])] })) };
    const r = route({ base: held, selected: "h1" })!;
    expect(r.tag).toBe("Next: the offer");
    expect(r.nodes.find((n) => n.id === "out")).toMatchObject({ state: "up", flag: "Up next" });
  });

  test("the stage decides the end of it", () => {
    expect(route({ stage: "offer" })!.tag).toBe("At the offer");
    expect(node("out", { stage: "offer" })).toMatchObject({ state: "up", flag: "Here now" });
    expect(route({ stage: "hired" })!.tag).toBe("Hired");
    expect(node("out", { stage: "hired" }).state).toBe("done");
    expect(route({ stage: "rejected" })!.tag).toBe("Closed");
    expect(node("out", { stage: "withdrawn" }).state).toBe("closed");
    expect(node("final", { stage: "rejected" })).toMatchObject({ state: "todo", flag: null });
  });

  test("a stage that could not be read, or rounds that are not the path's, keep the row", () => {
    expect(route({ stage: null })).toBeNull();
    expect(route({ base: { ...progress, steps: progress.steps.slice(1) } })).toBeNull();
    const rounds = loopRounds(progress, "i2", new Set(), NOW, true);
    expect(routeView({ graph, departmentId: null, lookup, rounds, stepCount: 3, stage: "interviewing" })).toBeNull();
  });

  test("everyone stays inside the box, nothing on another, however many people a round has", () => {
    const r = route()!;
    for (const n of r.nodes) {
      expect(n.x + n.w).toBeLessThanOrEqual(r.width);
      expect(n.y + n.h).toBeLessThanOrEqual(r.height);
    }
    expect(node("onsite").h).toBeGreaterThan(node("pitch").h);
  });

  test("it carries who filed and nothing of what they said", () => {
    expect(JSON.stringify(node("onsite").round)).toContain("Not filed");
    expect(JSON.stringify(route())).not.toMatch(/recommendation|rating|notes/);
  });
});
