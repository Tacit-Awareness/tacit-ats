"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useKeyHelp, useKeys } from "@/components/keys";
import { Kbd, Notice, Pill, pillOption, pillTrack } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { Input, selectClass } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { DraftSender, ShownDraft } from "@/lib/client/email";
import { isShown } from "@/lib/keys";
import { REPLY_KINDS, type ReplyKind, type ReplyStarters } from "@/lib/client/reply-starters";
import type { TemplateStarter } from "@/lib/client/email-template-rules";
import { cn } from "@/lib/utils";
import { draftReplyAction, sendReplyAction } from "./actions";
import { CmdEnter } from "../inbox/keycaps";

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
// reverse. The words are only ever the starters a member reads and changes:
// the built-in ones, or the company's templates (Settings > Email templates),
// filled in on the server (email-template-rules.ts's templateStarters). A
// template posts only its id beside the words, which core records on the draft.
// Drawn in Testbench's parts: the message a white card, the starters a small
// segmented control, the big button black with its key inside. What a step
// will and won't do is the button's hover (and a screen reader's status line),
// not a caption under it.

export type Reply = {
  /** Drawn in Home's tab, so a post comes back there. */
  home?: boolean;
  /** Drawn in the Inbox's pop-up, at this digest range, so a post comes back there on this applicant. */
  inbox?: number;
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
  /** The company's live templates, filled in for this email. */
  templates?: TemplateStarter[];
  subjectMax: number;
  bodyMax: number;
};

const LABEL: Record<ReplyKind, string> = { interview: "Interview", testbench: "Testbench", decline: "Decline", blank: "Blank" };

const shell = "grid grid-cols-[minmax(0,1fr)] gap-2";
/** `.cp-main`: the message, then the button beside it. */
const main = "grid grid-cols-[minmax(0,1fr)] items-stretch gap-4 md:grid-cols-[minmax(0,1fr)_auto]";
/**
 * The same with the message open or a draft to read: in a narrow reader (the
 * panel's container query) the buttons go under the message, right-aligned, so
 * the words get the reader's whole width rather than a column beside them.
 */
const mainWide = "grid grid-cols-[minmax(0,1fr)] items-stretch gap-3 @3xl:grid-cols-[minmax(0,1fr)_auto] @3xl:gap-4";
/** `.cp-msg`: a white card. */
const message = "grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-2.5 rounded-[12px] bg-card px-4 py-3 text-left shadow-[var(--shadow-sm)]";
/** `.cp-send`. */
const sendColumn = "grid content-end justify-items-stretch gap-2 md:w-[200px]";
const sendRow = "grid content-end justify-items-stretch gap-2 @max-3xl:flex @max-3xl:flex-row-reverse @max-3xl:items-center @3xl:w-[200px]";
/** `.cp-send .cx-primary`: Testbench's big button. */
const large = buttonVariants({ size: "lg" });
const plain = buttonVariants({ variant: "outline" });
/** Who it goes to and from whom, the message card's top line. */
const addressLine = "flex min-w-0 flex-wrap gap-x-3 text-[12px] text-faint";

function DraftSubmit({ hint }: { hint: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} title={`${hint} (⌘↵)`} className={large}>
      {pending ? "Writing…" : "Review draft"}
      <Kbd>
        <CmdEnter />
      </Kbd>
    </button>
  );
}

function SendSubmit({ hint }: { hint: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} title={hint} className={large}>
      {pending ? "Sending…" : "Send"}
    </button>
  );
}

/** Said to a screen reader as the step changes; a sighted member has it on the button's hover. */
function Status({ children }: { children: string }) {
  return (
    <p role="status" className="sr-only">
      {children}
    </p>
  );
}

function Address({ to, from }: { to: string; from: string | null }) {
  return (
    <span className={addressLine}>
      <span className="min-w-0 truncate">To {to}</span>
      {from ? <span className="min-w-0 truncate">from {from}</span> : null}
    </span>
  );
}

const DRAFT_HINT = "Draft. Nothing has gone out: read it, then Send.";

/** The stored draft, exactly what Send delivers, marked as a draft (amber: it waits on you). */
function DraftReview({ reply, draft, sent, change }: { reply: Reply; draft: ShownDraft; sent: ReactNode; change: () => void }) {
  return (
    <section aria-label="Draft reply" className={shell}>
      {sent}
      <div className={mainWide}>
        <div className={cn(message, "max-h-[45vh] overflow-y-auto")}>
          <div className="flex items-start gap-3">
            <dl className="m-0 grid min-w-0 flex-1 grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12.5px]">
              {reply.sender ? (
                <>
                  <dt className="text-faint">From</dt>
                  <dd className="m-0 min-w-0 break-words">{reply.sender.from}</dd>
                  <dt className="text-faint">Replies</dt>
                  <dd className="m-0 min-w-0 break-words">{reply.sender.replyTo}</dd>
                </>
              ) : null}
              <dt className="text-faint">To</dt>
              <dd className="m-0 min-w-0 break-words">{draft.to}</dd>
              <dt className="text-faint">Subject</dt>
              <dd className="m-0 min-w-0 break-words">{draft.subject}</dd>
            </dl>
            <Pill tone="amber" title={DRAFT_HINT} className="flex-none">
              Draft
            </Pill>
          </div>
          <p className="m-0 border-t border-[color:var(--line)] pt-2.5 font-sans text-[14px] leading-[22px] break-words whitespace-pre-wrap">{draft.body}</p>
        </div>
        <form action={sendReplyAction} className={sendRow}>
          <input type="hidden" name="draftId" value={draft.draftId} />
          <input type="hidden" name="applicationId" value={reply.applicationId} />
          {reply.home ? <input type="hidden" name="home" value="1" /> : null}
          {reply.inbox !== undefined ? <input type="hidden" name="inbox" value={reply.inbox} /> : null}
          <SendSubmit hint={DRAFT_HINT} />
          <button type="button" onClick={change} className={cn(plain, "@max-3xl:h-11")}>
            Change it
          </button>
          <Status>{DRAFT_HINT}</Status>
        </form>
      </div>
    </section>
  );
}

export function ReplyBox({ reply, suggested = "interview" }: { reply: Reply; suggested?: ReplyKind }) {
  const { enabled, to, draft, failed, starters } = reply;
  const templates = reply.templates ?? [];
  // A failed send comes back open, on its own words.
  const [open, setOpen] = useState(failed !== null);
  const [changing, setChanging] = useState(false);
  const [kind, setKind] = useState<ReplyKind>(suggested);
  // The picked move picks the starter; a member can still start from another, and their edits to each stay.
  const [followed, setFollowed] = useState(suggested);
  const [subject, setSubject] = useState(failed?.subject ?? starters.subject);
  const [bodies, setBodies] = useState(starters.bodies);
  // A template picked over the starters, by id, and each template's own edits, as the starters keep theirs.
  const [pick, setPick] = useState<string | null>(null);
  const [own, setOwn] = useState<Record<string, string>>(() => Object.fromEntries(templates.map((t) => [t.templateId, t.body])));
  const picked = templates.find((t) => t.templateId === pick) ?? null;
  // A subject the member hasn't touched follows the pick; one they wrote stays.
  const startFrom = (next: { kind: ReplyKind } | { template: TemplateStarter }) => {
    const before = picked?.subject ?? starters.subject;
    const after = "template" in next ? next.template.subject : starters.subject;
    if (subject === before) setSubject(after);
    if ("template" in next) setPick(next.template.templateId);
    else {
      setPick(null);
      setKind(next.kind);
    }
  };
  if (suggested !== followed) {
    setFollowed(suggested);
    startFrom({ kind: suggested });
  }
  // Their own words, a failed send's or the draft being changed: no starter then.
  const [mine, setMine] = useState(failed?.body ?? null);
  const [state, action, pending] = useActionState(draftReplyAction, {});
  const box = useRef<HTMLElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const body = mine ?? (picked ? (own[picked.templateId] ?? picked.body) : bodies[kind]);
  const fromTemplate = mine === null ? picked : null;
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
        <div className="flex items-center gap-3">
          <button type="button" disabled className={buttonVariants({ variant: "outline", size: "sm" })}>
            Reply
          </button>
          <span role="status" className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
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

  const from = reply.sender?.from ?? null;
  const hint = changing
    ? "Saves a new draft. The old one stays unsent and is dropped from your Inbox."
    : open
      ? "This only writes a draft. You'll read it before anything goes out."
      : "Nothing goes out until you read the draft and press Send.";

  return (
    <section ref={box} aria-label="Reply" className={shell}>
      {sent}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {failed ? <p className="m-0 text-[12.5px] text-muted-foreground">Your last reply here didn&apos;t go out, so here are its words to write again.</p> : null}
      <form
        action={action}
        className={open ? mainWide : main}
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
        {reply.inbox !== undefined ? <input type="hidden" name="inbox" value={reply.inbox} /> : null}
        {fromTemplate ? <input type="hidden" name="templateId" value={fromTemplate.templateId} /> : null}
        {open ? (
          <div className={message}>
            <div className="flex flex-wrap items-center gap-2">
              <Address to={to} from={from} />
              {mine === null ? (
                <span className="ml-auto flex flex-wrap items-center gap-2">
                  <span role="group" aria-label="Start from" className={pillTrack}>
                    {REPLY_KINDS.map((k) => {
                      const on = picked === null && k === kind;
                      return (
                        <button key={k} type="button" aria-pressed={on} onClick={() => startFrom({ kind: k })} className={pillOption(on, "sm")}>
                          {LABEL[k]}
                        </button>
                      );
                    })}
                  </span>
                  {templates.length ? (
                    <select
                      aria-label="Start from a template"
                      value={picked?.templateId ?? ""}
                      onChange={(e) => {
                        const t = templates.find((x) => x.templateId === e.target.value);
                        if (t) startFrom({ template: t });
                      }}
                      className={cn(selectClass, "h-[30px] w-auto max-w-[180px] truncate pr-7 text-[12px]", picked ? "text-foreground" : "text-muted-foreground")}
                    >
                      <option value="" disabled>
                        Template
                      </option>
                      {templates.map((t) => (
                        <option key={t.templateId} value={t.templateId}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </span>
              ) : null}
            </div>
            <label className="sr-only" htmlFor="reply-subject">
              Subject
            </label>
            <Input id="reply-subject" name="subject" required maxLength={reply.subjectMax} value={subject} readOnly={pending} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
            <label className="sr-only" htmlFor="reply-body">
              Reply
            </label>
            <Textarea
              ref={area}
              id="reply-body"
              name="body"
              required
              maxLength={reply.bodyMax}
              value={body}
              readOnly={pending}
              onChange={(e) =>
                mine !== null ? setMine(e.target.value) : picked ? setOwn({ ...own, [picked.templateId]: e.target.value }) : setBodies({ ...bodies, [kind]: e.target.value })
              }
              spellCheck
              className="block max-h-[32vh] min-h-[140px] resize-y font-sans text-[14px] leading-[22px]"
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
              className={cn(message, "cursor-text transition-shadow hover:shadow-[var(--shadow)]")}
            >
              <span className="flex items-center justify-between gap-3">
                <Address to={to} from={from} />
                <span className="flex flex-none items-center gap-2 text-[12px] font-medium text-foreground">
                  Edit
                  <Kbd>
                    R
                  </Kbd>
                </span>
              </span>
              <span className="line-clamp-3 font-sans text-[14px] leading-[22px] break-words whitespace-pre-line text-foreground">{body}</span>
            </button>
          </>
        )}
        <div className={open ? sendRow : sendColumn}>
          <DraftSubmit hint={hint} />
          {open ? (
            <button
              type="button"
              onClick={() => {
                setChanging(false);
                setOpen(false);
              }}
              className={cn(plain, "@max-3xl:h-11")}
            >
              {changing ? "Keep the draft" : "Close"}
            </button>
          ) : null}
          <Status>{hint}</Status>
        </div>
      </form>
    </section>
  );
}
