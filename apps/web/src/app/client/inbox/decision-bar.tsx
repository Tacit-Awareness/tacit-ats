"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useKeyHelp, useKeys } from "@/components/keys";
import { Kbd } from "@/components/page";
import { selectClass } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ConfirmCopy, ConfirmMode, DecisionAction, DecisionProps, TermLine } from "@/lib/client/inbox-decisions";
import type { IssueInstance } from "@/lib/client/inbox-issues";
import { isShown } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { decideIssueAction } from "./actions";
import { button, danger, plain, primary } from "./buttons";
import { CmdEnter } from "./keycaps";
import { DismissButton } from "./set-aside";

// A decision in the reader, on design/tats's keys: on an approval A approves
// and R rejects; on the team's call A is Next round (the Calendar's Find a
// time, on them and their next step: next-round-rules.ts), O moves to
// offer and R rejects. Nothing is written until the dialog is confirmed, by
// its button or ⌘↵, and Esc backs out: a key only opens it. The dialog is a
// native <dialog>, modal, so keys.ts's ignoreKey stops every page and shell key
// behind it. It posts decideIssueAction and closes when the post settles, so
// an error reads on the page and a second press finds no form. The dialog is
// Testbench's: 16px corners on the box surface, a Mona Sans title, the buttons
// right over a hairline, ⌘↵ inside the button it presses.

/** Testbench's dialog, shared with send-bar.tsx's. */
export const dialogClass = "m-auto rounded-[16px] border-0 bg-[color:var(--surface)] p-0 text-foreground shadow-[var(--box-shadow)] backdrop:bg-[color:var(--scrim)]";
export const dialogTitle = "m-0 font-sans text-[20px] leading-[26px] font-semibold tracking-[-0.01em] break-words";
export const dialogFoot = "flex items-center justify-end gap-2 border-t border-[color:var(--line)] px-6 py-4";
const fieldLabel = "grid gap-1.5 text-[12.5px] text-muted-foreground";

/** An offer's terms, as text. For the approver: readIssue fetches them for the issue open, and they go nowhere else. */
export function OfferTerms({ lines }: { lines: TermLine[] }) {
  if (!lines.length) return <p className="m-0 text-[13px] text-muted-foreground">No terms on this offer yet.</p>;
  return (
    <dl className="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
      {lines.map((l) => (
        <div key={l.label} className="contents">
          <dt className="text-faint">{l.label}</dt>
          <dd className="m-0 min-w-0 break-words">{l.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Inside the form, for its pending state: tells the dialog when the post has settled. */
export function Settled({ busy, done }: { busy: React.RefObject<boolean>; done: () => void }) {
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
    <div className={dialogFoot}>
      <button type="button" onClick={cancel} disabled={pending} className={cn(button, plain)}>
        Cancel
        <Kbd>
          esc
        </Kbd>
      </button>
      <button ref={confirmRef} type="submit" disabled={pending || blocked} data-off={blocked ? "" : undefined} title="⌘↵ confirms" className={cn(button, copy.danger ? danger : primary)}>
        {copy.confirm}
        <Kbd className="max-sm:hidden">
          <CmdEnter />
        </Kbd>
      </button>
    </div>
  );
}

function Fields({ mode, decision, firstField }: { mode: ConfirmMode; decision: DecisionProps; firstField: React.Ref<HTMLSelectElement & HTMLTextAreaElement> }) {
  const { pending } = useFormStatus();
  if (mode === "offer") return null;
  if (mode === "close") {
    return (
      <div className="mt-5 grid gap-4">
        {decision.reasons.length ? (
          <label className={fieldLabel}>
            Reason
            <select ref={firstField} name="reasonId" required defaultValue="" disabled={pending} className={cn(selectClass, "text-foreground")}>
              <option value="" disabled>
                Pick a reason…
              </option>
              {decision.reasons.map((r) => (
                <option key={r.reasonId} value={r.reasonId}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="m-0 text-[13px] text-[color:var(--red)]">Your company has no rejection reasons yet, so this can&apos;t be closed.</p>
        )}
        <label className={fieldLabel}>
          Note, kept on the application (optional)
          <Textarea name="note" rows={2} maxLength={decision.textMax} disabled={pending} className="text-foreground" />
        </label>
      </div>
    );
  }
  const required = mode === "reject";
  return (
    <label className={cn(fieldLabel, "mt-5")}>
      {required ? "Reason" : "Comment (optional)"}
      <Textarea ref={required ? firstField : undefined} name="reason" rows={3} required={required} maxLength={decision.textMax} disabled={pending} className="text-foreground" />
    </label>
  );
}

function ConfirmDialog({
  mode,
  copy,
  decision,
  instance,
  terms,
  next,
  range,
  close,
}: {
  mode: ConfirmMode;
  copy: ConfirmCopy;
  decision: DecisionProps;
  instance: IssueInstance;
  terms: TermLine[] | null;
  next: string | null;
  range: number;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLSelectElement & HTMLTextAreaElement>(null);
  const busy = useRef(false);
  const blocked = mode === "close" && !decision.reasons.length;

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    // Where the answer goes: the field a rejection needs, else the confirm button.
    (first.current ?? (blocked ? null : confirm.current))?.focus();
  }, [blocked]);

  const dismiss = () => {
    if (!busy.current) dialog.current?.close();
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="decision-title"
      onClose={close}
      onCancel={(e) => {
        // Esc mid-post would hide a write that is still happening.
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
      className={cn(dialogClass, "w-[min(460px,calc(100vw-32px))]")}
    >
      <form ref={form} action={decideIssueAction}>
        <Settled busy={busy} done={close} />
        <input type="hidden" name={decision.target.name} value={decision.target.value} />
        <input type="hidden" name="decision" value={mode} />
        <input type="hidden" name="issueReason" value={instance.reason} />
        <input type="hidden" name="issueAt" value={instance.at} />
        <input type="hidden" name="range" value={range} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <div className="p-6">
          <h2 id="decision-title" className={dialogTitle}>
            {copy.title}
          </h2>
          <p className="m-0 mt-2 text-[13px] break-words text-muted-foreground">{copy.body}</p>
          {terms ? (
            <div className="mt-4 rounded-[10px] bg-[color:var(--soft)] px-3.5 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
              <OfferTerms lines={terms} />
            </div>
          ) : null}
          <Fields mode={mode} decision={decision} firstField={first} />
        </div>
        <Buttons copy={copy} blocked={blocked} cancel={dismiss} confirmRef={confirm} />
      </form>
    </dialog>
  );
}

function KeyCap({ action }: { action: DecisionAction }) {
  return (
    <Kbd>
      {action.key.toUpperCase()}
    </Kbd>
  );
}

export function DecisionBar({
  decision,
  instance,
  terms,
  next,
  range,
  secondary,
  hint,
}: {
  decision: DecisionProps;
  instance: IssueInstance;
  terms: TermLine[] | null;
  next: string | null;
  range: number;
  secondary: { label: string; href: string } | null;
  /** How the primary action deals with it ("Next round finds a time …"), for its hover. */
  hint?: string;
}) {
  const [open, setOpen] = useState<Extract<DecisionAction, { mode: ConfirmMode }> | null>(null);
  const link = useRef<HTMLAnchorElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const press = (a: DecisionAction) => ("href" in a ? link.current?.click() : setOpen(a));
  useKeys(Object.fromEntries(decision.actions.map((a) => [a.key, () => void (isShown(bar.current) && press(a))])), open === null);
  useKeyHelp(
    "Inbox",
    decision.actions.map((a) => ({ keys: a.key.toUpperCase(), label: "href" in a ? a.label : `${a.label}, after you confirm` })),
  );
  return (
    <div ref={bar} data-tour="inbox-keys" className="flex flex-wrap items-center gap-2">
      {decision.actions.map((a) =>
        "href" in a ? (
          <Link key={a.key} ref={link} href={a.href} aria-keyshortcuts={a.key.toUpperCase()} title={a.primary ? hint : undefined} className={cn(button, a.primary ? primary : plain)}>
            {a.label}
            <KeyCap action={a} />
          </Link>
        ) : (
          <button key={a.key} type="button" onClick={() => press(a)} aria-haspopup="dialog" aria-keyshortcuts={a.key.toUpperCase()} title={a.primary ? hint : undefined} className={cn(button, a.primary ? primary : plain)}>
            {a.label}
            <KeyCap action={a} />
          </button>
        ),
      )}
      <DismissButton instance={instance} next={next} range={range} />
      {secondary ? (
        <Link href={secondary.href} className={cn(button, plain)}>
          {secondary.label}
        </Link>
      ) : null}
      {open ? <ConfirmDialog mode={open.mode} copy={open.copy} decision={decision} instance={instance} terms={terms} next={next} range={range} close={() => setOpen(null)} /> : null}
    </div>
  );
}
