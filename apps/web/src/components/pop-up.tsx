"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef } from "react";
import { Kbd, useKeyHelp, useKeys } from "@/components/keys";
import { inertOutside, writeInFlight, type PopupNode } from "@/lib/client/inbox-popup";

// design/tats's full-page pop-up (`.overlay.fs`, `.fs-sheet`): one thing over the
// list it came from, the Inbox's issues and the Pipeline's rows. The URL is its
// only state (`?i=`, `?open=`), so it can be linked and refreshed and Back works;
// closing is going to `home`, the same page without it.
//
// Deliberately not a <dialog>: useKeys and ignoreKey stand down for one, and the
// page's keys have to work in here (lib/client/inbox-popup.ts has the rest). A
// confirmation stays a native modal on top of it, which turns the page keys off
// again, this one's Esc included: useKeys is why Esc backs out of a confirmation
// and leaves this open. It closes on ✕, Esc or a press on the scrim, not while a
// write is under way. "Open as a page" is there for when you want the thing itself.

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-4">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

function PageIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-3.5 flex-none">
      <path d="M5 11l6-6M6 5h5v5" />
    </svg>
  );
}

export function PopUp({
  showing,
  title,
  subject,
  home,
  pageHref,
  keysTitle,
  closeLabel,
  backTo,
  children,
}: {
  /** What is open. A new one starts at the top with focus in the body: the next lands here after a fix, or on J and K. */
  showing: string;
  title: string;
  subject: string;
  /** Where closing lands. */
  home: string;
  /** "Open as a page": the thing itself. Null when there's no page this member can open. */
  pageHref: string | null;
  /** The `?` sheet's heading for Esc. */
  keysTitle: string;
  closeLabel: string;
  /** What takes focus when it closes, the first that is there: the row, then whatever holds it once the row has been dealt with. */
  backTo: (showing: string) => string[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const titleId = useId();
  const overlay = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const focusBack = useRef(() => [] as string[]);
  focusBack.current = () => backTo(showing);

  const busy = () => writeInFlight(sheet.current);
  const close = () => {
    // Without scrolling: the page stays where they left it.
    if (!busy()) router.push(home, { scroll: false });
  };
  useKeys({ Escape: close });
  useKeyHelp(keysTitle, [{ keys: "Esc", label: closeLabel }]);

  // Open: everything behind goes inert. Closed, by any route, Back included:
  // focus goes back to where it came from.
  useEffect(() => {
    const root = overlay.current;
    if (!root) return;
    const restore = inertOutside(root as unknown as PopupNode);
    return () => {
      restore();
      for (const selector of focusBack.current()) {
        const el = document.querySelector<HTMLElement>(selector);
        if (!el) continue;
        el.focus();
        break;
      }
    };
  }, []);

  // On the scrolling body, so the arrows and space read it.
  useEffect(() => {
    const b = body.current;
    if (!b) return;
    b.scrollTop = 0;
    b.focus({ preventScroll: true });
  }, [showing]);

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
        className="pop-dialog flex w-full max-w-[1280px] min-w-0 flex-col overflow-hidden sm:rounded-[12px] bg-[color:var(--paper)] shadow-[var(--pop-shadow)]"
      >
        <header className="flex min-h-14 flex-none items-center gap-3 border-b border-[color:var(--line-strong)] bg-[color:var(--surface)] py-2 pr-3 pl-4 md:pl-6">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <h2 id={titleId} className="m-0 text-[16px] leading-snug font-semibold tracking-[-0.01em] break-words">
              {title}
            </h2>
            {subject ? <p className="m-0 text-[13px] break-words text-muted-foreground">{subject}</p> : null}
          </div>
          {pageHref ? (
            <Link
              href={pageHref}
              aria-label="Open as a page"
              title="Open as a page"
              onClick={(e) => {
                if (busy()) e.preventDefault();
              }}
              className="inline-flex h-8 flex-none items-center gap-1.5 rounded-full px-2.5 text-[12.5px] whitespace-nowrap text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground"
            >
              <PageIcon />
              <span className="max-sm:hidden">Open as a page</span>
            </Link>
          ) : null}
          <Link
            href={home}
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
