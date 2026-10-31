import { describe, expect, test } from "vitest";
import { closeHref, inertOutside, rowSelector, writeInFlight, type PopupNode } from "./inbox-popup";

describe("closeHref", () => {
  test("is the plain Inbox with no notice", () => {
    expect(closeHref(null, null)).toBe("/client/inbox");
    expect(closeHref(null, "u1")).toBe("/client/inbox");
  });

  test("keeps a notice and its Undo", () => {
    expect(closeHref("dismissed", "u1")).toBe("/client/inbox?notice=dismissed&undo=u1");
    expect(closeHref("sent", null)).toBe("/client/inbox?notice=sent");
  });
});

const node = (tagName: string, children: PopupNode[] = [], inert = false): PopupNode => {
  const n: PopupNode = { tagName, inert, parentElement: null, children };
  for (const c of children) c.parentElement = n;
  return n;
};

describe("inertOutside", () => {
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
    expect(writeInFlight({ querySelector: (s) => (s === 'form button[type="submit"]:disabled' ? {} : null) })).toBe(true);
    expect(writeInFlight({ querySelector: () => null })).toBe(false);
    expect(writeInFlight(null)).toBe(false);
  });
});

test("rowSelector quotes what came through the URL", () => {
  expect(rowSelector("app-1")).toBe('[data-issue-row="app-1"]');
  expect(rowSelector('a"]b\\')).toBe('[data-issue-row="a\\"]b\\\\"]');
});
