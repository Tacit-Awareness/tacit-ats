import { describe, expect, test } from "vitest";
import { coverageOf } from "./coverage";
import type { SheetPerson, SkillSheet } from "./skill-sheet";

const person = (id: string, teams: string[], runs: Record<string, boolean>): SheetPerson => ({ id, name: id, teams, skills: [], version: null, runs });
const sheet = (people: SheetPerson[], types: string[]): SkillSheet => ({ people, types: types.map((id) => ({ id, name: `Type ${id}`, interviewers: 0 })) });

describe("coverageOf", () => {
  test("totals, and a gap for a type nobody runs", () => {
    const c = coverageOf(sheet([person("Ana", ["A", "B"], { t1: false }), person("Ben", ["A"], {}), person("Cy", [], { t1: true })], ["t1", "t2"]), 2);
    expect(c).toMatchObject({ interviewers: 2, teams: 2, multidisciplinary: 1, types: 2, covered: 1, gaps: ["Type t2"], state: "gaps" });
  });

  test("starred people first, then by name", () => {
    const c = coverageOf(sheet([person("Ana", [], { t1: false }), person("Cy", [], { t1: true }), person("Ben", [], { t1: false })], ["t1"]), 0);
    expect(c.rows[0].people.map((p) => [p.name, p.starred])).toEqual([["Cy", true], ["Ana", false], ["Ben", false]]);
    expect(c.state).toBe("covered");
  });

  test("no types yet is its own state, not all covered", () => {
    expect(coverageOf(sheet([person("Ana", [], {})], []), 0)).toMatchObject({ state: "no_types", rows: [], gaps: [], interviewers: 0 });
  });
});
