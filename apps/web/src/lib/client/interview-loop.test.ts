import { describe, expect, test } from "vitest";
import type { clientTools } from "@tacit-ats/core";
import { hiddenOn, loopRounds, stageIsOpen } from "./interview-loop";

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
