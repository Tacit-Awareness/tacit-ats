"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { browserArea, createMemory, type Remembered } from "@/lib/browser-memory";
import { WARMTH_FILTER_ID, WARMTH_STORAGE_KEY, displayId, isNight, levelAt, parseWarmth, warmthKey, warmthMatrix, withLevel, type WarmthLevels } from "@/lib/warmth";

// The React half of lib/warmth.ts: which display and half of the day this
// window is on, the levels this browser remembers, and the filter. One copy per
// browser, not per member: it corrects the screen, not the person. The server
// renders Off; the level arrives on hydration. With storage blocked a level
// still applies, in memory, until a reload.

const levels = createMemory<WarmthLevels>({ key: WARMTH_STORAGE_KEY, area: browserArea, parse: parseWarmth });
const SERVER_LEVELS: Remembered<WarmthLevels> = { value: {}, kept: true };

// Where this window is: `warmthKey` of its display and the time, "" until the
// filter has looked (on the server and before hydration).
let where = "";
const whereListeners = new Set<() => void>();
const subscribeWhere = (l: () => void) => {
  whereListeners.add(l);
  return () => {
    whereListeners.delete(l);
  };
};

function locate() {
  let next = "";
  try {
    const p3 = typeof matchMedia === "function" && matchMedia("(color-gamut: p3)").matches;
    next = warmthKey(displayId({ width: screen.width, height: screen.height, dpr: devicePixelRatio, p3 }), isNight(new Date()));
  } catch {
    return;
  }
  if (next === where) return;
  where = next;
  whereListeners.forEach((l) => l());
}

/** This display's level now, whether it is night, and how to change it. */
export function useWarmth() {
  const key = useSyncExternalStore(subscribeWhere, () => where, () => "");
  const { value } = useSyncExternalStore(levels.subscribe, levels.get, () => SERVER_LEVELS);
  return useMemo(
    () => ({
      level: key ? levelAt(value, key) : 0,
      night: key ? key.endsWith("|night") : isNight(new Date()),
      set: (level: number) => {
        if (key) levels.update((s) => withLevel(s, key, level));
      },
    }),
    [key, value],
  );
}

/**
 * Once in the shell: looks again when the window moves to another screen, the
 * evening or morning starts, or another tab changes a level, and puts the page
 * through the filter while a level is set. Off renders nothing and no class.
 */
export function WarmthFilter() {
  const { level } = useWarmth();
  const matrix = warmthMatrix(level);

  useEffect(() => {
    locate();
    // A move to another screen changes its size or density; resize is cheap, as locate only compares.
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === WARMTH_STORAGE_KEY) levels.reload();
    };
    window.addEventListener("resize", locate);
    window.addEventListener("storage", onStorage);
    // Screen fires `change` where the browser has the Window Management API; lib.dom does not type it.
    const scr = screen as Screen & Partial<EventTarget>;
    scr.addEventListener?.("change", locate);
    const tick = window.setInterval(locate, 60_000);
    return () => {
      window.removeEventListener("resize", locate);
      window.removeEventListener("storage", onStorage);
      scr.removeEventListener?.("change", locate);
      window.clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("warmth-on", matrix !== null);
    return () => root.classList.remove("warmth-on");
  }, [matrix]);

  if (!matrix) return null;
  return (
    <svg aria-hidden="true" focusable="false" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <filter id={WARMTH_FILTER_ID} colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values={matrix} />
      </filter>
    </svg>
  );
}
