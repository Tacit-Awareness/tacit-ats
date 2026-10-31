"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef } from "react";
import { Kbd, useKeyHelp, useKeys } from "@/components/keys";
import { inertOutside, rowSelector, writeInFlight, type PopupNode } from "@/lib/client/inbox-popup";

// design/tats's full-page pop-up (`.overlay.fs`, `.fs-sheet`): one issue over
// the Inbox card, holding the reader. `?i=` is its only state, so it can be
// linked and refreshed and Back works; closing is going to the plain Inbox.
//
// Deliberately not a <dialog>: useKeys and ignoreKey stand down for one, and the
// bars' keys have to work in here (lib/client/inbox-popup.ts has the rest). The
// confirmations stay native modals on top of it, which turns the page keys off
// again, this one's Esc included: useKeys is why Esc backs out of a confirmation
// and leaves this open. It closes on ✕, Esc or a press on the scrim, not while a
// write is under way.

const HOME = "/client/inbox";

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden className="size-4">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

export function IssuePopup({ issueKey, title, subject, children }: { issueKey: string; title: string; subject: string; children: React.ReactNode }) {
  const router = useRouter();
  const titleId = useId();
  const overlay = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const shown = useRef(issueKey);
  shown.current = issueKey;

  const busy = () => writeInFlight(sheet.current);
  const close = () => {
    // Without scrolling: the card stays where they left it.
    if (!busy()) router.push(HOME, { scroll: false });
  };
  useKeys({ Escape: close });
  useKeyHelp("Inbox", [{ keys: "Esc", label: "Close, back to the Inbox" }]);

  // Open: everything behind goes inert. Closed, by any route, Back included:
  // focus goes back to the row, or the card once the row has been dealt with.
  useEffect(() => {
    const root = overlay.current;
    if (!root) return;
    const restore = inertOutside(root as unknown as PopupNode);
    return () => {
      restore();
      (document.querySelector<HTMLElement>(rowSelector(shown.current)) ?? document.querySelector<HTMLElement>("[data-inbox-card]"))?.focus();
    };
  }, []);

  // On the scrolling body, so the arrows and space read it. Again for each
  // issue: the next one lands here after a fix, or on J and K.
  useEffect(() => {
    const b = body.current;
    if (!b) return;
    b.scrollTop = 0;
    b.focus({ preventScroll: true });
  }, [issueKey]);

  return (
    <div
      ref={overlay}
      onMouseDown={(e) => {
        // The sheet fills all but the scrim's edge, so only the scrim lands here.
        if (e.target === e.currentTarget) close();
      }}
      className="pop-scrim fixed inset-0 z-50 flex items-stretch justify-center bg-[color:var(--scrim)] sm:p-5"
    >
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="pop-dialog flex w-full max-w-[1280px] min-w-0 flex-col overflow-hidden bg-[color:var(--paper)] shadow-[var(--pop-shadow)]"
      >
        <header className="flex min-h-14 flex-none items-center gap-3 border-b border-[color:var(--line-strong)] bg-[color:var(--surface)] py-2 pr-3 pl-4 md:pl-6">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <h2 id={titleId} className="m-0 text-[16px] leading-snug font-semibold tracking-[-0.01em] break-words">
              {title}
            </h2>
            {subject ? <p className="m-0 text-[13px] break-words text-muted-foreground">{subject}</p> : null}
          </div>
          <Link
            href={HOME}
            scroll={false}
            aria-label="Close"
            onClick={(e) => {
              if (busy()) e.preventDefault();
            }}
            className="inline-flex h-8 flex-none items-center gap-2 rounded-full px-2 text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground"
          >
            <Kbd decorative className="max-sm:hidden">
              esc
            </Kbd>
            <CloseIcon />
          </Link>
        </header>
        <div ref={body} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none">
          {children}
        </div>
      </div>
    </div>
  );
}
