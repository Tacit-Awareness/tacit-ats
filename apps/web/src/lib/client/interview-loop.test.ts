import { describe, expect, test } from "vitest";
import type { clientTools } from "@tacit-ats/core";
import { hiddenOn, loopRounds } from "./interview-loop";

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
  const rounds = loopRounds(progress, "i2", new Set(["i1", "i2", "i3"]), NOW);

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
    expect(loopRounds(progress, "i2", new Set(["i2"]), NOW).map((r) => r.interviewId)).toEqual([null, null, null, null]);
  });

  test("an interviewer who sees only their own rounds", () => {
    const own = loopRounds({ ...progress, seesAllInterviews: false, steps: [{ position: 1, step: "Screen", state: "not_visible", interviews: [] }], offPlan: [] }, "x", new Set(), NOW);
    expect(own).toEqual([{ key: "step-1", n: 1, name: "Screen", status: "Not yours", people: [], when: null, interviewId: null, place: "past" }]);
  });
});

test("hiddenOn counts the interviewers whose feedback the member cannot see", () => {
  expect(hiddenOn(progress, "i2")).toBe(1);
  expect(hiddenOn(progress, "i1")).toBe(0);
  expect(hiddenOn(progress, "nope")).toBe(0);
});
