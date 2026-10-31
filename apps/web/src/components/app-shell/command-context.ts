"use client";

import { useEffect, useSyncExternalStore } from "react";

// What ⌘K can act on: the thing the page has open, as design/tats's palette takes
// the ticket you're on. A page registers it while mounted, as useKeyHelp does a
// page's keys, and an action only takes the member to a control that page already
// has: it never writes.

export type CommandAction = { label: string; hint?: string; run: () => void };
export type CommandContext = { name: string; actions: CommandAction[] };

let current: CommandContext | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => current;
const serverSnapshot = () => null;

/** Registers what's open. `ctx` is a value that stays the same across renders: useMemo it, or define it once. */
export function useCommandContext(ctx: CommandContext) {
  useEffect(() => {
    current = ctx;
    listeners.forEach((l) => l());
    return () => {
      if (current !== ctx) return;
      current = null;
      listeners.forEach((l) => l());
    };
  }, [ctx]);
}

export const useCurrentCommandContext = () => useSyncExternalStore(subscribe, snapshot, serverSnapshot);
