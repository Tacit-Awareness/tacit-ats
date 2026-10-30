"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Kbd, useKeyHelp, useKeys } from "@/components/keys";
import type { ConfirmCopy, ConfirmMode, DecisionAction, DecisionProps, TermLine } from "@/lib/client/inbox-decisions";
import { isShown } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { decideIssueAction } from "./actions";
import { ConfirmDialog } from "./confirm-dialog";
import { button, plain, primary } from "./fix-bar";

// A decision in the reader, on design/tats's keys: on an approval A approves
// and R rejects; on the team's call A is Next round (their page), O moves to
// offer and R rejects. Nothing is written until the dialog is confirmed
// (confirm-dialog.tsx): a key only opens it. It posts decideIssueAction.

const field =
  "w-full rounded-lg border border-[color:var(--line-strong)] bg-transparent px-2.5 py-1.5 text-[13px] text-foreground outline-none focus-visible:border-[color:var(--accent)] disabled:opacity-60";

/** An offer's terms, as text. For the approver: readIssue fetches them for the issue open, and they go nowhere else. */
export function OfferTerms({ lines }: { lines: TermLine[] }) {
  if (!lines.length) return <p className="m-0 text-[13px] text-muted-foreground">No terms on this offer yet.</p>;
  return (
    <dl className="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
      {lines.map((l) => (
        <div key={l.label} className="contents">
          <dt className="text-muted-foreground">{l.label}</dt>
          <dd className="m-0 min-w-0 break-words">{l.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Fields({ mode, decision, firstField }: { mode: ConfirmMode; decision: DecisionProps; firstField: React.Ref<HTMLSelectElement & HTMLTextAreaElement> }) {
  const { pending } = useFormStatus();
  if (mode === "offer") return null;
  if (mode === "close") {
    return (
      <div className="mt-3 grid gap-2">
        {decision.reasons.length ? (
          <label className="grid gap-1 text-[12.5px] text-muted-foreground">
            Reason
            <select ref={firstField} name="reasonId" required defaultValue="" disabled={pending} className={field}>
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
        <label className="grid gap-1 text-[12.5px] text-muted-foreground">
          Note, kept on the application (optional)
          <textarea name="note" rows={2} maxLength={decision.textMax} disabled={pending} className={field} />
        </label>
      </div>
    );
  }
  const required = mode === "reject";
  return (
    <label className="mt-3 grid gap-1 text-[12.5px] text-muted-foreground">
      {required ? "Reason" : "Comment (optional)"}
      <textarea ref={required ? firstField : undefined} name="reason" rows={3} required={required} maxLength={decision.textMax} disabled={pending} className={field} />
    </label>
  );
}

function DecisionDialog({
  mode,
  copy,
  decision,
  terms,
  next,
  close,
}: {
  mode: ConfirmMode;
  copy: ConfirmCopy;
  decision: DecisionProps;
  terms: TermLine[] | null;
  next: string | null;
  close: () => void;
}) {
  const first = useRef<HTMLSelectElement & HTMLTextAreaElement>(null);
  return (
    <ConfirmDialog action={decideIssueAction} copy={copy} blocked={mode === "close" && !decision.reasons.length} first={first} close={close}>
      <input type="hidden" name={decision.target.name} value={decision.target.value} />
      <input type="hidden" name="decision" value={mode} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {terms ? (
        <div className="mt-3 rounded-lg bg-[color:var(--soft)] px-3 py-2">
          <OfferTerms lines={terms} />
        </div>
      ) : null}
      <Fields mode={mode} decision={decision} firstField={first} />
    </ConfirmDialog>
  );
}

function KeyCap({ action }: { action: DecisionAction }) {
  return (
    <Kbd decorative className={action.primary ? "border-transparent bg-white/20 text-current" : undefined}>
      {action.key.toUpperCase()}
    </Kbd>
  );
}

export function DecisionBar({
  decision,
  terms,
  next,
  secondary,
}: {
  decision: DecisionProps;
  terms: TermLine[] | null;
  next: string | null;
  secondary: { label: string; href: string } | null;
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
    <div ref={bar} data-tour="inbox-keys" className="mt-4 flex flex-wrap items-center gap-1.5">
      {decision.actions.map((a) =>
        "href" in a ? (
          <Link key={a.key} ref={link} href={a.href} aria-keyshortcuts={a.key.toUpperCase()} className={cn(button, a.primary ? primary : plain)}>
            {a.label}
            <KeyCap action={a} />
          </Link>
        ) : (
          <button key={a.key} type="button" onClick={() => press(a)} aria-haspopup="dialog" aria-keyshortcuts={a.key.toUpperCase()} className={cn(button, a.primary ? primary : plain)}>
            {a.label}
            <KeyCap action={a} />
          </button>
        ),
      )}
      {secondary ? (
        <Link href={secondary.href} className={cn(button, plain)}>
          {secondary.label}
        </Link>
      ) : null}
      {open ? <DecisionDialog mode={open.mode} copy={open.copy} decision={decision} terms={terms} next={next} close={() => setOpen(null)} /> : null}
    </div>
  );
}
