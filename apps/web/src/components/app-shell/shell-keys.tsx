"use client";

import { useRouter } from "next/navigation";
import { mayLeave } from "@/lib/leave-guard";
import { useEffect, useRef, useState } from "react";
import { Kbd, usePageKeyHelp, type KeyHelpSection } from "@/components/keys";
import { Kbd as KeyCap } from "@/components/page";
import { SIGN_OUT_KEYS, chord, ignoreKey, isSignOutKey, modalOpen } from "@/lib/keys";
import { cn } from "@/lib/utils";
import "../overlays.css";

// The shell's half of design/tats's keyboard model: G then a letter goes to
// a page, `?` opens the sheet of keys (this page's, then the global ones).
// `[` and ⌘K stay in shell-frame.tsx, where they began. The sheet is a
// native <dialog>: Esc closes it, focus stays inside and goes back after.
// ⇧⌘Q signs out, by the same POST as the account menu's Sign out (isSignOutKey
// says why only that chord). The sheet is Testbench's `.dialog` (overlays.css).

export type GoKey = { key: string; label: string; href: string };

const OPEN_EVENT = "tats:keys";

function Keys({ keys }: { keys: string }) {
  return (
    <span className="flex flex-none items-center gap-1 text-muted-foreground">
      {keys.split(" ").map((k, i, all) =>
        // Between two keys these are words; last, "/" is the key.
        ["then", "/", "or"].includes(k) && i > 0 && i < all.length - 1 ? (
          <span key={i} className="px-0.5 text-[12px] text-faint">
            {k}
          </span>
        ) : (
          <Kbd key={i}>{k}</Kbd>
        ),
      )}
    </span>
  );
}

function HelpSection({ section }: { section: KeyHelpSection }) {
  return (
    <section className="grid content-start gap-1.5">
      <h3 className="m-0 font-sans text-[14px] leading-5 font-semibold">{section.title}</h3>
      <dl className="m-0 grid">
        {section.rows.map((r) => (
          <div key={`${r.keys}${r.label}`} className="flex min-h-8 items-center justify-between gap-4 border-b border-[color:var(--line)] py-1 text-[13px] last:border-b-0">
            <dt>{r.label}</dt>
            <dd className="m-0">
              <Keys keys={r.keys} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Opens the sheet, as `?` does. */
export function openKeys() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function ShellKeys({ go }: { go: GoKey[] }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const signOut = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const page = usePageKeyHelp();
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    let pending: number | null = null;
    // Capture phase, so the letter after G is taken before a page's J or K sees it.
    const onKey = (e: KeyboardEvent) => {
      if (isSignOutKey(e) && !modalOpen()) {
        e.preventDefault();
        signOut.current?.requestSubmit();
        return;
      }
      if (ignoreKey(e) || dialog.current?.open) return;
      const step = chord(pending, e.key, Date.now());
      pending = step.pending;
      if (step.then) {
        // The letter is G's either way: G then K is not a page's K.
        const to = goRef.current.find((g) => g.key === step.then);
        if (to || step.then.length === 1) e.preventDefault();
        if (to && mayLeave()) router.push(to.href);
      } else if (step.pending === null && (e.key === "?" || (e.key === "/" && e.shiftKey))) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [router]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // As Testbench's dialogs: the sheet itself takes focus, so it opens without a ring on Close; Tab goes on to it.
      d.focus({ preventScroll: true });
    }
    if (!open && d.open) d.close();
  }, [open]);

  const global: KeyHelpSection = {
    title: "Anywhere",
    rows: [
      { keys: "⌘K", label: "Command menu: pages, jobs, candidates" },
      ...go.map((g) => ({ keys: `G then ${g.key.toUpperCase()}`, label: g.label })),
      { keys: "[", label: "Collapse or expand the sidebar" },
      { keys: "?", label: "This list" },
      { keys: SIGN_OUT_KEYS, label: "Sign out" },
    ],
  };

  // A page that registered its name but no keys has nothing to list; with
  // nothing of the page's, the sheet is one column, not one beside an empty one.
  const sections = page.filter((s) => s.rows.length);

  return (
    <>
      <form ref={signOut} action="/client/signout" method="post" hidden />
      <dialog
        ref={dialog}
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        onClose={() => setOpen(false)}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
        className={cn("ov-dialog m-auto max-h-[calc(100vh-80px)] p-0 outline-none", sections.length ? "w-[min(760px,calc(100vw-40px))]" : "w-[min(440px,calc(100vw-40px))]")}
      >
        <div className="ov-dialog-head">
          <h2>Keyboard shortcuts</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" title="Close (esc)" className="ov-icon-btn -mt-1 -mr-2.5">
            <KeyCap>esc</KeyCap>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div className={cn("grid gap-x-10 gap-y-6 px-6 pt-4 pb-6", sections.length && "sm:grid-cols-2")}>
          {sections.map((s) => (
            <HelpSection key={s.title} section={s} />
          ))}
          <HelpSection section={global} />
        </div>
      </dialog>
    </>
  );
}
