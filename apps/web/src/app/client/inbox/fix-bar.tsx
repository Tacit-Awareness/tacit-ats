"use client";

import Link from "next/link";
import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { Kbd, useKeyHelp, useKeys } from "@/components/keys";
import type { IssueFix } from "@/lib/client/inbox-issues";
import { cn } from "@/lib/utils";
import { fixIssueAction } from "./actions";

// The reader's buttons (design/tats's `.kb-bar`, a label then its key): the
// one thing that deals with this issue, on F (the same link or the same form
// post), and the candidate's page. A decision has its own bar (decision-bar.tsx:
// A, O, R, as design/tats, which has no F there). design/tats's E (Dismiss) is
// left out: nothing stores one. Its "Ask Grokbot" needs the bot.

export const button = "inline-flex h-7 items-center gap-2 rounded-2xl border px-3 text-[13px] font-medium whitespace-nowrap transition-colors";
export const primary = "border-[color:var(--accent)] bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:brightness-106 disabled:opacity-60";
export const plain = "border-[color:var(--line-strong)] text-foreground hover:bg-[color:var(--hover)]";

const Key = () => (
  <Kbd decorative className="border-transparent bg-white/20 text-current">
    F
  </Kbd>
);

/** Inside the form, so the key does nothing while the write is in flight. */
function FixKey({ press, label }: { press: () => void; label: string }) {
  const { pending } = useFormStatus();
  useKeys({ f: press }, !pending);
  useKeyHelp("Inbox", [{ keys: "F", label }]);
  return null;
}

function Submit({ label, refFn }: { label: string; refFn: (b: HTMLButtonElement | null) => void }) {
  const { pending } = useFormStatus();
  return (
    <button ref={refFn} type="submit" disabled={pending} aria-keyshortcuts="F" className={cn(button, primary)}>
      {label}
      <Key />
    </button>
  );
}

function LinkFix({ fix }: { fix: Extract<IssueFix, { type: "link" }> }) {
  const link = useRef<HTMLAnchorElement>(null);
  useKeys({ f: () => link.current?.click() });
  useKeyHelp("Inbox", [{ keys: "F", label: fix.label }]);
  return (
    <Link ref={link} href={fix.href} aria-keyshortcuts="F" className={cn(button, primary)}>
      {fix.label}
      <Key />
    </Link>
  );
}

function WriteFix({ fix, next }: { fix: Extract<IssueFix, { type: "write" }>; next: string | null }) {
  const form = useRef<HTMLFormElement>(null);
  const submit = useRef<HTMLButtonElement | null>(null);
  return (
    <form ref={form} action={fixIssueAction}>
      <FixKey press={() => submit.current && form.current?.requestSubmit(submit.current)} label={fix.label} />
      <input type="hidden" name="applicationId" value={fix.applicationId} />
      <input type="hidden" name="write" value={fix.write} />
      {fix.nextAction !== null ? <input type="hidden" name="expected" value={fix.nextAction} /> : null}
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Submit label={fix.label} refFn={(b) => void (submit.current = b)} />
    </form>
  );
}

export function FixBar({ fix, next, secondary }: { fix: Extract<IssueFix, { type: "link" | "write" }>; next: string | null; secondary: { label: string; href: string } | null }) {
  return (
    <div data-tour="inbox-keys" className="mt-4 flex flex-wrap items-center gap-1.5">
      {fix.type === "link" ? <LinkFix fix={fix} /> : <WriteFix fix={fix} next={next} />}
      {secondary ? (
        <Link href={secondary.href} className={cn(button, plain)}>
          {secondary.label}
        </Link>
      ) : null}
    </div>
  );
}
