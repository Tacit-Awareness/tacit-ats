import type { ReactElement, ReactNode } from "react";
import { describe, expect, test } from "vitest";

import { ExplorerView, Ranked } from "./view";

// Keys only matter to the client's reconciler, which React's server render never
// reaches, so these read the tree: a repeated key is a row React keeps or drops
// wrongly once the page moves to another range.

/** Every element in a tree of children, not entering components. */
function elements(node: ReactNode): ReactElement<{ children?: ReactNode }>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (typeof node !== "object" || node === null || !("props" in node)) return [];
  const el = node as ReactElement<{ children?: ReactNode }>;
  return [el, ...elements(el.props.children)];
}

const distinct = (keys: (string | null)[]) => new Set(keys).size === keys.length;

describe("rows with the same name", () => {
  test("two jobs with one title are two rows", () => {
    const tree = Ranked({
      title: "Top jobs",
      col: "Applications",
      rows: [
        { label: "Software Engineer", n: 3, href: "/client/jobs/a" },
        { label: "Software Engineer", n: 2, href: "/client/jobs/b" },
      ],
    });
    const rows = elements(tree).filter((el) => el.key !== null);
    expect(rows).toHaveLength(2);
    expect(distinct(rows.map((r) => r.key))).toBe(true);
  });

  test("two people the member cannot see are two rows of the explorer", () => {
    const row = (key: string) => ({ key, label: "Someone you can't see", by: [1], total: 1 });
    const tree = ExplorerView({
      header: { filters: [], tabs: [] },
      p: {
        picks: [],
        unit: "applicants",
        total: 2,
        top: 4,
        segments: [{ label: "Referred", color: "var(--series-1)" }],
        rows: [row("a1"), row("a2")],
        slice: "Interviewer",
        measure: "Applicants",
        note: null,
        empty: null,
      },
    });
    const all = elements(tree);
    for (const tag of ["tr"]) expect(distinct(all.filter((el) => el.type === tag && el.key !== null).map((r) => r.key))).toBe(true);
    const columns = all.filter((el) => el.key !== null && (el.props as { title?: string }).title?.startsWith("Someone you can't see"));
    expect(columns.length).toBeGreaterThanOrEqual(2);
    expect(distinct(columns.map((c) => `${String(c.type)}:${c.key}`))).toBe(true);
  });
});
