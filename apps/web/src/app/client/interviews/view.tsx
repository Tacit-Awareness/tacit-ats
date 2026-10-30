import Link from "next/link";
import { Avatar, Empty, ListReader, MiniTitle, PageHeader, Section } from "@/components/page";
import type { GroupKey, Verdict } from "@/lib/client/interview-groups";
import type { LoopPerson, LoopRound as Round } from "@/lib/client/interview-loop";
import { cn } from "@/lib/utils";

// The Interviews page's markup, props only (page.tsx does the reads):
// design/tats's Interviews as a list and a reader. The list is a bar of how
// past interviews went, then Upcoming and the verdict groups, a row each. The
// reader is the candidate's loop as a tree (each round, who ran it and whether
// they filed; this round highlighted, later ones faded), then this
// interview's feedback as far as the member may read it. Notes are the
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

const PILL: Record<Verdict, string> = {
  pass: "bg-[color:var(--green-soft)] text-[color:var(--green)]",
  mixed: "bg-[color:var(--amber-soft)] text-[color:var(--amber)]",
  fail: "bg-[color:var(--red-soft)] text-[color:var(--red)]",
  pending: "bg-[color:var(--soft)] text-muted-foreground",
};

export function VerdictPill({ verdict, label, small = false }: { verdict: Verdict; label?: string; small?: boolean }) {
  return (
    <span className={cn("inline-flex flex-none items-center rounded-full font-medium whitespace-nowrap", small ? "h-5 px-2 text-[11.5px]" : "h-6 px-2.5 text-[12.5px]", PILL[verdict])}>
      {label ?? VERDICT_NAME[verdict]}
    </span>
  );
}

/** How the past interviews went, as one bar and its key. */
function SentimentBar({ counts }: { counts: { verdict: Verdict; n: number }[] }) {
  const shown = counts.filter((c) => c.n > 0);
  if (!shown.length) return null;
  return (
    <div role="img" aria-label={shown.map((c) => `${c.n} ${VERDICT_NAME[c.verdict]}`).join(", ")} className="grid gap-2.5 border-b border-[color:var(--line)] px-2 pt-2 pb-3">
      <div className="flex h-2 gap-0.5">
        {shown.map((c) => (
          <i key={c.verdict} className={cn("min-w-2 rounded", DOT[c.verdict])} style={{ flex: c.n }} />
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

function InterviewList({ groups, counts, toReview }: { groups: ListGroup[]; counts: { verdict: Verdict; n: number }[]; toReview: number }) {
  return (
    <div className="grid content-start gap-1">
      <div className="px-2 pt-2 pb-1">
        <PageHeader title="Interviews" badge={<span className="text-base font-normal text-muted-foreground">{toReview ? `${toReview} read pending` : ""}</span>} />
      </div>
      <SentimentBar counts={counts} />
      {groups.length === 0 ? <Empty className="px-2">No interviews yet.</Empty> : null}
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label} className="grid">
          <h2 className="m-0 flex items-center gap-2 px-2 pt-3.5 pb-1 text-[13px] font-medium">
            <i className={cn("size-2 rounded-full", DOT[g.key])} />
            {g.label}
            <span className="font-normal text-faint">{g.rows.length}</span>
          </h2>
          {g.rows.map((r) => (
            <Link
              key={r.interviewId}
              href={r.href}
              aria-current={r.selected ? "page" : undefined}
              className={cn(
                "grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-2.5 transition-colors",
                r.selected ? "bg-[color:var(--sel)]" : "hover:bg-[color:var(--hover)]",
              )}
            >
              <span className="row-span-2">
                <Avatar name={r.candidate} size="md" />
              </span>
              <b className="truncate text-[13.5px] font-medium">{r.candidate}</b>
              <span className="justify-self-end">
                {r.verdict ? <VerdictPill verdict={r.verdict} small /> : <span className="text-xs text-muted-foreground" title={r.whenTitle}>{r.when}</span>}
              </span>
              <span className="col-span-2 truncate text-[12.5px] text-muted-foreground" title={r.whenTitle}>
                {r.line}
              </span>
            </Link>
          ))}
        </section>
      ))}
    </div>
  );
}

const PERSON_TONE: Record<LoopPerson["tone"], string> = {
  done: "text-[color:var(--green)]",
  waiting: "text-[color:var(--amber)]",
  hidden: "text-muted-foreground",
  none: "text-faint",
};

/** The candidate's loop: a card for them, then each round down a rail, and who ran it. */
function Loop({ reader }: { reader: Reader }) {
  return (
    <Section>
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={reader.candidate} size="xl" />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <b className="truncate text-[14px] font-medium">{reader.candidate}</b>
          <span className="text-[12.5px] text-muted-foreground">{reader.loopLine}</span>
        </div>
        <span className="rounded-full bg-[color:var(--soft)] px-2.5 py-0.5 text-xs text-muted-foreground">{reader.tag}</span>
      </div>
      <ol className="m-0 mt-2 grid list-none gap-1.5 border-l border-[color:var(--line-strong)] pl-0 ml-[21px]">
        {reader.rounds.map((r) => {
          const body = (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-[13px] font-medium">{r.name}</b>
                {r.place === "current" ? <em className="rounded-full bg-[color:var(--accent-soft)] px-2 text-[11.5px] font-medium text-[color:var(--accent)] not-italic">Now</em> : null}
                <span className="text-xs text-faint">{r.status}</span>
                {r.when ? <span className="ml-auto text-xs text-faint">{r.when}</span> : null}
              </div>
              {r.people.length ? (
                <ul className="m-0 grid list-none gap-1 p-0">
                  {r.people.map((p, i) => (
                    <li key={i} className="flex min-w-0 items-center gap-2 text-[12.5px]">
                      <Avatar name={p.name} />
                      <span className="truncate">{p.name}</span>
                      <span className={cn("ml-auto flex-none", PERSON_TONE[p.tone])}>{p.state}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          );
          const cls = cn(
            "ml-5 grid gap-1.5 rounded-lg border px-3 py-2.5",
            r.place === "current" ? "border-[color:var(--accent)] bg-[color:var(--sel)]" : "border-[color:var(--line)] bg-card",
            r.href && "transition-colors hover:border-[color:var(--line-strong)]",
          );
          return (
            <li key={r.key} className={cn("relative", r.place === "later" && "opacity-50")}>
              <span
                aria-hidden
                className={cn(
                  "absolute top-2.5 -left-[11px] z-10 grid size-[21px] place-items-center rounded-full text-[11px] font-semibold",
                  r.place === "current" ? "bg-[color:var(--accent)] text-[color:var(--accent-ink)]" : "bg-[color:var(--raised)] text-muted-foreground shadow-[inset_0_0_0_1px_var(--line-strong)]",
                )}
              >
                {r.n}
              </span>
              {r.href ? (
                <Link href={r.href} className={cls}>
                  {body}
                </Link>
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
      {reader.partial ? <p className="m-0 mt-1 text-xs text-faint">You see the rounds you interview on; the rest of the loop is the hiring team&apos;s.</p> : null}
    </Section>
  );
}

function Feedback({ reader }: { reader: Reader }) {
  return (
    <Section title="Feedback" count={reader.feedback.length || undefined}>
      {reader.feedback.length === 0 ? <Empty>{reader.feedbackNote ?? "No feedback filed yet."}</Empty> : null}
      <div className="grid gap-3">
        {reader.feedback.map((f) => (
          <article key={f.feedbackId} className="grid gap-2 rounded-lg border border-[color:var(--line)] bg-card p-3">
            <header className="flex flex-wrap items-center gap-2">
              <Avatar name={f.interviewer} />
              <b className="text-[13px] font-medium">{f.interviewer}</b>
              <VerdictPill verdict={f.verdict} label={f.recommendation} small />
              {f.rating !== null ? <span className="text-xs text-muted-foreground tabular-nums">{f.rating} / 4</span> : null}
              <span className="ml-auto text-xs text-faint">{f.submitted}</span>
            </header>
            {f.ratings.length ? (
              <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[12.5px]">
                {f.ratings.map((r, i) => (
                  <div key={i} className="contents">
                    <dt className="truncate text-muted-foreground">
                      {r.attribute}
                      {r.note ? <span className="block whitespace-pre-wrap text-faint">{r.note}</span> : null}
                    </dt>
                    <dd className="m-0 text-right tabular-nums">{r.rating} / 4</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {f.notes ? (
              <>
                <MiniTitle>Notes</MiniTitle>
                <p className="m-0 text-[13px] leading-5 break-words whitespace-pre-wrap text-foreground/85">{f.notes}</p>
              </>
            ) : null}
          </article>
        ))}
      </div>
      {reader.feedback.length > 0 && reader.feedbackNote ? <p className="m-0 mt-2 text-xs text-faint">{reader.feedbackNote}</p> : null}
    </Section>
  );
}

function InterviewReader({ reader }: { reader: Reader }) {
  return (
    <article className="mx-auto grid max-w-[760px] gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <Link href="/client/interviews" className="text-[12.5px] text-muted-foreground hover:text-foreground md:hidden">
          ← Interviews
        </Link>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h1 className="m-0 truncate text-[18px] font-semibold tracking-[-0.02em]">{reader.title}</h1>
          <p className="m-0 truncate text-[12.5px] text-muted-foreground">{reader.sub}</p>
        </div>
        {reader.verdict ? <VerdictPill verdict={reader.verdict} /> : null}
      </header>
      <Loop reader={reader} />
      <Feedback reader={reader} />
    </article>
  );
}

export function InterviewsView({
  groups,
  counts,
  toReview,
  reader,
  open,
  readerError,
}: {
  groups: ListGroup[];
  counts: { verdict: Verdict; n: number }[];
  toReview: number;
  reader: Reader | null;
  /** An interview was picked (`?i=`): on a phone the reader replaces the list. */
  open: boolean;
  readerError: string | null;
}) {
  return (
    <ListReader
      listLabel="Interviews"
      readerLabel="Interview"
      open={open}
      list={<InterviewList groups={groups} counts={counts} toReview={toReview} />}
      reader={
        reader ? (
          <InterviewReader reader={reader} />
        ) : (
          <Empty className="p-2">{readerError ?? "Pick an interview to read its loop and feedback."}</Empty>
        )
      }
    />
  );
}
