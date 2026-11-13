import Link from "next/link";
import type { clientTools } from "@tacit-ats/core";
import { CountTile, PageBar, StatusGlyph, type GlyphKind } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { DEFAULT_RANGE, rangeLabel, readingLine, worthLine, type DigestGroupKey, type DigestRange, type DigestRow, type DigestSource, type ReadMark } from "@/lib/client/inbox-digest";
import type { DecisionProps, TermLine } from "@/lib/client/inbox-decisions";
import type { IssueFix, IssueInstance, IssueKind, IssueReason } from "@/lib/client/inbox-issues";
import { cn } from "@/lib/utils";
import { TicketReader, type Ticket as ApplicantTicket } from "../applicants/view";
import { ActivityStory } from "../candidates/activity-story";
import { Loop, type LoopProps, type Reader as InterviewReader } from "../interviews/view";
import { markAllDigestReadAction } from "./actions";
import { OpeningCard } from "./opening-card";
import { button, plain } from "./buttons";
import { DecisionBar, OfferTerms } from "./decision-bar";
import { FixBar } from "./fix-bar";
import { ForEnd, When } from "./local-time";
import { IssuePopup } from "./popup";
import { DIGEST_SECTION, KIND_SECTION, REASON_SECTION, SECTIONS, type SectionKey } from "./sections";
import { SendBar, type SendProps } from "./send-bar";
import { MarkReadButton, RowDismiss, RowMarkRead } from "./set-aside";
import { CallCard, WhereItStands } from "./ticket-card";

// The Inbox's markup, props only (page.tsx does the reads): design/tats's
// #inbox as a digest, one centred card (opening-card.tsx) that opens on Welcome
// back and reads before it shows anything, then three sections (sections.ts):
// New applicants, Interview judgement and Interview routing, each with what
// needs the member first and what is only news after. An entry is a calm two
// lines, Testbench's inbox row: a square status glyph, what needs doing, under
// it who and what happened in words, the time at the right, and beside the
// entry's link its own two buttons, the page and Dismiss (Mark read for news;
// design/tats's `.ibx-acts`), on a hover or with focus in it. Under the
// sections Done and Mark all as read. An entry that needs the member opens that
// issue in a pop-up (popup.tsx) holding the reader, where it is finished there
// and then: the same heading, the one fix (fix-bar.tsx, key F), Send here on an
// unsent draft (send-bar.tsx, key F, after a dialog) or the decision
// (decision-bar.tsx, keys A, O, R), Dismiss (set-aside.tsx, key E), the card
// saying what is waiting, an offer's terms for the approver reading it, then
// the candidate's story. An issue about someone the member can open is the
// whole ticket instead (design/tats's `openFull`): the route across the top,
// then the candidate with the card and its buttons under the chips
// (ticket-card.tsx). A news entry opens that same ticket over the card
// (`?open=`), with what happened in a card over it and Mark read there (key
// E), as on the row. A new applicant opens their ticket as New Applicants
// draws it (`?a=`, applicants/view.tsx's TicketReader): the application, and
// the routing bar and the reply, New Applicants' own, which route them here
// exactly as there. done-view.tsx is Done. Everything a member or a candidate
// wrote renders as text.

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
  /** `detail` is what is so; `hint` is how the fix deals with it, that button's hover. */
  card: { title: string; detail: string; hint?: string };
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
  /** Who it waits on and how long, for the card. */
  who: string | null;
  age: string;
  /** "Open as a page". Null when there's nothing the member can open (an approver not on the job). */
  page: string | null;
  /** Null for an issue with no candidate (a job's approval), or one the member can't read (an approver not on the job). */
  story: clientTools.ActivityEntry[] | null;
  /** The whole candidate in the story's place, the card under their chips. Null where they can't be read. */
  ticket?: Ticket | null;
  now: number;
};

/** One candidate as a pop-up holds them: named in its header, the route over them, `body` placing what it's given under their chips. */
export type Ticket = { title: string; subject: string; loop: TicketLoop | null; body: (call: React.ReactNode) => React.ReactNode };

/**
 * The whole candidate over the card, from a line of what happened. Where they
 * stand (the next action, how late, who owns it, when last touched) is the
 * candidate's own head and side card under it, so no card here repeats it.
 */
export type PersonPopupProps = Ticket & { key: string; page: string; news?: NewsProps | null };

/** The line of news a person pop-up was opened from: what happened, who did it and when, and its read mark for Mark read. */
export type NewsProps = { what: string; group: DigestGroupKey; who: string | null; at: string; age: string; interviewAt: string | null; mark: ReadMark; next: string | null };

/** A new applicant's ticket over the card (`?a=`), as New Applicants' reader holds it. `page` is their place in New Applicants. */
export type ApplicantPopupProps = { key: string; title: string; subject: string; page: string; ticket: ApplicantTicket };

/**
 * A row's square (Testbench's StatusGlyph), by why it waits: overdue is red, gone
 * quiet is dashed, waiting on someone else is the turning corner (still: it is a
 * wait, not work under way), a call to make is part filled, a reply is the
 * accent, an unsent draft is empty. Done's rows have no reason left: they are done.
 */
const REASON_GLYPH: Record<IssueReason, GlyphKind> = { overdue: "alert", quiet: "lapsed", feedback: "pending", decide: "half", approval: "most", reply: "live", draft: "empty" };
const KIND_GLYPH: Record<IssueKind, GlyphKind> = { late: "alert", decide: "half", reply: "live", draft: "empty" };
const glyphOf = (r: IssueRow): GlyphKind => (r.instance ? REASON_GLYPH[r.instance.reason] : KIND_GLYPH[r.kind]);

/** What happened, by group: a decision made is done, a booking is a step along, a read filed is part of a call. */
const GROUP_GLYPH: Record<DigestGroupKey, GlyphKind> = { decided: "done", booked: "most", fyi: "quarter" };

/** A status square that never turns: what waits in the Inbox waits on a person, not a process. */
function Glyph({ kind }: { kind: GlyphKind }) {
  return <StatusGlyph kind={kind} still />;
}

/**
 * A row's facts, out of the line the server joins with " · " (inbox-issues.ts's
 * issueLine: who, the candidate when `what` doesn't name them, why; a digest
 * row's meta: who, the job). Testbench puts no dot between facts, so they are
 * kept apart by column and by tone: people in --muted-text, what happened in
 * --faint, and who it's with in a column of its own.
 */
type Facts = { subject: string | null; why: string | null; who: string | null };

function factsOf(line: string, who: string | null, kind: "issue" | "digest"): Facts {
  const parts = line.split(" · ").filter(Boolean);
  const lead = who && parts[0] === who ? parts.shift()! : null;
  // A digest row names the candidate in `what`, so what is left is the job.
  if (kind === "digest") return { subject: null, why: parts.join(" ") || null, who: lead };
  const why = parts.pop() ?? null;
  return { subject: parts.join(" ") || null, why, who: lead };
}

/** Facts in a line, for a list too narrow for columns: people in --muted-text, what happened in --faint, with room between. */
function FactLine({ facts, className }: { facts: Facts; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-4", className)}>
      {facts.who ? <span className="min-w-0 truncate text-muted-foreground">{facts.who}</span> : null}
      {facts.subject ? <span className="min-w-0 truncate text-muted-foreground">{facts.subject}</span> : null}
      {facts.why ? <span className="min-w-0 truncate text-faint">{facts.why}</span> : null}
    </span>
  );
}

/** Done's row in its list: the square, what it was over who and why, and how it left. */
export function Row({ r }: { r: IssueRow }) {
  return (
    <Link
      href={r.href}
      data-key-item
      aria-current={r.active ? "true" : undefined}
      className={cn(
        "grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-t border-[color:var(--line)] px-5 py-3 transition-colors first:border-t-0 focus-visible:outline-none",
        r.active ? "bg-[color:var(--sel)] shadow-[inset_2px_0_0_var(--ink)]" : "hover:bg-[color:var(--surface)] focus-visible:bg-[color:var(--sel)] focus-visible:shadow-[inset_2px_0_0_var(--ink)]",
      )}
    >
      <Glyph kind="done" />
      <span title={r.what} className="truncate font-medium">
        {r.what}
      </span>
      <span className="justify-self-end text-[12px] whitespace-nowrap text-faint tabular-nums">{r.age}</span>
      <FactLine facts={factsOf(r.line, r.who, "issue")} className="col-span-2 col-start-2 text-[12px]" />
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

/** Done's bar: the crumb is the way back to the Inbox. */
export function DoneBar() {
  return <PageBar title="Done" crumbs={[{ href: "/client/inbox", label: "Inbox" }]} />;
}

const DONE_HREF = "/client/inbox?tab=done";

/** A new applicant as the Inbox lists them: who, the job, how they came in, when. The row opens their ticket in the pop-up (`href`); `page` is it in New Applicants. */
export type ApplicantRow = { applicationId: string; href: string; page: string; name: string; referral: boolean; added: boolean; job: string | null; source: string; age: string; active: boolean };
/** The newest few of `total`, and where the rest are. */
export type ApplicantsProps = { rows: ApplicantRow[]; total: number; href: string };

/** The sidebar's own marks for the three kinds of work (app-shell/shell-frame.tsx's ICONS: New Applicants, Interview Judgement, Interview Process), drawn bare. */
const SECTION_ICON: Record<SectionKey, string> = {
  applicants: "M2.5 5a1.5 1.5 0 0 0 0 3v3.5h11V8a1.5 1.5 0 0 1 0-3V2.5h-11ZM6.5 2.5v9",
  judgement: "M8 2.5a2 2 0 0 0-2 2v3.5a2 2 0 0 0 4 0V4.5a2 2 0 0 0-2-2ZM4.5 7.5a3.5 3.5 0 0 0 7 0M8 11v2.5",
  routing: "M3 2.5h4v3.5H3ZM9 10h4v3.5H9ZM5 6v3a2 2 0 0 0 2 2h2",
};

/** Who a row is with, in words: the one it waits on, who owns it, who asked, who did it. */
const WHO_WORD: Record<IssueReason, string> = { feedback: "waiting on", overdue: "with", quiet: "owned by", decide: "with", approval: "asked by", reply: "with", draft: "with" };
const DIGEST_WHO_WORD: Record<DigestGroupKey, string> = { decided: "by", booked: "with", fyi: "by" };

const sectionOf = (r: IssueRow): SectionKey => (r.instance ? REASON_SECTION[r.instance.reason] : KIND_SECTION[r.kind]);

/** The page and Dismiss (or Mark read): on a hover or with focus in the row, in the time's place; always on a touch screen, beside it. */
const ROW_ACTIONS =
  "flex flex-none items-start gap-0.5 pt-2 pr-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:absolute [@media(hover:hover)]:top-0 [@media(hover:hover)]:right-0 [@media(hover:none)]:opacity-100";
const ROW_ACTION = "grid size-7 place-items-center rounded-[7px] text-muted-foreground transition-colors hover:bg-[color:var(--hover)] hover:text-foreground disabled:opacity-50";

/**
 * An entry in the card (Testbench's inbox `.ib-row`): a calm block with 11px
 * corners, the surface on a hover; the one open in the pop-up, or focused by J
 * and K, sits on the selected fill inside the accent ring. The link draws no
 * ring of its own: the entry is the focus.
 */
const ENTRY =
  "ibx-entry group relative flex min-w-0 items-stretch rounded-[11px] transition-colors hover:bg-[color:var(--surface)] has-[>a[aria-current]]:bg-[color:var(--sel)] has-[>a:first-child:focus-visible]:bg-[color:var(--sel)] has-[>a:first-child:focus-visible]:outline-2 has-[>a:first-child:focus-visible]:outline-offset-0 has-[>a:first-child:focus-visible]:outline-[color:var(--accent)]";
/** The square, then what needs doing over who and what happened, the time at the right. */
const ENTRY_LINK = "grid min-w-0 flex-1 grid-cols-[14px_minmax(0,1fr)_auto] gap-x-3.5 gap-y-0.5 px-3.5 py-3 focus-visible:outline-none";
const ENTRY_GLYPH = "row-span-2 pt-1";
/** Ends on `tabular-nums`: the time, right-aligned, hidden while the row's buttons stand in its place. */
const ENTRY_TIME = "col-start-3 row-start-1 pt-0.5 pl-3 text-right font-mono text-[12px] leading-5 whitespace-nowrap text-faint tabular-nums";
const HIDE_FOR_ACTIONS = "[@media(hover:hover)]:group-focus-within:invisible [@media(hover:hover)]:group-hover:invisible";

/** What needs doing, a sentence: weight 500 when it waits on the member, plain when it is only news. */
function What({ text, needs, children }: { text: string; needs: boolean; children?: React.ReactNode }) {
  return <span className={cn("col-start-2 font-sans text-[15px] leading-[22px] break-words", needs ? "font-medium" : "font-normal")}>{children ?? text}</span>;
}

/** Under it, in words with room between: the candidate (a person, in --muted-text), what happened (--faint), who it's with. */
function Said({ facts, word }: { facts: Facts; word: string }) {
  return (
    <span className="col-start-2 flex min-w-0 flex-wrap items-baseline gap-x-4 font-sans text-[13px] leading-5">
      {facts.subject ? <span className="text-muted-foreground">{facts.subject}</span> : null}
      {facts.why ? <span className="text-faint">{facts.why}</span> : null}
      {facts.who ? (
        <span className="text-muted-foreground">
          <span className="text-faint">{word} </span>
          {facts.who}
        </span>
      ) : null}
    </span>
  );
}

/** The opening's order for an entry, so they arrive one after another (inbox.css). */
const order = (n: number) => ({ "--r": n }) as React.CSSProperties;

function PageLink({ href, what }: { href: string; what: string }) {
  return (
    <Link href={href} title="Open as a page" aria-label={`Open as a page: ${what}`} className={ROW_ACTION}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden>
        <path d="M5 11l6-6M6 5h5v5" />
      </svg>
    </Link>
  );
}

/**
 * Something that needs the member (`.ibx-r`). `scroll={false}`: opening and
 * closing leave the card where it was. The buttons sit beside the link, never
 * in it: a control inside a link is invalid, and a click on one would open the
 * row as well.
 */
function NeedRow({ r, range, n }: { r: IssueRow; range: DigestRange; n: number }) {
  return (
    <div data-key-row className={ENTRY} style={order(n)}>
      <Link href={r.href} scroll={false} data-key-item data-issue-row={r.key} aria-current={r.active ? "true" : undefined} aria-haspopup="dialog" className={ENTRY_LINK}>
        <span className={ENTRY_GLYPH}>
          <Glyph kind={glyphOf(r)} />
        </span>
        <What text={r.what} needs />
        <span className={cn(r.instance && HIDE_FOR_ACTIONS, ENTRY_TIME)}>{r.age}</span>
        <Said facts={factsOf(r.line, r.who, "issue")} word={r.instance ? WHO_WORD[r.instance.reason] : "with"} />
      </Link>
      {r.instance ? (
        <span className={ROW_ACTIONS}>
          {r.page ? <PageLink href={r.page} what={r.what} /> : null}
          <RowDismiss instance={r.instance} what={r.what} next={r.next ?? null} range={range} className={ROW_ACTION} />
        </span>
      ) : null}
    </div>
  );
}

/** A line of news in words: the feed's sentences end in a full stop, and an entry's line, like the others, doesn't. A booking says when, in the browser's zone. */
function NewsWhat({ what, interviewAt }: { what: string; interviewAt: string | null }) {
  const line = what.replace(/\.$/, "");
  return interviewAt ? (
    <>
      {line}
      <ForEnd iso={interviewAt} />
    </>
  ) : (
    <>{line}</>
  );
}

/**
 * A line of what happened: the row opens the whole candidate in the pop-up, with
 * the page and Mark read beside it, and says who, the job and when (`.ibx-meta`).
 * `what` reads the same to a screen reader as it does on the row, its time aside,
 * which only the browser can word. Everything in it renders as text.
 */
function InfoRow({ r, group, range, n }: { r: DigestProps["groups"][number]["rows"][number]; group: DigestGroupKey; range: DigestRange; n: number }) {
  return (
    <div data-key-row className={ENTRY} style={order(n)}>
      <Link href={r.href} scroll={false} data-key-item data-issue-row={r.id} aria-current={r.active ? "true" : undefined} aria-haspopup="dialog" className={ENTRY_LINK}>
        <span className={ENTRY_GLYPH}>
          <Glyph kind={GROUP_GLYPH[group]} />
        </span>
        <What text={r.what.replace(/\.$/, "")} needs={false}>
          <NewsWhat what={r.what} interviewAt={r.interviewAt} />
        </What>
        <span className={cn(HIDE_FOR_ACTIONS, ENTRY_TIME)}>
          <When iso={r.at} fallback={r.age} />
        </span>
        <Said facts={factsOf(r.meta, r.who, "digest")} word={DIGEST_WHO_WORD[group]} />
      </Link>
      <span className={ROW_ACTIONS}>
        <PageLink href={r.page} what={r.what} />
        <RowMarkRead mark={r.mark} what={r.what} next={r.next} range={range} className={ROW_ACTION} />
      </span>
    </div>
  );
}

/**
 * Someone newly in. The row opens their ticket in the pop-up, where they are
 * routed as in New Applicants, with the page (their place in New Applicants)
 * beside it, as every entry has. J and K reach it like any other entry.
 */
function ApplicantEntry({ a, n }: { a: ApplicantRow; n: number }) {
  const what = a.referral ? `${a.name} was referred` : a.added ? `${a.name} was added` : `${a.name} applied`;
  return (
    <div data-key-row className={ENTRY} style={order(n)}>
      <Link href={a.href} scroll={false} data-key-item data-issue-row={a.applicationId} aria-current={a.active ? "true" : undefined} aria-haspopup="dialog" className={ENTRY_LINK}>
        <span className={ENTRY_GLYPH}>
          <Glyph kind="empty" />
        </span>
        <What text={what} needs />
        <span className={cn(HIDE_FOR_ACTIONS, ENTRY_TIME)}>{a.age}</span>
        <Said facts={{ subject: a.job, why: a.source, who: null }} word="" />
      </Link>
      <span className={ROW_ACTIONS}>
        <PageLink href={a.page} what={what} />
      </span>
    </div>
  );
}

/** What a news entry's pop-up finishes: the line it came from, who and when, as the row says it, and Mark read. */
function NewsCard({ news, range }: { news: NewsProps; range: DigestRange }) {
  const word = DIGEST_WHO_WORD[news.group];
  return (
    <WhereItStands
      label="What happened"
      glyph={GROUP_GLYPH[news.group]}
      title={<NewsWhat what={news.what} interviewAt={news.interviewAt} />}
      why=""
      who={news.who}
      whoWord={word.charAt(0).toUpperCase() + word.slice(1)}
      age={<When iso={news.at} fallback={news.age} />}
      actions={<MarkReadButton mark={news.mark} next={news.next} range={range} />}
    />
  );
}

/** Where a read stopped at its cap, so nothing here reads as the whole of it. */
const TRUNCATED = "Too many interviews to check them all, so some missing feedback may not be listed.";
const DRAFTS_CAPPED = "Showing your newest 100 unsent drafts.";

/** The cap notes for a section, as one line: its head's hover and its screen-reader text. Null with nothing capped. */
function capNote(truncated: boolean, draftsCapped: boolean): string | null {
  const notes = [truncated ? TRUNCATED : null, draftsCapped ? DRAFTS_CAPPED : null].filter(Boolean);
  return notes.length ? notes.join(" ") : null;
}

/** A section's head (Testbench's inbox `.ib-group`): a soft rounded bar, the sidebar's mark for that work, its name and how many. A cap on its read is its hover, not a grey line under it. */
function SectionHead({ k, label, count, note, n }: { k: SectionKey; label: string; count: number; note: string | null; n: number }) {
  return (
    <h2 id={`inbox-${k}`} style={order(n)} title={note ?? undefined} className="ibx-entry m-0 flex h-11 items-center gap-2.5 rounded-[11px] bg-[color:var(--soft)] px-3.5 font-sans text-[14.5px] leading-none font-medium">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round" className="size-[15px] shrink-0 text-muted-foreground" aria-hidden>
        <path d={SECTION_ICON[k]} />
      </svg>
      {label}
      <CountTile>{count}</CountTile>
      {note ? <span className="sr-only">{note}</span> : null}
    </h2>
  );
}

/** The foot's buttons. A digest cut at its cap says so to a screen reader and on the foot's hover, not in a grey line beside the buttons. */
function DigestFoot({ digest, needs }: { digest: DigestProps; needs: number }) {
  const capped = digest.capped ? "A lot happened in this period, so only the newest updates are listed." : null;
  return (
    <footer title={capped ?? undefined} className="ibx-foot grid grid-cols-[minmax(0,1fr)] gap-2 border-t border-[color:var(--line)] px-6 py-3 sm:flex sm:min-h-[60px] sm:items-center sm:justify-end">
      {capped ? <p className="sr-only">{capped}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href={DONE_HREF} className={cn(button, plain)}>
          Done
        </Link>
        {digest.unread ? (
          <form action={markAllDigestReadAction}>
            <input type="hidden" name="range" value={digest.range} />
            <input type="hidden" name="asOf" value={digest.asOf} />
            <input type="hidden" name="needs" value={needs ? "1" : "0"} />
            <button type="submit" className={cn(button, plain)}>
              Mark all as read
            </button>
          </form>
        ) : null}
      </div>
    </footer>
  );
}

/** Nothing left: the tick and the line. How far back it looked, and any cap on the read, is the line's hover and its screen-reader text, not a line under it. */
function CaughtUp({ range, truncated, draftsCapped }: { range: DigestRange; truncated: boolean; draftsCapped: boolean }) {
  const detail = [`Nothing new in the last ${rangeLabel(range)}.`, capNote(truncated, draftsCapped)].filter(Boolean).join(" ");
  return (
    <div className="ibx-foot grid justify-items-center gap-2 border-t border-[color:var(--line)] px-6 py-16 text-center">
      <StatusGlyph kind="done" className="size-5" />
      <h2 title={detail} className="m-0 font-sans text-[18px] leading-6 font-semibold">
        You&apos;re all caught up<span className="sr-only">. {detail}</span>
      </h2>
      <div className="mt-3 flex items-center gap-2">
        <Link href={DONE_HREF} className={cn(button, plain)}>
          Done
        </Link>
        <Link href="/client/pipeline" className={cn(button, plain)}>
          Open pipeline
        </Link>
      </div>
    </div>
  );
}

function Draft({ draft }: { draft: NonNullable<IssueReaderProps["draft"]> }) {
  return (
    <dl className="m-0 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-[10px] bg-[color:var(--soft)] px-3.5 py-3 text-[13px] shadow-[inset_0_0_0_1px_var(--line)]">
      {draft.from ? (
        <>
          <dt className="text-faint">From</dt>
          <dd className="m-0 min-w-0 break-words">{draft.from}</dd>
        </>
      ) : null}
      <dt className="text-faint">To</dt>
      <dd className="m-0 min-w-0 break-words">{draft.to}</dd>
      <dt className="text-faint">Subject</dt>
      <dd className="m-0 min-w-0 break-words">{draft.subject}</dd>
      <dd className="col-span-2 m-0 mt-2 border-t border-[color:var(--line)] pt-2.5 font-sans text-[14px] leading-[22px] break-words whitespace-pre-wrap">{draft.body}</dd>
    </dl>
  );
}

function Reply({ reply }: { reply: NonNullable<IssueReaderProps["reply"]> }) {
  return (
    <div data-untrusted="candidate-email" className="rounded-[10px] bg-[color:var(--soft)] px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--line)]">
      {reply.subject ? <p className="m-0 mb-2 text-[13px] font-medium break-words">{reply.subject}</p> : null}
      <p className="m-0 font-sans text-[14px] leading-[22px] break-words whitespace-pre-wrap">{reply.body || "The email had no text."}</p>
    </div>
  );
}

function Bar({ issue, range }: { issue: IssueReaderProps; range: DigestRange }) {
  const hint = issue.card.hint;
  // "Open candidate" goes where the pop-up's own Open as a page does, so the bar leaves it to the header.
  const secondary = issue.secondary && issue.secondary.href !== issue.page ? issue.secondary : null;
  if (issue.decision) return <DecisionBar key={issue.decision.key} decision={issue.decision} instance={issue.instance} terms={issue.terms} next={issue.next} range={range} secondary={secondary} hint={hint} />;
  if (issue.fix.type === "send" && issue.draft) return <SendBar key={issue.fix.draftId} fix={issue.fix} draft={issue.draft} instance={issue.instance} next={issue.next} range={range} secondary={secondary} hint={hint} />;
  if (issue.fix.type === "link" || issue.fix.type === "write") return <FixBar fix={issue.fix} instance={issue.instance} next={issue.next} range={range} secondary={secondary} hint={hint} />;
  return null;
}

/**
 * Why these wait is only when ("Was due 4d ago.", "Interview ended 1d ago.",
 * "Last touched 9d ago."): on a whole ticket the card's age, the route and the
 * candidate under it say so already, so the line is the title's hover there.
 */
const WHEN_ONLY: ReadonlySet<IssueReason> = new Set(["overdue", "feedback", "quiet"]);

/** The issue's card: a decision's call, the read and the buttons together, or where anything else stands. */
function IssueCard({ issue, range }: { issue: IssueReaderProps; range: DigestRange }) {
  const brief = !!issue.ticket && WHEN_ONLY.has(issue.instance.reason);
  const extra =
    issue.draft || issue.reply || issue.terms ? (
      <>
        {issue.draft ? <Draft draft={issue.draft} /> : null}
        {issue.reply ? <Reply reply={issue.reply} /> : null}
        {issue.terms ? <OfferTerms lines={issue.terms} /> : null}
      </>
    ) : null;
  const loop = issue.ticket?.loop;
  const hasBar = issue.decision !== null || (issue.fix.type === "send" && issue.draft !== null) || issue.fix.type === "link" || issue.fix.type === "write";
  return issue.decision ? (
    <CallCard
      reads={loop?.feedback ?? []}
      note={loop?.feedbackNote ?? null}
      fact={issue.card.detail}
      head={
        <div className="grid grid-cols-[14px_minmax(0,1fr)] items-start gap-3">
          <span className="pt-[3px]">
            <Glyph kind={REASON_GLYPH[issue.instance.reason]} />
          </span>
          <div className="grid min-w-0 gap-1">
            <b className="font-sans text-[15px] leading-5 font-semibold break-words">{issue.card.title}</b>
            {issue.card.detail ? <span className="text-[13px] break-words text-muted-foreground">{issue.card.detail}</span> : null}
          </div>
        </div>
      }
      actions={<Bar issue={issue} range={range} />}
    >
      {extra}
    </CallCard>
  ) : (
    <WhereItStands
      who={issue.who}
      title={issue.card.title}
      why={brief ? "" : issue.card.detail}
      note={brief ? issue.card.detail : undefined}
      age={issue.age}
      late={issue.kind === "late"}
      glyph={REASON_GLYPH[issue.instance.reason]}
      actions={hasBar ? <Bar issue={issue} range={range} /> : null}
    >
      {extra}
    </WhereItStands>
  );
}

/** An issue with no one to open, a job's approval or an approver not on the job: the card and the story. */
function Reader({ issue, range }: { issue: IssueReaderProps; range: DigestRange }) {
  return (
    <article className="mx-auto grid w-[760px] max-w-full content-start">
      <IssueCard issue={issue} range={range} />
      {issue.story ? (
        <section aria-label="Activity" className="mt-8">
          <h2 className="m-0 mb-2 font-sans text-[15px] leading-5 font-semibold">Activity</h2>
          <ActivityStory entries={issue.story} now={issue.now} />
        </section>
      ) : null}
    </article>
  );
}

/** The route, edge to edge over the candidate (design/tats's `fullBody`). */
function Route({ loop }: { loop: TicketLoop | null }) {
  return loop ? (
    <div className="@container">
      <Loop reader={loop} />
    </div>
  ) : null;
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
  applicants = null,
  applicant = null,
  show = null,
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
  /** What happened lately. Left out, the card is what needs the member alone. */
  digest?: DigestProps;
  /** Who is newly in. Null where it couldn't be read: the section says nothing rather than take the page down. */
  applicants?: ApplicantsProps | null;
  /** The new applicant `?a=` opened, their ticket read in full. */
  applicant?: ApplicantPopupProps | null;
  /** The section `?show=` opened the card on; null is all of them. */
  show?: SectionKey | null;
}) {
  const digest = given ?? { ...NO_DIGEST, total: rows.length, shown: rows.length };
  const popup = issue !== null || person !== null || applicant !== null;
  const newcomers = applicants?.rows ?? [];
  const any = rows.length > 0 || digest.groups.length > 0 || newcomers.length > 0;

  // Each section in the card's order: its head, what needs the member, then what is only news. `n` counts entries down the
  // whole card, so the opening lays them out one after another.
  let n = 0;
  const sections = SECTIONS.map((s) => {
    const needs = rows.filter((r) => sectionOf(r) === s.key);
    const news = digest.groups.filter((g) => DIGEST_SECTION[g.key] === s.key);
    const newsCount = news.reduce((c, g) => c + g.rows.length, 0);
    const count = s.key === "applicants" ? (applicants?.total ?? 0) : needs.length + newsCount;
    // A queue that couldn't be read says nothing, rather than that nobody is new.
    const empty = s.key === "applicants" ? applicants !== null && newcomers.length === 0 : needs.length + newsCount === 0;
    const body = (
      <section key={s.key} aria-labelledby={`inbox-${s.key}`} data-section={s.key} className="grid grid-cols-[minmax(0,1fr)] content-start gap-1">
        <SectionHead k={s.key} label={s.label} count={count} note={s.key === "judgement" ? capNote(truncated, false) : s.key === "routing" ? capNote(false, draftsCapped) : null} n={n++} />
        {s.key === "applicants" ? newcomers.map((a) => <ApplicantEntry key={a.applicationId} a={a} n={n++} />) : null}
        {needs.map((r) => (
          <NeedRow key={r.key} r={r} range={digest.range} n={n++} />
        ))}
        {/* What is only news follows what needs the member, with no label between: its plain weight and its glyph say so. */}
        {news.flatMap((g) => g.rows.map((r) => <InfoRow key={r.id} r={r} group={g.key} range={digest.range} n={n++} />))}
        {s.key === "applicants" && applicants && applicants.total > 0 ? (
          <Link href={applicants.href} style={order(n++)} className={cn("ibx-entry ml-8 justify-self-start", buttonVariants({ variant: "ghost", size: "sm" }))}>
            {applicants.total > newcomers.length ? `All ${applicants.total} in New Applicants` : "Open New Applicants"}
          </Link>
        ) : null}
        {empty ? (
          <p className="ibx-entry m-0 px-3.5 py-4 font-sans text-[13px] text-faint" style={order(n++)}>
            Nothing here right now.
          </p>
        ) : null}
      </section>
    );
    return { key: s.key, label: s.label, count, body };
  });

  return (
    <div className="list-reader flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-[var(--page-gutter)] pt-5 pb-10 md:pt-10">
        <OpeningCard
          play={!popup && !flash}
          sources={digest.sources ?? []}
          reading={readingLine(digest.total)}
          worth={worthLine(digest.shown, digest.total)}
          sections={any ? sections : []}
          show={show}
          popup={popup}
          flash={!popup && flash ? flash : null}
          foot={any ? <DigestFoot digest={digest} needs={rows.length} /> : <CaughtUp range={digest.range} truncated={truncated} draftsCapped={draftsCapped} />}
        />
      </div>
      {/* A whole ticket's head names them and no more: the job and where they stand are the candidate's own head and side card under it, so the subject is for screen readers. */}
      {issue?.ticket ? (
        <IssuePopup issueKey={issue.instance.key} title={issue.ticket.title} subject={<span className="sr-only">{issue.ticket.subject}</span>} home={home} pageHref={issue.page}>
          <Route loop={issue.ticket.loop} />
          {issue.ticket.body(
            <>
              {flash}
              <IssueCard issue={issue} range={digest.range} />
            </>,
          )}
        </IssuePopup>
      ) : issue ? (
        <IssuePopup issueKey={issue.instance.key} title={issue.what} subject={issue.subject} home={home} pageHref={issue.page}>
          <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-3 px-4 pt-5 pb-10 md:px-6">
            {flash ? <div className="mx-auto w-[760px] max-w-full">{flash}</div> : null}
            <Reader issue={issue} range={digest.range} />
          </div>
        </IssuePopup>
      ) : person ? (
        <IssuePopup issueKey={person.key} title={person.title} subject={<span className="sr-only">{person.subject}</span>} home={home} pageHref={person.page}>
          <Route loop={person.loop} />
          {person.body(
            <>
              {flash}
              {person.news ? <NewsCard news={person.news} range={digest.range} /> : null}
              {person.loop?.feedback.length ? <CallCard reads={person.loop.feedback} note={person.loop.feedbackNote} head={null} fact="" actions={null} /> : null}
            </>,
          )}
        </IssuePopup>
      ) : applicant ? (
        // New Applicants' reader as it is there; its subject is for screen readers, as the application under it says the job.
        <IssuePopup issueKey={applicant.key} title={applicant.title} subject={<span className="sr-only">{applicant.subject}</span>} home={home} pageHref={applicant.page}>
          <TicketReader ticket={applicant.ticket} flash={flash} />
        </IssuePopup>
      ) : null}
    </div>
  );
}
