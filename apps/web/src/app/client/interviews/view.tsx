import Link from "next/link";
import { KeyList } from "@/components/keys";
import type * as React from "react";
import { Avatar, Empty, ListReader, PageBar } from "@/components/page";
import type { GroupKey, Verdict } from "@/lib/client/interview-groups";
import type { LoopPerson, LoopRound as Round } from "@/lib/client/interview-loop";
import { cn } from "@/lib/utils";
import { LoopRow } from "./loop-row";
import { ReviewCount, ReviewKey, ReviewProvider, ReviewRow } from "./review";

// The Interviews page's markup, props only (page.tsx does the reads):
// design/tats's Interviews as a list and a reader under one bar. The list is a
// bar of how past interviews went, then Upcoming and the verdict groups, a row
// each, a past one with its reviewed check (review.tsx). The reader is one
// card: its head, the candidate's loop as a path (each round, who ran it and whether
// they filed; held ones solid, this one outlined, the next marked, later ones
// stepped back), then this interview's feedback as far as the member may read it, then the member's own
// Granola notes when page.tsx passes them (./granola.tsx). Notes are the
// interviewer's own words: plain text, never markup.

export type ListRow = {
  interviewId: string;
  href: string;
  candidate: string;
  line: string;
  /** Upcoming: when it starts; past: its verdict. */
  when: string;
  whenTitle: string;
  verdict: Verdict | null;
  selected: boolean;
};

export type ListGroup = { key: GroupKey; label: string; rows: ListRow[] };

export type LoopRound = Omit<Round, "interviewId"> & { href: string | null };

export type FeedbackCard = {
  feedbackId: string;
  interviewer: string;
  recommendation: string;
  verdict: Verdict;
  rating: number | null;
  submitted: string;
  ratings: { attribute: string; rating: number; note: string | null }[];
  notes: string;
};

export type Reader = {
  title: string;
  sub: string;
  verdict: Verdict | null;
  candidate: string;
  tag: string;
  loopLine: string;
  rounds: LoopRound[];
  /** Plan steps this member cannot see, an interviewer reading only their own interviews. */
  partial: boolean;
  feedback: FeedbackCard[];
  feedbackNote: string | null;
};

const VERDICT_NAME: Record<Verdict, string> = { pass: "Pass", mixed: "Mixed", fail: "Fail", pending: "Read pending" };

const DOT: Record<GroupKey, string> = {
  upcoming: "bg-[color:var(--accent)]",
  pass: "bg-[color:var(--green)]",
  mixed: "bg-[color:var(--amber)]",
  fail: "bg-[color:var(--red)]",
  pending: "bg-[color:var(--line-strong)]",
};

/** design/tats's `.vpill` as its v50 calm pass left it: a neutral soft pill, ink text, a 7px dot carrying the colour. */
export function VerdictPill({ verdict, label, small = false }: { verdict: Verdict; label?: string; small?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex flex-none items-center gap-1.5 rounded-full bg-[color:var(--soft)] font-medium whitespace-nowrap text-foreground",
        small ? "h-5 px-2 text-[11.5px]" : "h-6 px-2.5 text-[12.5px]",
      )}
    >
      <i className={cn("size-[7px] rounded-full", verdict === "pending" ? "bg-[color:var(--faint)]" : DOT[verdict])} />
      {label ?? VERDICT_NAME[verdict]}
    </span>
  );
}

/** How the past interviews went, as one bar and its key. */
function SentimentBar({ counts }: { counts: { verdict: Verdict; n: number }[] }) {
  const shown = counts.filter((c) => c.n > 0);
  if (!shown.length) return null;
  return (
    <div role="img" aria-label={shown.map((c) => `${c.n} ${VERDICT_NAME[c.verdict]}`).join(", ")} className="grid gap-2.5 border-b border-[color:var(--line)] px-[18px] pt-3 pb-3.5">
      <div className="flex h-2 gap-0.5">
        {shown.map((c) => (
          <i key={c.verdict} className={cn("min-w-2", DOT[c.verdict])} style={{ flex: c.n }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-muted-foreground">
        {shown.map((c) => (
          <span key={c.verdict} className="inline-flex items-center gap-1.5">
            <i className={cn("size-2 rounded-full", DOT[c.verdict])} />
            {VERDICT_NAME[c.verdict]}
            <b className="font-medium text-foreground tabular-nums">{c.n}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function InterviewList({ groups, counts }: { groups: ListGroup[]; counts: { verdict: Verdict; n: number }[] }) {
  return (
    <KeyList title="Interviews" next="Next interview" mode="select" className="-mx-2 -mt-2 grid content-start" data-tour="interviews">
      <SentimentBar counts={counts} />
      {groups.length === 0 ? <Empty className="px-[18px] pt-3">No interviews yet.</Empty> : null}
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label} className="grid">
          <h2 className="m-0 flex items-center gap-2 px-[18px] pt-5 pb-1.5 text-[13px] font-medium">
            <i className={cn("size-2 rounded-full", DOT[g.key])} />
            {g.label}
            <span className="font-normal text-faint tabular-nums">{g.rows.length}</span>
          </h2>
          {g.rows.map((r) => (
            <ReviewRow key={r.interviewId} id={r.interviewId} candidate={r.candidate} selected={r.selected}>
              <Link
                href={r.href}
                data-key-item
                aria-current={r.selected ? "page" : undefined}
                className="grid min-w-0 grid-cols-[32px_minmax(0,1fr)] items-center gap-x-3 gap-y-[3px] py-3 pr-3 pl-[18px]"
              >
                <span className="row-span-2">
                  <Avatar name={r.candidate} size="row" candidate />
                </span>
                <b className="truncate text-[13.5px] font-medium group-data-[reviewed]:font-normal group-data-[reviewed]:text-muted-foreground">{r.candidate}</b>
                <span className="truncate text-[12.5px] text-faint" title={r.whenTitle}>
                  {r.line}
                </span>
              </Link>
            </ReviewRow>
          ))}
        </section>
      ))}
    </KeyList>
  );
}

const PERSON_DOT: Record<LoopPerson["tone"], string> = {
  done: "bg-[color:var(--green)]",
  waiting: "bg-[color:var(--amber)]",
  hidden: "bg-[color:var(--faint)]",
  none: "bg-[color:var(--faint)]",
};

/** The four looks of a round on the path (`.pth-s`), as design/tats's v74. */
function roundLook(r: LoopRound) {
  if (r.place === "current") return "border-[color:var(--accent)] bg-[color:var(--raised)] shadow-[var(--shadow),0_0_0_1.5px_var(--accent)]";
  if (r.next) return "border-[color:var(--line-strong)] bg-[color:var(--raised)] shadow-[var(--shadow),inset_0_3px_0_var(--accent)]";
  if (r.status === "Held") return "border-[color:var(--line)] bg-[color:var(--raised)] shadow-[var(--shadow)]";
  return "border-[color:var(--line-strong)] text-muted-foreground";
}

/** The arrow into a round takes the look of the round it reaches. */
function Arrow({ to }: { to: LoopRound }) {
  const tone = to.next ? "text-[color:var(--accent)]" : to.place === "current" || to.status === "Held" ? "text-foreground" : "text-[color:var(--line-strong)]";
  return (
    <span aria-hidden className={cn("relative h-0.5 w-7 flex-none self-center bg-current", tone)}>
      <i className="absolute -top-1 right-0 border-y-[5px] border-l-[6px] border-y-transparent border-l-current" />
    </span>
  );
}

function RoundCard({ round: r }: { round: LoopRound }) {
  const steppedBack = r.place !== "current" && !r.next && r.status !== "Held";
  const flag = [r.place === "current" ? "This interview" : null, r.next ? "Up next" : null].filter(Boolean).join(" · ");
  const body = (
    <>
      <span className="flex items-start gap-2 text-[13.5px] leading-5">
        <span className="grid size-5 flex-none place-items-center bg-[color:var(--soft)] text-[11.5px] text-muted-foreground tabular-nums">{r.n}</span>
        <b className="min-w-0 font-medium [overflow-wrap:anywhere]">{r.name}</b>
      </span>
      <span className="flex flex-wrap gap-x-1.5 text-[11.5px] leading-4">
        {flag ? <em className="font-medium text-[color:var(--accent)] not-italic">{flag}</em> : null}
        <span className="text-faint">{[r.status, r.when].filter(Boolean).join(" · ")}</span>
      </span>
      {r.people.map((p, j) => (
        <span key={j} className="flex min-w-0 items-center gap-2">
          <span className={cn("flex-none", steppedBack && "opacity-60")}>
            <Avatar name={p.name} size="lg" />
          </span>
          <span className="grid min-w-0 leading-tight">
            <b className="truncate text-[12.5px] font-medium" title={p.name}>
              {p.name}
            </b>
            <span className="inline-flex items-center gap-[5px] text-[12px] text-muted-foreground">
              <i className={cn("size-1.5 flex-none rounded-full", PERSON_DOT[p.tone])} />
              {p.state}
            </span>
          </span>
        </span>
      ))}
    </>
  );
  const card = cn("grid w-40 min-w-0 flex-1 content-start gap-2 border p-3", roundLook(r));
  return r.href ? (
    <Link href={r.href} className={cn(card, "transition-colors hover:border-[color:var(--faint)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]")}>
      {body}
    </Link>
  ) : (
    <div className={card}>{body}</div>
  );
}

/**
 * The candidate's loop as design/tats's path (`.pth`): a summary line, then the
 * rounds left to right joined by arrows. A held round is solid, the one being
 * read outlined in the accent, the next one marked Up next, the rest step back;
 * each state is in words on the card, not only in its colour. The row scrolls
 * sideways inside itself (LoopRow) and never widens the page.
 */
export function Loop({ reader }: { reader: Reader }) {
  return (
    <section aria-label="Interview loop" className="grid gap-3 border-b border-[color:var(--line-strong)] bg-[color:var(--surface)] px-4 pt-4 pb-3 @2xl:px-[26px]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <p className="m-0 min-w-0 text-[13.5px]">
          <b className="font-medium">{reader.candidate}</b>
          <span className="text-muted-foreground"> · {reader.loopLine}</span>
        </p>
        <span className="inline-flex h-6 flex-none items-center bg-[color:var(--soft)] px-2.5 text-[12.5px] font-medium whitespace-nowrap text-muted-foreground">{reader.tag}</span>
      </div>
      {reader.rounds.length ? (
        <LoopRow current={reader.rounds.find((r) => r.place === "current")?.key ?? null}>
          {reader.rounds.map((r, i) => (
            <li key={r.key} aria-current={r.place === "current" ? "step" : undefined} className="flex max-w-[300px] flex-[1_0_auto] items-stretch">
              {i > 0 ? <Arrow to={r} /> : null}
              <RoundCard round={r} />
            </li>
          ))}
        </LoopRow>
      ) : null}
      {reader.partial ? <p className="m-0 text-xs text-faint">You see the rounds you interview on; the rest of the loop is the hiring team&apos;s.</p> : null}
    </section>
  );
}

function Feedback({ reader }: { reader: Reader }) {
  return (
    <section aria-label="Feedback" className="grid gap-3.5 px-4 pt-5 pb-[22px] @2xl:px-[26px]">
      <div className="flex items-baseline justify-between gap-3 text-[14.5px]">
        <b className="font-medium">Feedback</b>
        {reader.feedback.length ? <span className="text-[13px] text-faint tabular-nums">{reader.feedback.length}</span> : null}
      </div>
      {reader.feedback.length === 0 ? <Empty className="my-0">{reader.feedbackNote ?? "No feedback filed yet."}</Empty> : null}
      {reader.feedback.map((f) => (
        <article key={f.feedbackId} className="grid gap-2.5 border-t border-[color:var(--line)] pt-3.5 first-of-type:border-t-0 first-of-type:pt-0">
          <header className="flex flex-wrap items-center gap-2">
            <Avatar name={f.interviewer} size="lg" />
            <b className="text-[13.5px] font-medium">{f.interviewer}</b>
            <VerdictPill verdict={f.verdict} label={f.recommendation} small />
            {f.rating !== null ? <span className="text-xs text-muted-foreground tabular-nums">{f.rating} / 4</span> : null}
            <span className="ml-auto text-xs text-faint">{f.submitted}</span>
          </header>
          {f.ratings.length ? (
            <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[13px]">
              {f.ratings.map((r, i) => (
                <div key={i} className="contents">
                  <dt className="text-muted-foreground">
                    {r.attribute}
                    {r.note ? <span className="block whitespace-pre-wrap text-faint">{r.note}</span> : null}
                  </dt>
                  <dd className="m-0 text-right tabular-nums">{r.rating} / 4</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {f.notes ? <p className="m-0 border-l-2 border-[color:var(--line-strong)] py-0.5 pl-3.5 text-[14px] leading-normal break-words whitespace-pre-wrap">{f.notes}</p> : null}
        </article>
      ))}
      {reader.feedback.length > 0 && reader.feedbackNote ? <p className="m-0 text-xs text-faint">{reader.feedbackNote}</p> : null}
    </section>
  );
}

/** One `.rc` card: the head, the loop, the feedback, the member's Granola notes. */
function InterviewReader({ reader, granola }: { reader: Reader; granola: React.ReactNode }) {
  return (
    <article className="@container mx-auto max-w-[860px] overflow-hidden border border-[color:var(--line)] bg-[color:var(--paper)]">
      <header className="flex flex-wrap items-center gap-4 border-b border-[color:var(--line)] px-4 py-4 @2xl:px-[26px] @2xl:py-[22px]">
        <Link href="/client/interviews" className="text-[12.5px] text-muted-foreground hover:text-foreground md:hidden">
          ← Interviews
        </Link>
        <div className="grid min-w-0 flex-1">
          <h1 className="m-0 truncate text-[19px] font-medium tracking-[-0.01em]">{reader.title}</h1>
          <p className="m-0 mt-1 truncate text-[13.5px] text-muted-foreground">{reader.sub}</p>
        </div>
        {reader.verdict ? <VerdictPill verdict={reader.verdict} /> : null}
      </header>
      <Loop reader={reader} />
      <Feedback reader={reader} />
      {granola}
    </article>
  );
}

export function InterviewsView({
  groups,
  counts,
  reviewed,
  reader,
  granola,
  open,
  readerError,
}: {
  groups: ListGroup[];
  counts: { verdict: Verdict; n: number }[];
  /** The past interviews this member has checked off; null when that could not be read. */
  reviewed: string[] | null;
  reader: Reader | null;
  /** The member's own Granola notes on this interview, already behind its Suspense boundary. Null when there can be none. */
  granola: React.ReactNode;
  /** An interview was picked (`?i=`): on a phone the reader replaces the list. */
  open: boolean;
  readerError: string | null;
}) {
  const past = groups.filter((g) => g.key !== "upcoming").flatMap((g) => g.rows.map((r) => r.interviewId));
  const selected = groups.flatMap((g) => g.rows).find((r) => r.selected)?.interviewId ?? null;
  return (
    <ReviewProvider past={past} saved={reviewed} selected={selected}>
      <ListReader
        listLabel="Interviews"
        readerLabel="Interview"
        open={open}
        bar={<PageBar title="Interviews" count={<ReviewCount />} />}
        list={
          <>
            <InterviewList groups={groups} counts={counts} />
            <ReviewKey />
          </>
        }
        reader={
          reader ? (
            <InterviewReader reader={reader} granola={granola} />
          ) : (
            <Empty className="p-2">{readerError ?? "Pick an interview to read its loop and feedback."}</Empty>
          )
        }
      />
    </ReviewProvider>
  );
}
