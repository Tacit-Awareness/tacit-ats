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

// The control panel's message (design/tats's `.cp-main`): the reply to the
// applicant as a preview, with a large button beside it, always in two steps.
// "Review draft" writes a draft and sends nothing; the page then shows that
// stored draft, From, To, subject and body, and only the Send button beside it
// sends it. Send has no key, on purpose. Changing a draft writes a new one: the
// database never changes a draft, so the old one stays unsent, and the Inbox
// stops offering it (inbox-issues.ts's currentDrafts). With no mailer, or no
// address, the box says so and offers nothing. Replying moves nobody: the row
// above it (routing-bar.tsx) still does that, and design/tats's one button for
// both is split because a reply can be refused while a route lands, and the
// reverse. The words are only ever the starters a member reads and changes.

export type Reply = {
  /** Drawn in Home's tab, so a post comes back there. */
  home?: boolean;
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

const LABEL: Record<ReplyKind, string> = { interview: "Interview", testbench: "Testbench", decline: "Decline", blank: "Blank" };

const field =
  "w-full border border-[color:var(--line)] bg-[color:var(--paper)] px-3 text-[13.5px] outline-none transition-colors placeholder:text-faint focus-visible:border-[color:var(--line-strong)]";

const shell = "grid grid-cols-[minmax(0,1fr)] gap-2";
/** `.cp-main`: the message, then the button. */
const main = "grid grid-cols-[minmax(0,1fr)] items-stretch gap-4 md:grid-cols-[minmax(0,1fr)_auto]";
/** `.cp-msg`. */
const message = "grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-2 border border-[color:var(--line)] bg-[color:var(--raised)] px-4 py-3 text-left";
/** `.cp-send`. */
const sendColumn = "grid content-end justify-items-stretch gap-2 md:w-[220px] md:justify-items-end md:text-right";
/** `.cp-send .cx-primary`. */
const large = "h-12 justify-center px-[26px] text-[15px]";
const hint = "m-0 text-[12px] text-faint";

function DraftSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} title="Review draft (⌘↵)" className={cn(pill, pillPrimary, large)}>
      {pending ? "Writing…" : "Review draft"}
      <Kbd decorative className="border-transparent bg-current/20 text-current">
        ⌘↵
      </Kbd>
    </button>
  );
}

function SendSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cn(pill, pillPrimary, large)}>
      {pending ? "Sending…" : "Send"}
    </button>
  );
}

/** The stored draft, exactly what Send delivers. */
function DraftReview({ reply, draft, sent, change }: { reply: Reply; draft: ShownDraft; sent: ReactNode; change: () => void }) {
  return (
    <section aria-label="Draft reply" className={shell}>
      {sent}
      <div className={main}>
        <div className={cn(message, "max-h-[calc(45*var(--vh))] overflow-y-auto")}>
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
          <p className="m-0 border-t border-[color:var(--line)] pt-2 text-[14px] leading-[1.55] break-words whitespace-pre-wrap">{draft.body}</p>
        </div>
        <form action={sendReplyAction} className={sendColumn}>
          <input type="hidden" name="draftId" value={draft.draftId} />
          <input type="hidden" name="applicationId" value={reply.applicationId} />
          {reply.home ? <input type="hidden" name="home" value="1" /> : null}
          <SendSubmit />
          <button type="button" onClick={change} className={cn(pill, "justify-center")}>
            Change it
          </button>
          <p className={hint}>Draft. Nothing has gone out: read it, then Send.</p>
        </form>
      </div>
    </section>
  );
}

export function ReplyBox({ reply, suggested = "interview" }: { reply: Reply; suggested?: ReplyKind }) {
  const { enabled, to, draft, failed, starters } = reply;
  // A failed send comes back open, on its own words.
  const [open, setOpen] = useState(failed !== null);
  const [changing, setChanging] = useState(false);
  const [kind, setKind] = useState<ReplyKind>(suggested);
  // The picked move picks the starter; a member can still start from another, and their edits to each stay.
  const [followed, setFollowed] = useState(suggested);
  if (suggested !== followed) {
    setFollowed(suggested);
    setKind(suggested);
  }
  const [subject, setSubject] = useState(failed?.subject ?? starters.subject);
  const [bodies, setBodies] = useState(starters.bodies);
  // Their own words, a failed send's or the draft being changed: no starter then.
  const [mine, setMine] = useState(failed?.body ?? null);
  const [state, action, pending] = useActionState(draftReplyAction, {});
  const box = useRef<HTMLElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const body = mine ?? bodies[kind];
  const canWrite = enabled && to !== null && !draft;
  // Focus only follows a press: a ticket that opens on a failed send must leave J and K walking the list.
  const pressed = useRef(false);
  const start = () => {
    if (!isShown(box.current)) return;
    pressed.current = true;
    setOpen(true);
  };
  useKeys({ r: start }, canWrite && !open);
  useKeyHelp("New Applicants", canWrite ? [{ keys: "R", label: "Write a reply" }, { keys: "⌘↵", label: "Review the draft" }] : []);

  useEffect(() => {
    if (open && pressed.current) area.current?.focus();
    pressed.current = false;
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
      pressed.current = true;
      setChanging(true);
      setOpen(true);
    };
    return <DraftReview reply={reply} draft={draft} sent={sent} change={change} />;
  }

  const from = reply.sender ? ` · from ${reply.sender.from}` : "";

  return (
    <section ref={box} aria-label="Reply" className={shell}>
      {sent}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {failed ? <p className="m-0 text-[12.5px] text-muted-foreground">Your last reply here didn&apos;t go out, so here are its words to write again.</p> : null}
      <form
        action={action}
        className={main}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !changing) setOpen(false);
          if (e.key !== "Enter") return;
          if ((e.metaKey || e.ctrlKey) && !pending) {
            e.preventDefault();
            e.currentTarget.requestSubmit();
          } else if (e.target instanceof HTMLInputElement) {
            // Enter in the subject would submit: a draft can't be discarded, so one is only ever asked for.
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="applicationId" value={reply.applicationId} />
        <input type="hidden" name="candidateId" value={reply.candidateId} />
        {reply.home ? <input type="hidden" name="home" value="1" /> : null}
        {open ? (
          <div className={message}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="min-w-0 truncate text-[12.5px] text-faint">
                To {to}
                {from}
              </span>
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
              className={cn(field, "block max-h-[calc(32*var(--vh))] min-h-[140px] resize-y py-2.5 leading-[1.55]")}
            />
          </div>
        ) : (
          <>
            {/* The preview's own words, posted as they read, so "Review draft" works from here too. */}
            <input type="hidden" name="subject" value={subject} />
            <input type="hidden" name="body" value={body} />
            <button
              type="button"
              onClick={start}
              aria-keyshortcuts="R"
              title="Read or edit the message"
              className={cn(message, "cursor-text transition-colors hover:border-[color:var(--line-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]")}
            >
              <span className="flex items-center justify-between gap-3 text-[12.5px] text-faint">
                <span className="min-w-0 truncate">
                  To {to}
                  {from}
                </span>
                <span className="flex flex-none items-center gap-2 font-medium text-[color:var(--accent)]">
                  Edit
                  <Kbd decorative>R</Kbd>
                </span>
              </span>
              <span className="line-clamp-3 text-[14px] leading-[1.55] break-words whitespace-pre-line text-foreground">{body}</span>
            </button>
          </>
        )}
        <div className={sendColumn}>
          <DraftSubmit />
          {open ? (
            <button
              type="button"
              onClick={() => {
                setChanging(false);
                setOpen(false);
              }}
              className={cn(pill, "justify-center")}
            >
              {changing ? "Keep the draft" : "Close"}
            </button>
          ) : null}
          <p role="status" className={hint}>
            {changing
              ? "Saves a new draft. The old one stays unsent and is dropped from your Inbox."
              : open
                ? "This only writes a draft. You'll read it before anything goes out."
                : "Nothing goes out until you read the draft and press Send."}
          </p>
        </div>
      </form>
    </section>
  );
}
