import { describe, expect, test } from "vitest";
import type { DepartmentNode } from "./department-tree";
import { applyTeamChange, buildTeamMatrix, isMultidisciplinary, teamsOf } from "./team-matrix";

const node = (id: string, name: string, parentId: string | null = null, archived = false): DepartmentNode => ({ id, name, parentId, archived });
const PEOPLE = [{ id: "a", name: "Ada" }, { id: "b", name: "Bo" }];
const DEPARTMENTS = [node("eng", "Engineering"), node("plat", "Platform", "eng"), node("old", "Old", null, true), node("kept", "Kept", "old"), node("sales", "Sales")];

const matrix = () =>
  buildTeamMatrix(PEOPLE, DEPARTMENTS, [
    { departmentId: "eng", members: [{ memberId: "a", lead: true }, { memberId: "b", lead: false }] },
    { departmentId: "plat", members: [{ memberId: "a", lead: false }] },
    { departmentId: "old", members: [{ memberId: "b", lead: false }] },
  ]);

describe("buildTeamMatrix", () => {
  test("labels a nested team by its path, each under its parent", () => {
    expect(matrix().teams.map((t) => t.path)).toEqual(["Engineering", "Engineering › Platform", "Old › Kept", "Sales"]);
  });

  test("leaves out an archived department, but a live team inside one keeps its path", () => {
    expect(matrix().teams.map((t) => t.id)).not.toContain("old");
    expect(matrix().teams.find((t) => t.id === "kept")?.path).toBe("Old › Kept");
  });

  test("a team nobody is on is still a team", () => {
    expect(matrix().teams.find((t) => t.id === "sales")).toMatchObject({ members: [], lead: null });
  });

  test("no departments, no teams", () => {
    expect(buildTeamMatrix(PEOPLE, [], []).teams).toEqual([]);
  });
});

describe("Multidisciplinary", () => {
  test("is more than one live team", () => {
    expect(isMultidisciplinary(matrix(), "a")).toBe(true);
    expect(teamsOf(matrix(), "b").map((t) => t.id)).toEqual(["eng"]);
    expect(isMultidisciplinary(matrix(), "b")).toBe(false);
  });
});

describe("applyTeamChange", () => {
  const eng = (m: ReturnType<typeof matrix>) => m.teams.find((t) => t.id === "eng")!;

  test("a tick adds, once", () => {
    const once = applyTeamChange(matrix(), { kind: "member", teamId: "plat", memberId: "b", on: true });
    expect(applyTeamChange(once, { kind: "member", teamId: "plat", memberId: "b", on: true }).teams.find((t) => t.id === "plat")?.members).toEqual(["a", "b"]);
  });

  test("taking the lead off the team leaves it with none", () => {
    expect(eng(applyTeamChange(matrix(), { kind: "member", teamId: "eng", memberId: "a", on: false }))).toMatchObject({ members: ["b"], lead: null });
  });

  test("taking someone else off keeps the lead", () => {
    expect(eng(applyTeamChange(matrix(), { kind: "member", teamId: "eng", memberId: "b", on: false }))).toMatchObject({ members: ["a"], lead: "a" });
  });

  test("a new lead replaces the old one, who stays on the team", () => {
    expect(eng(applyTeamChange(matrix(), { kind: "lead", teamId: "eng", memberId: "b" }))).toMatchObject({ members: ["a", "b"], lead: "b" });
  });

  test("a lead who was not on the team joins it", () => {
    expect(applyTeamChange(matrix(), { kind: "lead", teamId: "sales", memberId: "a" }).teams.find((t) => t.id === "sales")).toMatchObject({ members: ["a"], lead: "a" });
  });

  test("clearing the lead keeps everyone", () => {
    expect(eng(applyTeamChange(matrix(), { kind: "lead", teamId: "eng", memberId: null }))).toMatchObject({ members: ["a", "b"], lead: null });
  });
});
