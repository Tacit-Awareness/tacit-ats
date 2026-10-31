import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TOAST_MAX, createToasts, toastMs, withoutFlash } from "./toasts";

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

const texts = (t: ReturnType<typeof createToasts>) => t.list().map((x) => x.text);

describe("how long a toast stays", () => {
  test("six seconds, longer for a long sentence", () => {
    expect(toastMs({ text: "Sent.", tone: "info" })).toBe(6000);
    expect(toastMs({ text: "x".repeat(200), tone: "info" })).toBe(14000);
  });

  test("a refusal stays until dismissed", () => {
    expect(toastMs({ text: "No.", tone: "error" })).toBeNull();
  });
});

describe("the store", () => {
  test("a notice goes by itself, and a refusal does not", () => {
    const t = createToasts();
    t.show({ text: "Saved" });
    t.show({ text: "Refused", tone: "error" });
    vi.advanceTimersByTime(6000);
    expect(texts(t)).toEqual(["Refused"]);
    vi.advanceTimersByTime(600_000);
    expect(texts(t)).toEqual(["Refused"]);
  });

  test("dismissing takes one and leaves the rest, and tells whoever is listening", () => {
    const t = createToasts();
    const heard = vi.fn();
    t.subscribe(heard);
    const a = t.show({ text: "a" });
    t.show({ text: "b" });
    heard.mockClear();
    t.dismiss(a);
    expect(texts(t)).toEqual(["b"]);
    expect(heard).toHaveBeenCalledOnce();
    t.dismiss(a);
    expect(heard).toHaveBeenCalledOnce();
  });

  test("the same id shows once, so Back or a second effect is no new message", () => {
    const t = createToasts();
    t.show({ id: "flash-1", text: "Moved" });
    t.show({ id: "flash-1", text: "Moved" });
    expect(texts(t)).toEqual(["Moved"]);
    vi.advanceTimersByTime(6000);
    t.show({ id: "flash-1", text: "Moved" });
    expect(texts(t)).toEqual([]);
  });

  test("the same words twice are two messages", () => {
    const t = createToasts();
    t.show({ id: "flash-1", text: "Moved" });
    t.show({ id: "flash-2", text: "Moved" });
    expect(texts(t)).toEqual(["Moved", "Moved"]);
  });

  test("keeps the newest few, and an old one's timer goes with it", () => {
    const t = createToasts();
    for (let i = 0; i <= TOAST_MAX; i++) t.show({ text: String(i) });
    expect(texts(t)).toEqual(["1", "2", "3"]);
    expect(vi.getTimerCount()).toBe(TOAST_MAX);
  });

  test("an action rides along untouched", () => {
    const t = createToasts();
    const action = { undo: true };
    t.show({ text: "Moved to Done.", action });
    expect(t.list()[0]?.action).toBe(action);
  });
});

describe("withoutFlash", () => {
  test("takes the message and its Undo off, and leaves what the page needs", () => {
    expect(withoutFlash("?i=app-1&notice=dismissed&undo=u1")).toBe("?i=app-1");
    expect(withoutFlash("?notice=sent")).toBe("");
  });

  test("leaves an error, which stays on the page and in the URL", () => {
    expect(withoutFlash("?error=failed")).toBeNull();
    expect(withoutFlash("?error=failed&notice=sent")).toBe("?error=failed");
  });

  test("is null when there is nothing to take", () => {
    expect(withoutFlash("?i=app-1")).toBeNull();
    expect(withoutFlash("")).toBeNull();
  });
});
