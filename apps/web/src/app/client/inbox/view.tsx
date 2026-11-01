import Link from "next/link";
import type { clientTools } from "@tacit-ats/core";
import { KeyList } from "@/components/keys";
import { Avatar, PageBar, Tabs, textLink } from "@/components/page";
import { DIGEST_RANGES, DEFAULT_RANGE, inboxHref, rangeLabel, readingLine, worthLine, type DigestGroupKey, type DigestRange, type DigestRow, type DigestSource } from "@/lib/client/inbox-digest";
import type { DecisionProps, TermLine } from "@/lib/client/inbox-decisions";
import type { IssueFix, IssueInstance, IssueKind } from "@/lib/client/inbox-issues";
import { cn } from "@/lib/utils";
import { ActivityStory } from "../candidates/activity-story";
import { LocalForEnd, LocalWhen } from "../candidates/local-day";
import { Feedback, Loop, type LoopProps, type Reader as InterviewReader } from "../interviews/view";
import { markAllDigestReadAction } from "./actions";
import { OpeningCard } from "./opening-card";
import { button, plain } from "./buttons";
import { DecisionBar, OfferTerms } from "./decision-bar";
import { FixBar } from "./fix-bar";
import { IssuePopup } from "./popup";
import { SendBar, type SendProps } from "./send-bar";
import { RowDismiss, RowKeys, RowMarkRead } from "./set-aside";

// The Inbox's markup, props only (page.tsx does the reads): design/tats's
// #inbox as a digest, one centred card (`.ibx`): Welcome back with what's worth
// the member's time, how far back to look, and Needs you, a row each saying what
// is wrong, who it is about and its age, and beside the row's link its own two
// buttons, the page and Dismiss (design/tats's `.ibx-acts`). Under it Decisions
// made, Booked and FYI, with Mark read in Dismiss's place, then Done and Mark all
// as read. Needs you's row opens that issue in a pop-up (popup.tsx) holding the
// reader: the same heading, the one fix (fix-bar.tsx, key F), Send here on an
// unsent draft (send-bar.tsx, key F, after a dialog) or the decision
// (decision-bar.tsx, keys A, O, R), Dismiss (set-aside.tsx, key E), the card
// saying what is waiting, an offer's terms for the approver reading it, then the
// candidate's story. A decision on a candidate has the whole ticket instead of
// the story: the loop, the read and the candidate. The rows under Needs you open
// that whole candidate over the card (`?open=`). done-view.tsx is Done.
// Everything a member or a candidate wrote renders as text.

export type IssueRow = {
  key: string;
  kind: IssueKind;
  href: string;
  what: string;
  who: string | null;
  line: string;
  age: string;
  active: boolean;
  /** What Dismiss names. Done's rows have nothing to dismiss. */
  instance?: IssueInstance;
  /** The page this is about. Null when a row can't tell the member can open it. */
  page?: string | null;
  /** The row that takes focus once this one has gone, across Needs you and the groups. */
  next?: string | null;
};

/** A decision's loop and read, as far as this member may read them. */
export type TicketLoop = LoopProps & Pick<InterviewReader, "feedback" | "feedbackNote">;

export type IssueReaderProps = {
  kind: IssueKind;
  /** What E names: `key` alone would be every issue this application ever has. */
  instance: IssueInstance;
  what: string;
  subject: string;
  card: { title: string; detail: string };
  /** An unsent draft, for its author's eyes. */
  draft: SendProps | null;
  /** A candidate's reply: their words, shown as text. */
  reply: { subject: string; body: string } | null;
  fix: IssueFix;
  /** The buttons and what they confirm, when the fix is a decision. */
  decision: DecisionProps | null;
  /** An offer waiting on this member: its terms, as lines. Null for anything else. */
  terms: TermLine[] | null;
  next: string | null;
  secondary: { label: string; href: string } | null;
  /** "Open as a page". Null when there's nothing the member can open (an approver not on the job). */
  page: string | null;
  /** Null for an issue with no candidate (a job's approval), or one the member can't read (an approver not on the job). */
  story: clientTools.ActivityEntry[] | null;
  /** A decision: the whole candidate, under the loop and the read, in the story's place. Null where they can't be read. */
  ticket?: { loop: TicketLoop | null; body: React.ReactNode } | null;
  now: number;
};

/** The whole candidate over the card, from a row under Needs you. */
export type PersonPopupProps = { key: string; title: string; subject: string; page: string; body: React.ReactNode };

const ICON: Record<IssueKind, string> = {
  reply: "M6.5 3.5 2.5 7.5l4 4M2.5 7.5H10a3.5 3.5 0 0 1 3.5 3.5v1.5",
  draft: "M2.5 4h11v8.5h-11ZM2.5 4.5 8 8.8l5.5-4.3",
  late: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 4.8V8l2.2 1.3",
  decide: "M3.5 14V2.5M3.5 3h8.5l-2 3 2 3H3.5",
};

const TONE: Record<IssueKind, string> = {
  reply: "bg-[color:var(--sel)] text-[color:var(--accent)]",
  draft: "bg-[color:var(--sel)] text-[color:var(--accent)]",
  late: "bg-[color:var(--amber-soft)] text-[color:var(--amber)]",
  decide: "bg-[color:var(--soft)] text-muted-foreground",
};

function KindIcon({ kind, className }: { kind: IssueKind; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-8 flex-none place-items-center rounded-full", TONE[kind], className)}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
        <path d={ICON[kind]} />
      </svg>
    </span>
  );
}

export function Row({ r }: { r: IssueRow }) {
  return (
    <Link
      href={r.href}
      data-key-item
      aria-current={r.active ? "true" : undefined}
      className={cn(
        "grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2.5 transition-colors",
        r.active ? "bg-[color:var(--sel)]" : "hover:bg-[color:var(--hover)]",
      )}
    >
      <span className="row-span-2">
        <KindIcon kind={r.kind} />
      </span>
      <span className="truncate text-[13.5px] font-medium">{r.what}</span>
      <span className="justify-self-end text-[12.5px] whitespace-nowrap text-faint tabular-nums">{r.age}</span>
      <span className="col-span-2 flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
        {r.who ? <Avatar name={r.who} size="xs" /> : null}
        <span className="truncate">{r.line}</span>
      </span>
    </Link>
  );
}

export type DigestProps = {
  range: DigestRange;
  /** When the page was read: Mark all as read covers no more than this. */
  asOf: string;
  total: number;
  shown: number;
  sources?: DigestSource[];
  unread: number;
  capped: boolean;
  groups: { key: DigestGroupKey; label: string; rows: (DigestRow & { age: string; active: boolean; next: string | null })[] }[];
};

const NO_DIGEST: Omit<DigestProps, "total" | "shown"> = { range: DEFAULT_RANGE, asOf: "", unread: 0, capped: false, groups: [] };

const GROUP_ICON: Record<DigestGroupKey, string> = {
  decided: ICON.decide,
  booked: "M3 3.5h10v9.5H3ZM3 6.5h10M5.5 2v2.5M10.5 2v2.5",
  fyi: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 7.5V11M8 5h.01",
};

function RangeTabs({ range }: { range: DigestRange }) {
  return <Tabs label="How far back" tabs={DIGEST_RANGES.map((r) => ({ label: r.label, href: inboxHref(r.days), active: r.days === range }))} />;
}

/** Done's bar: the crumb is the way back to the Inbox. */
export function DoneBar() {
  return <PageBar title="Done" crumbs={[{ href: "/client/inbox", label: "Inbox" }]} />;
}

const DONE_HREF = "/client/inbox?tab=done";

/** The page and Dismiss: on a hover or with focus in the row, in the age's place; always on a touch screen, beside it. */
const ROW_ACTIONS =
  "flex flex-none items-center gap-0.5 self-start pt-2 pr-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:absolute [@media(hover:hover)]:top-0 [@media(hover:hover)]:right-0 [@media(hover:none)]:opacity-100";
const ROW_ACTION = "grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground disabled:opacity-60";

const GROUP_HEAD = "m-0 -mx-4 mb-1 flex items-center gap-2 border-y border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-2 text-[14px] font-medium sm:-mx-6 sm:px-6";

/**
 * A line of the digest (`.ibx-r`). `scroll={false}`: opening and closing leave
 * the card where it was. The buttons sit beside the link, never in it: a control
 * inside a link is invalid, and a click on one would open the row as well.
 */
function NeedRow({ r, range }: { r: IssueRow; range: DigestRange }) {
  return (
    <div data-key-row className="group relative -mx-3 flex min-w-0 items-stretch transition-colors hover:bg-[color:var(--hover)]">
      <Link
        href={r.href}
        scroll={false}
        data-key-item
        data-issue-row={r.key}
        aria-current={r.active ? "true" : undefined}
        aria-haspopup="dialog"
        className="grid min-w-0 flex-1 grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-x-3 px-3 py-3"
      >
        <KindIcon kind={r.kind} />
        <span className="grid min-w-0 gap-1">
          <span className="text-[15.5px] leading-[1.45] break-words">{r.what}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
            {r.who ? <Avatar name={r.who} size="xs" /> : null}
            <span className="min-w-0 break-words">{r.line}</span>
          </span>
        </span>
        <span className="pt-0.5 text-[12.5px] whitespace-nowrap text-faint tabular-nums [@media(hover:hover)]:group-focus-within:invisible [@media(hover:hover)]:group-hover:invisible">{r.age}</span>
      </Link>
      {r.instance ? (
        <span className={ROW_ACTIONS}>
          {r.page ? (
            <Link href={r.page} title="Open as a page" aria-label={`Open as a page: ${r.what}`} className={ROW_ACTION}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden>
                <path d="M5 11l6-6M6 5h5v5" />
              </svg>
            </Link>
          ) : null}
          <RowDismiss instance={r.instance} what={r.what} next={r.next ?? null} range={range} className={ROW_ACTION} />
        </span>
      ) : null}
    </div>
  );
}

/** Where a read stopped at its cap, so nothing here reads as the whole of it. */
function CapNotes({ truncated, draftsCapped }: { truncated: boolean; draftsCapped: boolean }) {
  return (
    <>
      {truncated ? <p className="m-0 pt-3 text-[12.5px] text-faint">Too many interviews to check them all, so some missing feedback may not be listed.</p> : null}
      {draftsCapped ? <p className="m-0 pt-3 text-[12.5px] text-faint">Showing your newest 100 unsent drafts.</p> : null}
    </>
  );
}

function NeedsYou({ rows, range, truncated, draftsCapped }: { rows: IssueRow[]; range: DigestRange; truncated: boolean; draftsCapped: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] content-start">
      <section aria-labelledby="inbox-needs-you" className="grid grid-cols-[minmax(0,1fr)]">
        <h2 id="inbox-needs-you" className={GROUP_HEAD}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0" aria-hidden>
            <path d="M8 2.5 14 13H2ZM8 6.5v3M8 11.3h.01" />
          </svg>
          Needs you
          <span className="font-normal text-faint tabular-nums">{rows.length}</span>
        </h2>
        {rows.map((r) => (
          <NeedRow key={r.key} r={r} range={range} />
        ))}
      </section>
      <CapNotes truncated={truncated} draftsCapped={draftsCapped} />
    </div>
  );
}

/**
 * A line of what happened: the row opens the whole candidate in the pop-up, with
 * the page and Mark read beside it, and says who, the job and when (`.ibx-meta`).
 * `what` reads the same to a screen reader as it does on the row, its time aside,
 * which only the browser can word. Everything in it renders as text.
 */
function InfoRow({ r, range }: { r: DigestProps["groups"][number]["rows"][number]; range: DigestRange }) {
  return (
    <div data-key-row className="group relative -mx-3 flex min-w-0 items-stretch transition-colors hover:bg-[color:var(--hover)]">
      <Link
        href={r.href}
        scroll={false}
        data-key-item
        data-issue-row={r.id}
        aria-current={r.active ? "true" : undefined}
        aria-haspopup="dialog"
        className="grid min-w-0 flex-1 gap-1 px-3 py-3 [@media(hover:hover)]:pr-20"
      >
        <span className="text-[15.5px] leading-[1.45] break-words">{r.interviewAt ? <>{r.what.replace(/\.$/, "")}<LocalForEnd iso={r.interviewAt} /></> : r.what}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
          {r.who ? <Avatar name={r.who} size="xs" /> : null}
          <span className="min-w-0 break-words">
            {r.meta}
            {r.meta ? " · " : ""}
            <span className="tabular-nums">
              <LocalWhen iso={r.at} fallback={r.age} />
            </span>
          </span>
        </span>
      </Link>
      <span className={ROW_ACTIONS}>
        <Link href={r.page} title="Open as a page" aria-label={`Open as a page: ${r.what}`} className={ROW_ACTION}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden>
            <path d="M5 11l6-6M6 5h5v5" />
          </svg>
        </Link>
        <RowMarkRead mark={r.mark} what={r.what} next={r.next} range={range} className={ROW_ACTION} />
      </span>
    </div>
  );
}

function DigestGroups({ digest }: { digest: DigestProps }) {
  return digest.groups.map((g) => (
    <section key={g.key} aria-labelledby={`inbox-${g.key}`} className="grid grid-cols-[minmax(0,1fr)]">
      <h2 id={`inbox-${g.key}`} className={GROUP_HEAD}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0" aria-hidden>
          <path d={GROUP_ICON[g.key]} />
        </svg>
        {g.label}
        <span className="font-normal text-faint tabular-nums">{g.rows.length}</span>
      </h2>
      {g.rows.map((r) => (
        <InfoRow key={r.id} r={r} range={digest.range} />
      ))}
    </section>
  ));
}

function DigestFoot({ digest, needs }: { digest: DigestProps; needs: number }) {
  return (
    <footer className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:flex sm:items-center sm:justify-between">
      <p className="m-0 text-[12.5px] text-faint">{digest.capped ? "A lot happened in this period, so only the newest updates are listed." : null}</p>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Link href={DONE_HREF} className="text-[13px] text-muted-foreground transition-colors hover:text-foreground">
          Done
        </Link>
        {digest.unread ? (
          <form action={markAllDigestReadAction}>
            <input type="hidden" name="range" value={digest.range} />
            <input type="hidden" name="asOf" value={digest.asOf} />
            <input type="hidden" name="needs" value={needs ? "1" : "0"} />
            <button type="submit" className={cn(button, plain, "justify-center")}>
              Mark all as read
            </button>
          </form>
        ) : null}
      </div>
    </footer>
  );
}

function CaughtUp({ range, truncated, draftsCapped }: { range: DigestRange; truncated: boolean; draftsCapped: boolean }) {
  return (
    <div className="grid justify-items-center gap-1.5 border-t border-[color:var(--line)] py-12 text-center">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round" className="size-[22px] text-[color:var(--green)]" aria-hidden>
        <path d="m3.5 8.5 3 3 6-7" />
      </svg>
      <h2 className="m-0 text-[15px] font-medium">You&apos;re all caught up</h2>
      <p className="m-0 text-[13px] text-muted-foreground">Nothing new in the last {rangeLabel(range)}.</p>
      <CapNotes truncated={truncated} draftsCapped={draftsCapped} />
      <div className="mt-1 flex items-center gap-3">
        <Link href={DONE_HREF} className={textLink}>
          Done
        </Link>
        <Link href="/client/pipeline" className={textLink}>
          Open Pipeline
        </Link>
      </div>
    </div>
  );
}

function Draft({ draft }: { draft: NonNullable<IssueReaderProps["draft"]> }) {
  return (
    <dl className="m-0 mt-3 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-[color:var(--line)] pt-3 text-[13px]">
      {draft.from ? (
        <>
          <dt className="text-muted-foreground">From</dt>
          <dd className="m-0 min-w-0 break-words">{draft.from}</dd>
        </>
      ) : null}
      <dt className="text-muted-foreground">To</dt>
      <dd className="m-0 min-w-0 break-words">{draft.to}</dd>
      <dt className="text-muted-foreground">Subject</dt>
      <dd className="m-0 min-w-0 break-words">{draft.subject}</dd>
      <dd className="col-span-2 m-0 mt-2 break-words whitespace-pre-wrap">{draft.body}</dd>
    </dl>
  );
}

function Reply({ reply }: { reply: NonNullable<IssueReaderProps["reply"]> }) {
  return (
    <div data-untrusted="candidate-email" className="mt-3 border-t border-[color:var(--line)] pt-3 text-[13px]">
      {reply.subject ? <p className="m-0 mb-2 font-medium break-words">{reply.subject}</p> : null}
      <p className="m-0 break-words whitespace-pre-wrap">{reply.body || "The email had no text."}</p>
    </div>
  );
}

function Reader({ issue, range }: { issue: IssueReaderProps; range: DigestRange }) {
  return (
    <article className="mx-auto grid w-[760px] max-w-full content-start">
      {issue.decision ? (
        <DecisionBar key={issue.decision.key} decision={issue.decision} instance={issue.instance} terms={issue.terms} next={issue.next} range={range} secondary={issue.secondary} />
      ) : issue.fix.type === "send" && issue.draft ? (
        <SendBar key={issue.fix.draftId} fix={issue.fix} draft={issue.draft} instance={issue.instance} next={issue.next} range={range} secondary={issue.secondary} />
      ) : issue.fix.type === "link" || issue.fix.type === "write" ? (
        <FixBar fix={issue.fix} instance={issue.instance} next={issue.next} range={range} secondary={issue.secondary} />
      ) : null}
      <section className="mt-5 border border-[color:var(--line-strong)] bg-[color:var(--paper)] py-3 pr-3 pl-3.5">
        <div className="flex items-center gap-3">
          <KindIcon kind={issue.kind} className="size-[26px]" />
          <div className="grid min-w-0 gap-px">
            <b className="text-[13.5px] font-medium break-words">{issue.card.title}</b>
            <span className="text-[12.5px] break-words text-muted-foreground">{issue.card.detail}</span>
          </div>
        </div>
        {issue.draft ? <Draft draft={issue.draft} /> : null}
        {issue.reply ? <Reply reply={issue.reply} /> : null}
        {issue.terms ? (
          <div className="mt-3 border-t border-[color:var(--line)] pt-3">
            <OfferTerms lines={issue.terms} />
          </div>
        ) : null}
      </section>
      {issue.story && !issue.ticket ? (
        <section aria-label="Activity" className="mt-7">
          <h2 className="m-0 mb-1 text-[13px] font-medium">Activity</h2>
          <ActivityStory entries={issue.story} now={issue.now} />
        </section>
      ) : null}
    </article>
  );
}

/** The path through the loop and the read, the Interviews reader's own two blocks, over the candidate. */
function LoopAndRead({ loop }: { loop: TicketLoop }) {
  return (
    <div className="px-4 pt-3 md:px-6">
      <article className="@container mx-auto w-[760px] max-w-full overflow-hidden border border-[color:var(--line)] bg-[color:var(--paper)]">
        <Loop reader={loop} />
        <Feedback reader={loop} />
      </article>
    </div>
  );
}

export function InboxView({
  rows,
  issue,
  person = null,
  flash,
  home = "/client/inbox",
  truncated,
  draftsCapped,
  digest: given,
}: {
  rows: IssueRow[];
  /** The issue `?i=` opened, read in full. Null is the card alone. */
  issue: IssueReaderProps | null;
  /** The digest row `?open=` opened. */
  person?: PersonPopupProps | null;
  flash: React.ReactNode;
  /** Where closing the pop-up lands. */
  home?: string;
  truncated: boolean;
  draftsCapped: boolean;
  /** What happened lately. Left out, the card is Needs you alone. */
  digest?: DigestProps;
}) {
  const digest = given ?? { ...NO_DIGEST, total: rows.length, shown: rows.length };
  const popup = issue !== null || person !== null;
  const any = rows.length > 0 || digest.groups.length > 0;
  return (
    <div className="list-reader flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto bg-[color:var(--frame)] px-4 py-6 md:py-12">
        <OpeningCard
          play={!popup && !flash && any}
          sources={digest.sources ?? []}
          reading={readingLine(digest.total)}
          worth={worthLine(digest.shown, digest.total)}
          range={<RangeTabs range={digest.range} />}
        >
          {!popup ? flash : null}
          {any ? (
            // J and K walk every row, Needs you first: over the card they move focus and Enter opens, since a key shouldn't throw up a pop-up; in a pop-up they open the next one.
            <KeyList title="Inbox" next="Next row" mode={popup ? "select" : "focus"} className="opening-list grid grid-cols-[minmax(0,1fr)] content-start gap-5">
              {popup ? null : <RowKeys />}
              {rows.length ? <NeedsYou rows={rows} range={digest.range} truncated={truncated} draftsCapped={draftsCapped} /> : null}
              <DigestGroups digest={digest} />
            </KeyList>
          ) : null}
          {any ? <DigestFoot digest={digest} needs={rows.length} /> : <CaughtUp range={digest.range} truncated={truncated} draftsCapped={draftsCapped} />}
        </OpeningCard>
      </div>
      {issue ? (
        <IssuePopup issueKey={issue.instance.key} title={issue.what} subject={issue.subject} home={home} pageHref={issue.page}>
          <div className={cn("grid grid-cols-[minmax(0,1fr)] content-start gap-3 px-4 pt-3 md:px-6", !issue.ticket && "pb-10")}>
            {flash ? <div className="mx-auto w-[760px] max-w-full">{flash}</div> : null}
            <Reader issue={issue} range={digest.range} />
          </div>
          {issue.ticket?.loop ? <LoopAndRead loop={issue.ticket.loop} /> : null}
          {issue.ticket?.body}
        </IssuePopup>
      ) : person ? (
        <IssuePopup issueKey={person.key} title={person.title} subject={person.subject} home={home} pageHref={person.page}>
          {flash ? <div className="px-4 pt-3 md:px-6">{flash}</div> : null}
          {person.body}
        </IssuePopup>
      ) : null}
    </div>
  );
}
