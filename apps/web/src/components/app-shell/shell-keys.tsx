"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Kbd, usePageKeyHelp, type KeyHelpSection } from "@/components/keys";
import { chord, ignoreKey } from "@/lib/keys";

// The shell's half of design/tats's keyboard model: G then a letter goes to
// a page, `?` opens the sheet of keys (this page's, then the global ones).
// `[` and ⌘K stay in shell-frame.tsx, where they began. The sheet is a
// native <dialog>: Esc closes it, focus stays inside and goes back after.

export type GoKey = { key: string; label: string; href: string };

const OPEN_EVENT = "tats:keys";

function Keys({ keys }: { keys: string }) {
  return (
    <span className="flex flex-none items-center gap-1">
      {keys.split(" ").map((k, i, all) =>
        // Between two keys these are words; last, "/" is the key.
        ["then", "/", "or"].includes(k) && i > 0 && i < all.length - 1 ? (
          <span key={i} className="text-[11.5px] text-faint">
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
    <section className="grid content-start gap-1">
      <h3 className="m-0 pb-1 text-[12px] font-medium text-faint">{section.title}</h3>
      <dl className="m-0 grid gap-1">
        {section.rows.map((r) => (
          <div key={`${r.keys}${r.label}`} className="flex min-h-7 items-center justify-between gap-4 text-[13px]">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="m-0">
              <Keys keys={r.keys} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A button that opens the sheet, so it is never reachable by `?` alone. */
export function KeysButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      data-tour="keys"
      aria-label="Keyboard shortcuts (?)"
      title="Keyboard shortcuts (?)"
      className={className}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round" className="size-[15px]" aria-hidden>
        <path d="M2 4.5h12v7H2ZM4.5 7h.01M7 7h.01M9.5 7h.01M12 7h.01M5 9.5h6" />
      </svg>
    </button>
  );
}

export function ShellKeys({ go }: { go: GoKey[] }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const page = usePageKeyHelp();
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    let pending: number | null = null;
    // Capture phase, so the letter after G is taken before a page's J or K sees it.
    const onKey = (e: KeyboardEvent) => {
      if (ignoreKey(e) || dialog.current?.open) return;
      const step = chord(pending, e.key, Date.now());
      pending = step.pending;
      if (step.then) {
        // The letter is G's either way: G then K is not a page's K.
        const to = goRef.current.find((g) => g.key === step.then);
        if (to || step.then.length === 1) e.preventDefault();
        if (to) router.push(to.href);
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
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const global: KeyHelpSection = {
    title: "Anywhere",
    rows: [
      { keys: "⌘K", label: "Command menu" },
      ...go.map((g) => ({ keys: `G then ${g.key.toUpperCase()}`, label: g.label })),
      { keys: "[", label: "Collapse or expand the sidebar" },
      { keys: "?", label: "This list" },
    ],
  };

  return (
    <dialog
      ref={dialog}
      aria-label="Keyboard shortcuts"
      onClose={() => setOpen(false)}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      className="m-auto w-[min(720px,calc(100vw-32px))] rounded-xl border border-[color:var(--line-strong)] bg-raised p-0 text-foreground shadow-[var(--pop-shadow)] backdrop:bg-[color:var(--scrim)]"
    >
      <div className="flex items-center justify-between border-b border-[color:var(--line)] px-4 py-3">
        <h2 className="m-0 text-[14px] font-semibold">Keyboard Shortcuts</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-2 py-1 text-[12.5px] text-muted-foreground hover:bg-[color:var(--hover)] hover:text-foreground"
        >
          Close <Kbd decorative>esc</Kbd>
        </button>
      </div>
      <div className="grid gap-x-8 gap-y-5 p-4 sm:grid-cols-2">
        {page.map((s) => (
          <HelpSection key={s.title} section={s} />
        ))}
        <HelpSection section={global} />
      </div>
    </dialog>
  );
}
