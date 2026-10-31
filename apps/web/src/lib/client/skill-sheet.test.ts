import { describe, expect, test } from "vitest";
import { applyRun, buildSkillSheet, runState } from "./skill-sheet";

const TYPES = [
  { typeId: "t1", name: "Coding", interviewers: [{ memberId: "a", prioritized: true }, { memberId: "b", prioritized: false }] },
  { typeId: "t2", name: "Design", interviewers: [] },
];

describe("buildSkillSheet", () => {
  const sheet = buildSkillSheet(
    [{ id: "a", name: "Ada" }, { id: "b", name: "Bo" }],
    new Map([["a", { focusAreas: ["Go"], updatedAt: "v1" }]]),
    TYPES,
    [{ path: "Eng", members: ["a"] }, { path: "Eng › Platform", members: ["a", "b"] }],
  );

  test("a person with a profile carries its version", () => {
    expect(sheet.people[0]).toMatchObject({ skills: ["Go"], version: "v1", teams: ["Eng", "Eng › Platform"], runs: { t1: true } });
  });

  test("a person with none has said nothing, and no version to name", () => {
    expect(sheet.people[1]).toMatchObject({ skills: [], version: null, teams: ["Eng › Platform"], runs: { t1: false } });
  });

  test("counts who runs each type, and invents none", () => {
    expect(sheet.types).toEqual([{ id: "t1", name: "Coding", interviewers: 2 }, { id: "t2", name: "Design", interviewers: 0 }]);
    expect(buildSkillSheet([{ id: "a", name: "Ada" }], new Map(), [], []).types).toEqual([]);
  });
});

describe("runState and applyRun", () => {
  test("reads off, runs and starred", () => {
    expect([runState({}, "t"), runState({ t: false }, "t"), runState({ t: true }, "t")]).toEqual(["off", "runs", "starred"]);
  });

  test("a type called constructor is not run by anyone", () => {
    expect(runState({}, "constructor")).toBe("off");
  });

  test("goes each way", () => {
    expect(applyRun({}, "t", "runs")).toEqual({ t: false });
    expect(applyRun({ t: false }, "t", "starred")).toEqual({ t: true });
    expect(applyRun({ t: true, u: false }, "t", "off")).toEqual({ u: false });
  });
});
