"use client";

import { useEffect, useSyncExternalStore } from "react";
import { currentToasts, dismissToast, showToast, subscribeToasts, withoutFlash, type Toast } from "@/lib/toasts";
import { cn } from "@/lib/utils";

// design/tats's toasts (`#toasts`, `.toast`): bottom right, across the bottom on a
// phone, rising in and gone after six seconds. lib/toasts.ts is the store.
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
        <div key={t.id} className="toast flex max-w-[420px] [&_a]:pointer-events-auto [&_button]:pointer-events-auto items-center gap-2.5 border border-[color:var(--line-strong)] bg-raised py-2 pr-2 pl-3 text-[13px] shadow-[var(--pop-shadow)] max-sm:max-w-none">
          <span className={cn("min-w-0 flex-1 break-words", t.tone === "error" && "text-negative")}>{t.text}</span>
          {t.action as React.ReactNode}
          {t.tone === "error" ? (
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="flex-none rounded-full px-1.5 py-0.5 text-[12.5px] font-medium text-muted-foreground hover:bg-[color:var(--hover)] hover:text-foreground"
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
