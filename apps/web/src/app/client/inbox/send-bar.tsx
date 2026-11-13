"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useKeyHelp, useKeys } from "@/components/keys";
import { Kbd } from "@/components/page";
import type { IssueFix, IssueInstance } from "@/lib/client/inbox-issues";
import { isShown } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { sendDraftAction } from "./actions";
import { button, plain, primary } from "./buttons";
import { Settled, dialogClass, dialogFoot, dialogTitle } from "./decision-bar";
import { CmdEnter } from "./keycaps";
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
    <div className={dialogFoot}>
      <button ref={cancelRef} type="button" onClick={cancel} disabled={pending} className={cn(button, plain)}>
        Cancel
        <Kbd>
          esc
        </Kbd>
      </button>
      <button type="submit" disabled={pending} title="⌘↵ sends" className={cn(button, primary)}>
        {pending ? "Sending…" : "Send"}
        <Kbd className="max-sm:hidden">
          <CmdEnter />
        </Kbd>
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
      className={cn(dialogClass, "w-[min(560px,calc(100vw-32px))]")}
    >
      <form ref={form} action={sendDraftAction}>
        <Settled busy={busy} done={close} />
        <input type="hidden" name="draftId" value={draftId} />
        <input type="hidden" name="issueReason" value={instance.reason} />
        <input type="hidden" name="issueAt" value={instance.at} />
        <input type="hidden" name="range" value={range} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <div className="p-6">
          <h2 id="send-title" className={dialogTitle}>
            Send this to {draft.to}?
          </h2>
          <p className="m-0 mt-2 text-[13px] text-muted-foreground">It goes out exactly as written, and can&apos;t be called back.</p>
          <div className="mt-4 grid max-h-[50vh] gap-2.5 overflow-y-auto rounded-[10px] bg-[color:var(--soft)] px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--line)]">
            <dl className="m-0 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[13px]">
              {draft.from ? (
                <>
                  <dt className="text-faint">From</dt>
                  <dd className="m-0 min-w-0 break-words">{draft.from}</dd>
                </>
              ) : null}
              {draft.replyTo ? (
                <>
                  <dt className="text-faint">Replies</dt>
                  <dd className="m-0 min-w-0 break-words">{draft.replyTo}</dd>
                </>
              ) : null}
              <dt className="text-faint">To</dt>
              <dd className="m-0 min-w-0 break-words">{draft.to}</dd>
              <dt className="text-faint">Subject</dt>
              <dd className="m-0 min-w-0 break-words">{draft.subject}</dd>
            </dl>
            <p className="m-0 border-t border-[color:var(--line)] pt-2.5 font-sans text-[14px] leading-[22px] break-words whitespace-pre-wrap">{draft.body}</p>
          </div>
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
  hint,
}: {
  fix: Extract<IssueFix, { type: "send" }>;
  draft: SendProps;
  instance: IssueInstance;
  next: string | null;
  range: number;
  secondary: { label: string; href: string } | null;
  /** What Send here does ("It only goes out after you confirm"), for its hover. */
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  useKeys({ f: () => void (isShown(bar.current) && setOpen(true)) }, fix.canSend && !open);
  useKeyHelp("Inbox", fix.canSend ? [{ keys: "F", label: `${fix.label}, after you confirm` }] : []);
  return (
    <div ref={bar} data-tour="inbox-keys" className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={!fix.canSend} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-keyshortcuts={fix.canSend ? "F" : undefined} title={hint} className={cn(button, primary, !fix.canSend && "cursor-not-allowed")}>
        {fix.label}
        {fix.canSend ? (
          <Kbd>
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
