import { describe, expect, test } from "vitest";
import { inertOutside, rowSelector, writeInFlight, type PopupNode } from "./inbox-popup";

const node = (tagName: string, children: PopupNode[] = [], inert = false): PopupNode => {
  const n: PopupNode = { tagName, inert, parentElement: null, children };
  for (const c of children) c.parentElement = n;
  return n;
};

describe("inertOutside", () => {
  test("leaves the toasts live, so an Undo works over the pop-up", () => {
    const popup = node("DIV");
    const toasts: PopupNode = { ...node("DIV"), dataset: { toasts: "" } };
    const aside = node("ASIDE");
    const root = node("DIV", [popup, toasts, aside]);
    node("BODY", [root]);
    inertOutside(popup);
    expect([toasts.inert, aside.inert]).toEqual([false, true]);
  });

  const page = () => {
    const popup = node("DIV", [node("A")]);
    const card = node("DIV", [node("A")]);
    const aside = node("ASIDE");
    const already = node("DIV", [], true);
    const main = node("MAIN", [card, popup]);
    const script = node("SCRIPT");
    const announcer = node("NEXT-ROUTE-ANNOUNCER");
    const root = node("DIV", [aside, main, already]);
    const body = node("BODY", [root, script, announcer]);
    node("HTML", [body]);
    return { popup, card, aside, already, main, script, announcer, root, body };
  };

  test("everything outside goes inert, up to the body, and never the way to the pop-up", () => {
    const p = page();
    inertOutside(p.popup);
    expect([p.card.inert, p.aside.inert]).toEqual([true, true]);
    expect([p.popup.inert, p.main.inert, p.root.inert, p.body.inert]).toEqual([false, false, false, false]);
  });

  test("a <dialog> stays reachable: the `?` sheet is always mounted, and inert on it would outlast its opening", () => {
    const sheet = node("DIALOG");
    const popup = node("DIV");
    const main = node("MAIN", [popup, sheet]);
    node("BODY", [main, node("ASIDE")]);
    inertOutside(popup);
    expect(sheet.inert).toBe(false);
  });

  test("Next's announcer and scripts stay as they are", () => {
    const p = page();
    inertOutside(p.popup);
    expect([p.script.inert, p.announcer.inert]).toEqual([false, false]);
  });

  test("the answer puts back only what it set", () => {
    const p = page();
    inertOutside(p.popup)();
    expect([p.card.inert, p.aside.inert]).toEqual([false, false]);
    expect(p.already.inert).toBe(true);
  });
});

describe("writeInFlight", () => {
  test("a form's submit turned off is a write under way", () => {
    expect(writeInFlight({ querySelector: (s) => (s === 'form button[type="submit"]:disabled:not([data-off])' ? {} : null) })).toBe(true);
    expect(writeInFlight({ querySelector: () => null })).toBe(false);
    expect(writeInFlight(null)).toBe(false);
  });
});

test("rowSelector quotes what came through the URL", () => {
  expect(rowSelector("app-1")).toBe('[data-issue-row="app-1"]');
  expect(rowSelector('a"]b\\')).toBe('[data-issue-row="a\\"]b\\\\"]');
});
