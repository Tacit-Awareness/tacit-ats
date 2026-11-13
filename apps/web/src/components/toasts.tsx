"use client";

import { useEffect, useSyncExternalStore } from "react";
import { currentToasts, dismissToast, showToast, subscribeToasts, withoutFlash, type Toast } from "@/lib/toasts";
import "./overlays.css";

// design/tats's toasts (`#toasts`), drawn as Testbench's `.toast`: black, white
// words, 10px corners (overlays.css turns what a page puts in one, an Undo and
// its key, to the toast's ink). Bottom right, across the bottom on a phone,
// rising in and gone after six seconds. A refusal carries a mark and stays until
// dismissed. lib/toasts.ts is the store.
//
// `Toaster` is mounted once, in the shell, always there so a screen reader hears
// what lands in it. Only a toast's buttons take the pointer, so one over a page's Save
// doesn't swallow the click. `data-toasts` keeps it out of inertOutside, so a toast and its
// Undo work over a pop-up. A native modal <dialog> sits above it, on purpose.
//
// `Flash` (through flash-toast.tsx, on a server page) says what a redirect's
// `?notice=` meant. It draws nothing itself and takes `notice` and `undo` off the URL once shown, so a reload
// or a later refresh of that page is not a second message; `stamp`, a time from
// the server's render, is what tells the same words after a second redirect from
// the same page going back. A refusal (`?error=`) is not a toast: it stays on the
// page, where the thing that failed is, and in the URL.

export { showToast, dismissToast };

const noToasts: Toast[] = [];
const serverToasts = () => noToasts;

export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, currentToasts, serverToasts);
  return (
    <div data-toasts role="status" aria-live="polite" className="pointer-events-none fixed right-5 bottom-[60px] z-[70] grid justify-items-end gap-2 max-sm:right-4 max-sm:left-4 max-sm:justify-items-stretch">
      {toasts.map((t) => (
        <div key={t.id} className="toast ov-toast flex max-w-[440px] items-center gap-2.5 py-2.5 pr-2.5 pl-4 text-[13px] leading-5 max-sm:max-w-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
          {t.tone === "error" ? (
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="ov-toast-alert size-4 flex-none" aria-hidden>
              <path d="M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 5v3.5M8 10.9h.01" />
            </svg>
          ) : null}
          <span className="min-w-0 flex-1 break-words">{t.text}</span>
          {t.action as React.ReactNode}
          {t.tone === "error" ? (
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="flex-none rounded-[6px] px-2 py-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground"
            >
              Dismiss
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function Flash({ text, stamp, action }: { text: string; stamp: number; action?: React.ReactNode }) {
  useEffect(() => {
    showToast({ id: `flash-${stamp}`, text, action });
    const search = withoutFlash(location.search);
    if (search !== null) history.replaceState(null, "", `${location.pathname}${search}${location.hash}`);
    // `stamp` is the render this message came from: the words and the action go with it.
  }, [stamp]);
  // With no script nothing above runs, and the message is still on the page.
  return <noscript>{text}</noscript>;
}
