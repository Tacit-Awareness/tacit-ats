"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Kbd, useKeyHelp, useKeys } from "@/components/keys";
import type { IssueInstance } from "@/lib/client/inbox-issues";
import { rowSelector } from "@/lib/client/inbox-popup";
import { isShown, onePress } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { dismissIssueAction, restoreIssueAction } from "./actions";
import { button, plain } from "./buttons";

// Setting an issue aside (design/tats's E, `ibDone`) and getting it back. E
// isn't confirmed, as the prototype: it changes only this member's queue, and
// Undo in the toast (or Z, or Move back to Inbox on Done) brings it straight back. A key
// checks isShown first: on a phone's list the reader is mounted but hidden, and
// an unseen issue is never written. Holding E sets aside one, not the queue.

function EKey({ press }: { press: () => void }) {
  const { pending } = useFormStatus();
  useKeys({ e: onePress(press) }, !pending);
  return null;
}

function DismissSubmit({ refFn }: { refFn: (b: HTMLButtonElement | null) => void }) {
  const { pending } = useFormStatus();
  return (
    <button ref={refFn} type="submit" disabled={pending} aria-keyshortcuts="E" className={cn(button, plain, "disabled:opacity-60")}>
      Dismiss
      <Kbd decorative>E</Kbd>
    </button>
  );
}

/** Inside the fix and decision bars, whichever the issue has. Fields are `issue*` because a decision's form has a `reason` of its own. */
export function DismissButton({ instance, next }: { instance: IssueInstance; next: string | null }) {
  const form = useRef<HTMLFormElement>(null);
  const submit = useRef<HTMLButtonElement | null>(null);
  useKeyHelp("Inbox", [{ keys: "E", label: "Dismiss, to Done" }]);
  return (
    <form ref={form} action={dismissIssueAction}>
      <EKey press={() => void (submit.current && isShown(form.current) && form.current?.requestSubmit(submit.current))} />
      <input type="hidden" name="issueKey" value={instance.key} />
      <input type="hidden" name="issueReason" value={instance.reason} />
      <input type="hidden" name="issueAt" value={instance.at} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <DismissSubmit refFn={(b) => void (submit.current = b)} />
    </form>
  );
}

function RowCheck({ what, className }: { what: string; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} title="Dismiss (E)" aria-label={`Dismiss: ${what}`} aria-keyshortcuts="E" className={className}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden>
        <path d="m3.5 8.5 3 3 6-7" />
      </svg>
    </button>
  );
}

/**
 * The check on a row of the card: the same action as the reader's Dismiss,
 * `from=row` keeping the member on the card. It goes with its row, so focus
 * moves to the row below rather than falling to the page.
 */
export function RowDismiss({ instance, what, next, className }: { instance: IssueInstance; what: string; next: string | null; className: string }) {
  const posted = useRef(false);
  const toNext = useRef(next);
  toNext.current = next;
  useEffect(
    () => () => {
      if (!posted.current) return;
      const row = toNext.current ? document.querySelector<HTMLElement>(rowSelector(toNext.current)) : null;
      (row ?? document.querySelector<HTMLElement>("[data-inbox-card]"))?.focus();
    },
    [],
  );
  return (
    <form action={dismissIssueAction} onSubmit={() => void (posted.current = true)} className="contents">
      <input type="hidden" name="issueKey" value={instance.key} />
      <input type="hidden" name="issueReason" value={instance.reason} />
      <input type="hidden" name="issueAt" value={instance.at} />
      <input type="hidden" name="from" value="row" />
      <RowCheck what={what} className={className} />
    </form>
  );
}

/** E over the card, with focus on a row. In the pop-up the reader's Dismiss has it, and with no row in focus it does nothing. */
export function RowKeys() {
  useKeys({
    e: onePress(() => {
      const submit = document.activeElement?.closest("[data-key-row]")?.querySelector<HTMLButtonElement>('form button[type="submit"]');
      if (submit && !submit.disabled) submit.click();
    }),
  });
  useKeyHelp("Inbox", [{ keys: "E", label: "Dismiss the row you're on, to Done" }]);
  return null;
}

function ZKey({ press }: { press: () => void }) {
  const { pending } = useFormStatus();
  useKeys({ z: onePress(press) }, !pending);
  useKeyHelp("Inbox", [{ keys: "Z", label: "Undo the dismiss" }]);
  return null;
}

function UndoSubmit({ refFn }: { refFn: (b: HTMLButtonElement | null) => void }) {
  const { pending } = useFormStatus();
  return (
    <button ref={refFn} type="submit" disabled={pending} aria-keyshortcuts="Z" className="inline-flex flex-none items-center gap-1.5 font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-60">
      Undo
      <Kbd decorative>Z</Kbd>
    </button>
  );
}

/** The toast's Undo after a dismiss. Z works for as long as the toast is up, wherever the member has gone. */
export function UndoToast({ id }: { id: string }) {
  const form = useRef<HTMLFormElement>(null);
  const submit = useRef<HTMLButtonElement | null>(null);
  return (
    <form ref={form} action={restoreIssueAction} className="flex-none">
      <ZKey press={() => void (submit.current && isShown(form.current) && form.current?.requestSubmit(submit.current))} />
      <input type="hidden" name="id" value={id} />
      <UndoSubmit refFn={(b) => void (submit.current = b)} />
    </form>
  );
}

function MoveBackSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cn(button, plain, "disabled:opacity-60")}>
      Move back to Inbox
    </button>
  );
}

export function MoveBackButton({ id }: { id: string }) {
  return (
    <form action={restoreIssueAction}>
      <input type="hidden" name="id" value={id} />
      <MoveBackSubmit />
    </form>
  );
}
