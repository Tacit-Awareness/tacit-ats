import { describe, expect, test } from "vitest";

import { TEAM_ICONS, readTeamIcons, teamIconFor } from "./team-icons";

describe("a team's icon", () => {
  test("is matched from its name, so nobody has to choose one", () => {
    const cases: [string, string][] = [
      ["Design", "palette"],
      ["Go-to-market", "megaphone"],
      ["Infra", "server"],
      ["Platform", "layers"],
      ["Serving", "rocket"],
      ["Product", "package"],
      ["Growth", "trending"],
      ["Research", "flask"],
      ["Evals", "clipboard"],
      ["Post-training", "brain"],
      ["Customer Success", "lifebuoy"],
      ["People Ops", "heart"],
      ["Forward Deployed Engineering", "rocket"],
      ["ML Research", "brain"],
    ];
    for (const [name, key] of cases) expect(teamIconFor(name), name).toBe(key);
  });

  test("the narrower word wins: Product Design is design, not product", () => {
    expect(teamIconFor("Product Design")).toBe("palette");
    expect(teamIconFor("Research Evals")).toBe("clipboard");
  });

  test("a name that says nothing gets the people mark", () => {
    expect(teamIconFor("Team Seven")).toBe("users");
    expect(teamIconFor("")).toBe("users");
  });

  test("every rule names an icon that exists, and every icon has a name to read out", () => {
    const keys = new Set(TEAM_ICONS.map((i) => i.key));
    expect(keys.size).toBe(TEAM_ICONS.length);
    for (const n of ["evals", "training", "research", "design", "content", "marketing", "sales", "growth", "infra", "platform", "serving", "mobile", "hardware", "data", "security", "legal", "finance", "people", "support", "operations", "tools", "logistics", "international", "workplace", "product", "engineering"]) expect(keys.has(teamIconFor(n)), n).toBe(true);
    for (const i of TEAM_ICONS) expect(i.name.length, i.key).toBeGreaterThan(2);
  });

  test("only real choices are read back from the browser", () => {
    expect(readTeamIcons(JSON.stringify({ a: "rocket", b: "nope", c: 3 }))).toEqual({ a: "rocket" });
    for (const raw of [null, "", "[]", "not json", '"x"']) expect(readTeamIcons(raw), String(raw)).toEqual({});
  });
});
