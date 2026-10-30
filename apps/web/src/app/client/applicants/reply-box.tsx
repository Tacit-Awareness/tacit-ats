"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Kbd, useKeyHelp, useKeys } from "@/components/keys";
import { Notice } from "@/components/page";
import type { DraftSender, ShownDraft } from "@/lib/client/email";
import { isShown } from "@/lib/keys";
import { REPLY_KINDS, type ReplyKind, type ReplyStarters } from "@/lib/client/reply-starters";
import { cn } from "@/lib/utils";
import { draftReplyAction, sendReplyAction } from "./actions";
import { pill, pillPrimary } from "./routing-bar";

// design/tats's `.composer2`, above the routing bar: a reply to the applicant,
// always in two steps. "Review draft" writes a draft and sends nothing; the
// page then shows that stored draft, From, To, subject and body, and only the
// Send button under it sends it. Send has no key, on purpose. Changing a draft
// writes a new one: the database never changes a draft, so the old one stays
// unsent, and the Inbox stops offering it (inbox-issues.ts's currentDrafts).
// With no mailer, or no address, the box says so and offers nothing. Replying
// moves nobody: the routing bar under it still does that, and design/tats's
// one button for both is split because a reply can be refused while a route
// lands, and the reverse.

export type Reply = {
  applicationId: string;
  candidateId: string;
  /** Whom it would go to, for the composer; the draft says for certain. */
  to: string | null;
  /** False with no mailer on this deployment. */
  enabled: boolean;
  draft: ShownDraft | null;
  sender: DraftSender | null;
  /** The words of a draft that failed to send, to write again. */
  failed: { subject: string; body: string } | null;
  sent: { when: string; subject: string; by: string } | null;
  starters: ReplyStarters;
  subjectMax: number;
  bodyMax: number;
};

const LABEL: Record<ReplyKind, string> = { interview: "Interview", decline: "Decline", blank: "Blank" };

const field =
  "w-full rounded-lg border border-[color:var(--line)] bg-[color:var(--paper)] px-3 text-[13.5px] outline-none transition-colors placeholder:text-faint focus-visible:border-[color:var(--line-strong)]";

const shell = "grid gap-2 border-t border-[color:var(--line)] bg-[color:var(--paper)] px-[18px] py-3";

function DraftSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} title="Review draft (⌘↵)" className={cn(pill, pillPrimary)}>
      {pending ? "Writing…" : "Review draft"}
      <Kbd decorative className="border-transparent bg-white/20 text-current">
        ⌘↵
      </Kbd>
    </button>
  );
}

function SendSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cn(pill, pillPrimary)}>
      {pending ? "Sending…" : "Send"}
    </button>
  );
}

/** The stored draft, exactly what Send delivers. */
function DraftReview({ reply, draft, sent, change }: { reply: Reply; draft: ShownDraft; sent: ReactNode; change: () => void }) {
  return (
    <section aria-label="Draft reply" className={shell}>
      {sent}
      <p className="m-0 text-[12.5px] text-muted-foreground">Draft. Nothing has gone out: read it, then Send.</p>
      <div className="grid max-h-[45vh] gap-2 overflow-y-auto rounded-lg border border-[color:var(--line)] px-3 py-2.5">
        <dl className="m-0 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[13px]">
          {reply.sender ? (
            <>
              <dt className="text-muted-foreground">From</dt>
              <dd className="m-0 min-w-0 break-words">{reply.sender.from}</dd>
              <dt className="text-muted-foreground">Replies</dt>
              <dd className="m-0 min-w-0 break-words">{reply.sender.replyTo}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">To</dt>
          <dd className="m-0 min-w-0 break-words">{draft.to}</dd>
          <dt className="text-muted-foreground">Subject</dt>
          <dd className="m-0 min-w-0 break-words">{draft.subject}</dd>
        </dl>
        <p className="m-0 border-t border-[color:var(--line)] pt-2 text-[13.5px] leading-[1.55] break-words whitespace-pre-wrap">{draft.body}</p>
      </div>
      <form action={sendReplyAction} className="flex flex-wrap items-center gap-1.5">
        <input type="hidden" name="draftId" value={draft.draftId} />
        <input type="hidden" name="applicationId" value={reply.applicationId} />
        <SendSubmit />
        <button type="button" onClick={change} className={pill}>
          Change it
        </button>
      </form>
    </section>
  );
}

export function ReplyBox({ reply }: { reply: Reply }) {
  const { enabled, to, draft, failed, starters } = reply;
  // A failed send comes back open, on its own words.
  const [open, setOpen] = useState(failed !== null);
  const [changing, setChanging] = useState(false);
  const [kind, setKind] = useState<ReplyKind>("interview");
  const [subject, setSubject] = useState(failed?.subject ?? starters.subject);
  const [bodies, setBodies] = useState(starters.bodies);
  // Their own words, a failed send's or the draft being changed: no starter then.
  const [mine, setMine] = useState(failed?.body ?? null);
  const [state, action, pending] = useActionState(draftReplyAction, {});
  const box = useRef<HTMLElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const body = mine ?? bodies[kind];
  const canWrite = enabled && to !== null && !draft;
  const start = () => {
    if (isShown(box.current)) setOpen(true);
  };
  useKeys({ r: start }, canWrite && !open);
  useKeyHelp("Applicant Tickets", canWrite ? [{ keys: "R", label: "Write a reply" }, { keys: "⌘↵", label: "Review the draft" }] : []);

  useEffect(() => {
    if (open) area.current?.focus();
  }, [open, changing]);

  const sent = reply.sent ? (
    <p className="m-0 text-[12.5px] break-words text-muted-foreground">
      {reply.sent.by} emailed them {reply.sent.when}: {reply.sent.subject}
    </p>
  ) : null;

  if (!enabled || to === null) {
    return (
      <section ref={box} aria-label="Reply" className={shell}>
        {sent}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled className={cn(pill, "cursor-not-allowed")}>
            Reply
          </button>
          <span role="status" className="text-[12.5px] text-muted-foreground">
            {enabled ? "No email address on file, so there's nobody to reply to." : "Email isn't set up on this deployment, so replies can't go out from here."}
          </span>
        </div>
      </section>
    );
  }

  if (draft && !changing) {
    const change = () => {
      setSubject(draft.subject);
      setMine(draft.body);
      setChanging(true);
      setOpen(true);
    };
    return <DraftReview reply={reply} draft={draft} sent={sent} change={change} />;
  }

  if (!open) {
    return (
      <section ref={box} aria-label="Reply" className={shell}>
        {sent}
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={start} aria-keyshortcuts="R" className={pill}>
            Reply
            <Kbd decorative>R</Kbd>
          </button>
          <span className="truncate text-[13px] text-muted-foreground">To {to}. Nothing goes out until you read the draft and press Send.</span>
        </div>
      </section>
    );
  }

  return (
    <section ref={box} aria-label="Reply" className={shell}>
      {sent}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <form
        action={action}
        className="grid gap-2"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !changing) setOpen(false);
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !pending) {
            e.preventDefault();
            e.currentTarget.requestSubmit();
          }
        }}
      >
        <input type="hidden" name="applicationId" value={reply.applicationId} />
        <input type="hidden" name="candidateId" value={reply.candidateId} />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="min-w-0 truncate text-[13px] text-muted-foreground">To {to}</span>
          {mine === null ? (
            <span role="group" aria-label="Start from" className="ml-auto flex items-center gap-1">
              {REPLY_KINDS.map((k) => (
                <button key={k} type="button" aria-pressed={k === kind} onClick={() => setKind(k)} className={cn(pill, k === kind && "bg-[color:var(--sel)]")}>
                  {LABEL[k]}
                </button>
              ))}
            </span>
          ) : null}
        </div>
        <label className="sr-only" htmlFor="reply-subject">
          Subject
        </label>
        <input id="reply-subject" name="subject" required maxLength={reply.subjectMax} value={subject} readOnly={pending} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className={cn(field, "h-8")} />
        <label className="sr-only" htmlFor="reply-body">
          Reply
        </label>
        <textarea
          ref={area}
          id="reply-body"
          name="body"
          required
          maxLength={reply.bodyMax}
          value={body}
          readOnly={pending}
          onChange={(e) => (mine === null ? setBodies({ ...bodies, [kind]: e.target.value }) : setMine(e.target.value))}
          spellCheck
          className={cn(field, "block max-h-[32vh] min-h-[150px] resize-y py-2.5 leading-[1.55]")}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <DraftSubmit />
          <button
            type="button"
            onClick={() => {
              setChanging(false);
              setOpen(false);
            }}
            className={pill}
          >
            {changing ? "Keep the draft" : "Close"}
          </button>
          <span role="status" className="text-[12.5px] text-muted-foreground">
            {changing ? "Saves a new draft. The old one stays unsent and is dropped from your Inbox." : "This only writes a draft. You'll read it before anything goes out."}
          </span>
        </div>
      </form>
    </section>
  );
}
