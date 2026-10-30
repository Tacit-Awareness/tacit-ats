"use client";

import { useSyncExternalStore } from "react";
import { togglePage, togglePick, type BulkItem, type Picked } from "@/lib/client/crm-bulk-rules";

// The CRM's selected rows, in the browser for as long as the tab stays on
// the app: a sort, a search or the next page is a new URL and a new page
// render, and design/tats's selection carries across them. A plain store
// rather than component state, for that. Nothing here is saved.

let picked: Picked = new Map();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const none: Picked = new Map();
const set = (next: Picked) => {
  if (next === picked) return;
  picked = next;
  listeners.forEach((l) => l());
};

export const usePicked = (): Picked => useSyncExternalStore(subscribe, () => picked, () => none);
export const toggleItem = (item: BulkItem) => set(togglePick(picked, item));
export const togglePageItems = (items: readonly BulkItem[]) => set(togglePage(picked, items));
export const clearPicked = () => set(new Map());
