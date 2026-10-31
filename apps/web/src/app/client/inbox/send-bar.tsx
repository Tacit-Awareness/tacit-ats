"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Kbd, useKeyHelp, useKeys } from "@/components/keys";
import type { IssueFix, IssueInstance } from "@/lib/client/inbox-issues";
import { isShown } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { sendDraftAction } from "./actions";
import { button, plain, primary } from "./buttons";
import { Settled } from "./decision-bar";
import { DismissButton } from "./set-aside";

// Send here, on an unsent draft: F or the button only opens a native modal
// <dialog> showing the stored draft in full, and Send in it, or ⌘↵, is the
// send. Esc, Cancel or the backdrop back out, and the dialog opens on Cancel,
// so a second Enter can't send. With no mailer on this deployment the button is
// off and the card says why. Same dialog rules as decision-bar.tsx. Dismiss (E)
// is here as on the other bars: a draft that can't go out can still be set aside.

export type SendProps = { to: string; subject: string; body: string; from: string | null; replyTo: string | null };

function Buttons({ cancel, cancelRef }: { cancel: () => void; cancelRef: React.Ref<HTMLButtonElement> }) {
  const { pending } = useFormStatus();
  return (
    <div className="mt-4 flex items-center justify-end gap-1.5">
      <span className="mr-auto hidden text-[12px] text-faint sm:inline">⌘↵ to send</span>
      <button ref={cancelRef} type="button" onClick={cancel} disabled={pending} className={cn(button, plain)}>
        Cancel
        <Kbd decorative>esc</Kbd>
      </button>
      <button type="submit" disabled={pending} className={cn(button, primary)}>
        {pending ? "Sending…" : "Send"}
      </button>
    </div>
  );
}

function SendDialog({ draftId, draft, instance, next, range, close }: { draftId: string; draft: SendProps; instance: IssueInstance; next: string | null; range: number; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    cancel.current?.focus();
  }, []);

  const dismiss = () => {
    if (!busy.current) dialog.current?.close();
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="send-title"
      onClose={close}
      onCancel={(e) => {
        // Esc mid-post would hide a send that is still happening.
        if (busy.current) e.preventDefault();
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy.current) {
          e.preventDefault();
          form.current?.requestSubmit();
        }
      }}
      className="m-auto w-[min(560px,calc(100vw-32px))] border border-[color:var(--line-strong)] bg-raised p-0 text-foreground shadow-[var(--pop-shadow)] backdrop:bg-[color:var(--scrim)]"
    >
      <form ref={form} action={sendDraftAction} className="p-4">
        <Settled busy={busy} done={close} />
        <input type="hidden" name="draftId" value={draftId} />
        <input type="hidden" name="issueReason" value={instance.reason} />
        <input type="hidden" name="issueAt" value={instance.at} />
        <input type="hidden" name="range" value={range} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <h2 id="send-title" className="m-0 text-[15px] font-semibold break-words">
          Send this to {draft.to}?
        </h2>
        <p className="m-0 mt-1 text-[13px] text-muted-foreground">It goes out exactly as written, and can&apos;t be called back.</p>
        <div className="mt-3 grid max-h-[calc(50*var(--vh))] gap-2 overflow-y-auto bg-[color:var(--soft)] px-3 py-2">
          <dl className="m-0 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[13px]">
            {draft.from ? (
              <>
                <dt className="text-muted-foreground">From</dt>
                <dd className="m-0 min-w-0 break-words">{draft.from}</dd>
              </>
            ) : null}
            {draft.replyTo ? (
              <>
                <dt className="text-muted-foreground">Replies</dt>
                <dd className="m-0 min-w-0 break-words">{draft.replyTo}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">To</dt>
            <dd className="m-0 min-w-0 break-words">{draft.to}</dd>
            <dt className="text-muted-foreground">Subject</dt>
            <dd className="m-0 min-w-0 break-words">{draft.subject}</dd>
          </dl>
          <p className="m-0 border-t border-[color:var(--line)] pt-2 text-[13px] break-words whitespace-pre-wrap">{draft.body}</p>
        </div>
        <Buttons cancel={dismiss} cancelRef={cancel} />
      </form>
    </dialog>
  );
}

export function SendBar({
  fix,
  draft,
  instance,
  next,
  range,
  secondary,
}: {
  fix: Extract<IssueFix, { type: "send" }>;
  draft: SendProps;
  instance: IssueInstance;
  next: string | null;
  range: number;
  secondary: { label: string; href: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  useKeys({ f: () => void (isShown(bar.current) && setOpen(true)) }, fix.canSend && !open);
  useKeyHelp("Inbox", fix.canSend ? [{ keys: "F", label: `${fix.label}, after you confirm` }] : []);
  return (
    <div ref={bar} data-tour="inbox-keys" className="mt-4 flex flex-wrap items-center gap-1.5">
      <button type="button" disabled={!fix.canSend} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-keyshortcuts={fix.canSend ? "F" : undefined} className={cn(button, primary, !fix.canSend && "cursor-not-allowed")}>
        {fix.label}
        {fix.canSend ? (
          <Kbd decorative className="border-transparent bg-current/20 text-current">
            F
          </Kbd>
        ) : null}
      </button>
      <DismissButton instance={instance} next={next} range={range} />
      {secondary ? (
        <Link href={secondary.href} className={cn(button, plain)}>
          {secondary.label}
        </Link>
      ) : null}
      {open ? <SendDialog draftId={fix.draftId} draft={draft} instance={instance} next={next} range={range} close={() => setOpen(false)} /> : null}
    </div>
  );
}
