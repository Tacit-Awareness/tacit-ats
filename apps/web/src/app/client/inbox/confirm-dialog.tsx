"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Kbd } from "@/components/keys";
import type { ConfirmCopy } from "@/lib/client/inbox-decisions";
import { cn } from "@/lib/utils";
import { button, plain, primary } from "./fix-bar";

// The confirmation before a write nobody can take back: a decision in the Inbox
// (decision-bar.tsx) or a command to a Grokbot (activity/command-button.tsx).
// Nothing is written until its button or ⌘↵, and Esc, Cancel or the backdrop
// back out, but not while the post is in flight: that would hide a write still
// happening. A native <dialog>, modal, so keys.ts's ignoreKey stops every page
// and shell key behind it. It closes when the post settles, so an error reads
// on the page and a second press finds no form.

const danger = "border-[color:var(--red)] bg-[color:var(--red)] text-white hover:brightness-106 disabled:opacity-60";

/** Inside the form, for its pending state: tells the dialog when the post has settled. */
function Settled({ busy, done }: { busy: React.RefObject<boolean>; done: () => void }) {
  const { pending } = useFormStatus();
  useEffect(() => {
    const settled = busy.current && !pending;
    busy.current = pending;
    if (settled) done();
  }, [pending, busy, done]);
  return null;
}

function Buttons({ copy, blocked, cancel, confirmRef }: { copy: ConfirmCopy; blocked: boolean; cancel: () => void; confirmRef: React.Ref<HTMLButtonElement> }) {
  const { pending } = useFormStatus();
  return (
    <div className="mt-4 flex items-center justify-end gap-1.5">
      <span className="mr-auto hidden text-[12px] text-faint sm:inline">⌘↵ to confirm</span>
      <button type="button" onClick={cancel} disabled={pending} className={cn(button, plain)}>
        Cancel
        <Kbd decorative>esc</Kbd>
      </button>
      <button ref={confirmRef} type="submit" disabled={pending || blocked} className={cn(button, copy.danger ? danger : primary)}>
        {copy.confirm}
      </button>
    </div>
  );
}

export function ConfirmDialog({
  action,
  copy,
  blocked = false,
  first,
  close,
  children,
}: {
  action: (form: FormData) => Promise<void>;
  copy: ConfirmCopy;
  /** Nothing can be confirmed: the form says why. */
  blocked?: boolean;
  /** The field the answer starts in; otherwise the confirm button. */
  first?: React.RefObject<HTMLElement | null>;
  close: () => void;
  /** Its hidden fields, and whatever it asks. */
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    (first?.current ?? (blocked ? null : confirm.current))?.focus();
  }, [blocked, first]);

  const dismiss = () => {
    if (!busy.current) dialog.current?.close();
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="confirm-title"
      onClose={close}
      onCancel={(e) => {
        if (busy.current) e.preventDefault();
      }}
      onMouseDown={(e) => {
        // The form fills the dialog, so only the backdrop lands here.
        if (e.target === e.currentTarget) dismiss();
      }}
      // On the dialog, not the form: a click on its text moves focus to the dialog itself.
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy.current && !blocked) {
          e.preventDefault();
          form.current?.requestSubmit();
        }
      }}
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-xl border border-[color:var(--line-strong)] bg-raised p-0 text-foreground shadow-[var(--pop-shadow)] backdrop:bg-[color:var(--scrim)]"
    >
      <form ref={form} action={action} className="p-4">
        <Settled busy={busy} done={close} />
        <h2 id="confirm-title" className="m-0 text-[15px] font-semibold break-words">
          {copy.title}
        </h2>
        <p className="m-0 mt-1 text-[13px] break-words text-muted-foreground">{copy.body}</p>
        {children}
        <Buttons copy={copy} blocked={blocked} cancel={dismiss} confirmRef={confirm} />
      </form>
    </dialog>
  );
}
