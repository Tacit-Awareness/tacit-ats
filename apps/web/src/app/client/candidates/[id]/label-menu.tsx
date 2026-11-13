"use client";

import { useCallback, useEffect, useLayoutEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { useKeyHelp, useKeys } from "@/components/keys";
import { Chip } from "@/components/page";
import { showToast } from "@/components/toasts";
import { menuKey } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { setLabelAction, type LabelResult } from "./actions";
import { CANDIDATE_ERRORS, type CandidateError } from "./messages";

// design/tats's `labelMenu`: a candidate's labels as chips and a checked menu, on
// the page and in the Pipeline's pop-up, for someone who may change their record
// (read.ts asks can_edit_person; controls.tsx draws plain chips for anyone else).
// A chip changes at once and the server's answer settles it: a refusal puts it
// back and says why, in place, so the pop-up stays open. L opens the menu; J / K
// or the arrows, Enter or a digit, Esc, as the board's stage menu. The labels are
// the company's own: this puts them on and takes them off, and makes none.
// Drawn as Testbench's chips and `.menu`: the add button a dashed chip, the menu
// white with 34px items, each label's digit as a key at its end.

export type LabelOption = { tagId: string; name: string };

type Flip = { name: string; on: boolean };
const flipped = (labels: string[], { name, on }: Flip) => (on ? [...labels.filter((l) => l !== name), name] : labels.filter((l) => l !== name));

const WIDTH = 240;
/** Testbench's `.menu-item`: 34px, 7px corners. */
const ITEM =
  "flex h-[34px] w-full flex-none items-center gap-2.5 rounded-[7px] px-2.5 text-left text-[13px] outline-none transition-colors hover:bg-[color:var(--hover)] focus-visible:bg-[color:var(--hover)]";
/** A key inside the item, Testbench's `.kbd`. */
const KEY = "ml-auto inline-grid h-5 min-w-5 place-items-center rounded-[4px] px-1 font-mono text-[11px] text-muted-foreground shadow-[inset_0_0_0_1px_currentColor] opacity-70";

function Check({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-4 flex-none place-items-center rounded-[4px] bg-[color:var(--paper)] text-[color:var(--primary-ink)] shadow-[inset_0_0_0_1px_var(--field)]",
        on && "bg-[color:var(--primary)] shadow-none",
      )}
    >
      {on ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="size-[11px]">
          <path d="m3 8.5 3.2 3.2L13 4.8" />
        </svg>
      ) : null}
    </span>
  );
}

function Menu({ anchor, options, carried, onFlip, onClose }: { anchor: DOMRect; options: LabelOption[]; carried: string[]; onFlip: (o: LabelOption) => void; onClose: (refocus: boolean) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const count = options.length;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const gap = 8;
    const below = anchor.bottom + 4;
    el.style.top = `${below + el.offsetHeight + gap > window.innerHeight ? Math.max(gap, anchor.top - el.offsetHeight - 4) : below}px`;
    el.style.left = `${Math.max(gap, Math.min(anchor.left, window.innerWidth - WIDTH - gap))}px`;
    el.querySelector<HTMLElement>("[role=menuitemcheckbox]")?.focus();
  }, [anchor]);

  useEffect(() => {
    const items = () => Array.from(box.current?.querySelectorAll<HTMLElement>("[role=menuitemcheckbox]") ?? []);
    const outside = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) onClose(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!box.current?.contains(document.activeElement)) return onClose(false);
      const command = menuKey(e, count);
      if (!command) return;
      if (command.kind === "close") {
        // Prevented, so Esc shuts this and leaves the pop-up behind it open.
        if (command.refocus) e.preventDefault();
        return onClose(command.refocus);
      }
      e.preventDefault();
      const all = items();
      // A press, not a key held: each repeat would flip it again.
      if (command.kind === "pick") return e.repeat ? undefined : all[command.index]?.click();
      const cur = all.indexOf(document.activeElement as HTMLElement);
      all[(cur + command.d + all.length) % all.length]?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", outside, true);
    document.addEventListener("keydown", onKey);
    const onResize = () => onClose(false);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("scroll", outside, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [count, onClose]);

  return (
    <div
      ref={box}
      role="menu"
      aria-label="Labels"
      style={{ width: WIDTH }}
      className="fixed z-[55] flex max-h-[300px] flex-col overflow-y-auto rounded-[12px] bg-raised p-1.5 shadow-[var(--pop-shadow)]"
    >
      <p className="m-0 flex-none px-2.5 pt-1.5 pb-1 text-[11.5px] text-faint">Labels</p>
      {options.map((o, i) => {
        const on = carried.includes(o.name);
        return (
          <button key={o.tagId} type="button" role="menuitemcheckbox" aria-checked={on} tabIndex={-1} onClick={() => onFlip(o)} className={ITEM}>
            <Check on={on} />
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            {i < 9 ? (
              <kbd aria-hidden className={KEY}>
                {i + 1}
              </kbd>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function LabelMenu({ candidateId, labels, options }: { candidateId: string; labels: string[]; options: LabelOption[] }) {
  const [shown, flip] = useOptimistic(labels, flipped);
  const [, start] = useTransition();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  const open = () => {
    if (button.current) setAnchor(button.current.getBoundingClientRect());
  };
  const close = useCallback((refocus: boolean) => {
    setAnchor(null);
    if (refocus) button.current?.focus();
  }, []);

  useKeys({ l: open }, !anchor);
  useKeyHelp("Candidate", [{ keys: "L", label: "Edit labels" }]);

  const toggle = (o: LabelOption) => {
    const on = !shown.includes(o.name);
    const form = new FormData();
    form.set("candidateId", candidateId);
    form.set("tagId", o.tagId);
    form.set("on", on ? "1" : "0");
    start(async () => {
      flip({ name: o.name, on });
      const result: LabelResult = await setLabelAction(form).catch(() => ({ ok: false, error: "label_unsure" }) as const);
      if (!result.ok) showToast({ text: CANDIDATE_ERRORS[result.error satisfies CandidateError], tone: "error" });
    });
  };

  return (
    <>
      {shown.map((t) => (
        <Chip key={`tag-${t}`}>{t}</Chip>
      ))}
      <button
        ref={button}
        type="button"
        data-command="labels"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        aria-keyshortcuts="L"
        title="Edit labels (L)"
        onClick={() => (anchor ? close(false) : open())}
        className="inline-flex h-[26px] items-center gap-1.5 rounded-[6px] border border-dashed border-[color:var(--line-strong)] px-[9px] font-mono text-[12.5px] text-muted-foreground transition-colors hover:border-[color:var(--faint)] hover:bg-[color:var(--hover)] hover:text-foreground aria-expanded:border-solid aria-expanded:bg-[color:var(--hover)] aria-expanded:text-foreground"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="size-3" aria-hidden>
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
        Labels
      </button>
      {anchor ? <Menu anchor={anchor} options={options} carried={shown} onFlip={toggle} onClose={close} /> : null}
    </>
  );
}
