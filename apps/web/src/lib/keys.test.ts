import { describe, expect, it } from "vitest";
import { CHORD_MS, chord, ignoreKey, isTyping, keyName, stepIndex, type KeyEventLike } from "./keys";

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

  it("lets keys through on the page, a link or a button", () => {
    for (const t of ["BODY", "A", "BUTTON", "DIV"]) expect(isTyping(el(t))).toBe(false);
    expect(isTyping(null)).toBe(false);
    expect(ignoreKey(ev())).toBe(false);
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
