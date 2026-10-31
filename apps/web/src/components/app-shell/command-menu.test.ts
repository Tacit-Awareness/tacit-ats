import { describe, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { contextItems, filterCommands, hitItem, menuItems, type CommandItem } from "./command-menu";

const pages: CommandItem[] = [
  { group: "Go to", label: "Pipeline", href: "/client/pipeline" },
  { group: "Go to", label: "Inbox", href: "/client/inbox" },
];
const run = vi.fn();
const ctx = { name: "Ann Lee", actions: [{ label: "Write a note", hint: "C", run }, { label: "Edit labels…", hint: "L", run }] };
const hit = { candidateId: "p1", name: "Pip Hill", line: "Engineer · Founding Engineer" };

describe("the command menu's list", () => {
  test("filters pages as before", () => {
    expect(filterCommands(pages, "PIPE").map((i) => i.label)).toEqual(["Pipeline"]);
    expect(filterCommands(pages, " ")).toEqual(pages);
  });

  test("a hit links to the candidate", () => {
    expect(hitItem(hit)).toEqual({ group: "Candidates", label: "Pip Hill", sub: hit.line, href: "/client/candidates/p1" });
  });

  test("the open candidate's actions come first, the search's people last", () => {
    const items = menuItems(ctx, pages, [hit], "");
    expect(items.map((i) => i.group)).toEqual(["This candidate", "This candidate", "Go to", "Go to", "Candidates"]);
  });

  test("an action has no link and only runs what the page gave it", () => {
    const [note] = contextItems(ctx);
    expect(note).toMatchObject({ label: "Write a note", hint: "C" });
    expect(note?.href).toBeUndefined();
    expect(note?.run).toBe(run);
  });

  test("actions filter with the pages; the search answered for itself, so its people stay", () => {
    expect(menuItems(ctx, pages, [hit], "pip").map((i) => i.label)).toEqual(["Pipeline", "Pip Hill"]);
    expect(menuItems(ctx, pages, [{ ...hit, name: "Someone Else" }], "label").map((i) => i.label)).toEqual(["Edit labels…", "Someone Else"]);
  });

  test("no candidate open, no actions; no Ask Grokbot either way", () => {
    expect(contextItems(null)).toEqual([]);
    expect(menuItems(ctx, pages, [hit], "").some((i) => /grok/i.test(`${i.group} ${i.label}`))).toBe(false);
  });
});
