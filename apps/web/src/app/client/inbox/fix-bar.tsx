"use client";

import Link from "next/link";
import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { Kbd, useKeyHelp, useKeys } from "@/components/keys";
import type { IssueFix, IssueInstance } from "@/lib/client/inbox-issues";
import { isShown, onePress } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { fixIssueAction } from "./actions";
import { button, plain, primary } from "./buttons";
import { DismissButton } from "./set-aside";

// The reader's buttons (design/tats's `.kb-bar`, a label then its key): the
// one thing that deals with this issue, on F (the same link or the same form
// post), Dismiss on E (set-aside.tsx), and the candidate's page. A decision has
// its own bar (decision-bar.tsx: A, O, R, as design/tats, which has no F there).
// design/tats's "Ask Grokbot" needs the bot.

const Key = () => (
  <Kbd decorative className="border-transparent bg-current/20 text-current">
    F
  </Kbd>
);

/** Inside the form, so the key does nothing while the write is in flight. */
function FixKey({ press, label }: { press: () => void; label: string }) {
  const { pending } = useFormStatus();
  useKeys({ f: onePress(press) }, !pending);
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
  useKeys({ f: () => void (isShown(link.current) && link.current?.click()) });
  useKeyHelp("Inbox", [{ keys: "F", label: fix.label }]);
  return (
    <Link ref={link} href={fix.href} aria-keyshortcuts="F" className={cn(button, primary)}>
      {fix.label}
      <Key />
    </Link>
  );
}

function WriteFix({ fix, instance, next, range }: { fix: Extract<IssueFix, { type: "write" }>; instance: IssueInstance; next: string | null; range: number }) {
  const form = useRef<HTMLFormElement>(null);
  const submit = useRef<HTMLButtonElement | null>(null);
  return (
    <form ref={form} action={fixIssueAction}>
      <FixKey press={() => void (submit.current && isShown(form.current) && form.current?.requestSubmit(submit.current))} label={fix.label} />
      <input type="hidden" name="applicationId" value={fix.applicationId} />
      <input type="hidden" name="write" value={fix.write} />
      <input type="hidden" name="issueReason" value={instance.reason} />
      <input type="hidden" name="issueAt" value={instance.at} />
      <input type="hidden" name="range" value={range} />
      {fix.nextAction !== null ? <input type="hidden" name="expected" value={fix.nextAction} /> : null}
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Submit label={fix.label} refFn={(b) => void (submit.current = b)} />
    </form>
  );
}

export function FixBar({
  fix,
  instance,
  next,
  range,
  secondary,
}: {
  fix: Extract<IssueFix, { type: "link" | "write" }>;
  instance: IssueInstance;
  next: string | null;
  range: number;
  secondary: { label: string; href: string } | null;
}) {
  return (
    <div data-tour="inbox-keys" className="mt-4 flex flex-wrap items-center gap-1.5">
      {fix.type === "link" ? <LinkFix fix={fix} /> : <WriteFix fix={fix} instance={instance} next={next} range={range} />}
      <DismissButton instance={instance} next={next} range={range} />
      {secondary ? (
        <Link href={secondary.href} className={cn(button, plain)}>
          {secondary.label}
        </Link>
      ) : null}
    </div>
  );
}
