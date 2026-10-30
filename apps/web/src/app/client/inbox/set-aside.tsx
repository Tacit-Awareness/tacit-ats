"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { Kbd, useKeyHelp, useKeys } from "@/components/keys";
import { Notice } from "@/components/page";
import type { IssueInstance } from "@/lib/client/inbox-issues";
import { isShown } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { dismissIssueAction, restoreIssueAction } from "./actions";
import { button, plain } from "./fix-bar";

// Setting an issue aside (design/tats's E, `ibDone`) and getting it back. E
// isn't confirmed, as the prototype: it changes only this member's queue, and
// Undo (or Z, or Move back to Inbox on Done) brings it straight back. A key
// checks isShown first: on a phone's list the reader is mounted but hidden, and
// an unseen issue is never written.

function EKey({ press }: { press: () => void }) {
  const { pending } = useFormStatus();
  useKeys({ e: press }, !pending);
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

function ZKey({ press }: { press: () => void }) {
  const { pending } = useFormStatus();
  useKeys({ z: press }, !pending);
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

/** The notice after E. The form goes round the Notice: a `<p>` can't hold one. */
export function UndoNotice({ id, children }: { id: string; children: React.ReactNode }) {
  const form = useRef<HTMLFormElement>(null);
  const submit = useRef<HTMLButtonElement | null>(null);
  return (
    <form ref={form} action={restoreIssueAction}>
      <ZKey press={() => void (submit.current && isShown(form.current) && form.current?.requestSubmit(submit.current))} />
      <input type="hidden" name="id" value={id} />
      <Notice className="flex items-center justify-between gap-3">
        <span>{children}</span>
        <UndoSubmit refFn={(b) => void (submit.current = b)} />
      </Notice>
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
