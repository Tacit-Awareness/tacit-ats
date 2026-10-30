import { describe, expect, test, vi } from "vitest";

import { browserArea, createMemory, type StorageArea } from "./browser-memory";

const KEY = "t";
const parse = (raw: unknown) => (typeof raw === "number" ? raw : 0);

function fakeArea(start: Record<string, string> = {}): StorageArea & { data: Record<string, string> } {
  const data = { ...start };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

const denied = () => {
  throw new DOMException("The operation is insecure.", "SecurityError");
};

describe("a remembered value", () => {
  test("reads what storage holds and writes back", () => {
    const area = fakeArea({ [KEY]: "4" });
    const m = createMemory({ key: KEY, area: () => area, parse });
    expect(m.get()).toEqual({ value: 4, kept: true });
    m.update((v) => v + 1);
    expect(m.get()).toEqual({ value: 5, kept: true });
    expect(area.data[KEY]).toBe("5");
  });

  test("get is the same object until something changes, as useSyncExternalStore needs", () => {
    const m = createMemory({ key: KEY, area: () => fakeArea(), parse });
    expect(m.get()).toBe(m.get());
  });

  test("corrupt JSON is an empty value, and the next write replaces it", () => {
    const area = fakeArea({ [KEY]: "{not json" });
    const m = createMemory({ key: KEY, area: () => area, parse });
    expect(m.get()).toEqual({ value: 0, kept: true });
    m.update((v) => v + 1);
    expect(area.data[KEY]).toBe("1");
  });

  test("a write from another tab is not lost", () => {
    const area = fakeArea({ [KEY]: "1" });
    const m = createMemory({ key: KEY, area: () => area, parse });
    m.get();
    area.data[KEY] = "10";
    m.update((v) => v + 1);
    expect(m.get().value).toBe(11);
  });

  test("reload picks up another tab and tells subscribers; an unsubscribed one hears nothing", () => {
    const area = fakeArea({ [KEY]: "1" });
    const m = createMemory({ key: KEY, area: () => area, parse });
    const heard = vi.fn();
    const off = m.subscribe(heard);
    area.data[KEY] = "2";
    m.reload();
    expect(m.get().value).toBe(2);
    expect(heard).toHaveBeenCalledTimes(1);
    off();
    m.reload();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("with storage blocked", () => {
  test("the accessor itself throwing: nothing escapes, and the value lives in memory", () => {
    const m = createMemory({ key: KEY, area: denied, parse });
    expect(m.get()).toEqual({ value: 0, kept: false });
    m.update((v) => v + 1);
    m.update((v) => v + 1);
    expect(m.get()).toEqual({ value: 2, kept: false });
    expect(() => m.reload()).not.toThrow();
    expect(m.get().value).toBe(2);
  });

  test("getItem and setItem throwing", () => {
    const area: StorageArea = { getItem: denied, setItem: denied };
    const m = createMemory({ key: KEY, area: () => area, parse });
    m.update((v) => v + 1);
    expect(m.get()).toEqual({ value: 1, kept: false });
  });

  test("full: reads work, writes do not, and the value still moves", () => {
    const area = fakeArea({ [KEY]: "1" });
    area.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    const m = createMemory({ key: KEY, area: () => area, parse });
    m.update((v) => v + 1);
    expect(m.get()).toEqual({ value: 2, kept: false });
  });

  test("no window, as on the server: browserArea is null and the memory is empty", () => {
    expect(browserArea()).toBeNull();
    expect(createMemory({ key: KEY, area: browserArea, parse }).get()).toEqual({ value: 0, kept: false });
  });
});
