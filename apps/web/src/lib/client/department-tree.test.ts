import { describe, expect, test } from "vitest";

import { departmentAndBelow, departmentOptions, departmentScope, departmentTabs, inScope, jobsInDepartment, type DepartmentNode, type DepartmentsRead } from "./department-tree";

const dep = (id: string, name: string, parentId: string | null = null, archived = false): DepartmentNode => ({ id, name, parentId, archived });

// Engineering > Platform > Infra, Engineering > Research (archived), Product; Old (archived) > Growth.
const DEPARTMENTS = [
  dep("eng", "Engineering"),
  dep("plat", "Platform", "eng"),
  dep("infra", "Infra", "plat"),
  dep("res", "Research", "eng", true),
  dep("prod", "Product"),
  dep("old", "Old", null, true),
  dep("growth", "Growth", "old"),
];

const READ: DepartmentsRead = {
  departments: DEPARTMENTS,
  jobs: [
    { jobId: "j-eng", departmentId: "eng" },
    { jobId: "j-plat", departmentId: "plat" },
    { jobId: "j-infra", departmentId: "infra" },
    { jobId: "j-res", departmentId: "res" },
    { jobId: "j-prod", departmentId: "prod" },
    { jobId: "j-growth", departmentId: "growth" },
    { jobId: "j-none", departmentId: null },
  ],
};

describe("department matching", () => {
  test("a department matches itself and every department below it, at any depth", () => {
    expect([...departmentAndBelow(DEPARTMENTS, "eng")].sort()).toEqual(["eng", "infra", "plat", "res"]);
    expect([...departmentAndBelow(DEPARTMENTS, "plat")].sort()).toEqual(["infra", "plat"]);
    expect([...departmentAndBelow(DEPARTMENTS, "infra")]).toEqual(["infra"]);
    expect([...departmentAndBelow(DEPARTMENTS, "prod")]).toEqual(["prod"]);
  });

  test("the order of the rows does not matter, and a loop does not hang", () => {
    const reversed = [...DEPARTMENTS].reverse();
    expect([...departmentAndBelow(reversed, "eng")].sort()).toEqual(["eng", "infra", "plat", "res"]);
    const loop = [dep("a", "A", "b"), dep("b", "B", "a")];
    expect([...departmentAndBelow(loop, "a")].sort()).toEqual(["a", "b"]);
    expect(departmentOptions(loop).map((o) => o.path)).toEqual(["A › B", "B › A"]);
  });

  test("a department's jobs include those of archived departments inside it, and no job in no department", () => {
    expect([...jobsInDepartment(READ, "eng")].sort()).toEqual(["j-eng", "j-infra", "j-plat", "j-res"]);
    expect([...jobsInDepartment(READ, "plat")].sort()).toEqual(["j-infra", "j-plat"]);
    expect([...jobsInDepartment(READ, "prod")]).toEqual(["j-prod"]);
  });
});

describe("the filter's options", () => {
  test("live departments only, each under its parent, with its path", () => {
    expect(departmentOptions(DEPARTMENTS)).toEqual([
      { id: "eng", name: "Engineering", path: "Engineering", depth: 0 },
      { id: "plat", name: "Platform", path: "Engineering › Platform", depth: 1 },
      { id: "infra", name: "Infra", path: "Engineering › Platform › Infra", depth: 2 },
      // a live department inside an archived one is still offered
      { id: "growth", name: "Growth", path: "Old › Growth", depth: 1 },
      { id: "prod", name: "Product", path: "Product", depth: 0 },
    ]);
  });

  test("the URL's department is a live one, or no filter", () => {
    const picked = departmentScope(READ, "plat");
    expect(picked.departmentId).toBe("plat");
    expect([...picked.jobIds!].sort()).toEqual(["j-infra", "j-plat"]);
    expect(inScope(picked, "j-infra")).toBe(true);
    expect(inScope(picked, "j-eng")).toBe(false);

    for (const raw of ["res", "old", "nope", "", null, undefined]) {
      const scope = departmentScope(READ, raw);
      expect(scope.departmentId, String(raw)).toBeNull();
      expect(scope.jobIds).toBeNull();
      expect(inScope(scope, "j-none")).toBe(true);
    }
  });

  test("an org with no departments shows no filter at all", () => {
    const none = departmentScope({ departments: [], jobs: [] }, "eng");
    expect(none).toEqual({ options: [], departmentId: null, jobIds: null });
    expect(departmentTabs(none, () => "/x")).toEqual([]);
    // only archived ones: nothing to offer either
    expect(departmentTabs(departmentScope({ departments: [dep("old", "Old", null, true)], jobs: [] }, null), () => "/x")).toEqual([]);
  });

  test("the tabs: All departments first, then each by path, the picked one active", () => {
    const tabs = departmentTabs(departmentScope(READ, "prod"), (d) => `/p?department=${d ?? ""}`);
    expect(tabs.map((t) => [t.label, t.active])).toEqual([
      ["All departments", false],
      ["Engineering", false],
      ["Engineering › Platform", false],
      ["Engineering › Platform › Infra", false],
      ["Old › Growth", false],
      ["Product", true],
    ]);
    expect(tabs[0].href).toBe("/p?department=");
    expect(tabs[5].href).toBe("/p?department=prod");
  });
});
