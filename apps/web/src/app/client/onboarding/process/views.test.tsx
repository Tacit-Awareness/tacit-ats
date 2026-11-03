import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("./actions", () => ({ readProcessAction: vi.fn(), saveProcessAction: vi.fn(), previewApplyAction: vi.fn(), applyProcessAction: vi.fn() }));

import type { ProcessRead } from "@/lib/client/process";
import { editorState } from "@/lib/client/process-editor";
import { defaultGraph, type ProcessDoc, type ProcessLookup } from "@/lib/client/process-graph";
import { ProcessCanvas } from "./canvas";
import { ProcessEditor } from "./editor";
import { ProcessList } from "./list";

const lookup: ProcessLookup = {
  departments: [
    { id: "eng", name: "Engineering", parentId: null, archived: false },
    { id: "old", name: "Old team", parentId: null, archived: true },
  ],
  members: [{ id: "ada", name: "Ada Admin" }],
};

const SPLIT: ProcessDoc = {
  nodes: [
    { id: "in", kind: "start", x: 0, y: 0, label: "Applied" },
    { id: "split", kind: "route", x: 0, y: 0, label: "By team" },
    { id: "a", kind: "stage", x: 0, y: 0, label: "Systems", type: "interview", team: "eng", mins: 60 },
    { id: "b", kind: "stage", x: 0, y: 0, label: "General", type: "interview", team: "old" },
    { id: "out", kind: "end", x: 0, y: 0, label: "Offer" },
    { id: "n", kind: "note", x: 0, y: 0, label: "Skip for referrals?" },
  ],
  edges: [
    { id: "1", from: "in", to: "split", label: "" },
    { id: "2", from: "split", to: "a", label: "", department: "eng" },
    { id: "3", from: "split", to: "b", label: "" },
    { id: "4", from: "a", to: "out", label: "" },
    { id: "5", from: "b", to: "out", label: "" },
  ],
};

const read = (graph = defaultGraph(), drawn = true): ProcessRead => ({ graph, drawn, updatedAt: drawn ? "2026-10-31T00:00:00Z" : null, lookup });
const editor = (r: ProcessRead, canEdit = true) => renderToStaticMarkup(<ProcessEditor read={r} canEdit={canEdit} />);

describe("the list", () => {
  const html = renderToStaticMarkup(<ProcessList graph={SPLIT} lookup={lookup} />);

  test("puts steps side by side in one level, with their branches", () => {
    expect(html).toContain("Depends on the team");
    expect(html).toContain("Systems");
    expect(html).toContain("Engineering · Interview · 1h");
    expect(html).toContain("Everyone else · Interview");
  });

  test("gives each team its way through, and a job in none", () => {
    expect(html).toContain("The way through for each team");
    expect(html).toContain("No team");
  });

  test("draws an archived team as a gap", () => {
    expect(html).toContain('<span class="proc-gap">Old team (archived)</span>');
  });

  test("keeps the notes", () => {
    expect(html).toContain("Skip for referrals?");
  });

  test("says where a way through stops", () => {
    const stuck = renderToStaticMarkup(<ProcessList graph={{ ...SPLIT, edges: SPLIT.edges.filter((e) => e.id !== "3") }} lookup={lookup} />);
    expect(stuck).toContain("stops at a split with no branch for it");
  });
});

describe("the editor", () => {
  test("an admin gets Save, Apply and the tools", () => {
    const html = editor(read());
    expect(html).toContain(">Save<");
    expect(html).toContain("Apply to jobs");
    expect(html).toContain("fc-port");
    expect(html).toContain('aria-label="Undo (⌘Z)"');
  });

  test("someone who may only read gets the canvas without any of it", () => {
    const html = editor(read(), false);
    expect(html).toContain('data-mode="read"');
    expect(html).not.toContain(">Save<");
    expect(html).not.toContain("Apply to jobs");
    expect(html).not.toContain("fc-port");
    expect(html).not.toContain('aria-label="Undo (⌘Z)"');
    expect(html).toContain("Zoom in");
  });

  test("Nothing saved says it is only a starting point, and Apply waits for a save", () => {
    const html = editor(read(defaultGraph(), false));
    expect(html).toContain("This is a starting point, not your process.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*title="Save first: Apply uses what&#x27;s saved\."/);
  });

  test("the list is always in the page, for a keyboard or a screen reader", () => {
    expect(editor(read())).toContain("proc-listwrap");
    expect(editor(read())).toContain("for a keyboard or a screen reader");
  });

  test("a problem is listed and turns Apply off, and a gap is listed and does not", () => {
    const broken = editor(read({ ...SPLIT, edges: SPLIT.edges.filter((e) => e.id !== "5") }));
    expect(broken).toContain("To fix before this can go on any job");
    expect(broken).toContain("General leads nowhere");
    expect(broken).toMatch(/<button[^>]*disabled[^>]*title="Fix what&#x27;s listed first\."/);

    const gap = editor(read(SPLIT));
    expect(gap).not.toContain("To fix before");
    expect(gap).toContain("Worth a look");
    expect(gap).not.toContain('title="Fix');
  });
});

describe("the canvas", () => {
  test("marks a node a problem names, and one with a gap", () => {
    const html = renderToStaticMarkup(<ProcessCanvas state={editorState(SPLIT)} dispatch={() => {}} lookup={lookup} readOnly={false} flagged={new Set(["a"])} shown />);
    expect(html).toContain('class="fc-n stage bad"');
    expect(html).toContain('class="fc-n stage gap"');
  });

  test("no port on the end or a note: nothing leads on from them", () => {
    const html = renderToStaticMarkup(<ProcessCanvas state={editorState(SPLIT)} dispatch={() => {}} lookup={lookup} readOnly={false} flagged={new Set()} shown />);
    expect(html.match(/fc-port/g)).toHaveLength(4);
  });
});
