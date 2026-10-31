import { describe, expect, it } from "vitest";
import { CHORD_MS, chord, ignoreKey, isShown, isSignOutKey, isTyping, keyName, menuKey, onePress, stepIndex, type KeyEventLike } from "./keys";

const ev = (over: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key: "j",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  defaultPrevented: false,
  target: { tagName: "BODY", isContentEditable: false } as unknown as EventTarget,
  ...over,
});
const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable }) as unknown as EventTarget;

describe("the typing guard", () => {
  it("keeps keys for inputs, textareas, selects and contenteditable", () => {
    for (const t of ["INPUT", "TEXTAREA", "SELECT"]) expect(isTyping(el(t))).toBe(true);
    expect(isTyping(el("DIV", true))).toBe(true);
    expect(ignoreKey(ev({ target: el("INPUT") }))).toBe(true);
  });

  it("keeps every key from the page behind a modal dialog, wherever the focus is", () => {
    expect(ignoreKey(ev(), true)).toBe(true);
    expect(ignoreKey(ev({ target: el("BUTTON") }), true)).toBe(true);
    expect(ignoreKey(ev(), false)).toBe(false);
  });

  it("lets keys through on the page, a link or a button", () => {
    for (const t of ["BODY", "A", "BUTTON", "DIV"]) expect(isTyping(el(t))).toBe(false);
    expect(isTyping(null)).toBe(false);
    expect(ignoreKey(ev())).toBe(false);
  });
});

describe("a hidden pane", () => {
  const box = (rects: number) => ({ getClientRects: () => ({ length: rects }) });

  it("keeps its keys: a phone's list hides the reader, whose buttons stay mounted", () => {
    expect(isShown(box(1))).toBe(true);
    expect(isShown(box(0))).toBe(false);
    expect(isShown(null)).toBe(false);
  });
});

describe("the modifier guard", () => {
  it("skips ⌘, Ctrl and Alt", () => {
    expect(ignoreKey(ev({ metaKey: true }))).toBe(true);
    expect(ignoreKey(ev({ ctrlKey: true }))).toBe(true);
    expect(ignoreKey(ev({ altKey: true }))).toBe(true);
  });

  it("allows Shift, which ? needs, and folds Shift+J into J", () => {
    expect(ignoreKey(ev({ key: "?" }))).toBe(false);
    expect(keyName("J")).toBe("j");
    expect(keyName("Enter")).toBe("Enter");
  });

  it("skips an event something else already handled", () => {
    expect(ignoreKey(ev({ defaultPrevented: true }))).toBe(true);
  });

  it("skips a key while a modal dialog is open, wherever focus is", () => {
    const inDocument = (modal: unknown) => ({ tagName: "BODY", ownerDocument: { querySelector: (s: string) => (s === "dialog:modal" ? modal : null) } }) as unknown as EventTarget;
    expect(ignoreKey(ev({ target: inDocument({}) }))).toBe(true);
    expect(ignoreKey(ev({ target: inDocument(null) }))).toBe(false);
  });
});

describe("sign out's chord", () => {
  const press = (over: Partial<Parameters<typeof isSignOutKey>[0]>) => isSignOutKey({ key: "q", metaKey: true, shiftKey: true, ctrlKey: false, altKey: false, repeat: false, ...over });

  it("is shift and command and Q, whichever case the browser reports", () => {
    expect(press({})).toBe(true);
    expect(press({ key: "Q" })).toBe(true);
  });

  it("is never Ctrl, which quits the browser on Windows and Linux", () => {
    expect(press({ metaKey: false, ctrlKey: true })).toBe(false);
    expect(press({ ctrlKey: true })).toBe(false);
  });

  it("is nothing without every key, and a held key signs out once", () => {
    expect(press({ shiftKey: false })).toBe(false);
    expect(press({ metaKey: false })).toBe(false);
    expect(press({ altKey: true })).toBe(false);
    expect(press({ key: "w" })).toBe(false);
    expect(press({ repeat: true })).toBe(false);
  });
});

describe("the G chord", () => {
  it("G then a letter within the window jumps", () => {
    const a = chord(null, "g", 1000);
    expect(a).toEqual({ pending: 1000, then: null });
    expect(chord(a.pending, "c", 1000 + CHORD_MS - 1)).toEqual({ pending: null, then: "c" });
  });

  it("a letter after the window is just a letter", () => {
    expect(chord(1000, "c", 1000 + CHORD_MS)).toEqual({ pending: null, then: null });
  });

  it("a late G starts a new chord", () => {
    expect(chord(1000, "g", 1000 + CHORD_MS + 5)).toEqual({ pending: 1000 + CHORD_MS + 5, then: null });
  });

  it("any other key without G does nothing", () => {
    expect(chord(null, "j", 5)).toEqual({ pending: null, then: null });
  });

  it("folds case, so Shift+G then Shift+H still jumps", () => {
    expect(chord(chord(null, "G", 0).pending, "H", 10).then).toBe("h");
  });
});

describe("stepping a list", () => {
  it("starts at the top going down and the bottom going up", () => {
    expect(stepIndex(-1, 3, 1)).toBe(0);
    expect(stepIndex(-1, 3, -1)).toBe(2);
  });

  it("clamps at both ends", () => {
    expect(stepIndex(2, 3, 1)).toBe(2);
    expect(stepIndex(0, 3, -1)).toBe(0);
    expect(stepIndex(1, 3, 1)).toBe(2);
  });

  it("an empty list has nothing to step to", () => {
    expect(stepIndex(-1, 0, 1)).toBe(-1);
  });
});

describe("a key while a menu is open", () => {
  it("steps, picks and closes", () => {
    expect(menuKey(ev({ key: "j" }), 5)).toEqual({ kind: "step", d: 1 });
    expect(menuKey(ev({ key: "ArrowUp" }), 5)).toEqual({ kind: "step", d: -1 });
    expect(menuKey(ev({ key: "2" }), 5)).toEqual({ kind: "pick", index: 1 });
    expect(menuKey(ev({ key: "Escape" }), 5)).toEqual({ kind: "close", refocus: true });
    expect(menuKey(ev({ key: "Tab" }), 5)).toEqual({ kind: "close", refocus: false });
    expect(menuKey(ev({ key: "x" }), 5)).toBeNull();
  });

  // A pick is a write: F, / or ⌘K can move focus to a field while the menu is up.
  it("leaves a digit typed in a field alone", () => {
    expect(menuKey(ev({ key: "3", target: el("INPUT") }), 5)).toBeNull();
    expect(menuKey(ev({ key: "j", target: el("INPUT") }), 5)).toBeNull();
  });

  it("leaves a key something else handled: G then 3 is not a pick", () => {
    expect(menuKey(ev({ key: "3", defaultPrevented: true }), 5)).toBeNull();
  });

  it("leaves ⌘, Ctrl and Alt alone", () => {
    expect(menuKey(ev({ key: "1", metaKey: true }), 5)).toBeNull();
    expect(menuKey(ev({ key: "1", altKey: true }), 5)).toBeNull();
  });

  it("only picks a line that shows that digit", () => {
    expect(menuKey(ev({ key: "6" }), 5)).toBeNull();
    expect(menuKey(ev({ key: "0" }), 5)).toBeNull();
  });
});

describe("onePress", () => {
  it("acts on a press, not on the repeats of a key held down", () => {
    let runs = 0;
    const press = onePress(() => void runs++);
    press({ repeat: false });
    press({ repeat: true });
    press({ repeat: true });
    expect(runs).toBe(1);
  });
});
