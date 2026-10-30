import { describe, expect, test } from "vitest";
import { groupBoard, matchRole, type BoardRole } from "./board";

const role = (title: string, department: string | null, location: string | null = null): BoardRole => ({ slug: title, title, department, location });

describe("groupBoard", () => {
  test("departments by name, roles by title, Other last", () => {
    const groups = groupBoard([role("Zed", "Research"), role("Ann", "Research"), role("Bob", null), role("Cy", "GTM")]);
    expect(groups.map((g) => [g.name, g.roles.map((r) => r.title)])).toEqual([
      ["GTM", ["Cy"]],
      ["Research", ["Ann", "Zed"]],
      ["Other", ["Bob"]],
    ]);
  });

  test("no departments at all is one unnamed list, and no roles is none", () => {
    expect(groupBoard([role("Ann", null)])).toEqual([{ name: null, roles: [role("Ann", null)] }]);
    expect(groupBoard([])).toEqual([]);
  });
});

describe("matchRole", () => {
  test("matches title, team and location in any case, and an empty search matches all", () => {
    const r = role("Founding Engineer", "Product", "San Francisco");
    expect(["founding", "PRODUCT", " san ", ""].every((q) => matchRole(r, q))).toBe(true);
    expect(matchRole(r, "design")).toBe(false);
  });
});
