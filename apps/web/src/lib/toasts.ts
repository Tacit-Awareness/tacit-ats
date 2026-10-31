// design/tats's toasts, the store (components/toasts.tsx draws them and is how a
// server page asks for one). A plain module, so any client component can call
// showToast and a test needs no DOM. Unit-tested in toasts.test.ts.

export type Toast = {
  id: string;
  text: string;
  tone: "info" | "error";
  /** Beside the text, such as an Undo. Held as it came: this file never looks in it. */
  action?: unknown;
};

/** At most this many at once, oldest out first. */
export const TOAST_MAX = 3;

/** How long a toast stays, as design/tats's 6s, with time to read a long sentence. A refusal stays until dismissed. */
export const toastMs = (t: Pick<Toast, "text" | "tone">): number | null => (t.tone === "error" ? null : Math.max(6000, t.text.length * 70));

/** Ids already shown: a page coming back through Back or Strict Mode's second run is not a new message. */
const SEEN_MAX = 100;

export function createToasts() {
  let list: Toast[] = [];
  let count = 0;
  const seen = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  const dismiss = (id: string) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
    if (!list.some((t) => t.id === id)) return;
    list = list.filter((t) => t.id !== id);
    emit();
  };

  const show = (t: Omit<Toast, "id" | "tone"> & { id?: string; tone?: Toast["tone"] }): string => {
    const id = t.id ?? `toast-${++count}`;
    if (seen.has(id)) return id;
    seen.add(id);
    if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value as string);
    const toast: Toast = { ...t, id, tone: t.tone ?? "info" };
    const over = list.length + 1 - TOAST_MAX;
    if (over > 0) for (const old of list.slice(0, over)) dismiss(old.id);
    list = [...list, toast];
    const ms = toastMs(toast);
    if (ms !== null) timers.set(id, setTimeout(() => dismiss(id), ms));
    emit();
    return id;
  };

  return {
    show,
    dismiss,
    list: () => list,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
}

const toasts = createToasts();

export const showToast = toasts.show;
export const dismissToast = toasts.dismiss;
export const subscribeToasts = toasts.subscribe;
export const currentToasts = toasts.list;

/** The params that carried a one-time message, gone from a query once it has shown. Null when there were none. */
export function withoutFlash(search: string): string | null {
  const params = new URLSearchParams(search);
  if (!params.has("notice") && !params.has("undo")) return null;
  params.delete("notice");
  params.delete("undo");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
