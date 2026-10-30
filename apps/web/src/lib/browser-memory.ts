// A small remembered value in this browser's localStorage, as design/tats
// keeps its pins (`tats.views.v2`, every read and write in a try/catch). Only
// conveniences live here: nothing a page needs in order to render, and never
// candidate text. Storage can be missing, blocked, full or corrupt, and each
// of those leaves the value in memory, so the page works the same until a
// reload. Pure of React and of `window`: `area` is passed in, and the tests
// hand it one that throws.

export type StorageArea = Pick<Storage, "getItem" | "setItem">;

/** `window.localStorage`, whose own getter throws where site data is blocked. */
export const browserArea = (): StorageArea | null => (typeof window === "undefined" ? null : window.localStorage);

/** The value, and whether this browser is keeping it (false once a read or write failed). */
export type Remembered<T> = { value: T; kept: boolean };

export type Memory<T> = {
  get: () => Remembered<T>;
  update: (next: (value: T) => T) => void;
  /** Read again, for a write from another tab. */
  reload: () => void;
  subscribe: (listener: () => void) => () => void;
};

/** `ok: false` is storage we could not reach; `raw: null` is storage with nothing, or nothing readable, in it. */
function read(area: () => StorageArea | null, key: string): { ok: true; raw: unknown } | { ok: false } {
  try {
    const store = area();
    if (!store) return { ok: false };
    const text = store.getItem(key);
    if (text === null) return { ok: true, raw: null };
    try {
      return { ok: true, raw: JSON.parse(text) };
    } catch {
      return { ok: true, raw: null };
    }
  } catch {
    return { ok: false };
  }
}

function write(area: () => StorageArea | null, key: string, value: unknown): boolean {
  try {
    const store = area();
    if (!store) return false;
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function createMemory<T>({ key, area, parse }: { key: string; area: () => StorageArea | null; parse: (raw: unknown) => T }): Memory<T> {
  const listeners = new Set<() => void>();
  let state: Remembered<T> | null = null;
  const emit = () => listeners.forEach((l) => l());

  const load = (): Remembered<T> => {
    const got = read(area, key);
    return got.ok ? { value: parse(got.raw), kept: true } : { value: parse(null), kept: false };
  };
  const get = () => (state ??= load());

  return {
    get,
    update(next) {
      // From storage when it answers, so a write in another tab is not lost;
      // from memory once a write has failed, as storage then holds an older copy.
      const got = read(area, key);
      const base = got.ok && got.raw !== null && state?.kept !== false ? parse(got.raw) : get().value;
      const value = next(base);
      state = { value, kept: write(area, key, value) };
      emit();
    },
    reload() {
      const got = read(area, key);
      if (!got.ok || got.raw === null || state?.kept === false) return;
      state = { value: parse(got.raw), kept: true };
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
