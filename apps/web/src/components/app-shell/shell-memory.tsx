"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { browserArea, createMemory, type Memory, type Remembered } from "@/lib/browser-memory";
import { NO_VIEWS, addView, newViewId, parseViews, removeView, togglePin, type SavedView, type ViewFilters, type ViewsState } from "@/lib/saved-views";
import { MARKS, NO_MARKS, hasNew, marksStale, parseMarks, type MarkKey, type MarkLists } from "@/lib/sidebar-marks";

// What the shell remembers in this browser: the saved views and pins, and what
// each marked page last showed. One copy per member (`tats.views.v2:<actor>`,
// so someone else on the machine, or the same person's other company, starts
// clean). The server renders neither: the first paint has the built-in views
// and no pins or tints, and they arrive on hydration. With storage blocked the
// first paint is the whole story and everything still works, in memory, until
// a reload.

const SERVER_VIEWS: Remembered<ViewsState> = { value: NO_VIEWS, kept: true };
const SERVER_SEEN: Remembered<MarkLists> = { value: NO_MARKS, kept: true };

type ShellMemoryValue = {
  views: Memory<ViewsState>;
  seen: Memory<MarkLists>;
  current: MarkLists;
  /** A page showed these: they are what is there now, and what you have seen. */
  show: (mark: MarkKey, ids: string[]) => void;
};

const Context = createContext<ShellMemoryValue | null>(null);

export function ShellMemory({ actorId, children }: { actorId: string; children: React.ReactNode }) {
  const [views] = useState(() => createMemory({ key: `tats.views.v2:${actorId}`, area: browserArea, parse: parseViews }));
  const [seen] = useState(() => createMemory({ key: `tats.marks.v1:${actorId}`, area: browserArea, parse: parseMarks }));
  const [current, setCurrent] = useState<MarkLists>(NO_MARKS);
  const pathname = usePathname();

  // Another tab pinned something: this tab's sidebar follows.
  useEffect(() => {
    const onStorage = () => {
      views.reload();
      seen.reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [views, seen]);

  const lastRead = useRef<number | null>(null);
  const reading = useRef(false);
  // Bumped each time a page draws its list, which is newer than a read already out.
  const drawn = useRef(0);
  const refresh = useCallback(async () => {
    if (reading.current || document.hidden || !marksStale(lastRead.current, Date.now())) return;
    reading.current = true;
    lastRead.current = Date.now();
    const asked = drawn.current;
    try {
      // `redirect: "error"`: a lapsed session redirects to sign-in, and that is not an answer.
      const res = await fetch("/client/marks", { cache: "no-store", redirect: "error" });
      if (!res.ok) return;
      const next = parseMarks(await res.json());
      if (asked !== drawn.current) return;
      setCurrent((c) => ({ inbox: next.inbox ?? c.inbox, tickets: next.tickets ?? c.tickets, activity: next.activity ?? c.activity }));
    } catch {
      // Offline or signed out: the links stay as they were, and the next read after the wait tries again.
    } finally {
      reading.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [pathname, refresh]);
  useEffect(() => {
    const onBack = () => void refresh();
    window.addEventListener("focus", onBack);
    document.addEventListener("visibilitychange", onBack);
    return () => {
      window.removeEventListener("focus", onBack);
      document.removeEventListener("visibilitychange", onBack);
    };
  }, [refresh]);

  const value = useMemo<ShellMemoryValue>(
    () => ({
      views,
      seen,
      current,
      show: (mark, ids) => {
        drawn.current += 1;
        setCurrent((c) => ({ ...c, [mark]: ids }));
        seen.update((s) => ({ ...s, [mark]: ids }));
      },
    }),
    [views, seen, current],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

function useShellMemory() {
  const value = useContext(Context);
  if (!value) throw new Error("A saved view or a sidebar mark outside the shell.");
  return value;
}

/** The saved views and what you can do to them. `kept` says whether this browser is keeping them. */
export function useViews() {
  const { views } = useShellMemory();
  const { value, kept } = useSyncExternalStore(views.subscribe, views.get, () => SERVER_VIEWS);
  return useMemo(
    () => ({
      state: value,
      kept,
      togglePin: (id: string) => views.update((s) => togglePin(s, id)),
      remove: (id: string) => views.update((s) => removeView(s, id)),
      /** The new view, or null when it could not be added (no name, or too many). */
      add: (input: ViewFilters & { name: string; desc: string; pin: boolean }): SavedView | null => {
        let made: SavedView | null = null;
        views.update((s) => {
          const id = newViewId(s, Date.now());
          const next = addView(s, { ...input, id });
          made = next?.custom.find((v) => v.id === id) ?? null;
          return next ?? s;
        });
        return made;
      },
    }),
    [views, value, kept],
  );
}

/** Which links get the tint. The page you are on never does: you are looking at it. */
export function useMarks(activeMark: MarkKey | null): Record<MarkKey, boolean> {
  const { seen, current } = useShellMemory();
  const { value } = useSyncExternalStore(seen.subscribe, seen.get, () => SERVER_SEEN);
  return Object.fromEntries(MARKS.map((m) => [m, m !== activeMark && hasNew(current[m], value[m])])) as Record<MarkKey, boolean>;
}

/** Rendered by a marked page with what it is showing, so its link clears, and stays clear until something else arrives. */
export function MarkSeen({ mark, ids }: { mark: MarkKey; ids: string[] }) {
  const { show } = useShellMemory();
  const key = ids.join("\n");
  const showRef = useRef(show);
  showRef.current = show;
  useEffect(() => {
    showRef.current(mark, key ? key.split("\n") : []);
  }, [mark, key]);
  return null;
}
