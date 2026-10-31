"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Kbd, useKeyHelp, useKeys } from "@/components/keys";
import type { ReadMark } from "@/lib/client/inbox-digest";
import type { IssueInstance } from "@/lib/client/inbox-issues";
import { rowSelector } from "@/lib/client/inbox-popup";
import { isShown, onePress } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { dismissIssueAction, markDigestReadAction, restoreIssueAction } from "./actions";
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
export function DismissButton({ instance, next, range }: { instance: IssueInstance; next: string | null; range: number }) {
  const form = useRef<HTMLFormElement>(null);
  const submit = useRef<HTMLButtonElement | null>(null);
  useKeyHelp("Inbox", [{ keys: "E", label: "Dismiss, to Done" }]);
  return (
    <form ref={form} action={dismissIssueAction}>
      <EKey press={() => void (submit.current && isShown(form.current) && form.current?.requestSubmit(submit.current))} />
      <input type="hidden" name="issueKey" value={instance.key} />
      <input type="hidden" name="issueReason" value={instance.reason} />
      <input type="hidden" name="issueAt" value={instance.at} />
      <input type="hidden" name="range" value={range} />
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

/** A row's check goes with its row, so focus moves to the row after it rather than falling to the page, and J carries on from there. */
function useFocusAfter(next: string | null): () => void {
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
  return () => void (posted.current = true);
}

/** The check on a line of what happened: the member's own read mark. */
function RowReadCheck({ what, className }: { what: string; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} title="Mark read (E)" aria-label={`Mark read: ${what}`} aria-keyshortcuts="E" className={className}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden>
        <path d="m3.5 8.5 3 3 6-7" />
      </svg>
    </button>
  );
}

export function RowMarkRead({ mark, what, next, range, className }: { mark: ReadMark; what: string; next: string | null; range: number; className: string }) {
  const posted = useFocusAfter(next);
  return (
    <form action={markDigestReadAction} onSubmit={posted} className="contents">
      <input type="hidden" name="markKey" value={mark.key} />
      <input type="hidden" name="markReason" value={mark.reason} />
      <input type="hidden" name="markAt" value={mark.at} />
      <input type="hidden" name="range" value={range} />
      <RowReadCheck what={what} className={className} />
    </form>
  );
}

/**
 * The check on a row of the card: the same action as the reader's Dismiss,
 * `from=row` keeping the member on the card.
 */
export function RowDismiss({ instance, what, next, range, className }: { instance: IssueInstance; what: string; next: string | null; range: number; className: string }) {
  const posted = useFocusAfter(next);
  return (
    <form action={dismissIssueAction} onSubmit={posted} className="contents">
      <input type="hidden" name="issueKey" value={instance.key} />
      <input type="hidden" name="issueReason" value={instance.reason} />
      <input type="hidden" name="issueAt" value={instance.at} />
      <input type="hidden" name="from" value="row" />
      <input type="hidden" name="range" value={range} />
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
  useKeyHelp("Inbox", [{ keys: "E", label: "Dismiss the row you're on, or mark it read" }]);
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
export function UndoToast({ id, range }: { id: string; range: number }) {
  const form = useRef<HTMLFormElement>(null);
  const submit = useRef<HTMLButtonElement | null>(null);
  return (
    <form ref={form} action={restoreIssueAction} className="flex-none">
      <ZKey press={() => void (submit.current && isShown(form.current) && form.current?.requestSubmit(submit.current))} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="range" value={range} />
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
