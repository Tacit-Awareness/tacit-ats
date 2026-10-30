import Link from "next/link";
import type { clientTools } from "@tacit-ats/core";
import { KeyList } from "@/components/keys";
import { Avatar, ListReader, Notice, PageBar, textLink } from "@/components/page";
import type { DecisionProps, TermLine } from "@/lib/client/inbox-decisions";
import { ISSUE_KINDS, type IssueFix, type IssueKind } from "@/lib/client/inbox-issues";
import { cn } from "@/lib/utils";
import { ActivityStory } from "../candidates/activity-story";
import { DecisionBar, OfferTerms } from "./decision-bar";
import { FixBar } from "./fix-bar";

// The Inbox's markup, props only (page.tsx does the reads): design/tats's
// #inbox as a list and a reader under one bar. The list is the queue by kind,
// a row each: an icon, what is wrong, who it waits on and why, its age. The
// reader: the same heading, the one fix (fix-bar.tsx, key F) or the decision
// (decision-bar.tsx, keys A, O, R), the card saying what is waiting, an offer's
// terms for the approver reading it, then the candidate's story. Everything a
// member or a candidate wrote renders as text.

export type IssueRow = { key: string; kind: IssueKind; href: string; what: string; who: string | null; line: string; age: string; active: boolean };

export type IssueReaderProps = {
  kind: IssueKind;
  what: string;
  subject: string;
  card: { title: string; detail: string };
  /** An unsent draft, for its author's eyes. */
  draft: { to: string; subject: string; body: string } | null;
  fix: IssueFix;
  /** The buttons and what they confirm, when the fix is a decision. */
  decision: DecisionProps | null;
  /** An offer waiting on this member: its terms, as lines. Null for anything else. */
  terms: TermLine[] | null;
  next: string | null;
  secondary: { label: string; href: string } | null;
  /** Null for an issue with no candidate (a job's approval), or one the member can't read (an approver not on the job). */
  story: clientTools.ActivityEntry[] | null;
  now: number;
};

const ICON: Record<IssueKind, string> = {
  draft: "M2.5 4h11v8.5h-11ZM2.5 4.5 8 8.8l5.5-4.3",
  late: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 4.8V8l2.2 1.3",
  decide: "M3.5 14V2.5M3.5 3h8.5l-2 3 2 3H3.5",
};

const TONE: Record<IssueKind, string> = {
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

function Row({ r }: { r: IssueRow }) {
  return (
    <Link
      href={r.href}
      data-key-item
      aria-current={r.active ? "true" : undefined}
      className={cn(
        "grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-[10px] px-3 py-2.5 transition-colors",
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

function IssueList({ rows, truncated, draftsCapped }: { rows: IssueRow[]; truncated: boolean; draftsCapped: boolean }) {
  return (
    <KeyList title="Inbox" next="Next issue" mode="select" data-tour="inbox" className="grid content-start gap-0.5">
      {ISSUE_KINDS.map((k) => {
        const group = rows.filter((r) => r.kind === k.key);
        if (!group.length) return null;
        return (
          <section key={k.key} aria-label={k.label} className="grid gap-0.5">
            <h2 className="m-0 flex items-center gap-2 px-3 pt-3 pb-1 text-[12.5px] font-medium text-muted-foreground">
              {k.label}
              <span className="font-normal text-faint tabular-nums">{group.length}</span>
            </h2>
            {group.map((r) => (
              <Row key={r.key} r={r} />
            ))}
          </section>
        );
      })}
      {truncated ? <p className="m-0 px-3 pt-3 text-[12.5px] text-faint">Too many interviews to check them all, so some missing feedback may not be listed.</p> : null}
      {draftsCapped ? <p className="m-0 px-3 pt-3 text-[12.5px] text-faint">Showing your newest 100 unsent drafts.</p> : null}
    </KeyList>
  );
}

function Draft({ draft }: { draft: NonNullable<IssueReaderProps["draft"]> }) {
  return (
    <dl className="m-0 mt-3 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-[color:var(--line)] pt-3 text-[13px]">
      <dt className="text-muted-foreground">To</dt>
      <dd className="m-0 min-w-0 break-words">{draft.to}</dd>
      <dt className="text-muted-foreground">Subject</dt>
      <dd className="m-0 min-w-0 break-words">{draft.subject}</dd>
      <dd className="col-span-2 m-0 mt-2 break-words whitespace-pre-wrap">{draft.body}</dd>
    </dl>
  );
}

function Reader({ issue }: { issue: IssueReaderProps }) {
  return (
    <article className="mx-auto grid w-[760px] max-w-full content-start">
      <h1 className="m-0 text-[20px] leading-tight font-semibold tracking-[-0.01em] break-words">{issue.what}</h1>
      <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">{issue.subject}</p>
      {issue.decision ? (
        <DecisionBar key={issue.decision.key} decision={issue.decision} terms={issue.terms} next={issue.next} secondary={issue.secondary} />
      ) : issue.fix.type === "link" || issue.fix.type === "write" ? (
        <FixBar fix={issue.fix} next={issue.next} secondary={issue.secondary} />
      ) : null}
      <section className="mt-5 rounded-[10px] border border-[color:var(--line-strong)] bg-[color:var(--paper)] py-3 pr-3 pl-3.5">
        <div className="flex items-center gap-3">
          <KindIcon kind={issue.kind} className="size-[26px]" />
          <div className="grid min-w-0 gap-px">
            <b className="text-[13.5px] font-medium break-words">{issue.card.title}</b>
            <span className="text-[12.5px] break-words text-muted-foreground">{issue.card.detail}</span>
          </div>
        </div>
        {issue.draft ? <Draft draft={issue.draft} /> : null}
        {issue.terms ? (
          <div className="mt-3 border-t border-[color:var(--line)] pt-3">
            <OfferTerms lines={issue.terms} />
          </div>
        ) : null}
      </section>
      {issue.story ? (
        <section aria-label="Activity" className="mt-7">
          <h2 className="m-0 mb-1 text-[13px] font-medium">Activity</h2>
          <ActivityStory entries={issue.story} now={issue.now} />
        </section>
      ) : null}
    </article>
  );
}

export function InboxView({
  rows,
  issue,
  notice,
  error,
  open,
  truncated,
  draftsCapped,
}: {
  rows: IssueRow[];
  issue: IssueReaderProps | null;
  notice: string | null;
  error: string | null;
  open: boolean;
  truncated: boolean;
  draftsCapped: boolean;
}) {
  const flash = error ? <Notice tone="error">{error}</Notice> : notice ? <Notice>{notice}</Notice> : null;
  if (!issue) {
    return (
      <div className="list-reader flex min-h-0 flex-1 flex-col">
        <PageBar title="Inbox" />
        <div className="grid flex-1 content-center justify-items-center gap-2 p-6 text-center">
          {flash}
          <span aria-hidden className="grid size-11 place-items-center rounded-full bg-[color:var(--green-soft)] text-[color:var(--green)]">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-5">
              <path d="m3.5 8.5 3 3 6-7" />
            </svg>
          </span>
          <h2 className="m-0 mt-1 text-[15px] font-medium">You&apos;re all caught up</h2>
          <p className="m-0 text-[13px] text-muted-foreground">Unsent drafts, overdue work and decisions show up here.</p>
          <Link href="/client/pipeline" className={cn(textLink, "mt-1")}>
            Open Pipeline
          </Link>
        </div>
      </div>
    );
  }
  return (
    <ListReader
      listLabel="Issues"
      readerLabel="Issue"
      open={open}
      bar={<PageBar title="Inbox" count={rows.length} />}
      list={<IssueList rows={rows} truncated={truncated} draftsCapped={draftsCapped} />}
      reader={
        <div className="grid content-start gap-3 md:px-6 md:pt-3 md:pb-10">
          <Link href="/client/inbox" className={cn(textLink, "md:hidden")}>
            ← All issues
          </Link>
          {flash ? <div className="mx-auto w-[760px] max-w-full">{flash}</div> : null}
          <Reader issue={issue} />
        </div>
      }
    />
  );
}
