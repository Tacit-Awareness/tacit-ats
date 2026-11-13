import Link from "next/link";
import { KeyList } from "@/components/keys";
import type * as React from "react";
import { Empty, ListReader, PageBar, Pill, StatusGlyph, type GlyphKind } from "@/components/page";
import type { GroupKey, Verdict } from "@/lib/client/interview-groups";
import type { LoopPerson, LoopRound as Round, RouteNode, RouteState, RouteView } from "@/lib/client/interview-loop";
import { cn } from "@/lib/utils";
import { LoopRow, RouteRow } from "./loop-row";
import { ProcessSheet } from "./process-sheet";
import { ReviewCount, ReviewKey, ReviewProvider, ReviewRow } from "./review";

// The Interviews page's markup, props only (page.tsx does the reads), in
// Tacit Testbench's list and reader. The list is a bar of how past interviews
// went, then Upcoming and the verdict groups under their bands, a Linear-style
// row each with its status square, a past one with its reviewed check
// (review.tsx). The reader is Testbench's review: the candidate and round on
// the pane, then cards for the candidate's loop as steps (each round, who ran
// it and whether they filed; this one raised, held ones solid, later ones
// dashed), this interview's feedback as far as the member may read it, each
// filing a chat transcript (ReadThread), and the member's own Granola notes
// when page.tsx passes them (./granola.tsx). Notes are the interviewer's own
// words: plain text, never markup.

export type ListRow = {
  interviewId: string;
  href: string;
  candidate: string;
  /** The round, who ran it and when, in one line: the row's hover. */
  line: string;
  /** The round, and who ran it, as the row's second line. */
  step: string;
  who: string | null;
  /** Upcoming: when it starts; past: how long ago. */
  when: string;
  whenTitle: string;
  verdict: Verdict | null;
  /** Upcoming and already started: its square is live. */
  live: boolean;
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
  /** The company's process with this candidate on it; null keeps the row of rounds. */
  route: RouteView<LoopRound> | null;
  /** Onboarding's process step, which an admin's Edit the process opens over the reader (process-sheet.tsx). Null for anyone else. */
  editProcess: string | null;
  /** Plan steps this member cannot see, an interviewer reading only their own interviews. */
  partial: boolean;
  feedback: FeedbackCard[];
  feedbackNote: string | null;
};

/** What the loop draws from, also the Inbox's whole ticket for a decision. */
export type LoopProps = Pick<Reader, "candidate" | "tag" | "loopLine" | "rounds" | "route" | "editProcess" | "partial">;

const VERDICT_NAME: Record<Verdict, string> = { pass: "Pass", mixed: "Mixed", fail: "Fail", pending: "Read pending" };

/** Testbench's square status glyphs: a pass is done, a fail closed, a mixed read half way, one still to come in waits on its reader. */
const VERDICT_GLYPH: Record<Verdict, GlyphKind> = { pass: "done", fail: "closed", mixed: "half", pending: "pending" };

/** A read still to come in is waiting on a person, not working, so its corner stays `still`. */
export function VerdictGlyph({ verdict, className }: { verdict: Verdict; className?: string }) {
  return <StatusGlyph kind={VERDICT_GLYPH[verdict]} color={verdict === "mixed" ? "var(--amber)" : undefined} still className={className} />;
}

/** Colour only where it means something: a pass green, a fail red, a mixed read amber, one still to come in grey. */
const VERDICT_TONE = { pass: "green", fail: "red", mixed: "amber", pending: "grey" } as const satisfies Record<Verdict, string>;

/** A verdict as Testbench's `.tag`: Geist Mono on a flat fill. */
export function VerdictPill({ verdict, label, small = false }: { verdict: Verdict; label?: string; small?: boolean }) {
  return (
    <Pill tone={VERDICT_TONE[verdict]} className={cn("flex-none", small && "h-5 px-1.5 text-[11.5px]")}>
      {label ?? VERDICT_NAME[verdict]}
    </Pill>
  );
}

const BAR: Record<Verdict, string> = {
  pass: "bg-[color:var(--green)]",
  mixed: "bg-[color:var(--amber)]",
  fail: "bg-[color:var(--red)]",
  pending: "bg-[color:color-mix(in_srgb,var(--ink-4)_45%,transparent)]",
};

/** How the past interviews went: one rounded bar split by verdict, and each part's name and count under it, in the same order. */
function ResultBar({ counts }: { counts: { verdict: Verdict; n: number }[] }) {
  const shown = counts.filter((c) => c.n > 0);
  if (!shown.length) return null;
  return (
    <div role="img" aria-label={shown.map((c) => `${c.n} ${VERDICT_NAME[c.verdict]}`).join(", ")} className="grid gap-2.5 border-b border-[color:var(--line)] px-4 pt-4 pb-3.5">
      <div className="flex h-2 gap-[3px]">
        {shown.map((c) => (
          <i key={c.verdict} title={`${VERDICT_NAME[c.verdict]} ${c.n}`} className={cn("min-w-1.5 rounded-full", BAR[c.verdict])} style={{ flex: c.n }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-faint">
        {shown.map((c) => (
          <span key={c.verdict} className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
            {VERDICT_NAME[c.verdict]}
            <b className="font-medium text-foreground tabular-nums">{c.n}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** A row's square: its verdict, or for one still ahead, live once it has started and empty until then. */
function RowGlyph({ row }: { row: ListRow }) {
  if (row.verdict) return <VerdictGlyph verdict={row.verdict} />;
  return <StatusGlyph kind={row.live ? "live" : "empty"} />;
}

function GroupGlyph({ group }: { group: GroupKey }) {
  return group === "upcoming" ? <StatusGlyph kind="empty" /> : <VerdictGlyph verdict={group} />;
}

function InterviewList({ groups, counts }: { groups: ListGroup[]; counts: { verdict: Verdict; n: number }[] }) {
  return (
    <KeyList title="Interview Judgement" next="Next interview" mode="select" rows className="-mx-2 -mt-2 grid content-start" data-tour="interviews">
      <ResultBar counts={counts} />
      {groups.length === 0 ? <Empty className="px-4 pt-3">No interviews yet.</Empty> : null}
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label} className="grid">
          <h2 className="m-0 flex h-10 items-center gap-2.5 border-b border-[color:var(--line)] bg-[color:var(--band)] px-4 font-mono text-[13px] font-medium tracking-normal">
            <GroupGlyph group={g.key} />
            {g.label}
            <span className="font-normal text-faint tabular-nums">{g.rows.length}</span>
          </h2>
          {g.rows.map((r) => (
            <ReviewRow key={r.interviewId} id={r.interviewId} candidate={r.candidate} selected={r.selected}>
              <Link
                href={r.href}
                data-key-item
                aria-current={r.selected ? "page" : undefined}
                title={r.line}
                className="grid min-w-0 grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-2.5 pr-3 pl-4"
              >
                <RowGlyph row={r} />
                <b className="truncate text-[13px] font-medium group-data-[reviewed]:font-normal group-data-[reviewed]:text-muted-foreground">{r.candidate}</b>
                <span className="text-[12px] whitespace-nowrap text-faint tabular-nums" title={r.whenTitle}>
                  {r.when}
                </span>
                <span className="col-span-2 col-start-2 flex min-w-0 gap-3 text-[12px] text-faint">
                  <span className="truncate">{r.step}</span>
                  {r.who ? <span className="min-w-0 flex-none truncate max-w-[55%]">{r.who}</span> : null}
                </span>
              </Link>
            </ReviewRow>
          ))}
        </section>
      ))}
    </KeyList>
  );
}

/** Lines the reads build as "a · b · c", drawn as separate facts with space between, never a dot. */
const facts = (line: string) => line.split(" · ").filter(Boolean);

/** A round's square: held done, cancelled closed, booked an empty frame, not yet booked a dashed one. */
function roundGlyph(r: LoopRound): GlyphKind {
  if (r.status === "Held") return "done";
  if (r.status === "Cancelled") return "closed";
  return r.status === "Booked" ? "empty" : "lapsed";
}

const PERSON_GLYPH: Record<LoopPerson["tone"], { kind: GlyphKind; color?: string }> = {
  done: { kind: "done" },
  waiting: { kind: "empty", color: "var(--amber)" },
  hidden: { kind: "lapsed" },
  none: { kind: "empty" },
};

/** Who ran a round, and whether they filed: the name whole, its state under it. */
function Person({ person: p }: { person: LoopPerson }) {
  const g = PERSON_GLYPH[p.tone];
  return (
    <span className="grid min-w-0 gap-0.5 text-[12px] leading-4">
      <span className="font-medium text-foreground [overflow-wrap:break-word]">{p.name}</span>
      <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <StatusGlyph kind={g.kind} color={g.color} className="size-3" />
        {p.state}
      </span>
    </span>
  );
}

/** The route graph's people line: one row each, as the graph's cards have a fixed height. */
function RoutePerson({ person: p }: { person: LoopPerson }) {
  const g = PERSON_GLYPH[p.tone];
  return (
    <span className="flex h-[22px] min-w-0 items-center gap-2 text-[12px]">
      <span className="min-w-0 truncate text-foreground" title={p.name}>
        {p.name}
      </span>
      <span className="ml-auto inline-flex min-w-0 flex-none items-center gap-1.5 text-muted-foreground" title={p.state}>
        <StatusGlyph kind={g.kind} color={g.color} className="size-3" />
        {p.state}
      </span>
    </span>
  );
}

/**
 * Testbench's steps (StageSteps' look): the round being read raised off the
 * well, a held one solid, the next one and the ones after it dashed, the later
 * ones stepped back.
 */
function roundLook(r: LoopRound) {
  if (r.place === "current") return "border-transparent bg-[color:var(--raised)] shadow-[var(--shadow)]";
  if (r.next) return "border-dashed border-[color:var(--field)]";
  if (r.status === "Held") return "border-[color:var(--line-strong)]";
  return "border-dashed border-[color:var(--line-strong)] text-muted-foreground";
}

/** Before a round: a quiet chevron in the gap, the way through read left to right (and on, when the row wraps). */
function Arrow() {
  return (
    <svg data-arrow viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="absolute top-1/2 -left-[16px] size-3.5 -translate-y-1/2 text-[color:var(--ink-4)]">
      <path d="M6 3.5l4.5 4.5L6 12.5" />
    </svg>
  );
}

/** "This interview", "Up next": in words, in the accent. On a step they may wrap; on the graph's one-line cards they hold their width. */
function Flags({ flags, wrap = false }: { flags: string[]; wrap?: boolean }) {
  return flags.map((f) => (
    <em key={f} className={cn("font-medium text-[color:var(--accent)] not-italic", wrap ? "min-w-0" : "flex-none")}>
      {f}
    </em>
  ));
}

function RoundCard({ round: r }: { round: LoopRound }) {
  const steppedBack = r.place !== "current" && !r.next && r.status !== "Held";
  const flags = [r.place === "current" ? "This interview" : null, r.next ? "Up next" : null].filter((f): f is string => !!f);
  const body = (
    <>
      <b className="min-w-0 text-[13px] leading-5 font-medium [overflow-wrap:break-word]">{r.name}</b>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] leading-4">
        <Flags flags={flags} wrap />
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-faint">
          {/* In a narrow reader the step's own look carries its state, and the square gives its room to the words. */}
          <StatusGlyph kind={roundGlyph(r)} className="hidden size-3 @2xl:block" />
          {r.status}
        </span>
        {r.when ? <span className="text-faint">{r.when}</span> : null}
      </span>
      {r.people.length ? (
        <span className={cn("mt-0.5 grid gap-1.5 border-t border-[color:var(--line)] pt-2", steppedBack && "opacity-70")}>
          {r.people.map((p, j) => (
            <Person key={j} person={p} />
          ))}
        </span>
      ) : null}
    </>
  );
  const card = cn("grid min-w-0 flex-1 content-start gap-1.5 rounded-[10px] border p-2.5 @2xl:p-3", roundLook(r));
  return r.href ? (
    <Link href={r.href} className={cn(card, "transition-colors hover:bg-[color:var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]", r.place === "current" && "hover:bg-[color:var(--raised)]")}>
      {body}
    </Link>
  ) : (
    <div className={card}>{body}</div>
  );
}

const ROUTE_LOOK: Record<RouteState, string> = {
  done: "border-[color:var(--line-strong)] bg-[color:var(--paper)]",
  view: "border-transparent bg-[color:var(--raised)] shadow-[var(--shadow)]",
  up: "border-dashed border-[color:var(--field)] bg-[color:var(--paper)]",
  todo: "border-dashed border-[color:var(--line-strong)] text-muted-foreground",
  off: "border-dashed border-[color:var(--line)] text-faint opacity-55",
  closed: "border-[color:var(--line-strong)] bg-[color:var(--soft-strong)] text-muted-foreground",
};

const ROUTE_EDGE: Record<RouteView<LoopRound>["edges"][number]["tone"], string> = {
  off: "text-[color:var(--line)]",
  todo: "text-[color:var(--line-strong)]",
  done: "text-[color:var(--ink-4)]",
  up: "text-[color:var(--accent)]",
};

const ROUTE_STATE: Record<RouteState, string> = { done: "passed", view: "this interview", up: "up next", todo: "still to come", off: "another team's branch", closed: "closed" };

function RouteCard({ node: n }: { node: RouteNode<LoopRound> }) {
  const place = { left: n.x, top: n.y, width: n.w, height: n.h };
  const box = "absolute m-0 flex min-w-0 list-none rounded-[8px] border";
  const current = n.state === "view" ? ("step" as const) : undefined;
  const flags = n.flag ? facts(n.flag) : [];
  if (n.kind !== "stage") {
    return (
      <li
        aria-current={current}
        style={place}
        className={cn(box, "items-center justify-center gap-1.5 px-2 text-[12.5px]", n.kind === "route" ? "border-dashed border-[color:var(--line-strong)] bg-[color:var(--soft)] text-muted-foreground" : ROUTE_LOOK[n.state])}
      >
        <b className="truncate font-medium" title={n.label}>
          {n.label}
        </b>
        {flags.length ? (
          <span className="flex flex-none gap-1.5 text-[11.5px]">
            <Flags flags={flags} />
          </span>
        ) : null}
        <span className="sr-only">{ROUTE_STATE[n.state]}</span>
      </li>
    );
  }
  const r = n.round;
  // A card here has one line for its facts: the round's status is its square (named on hover and to a screen reader), so the line keeps room for the flag and when.
  const line = r ? [r.when] : [n.who];
  if (r && !r.people.length && n.who) line.push(n.who);
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        {r ? <StatusGlyph kind={roundGlyph(r)} title={r.status} className="size-3" /> : null}
        <b className="truncate text-[12.5px] leading-[18px] font-medium" title={n.label}>
          {n.label}
        </b>
      </span>
      <span className="flex min-w-0 gap-2 text-[11.5px] leading-4">
        <Flags flags={flags} />
        {line.filter(Boolean).map((t, i) => (
          <span key={i} className="truncate text-faint">
            {t}
          </span>
        ))}
      </span>
      {r?.people.map((p, i) => <RoutePerson key={i} person={p} />)}
      <span className="sr-only">{ROUTE_STATE[n.state]}</span>
    </>
  );
  const card = "grid h-full w-full min-w-0 content-start rounded-[7px] px-2.5 py-2";
  return (
    <li aria-current={current} style={place} className={cn(box, ROUTE_LOOK[n.state])}>
      {r?.href ? (
        <Link href={r.href} className={cn(card, "transition-colors hover:bg-[color:var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]")}>
          {body}
        </Link>
      ) : (
        <div className={card}>{body}</div>
      )}
    </li>
  );
}

/** design/tats's routing graph: the way through, the branch for this job's team lit and the others faded. */
function Route({ route }: { route: RouteView<LoopRound> }) {
  const current = route.nodes.find((n) => n.state === "view")?.id ?? null;
  return (
    <RouteRow current={current} width={route.width} height={route.height}>
      <svg aria-hidden width={route.width} height={route.height} className="absolute inset-0">
        {route.edges.map((e) => (
          <g key={e.id} className={ROUTE_EDGE[e.tone]}>
            <path d={e.d} fill="none" stroke="currentColor" strokeWidth={e.tone === "off" || e.tone === "todo" ? 1.25 : 1.5} />
            <path d={e.arrow} fill="currentColor" />
          </g>
        ))}
      </svg>
      <ol className="m-0 list-none p-0">
        {route.nodes.map((n) => (
          <RouteCard key={n.id} node={n} />
        ))}
      </ol>
    </RouteRow>
  );
}

/**
 * The candidate's loop as Testbench's steps: a heading with where they are,
 * then the rounds left to right in a recessed well. The round being read is
 * raised, a held one solid, the next one marked Up next, later ones dashed;
 * each state is in words on the card, not only in its look. The row scrolls
 * sideways inside itself (LoopRow) and never widens the page. No chrome of its
 * own beyond that, so the Interviews reader sets it in a card and the Inbox's
 * ticket edge to edge. Who and the job (`loopLine`) are the heading's hover.
 */
export function Loop({ reader }: { reader: LoopProps }) {
  const { route } = reader;
  const rows = route ? route.offPlan : reader.rounds;
  return (
    <section aria-label="Interview loop" className="grid gap-3.5 px-4 pt-4 pb-5 @2xl:px-6">
      <div className="flex min-h-[30px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="m-0 min-w-0 font-sans text-[15px] leading-[22px] font-semibold tracking-[-0.01em]" title={[reader.candidate, ...facts(reader.loopLine)].join("\n")}>
          Interview loop
          <span className="sr-only">
            {[reader.candidate, ...facts(reader.loopLine)].map((f) => (
              <span key={f}>, {f}</span>
            ))}
          </span>
        </h2>
        <span className="flex flex-none items-center gap-2">
          <Pill>{reader.tag}</Pill>
          {reader.editProcess ? <ProcessSheet href={reader.editProcess} /> : null}
        </span>
      </div>
      {route ? <Route route={route} /> : null}
      {route && route.offPlan.length ? <p className="m-0 text-[12px] text-faint">Not on the plan</p> : null}
      {rows.length ? (
        <LoopRow current={rows.find((r) => r.place === "current")?.key ?? null} label={route ? "Rounds not on the plan" : undefined}>
          {rows.map((r, i) => (
            // Equal shares of the well, never under 104px: a normal loop shows every round whole, and a long one wraps.
            <li key={r.key} aria-current={r.place === "current" ? "step" : undefined} className={cn("relative flex max-w-[300px] min-w-[104px] flex-[1_1_0] items-stretch", i > 0 && "ml-[18px]")}>
              {i > 0 ? <Arrow /> : null}
              <RoundCard round={r} />
            </li>
          ))}
        </LoopRow>
      ) : null}
      {reader.partial ? <p className="m-0 text-[12px] text-faint">You see the rounds you interview on; the rest of the loop is the hiring team&apos;s.</p> : null}
    </section>
  );
}

/** A question the filing answered, as the transcript's assistant: plain text, left. */
function Ask({ i, children }: { i: number; children: React.ReactNode }) {
  return (
    <p style={{ "--i": i } as React.CSSProperties} className="m-0 max-w-[85%] self-start text-[13px] leading-5 text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * The interviewer's answer, as the transcript's user: a quiet grey bubble on
 * the right. Whose they are is the read's heading ("Noor Haddad's read"), here
 * and on the Inbox's ticket, so no bubble names them again.
 */
function Answer({ i, children }: { i: number; children: React.ReactNode }) {
  return (
    <div style={{ "--i": i } as React.CSSProperties} className="flex max-w-[85%] min-w-0 origin-bottom-right flex-col items-end self-end">
      <div className="max-w-full rounded-[14px] rounded-br-[5px] bg-[color:var(--soft)] px-3.5 py-2.5 text-[13px] leading-5 shadow-[inset_0_0_0_1px_var(--line)] [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

const possessive = (name: string) => (name === "You" ? "Your" : `${name}'s`);

/**
 * One filing as design/tats's post-interview read: a chat transcript (after
 * Fluid Functionalism's ChatMessage), the questions the feedback form asks on
 * the left, the interviewer's answers in bubbles on the right, in the form's
 * order. `ask` is the hire question; without it (the Inbox's ticket, whose
 * card already heads the read with who and the verdict) it starts at the
 * scorecard. Every answer is the interviewer's own words, as text: what they
 * wrote is set in Mona Sans for reading, the rest stays Geist Mono.
 */
export function ReadThread({ feedback: f, ask = null }: { feedback: FeedbackCard; ask?: string | null }) {
  const msgs: React.ReactNode[] = [];
  const answer = (body: React.ReactNode) => (
    <Answer key={msgs.length} i={msgs.length}>
      {body}
    </Answer>
  );
  const scorecard = f.ratings.length > 0;
  if (ask) {
    msgs.push(
      <p key="day" className="m-0 mb-1 flex flex-wrap justify-center gap-x-3 self-center text-[12px] text-faint">
        <span>{possessive(f.interviewer)} read</span>
        <span>{f.submitted}</span>
      </p>,
    );
    msgs.push(
      <Ask key={msgs.length} i={msgs.length}>
        {ask}
      </Ask>,
    );
    msgs.push(
      answer(
        <span className="inline-flex flex-wrap items-center gap-x-2">
          <VerdictGlyph verdict={f.verdict} />
          <b className="font-medium">{f.recommendation}</b>
          {f.rating !== null ? <span className="text-muted-foreground tabular-nums">{f.rating} / 4 overall</span> : null}
        </span>,
      ),
    );
  }
  if (scorecard) {
    msgs.push(
      <Ask key={msgs.length} i={msgs.length}>
        How did they do on the scorecard, 1 to 4?
      </Ask>,
    );
    msgs.push(
      answer(
        <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-5 gap-y-1.5">
          {f.ratings.map((r, i) => (
            <div key={i} className="contents">
              <dt>
                {r.attribute}
                {r.note ? <span className="block font-sans text-[13.5px] leading-[21px] whitespace-pre-wrap text-muted-foreground">{r.note}</span> : null}
              </dt>
              <dd className="m-0 text-right tabular-nums">{r.rating} / 4</dd>
            </div>
          ))}
        </dl>,
      ),
    );
  }
  if (f.notes) {
    msgs.push(
      <Ask key={msgs.length} i={msgs.length}>
        What did you see?
      </Ask>,
    );
    msgs.push(answer(<span className="block font-sans text-[14px] leading-[22px] break-words whitespace-pre-wrap">{f.notes}</span>));
  }
  return msgs.length ? <div className="read-thread flex flex-col gap-3">{msgs}</div> : null;
}

/** `own` is the member's own feedback form (./feedback-form.tsx), passed in so the Inbox's ticket, which draws this too, imports no action. */
export function Feedback({ reader, own = null }: { reader: Pick<Reader, "candidate" | "feedback" | "feedbackNote">; own?: React.ReactNode }) {
  return (
    <section aria-label="Feedback" className="grid gap-4 px-4 pt-4 pb-6 @2xl:px-6">
      <h2 className="m-0 flex min-h-[30px] items-center gap-2 font-sans text-[15px] leading-[22px] font-semibold tracking-[-0.01em]">
        Feedback
        {reader.feedback.length ? <span className="font-mono text-[12.5px] font-normal tracking-normal text-faint tabular-nums">{reader.feedback.length}</span> : null}
      </h2>
      {own}
      {reader.feedback.length === 0 ? <Empty className="my-0">{reader.feedbackNote ?? "No feedback filed yet."}</Empty> : null}
      {reader.feedback.map((f) => (
        <article key={f.feedbackId} aria-label={`${possessive(f.interviewer)} read`} className="border-t border-[color:var(--line)] pt-4 first-of-type:border-t-0 first-of-type:pt-0">
          <ReadThread feedback={f} ask={`Would you hire ${reader.candidate}?`} />
        </article>
      ))}
      {reader.feedback.length > 0 && reader.feedbackNote ? <p className="m-0 text-[12px] text-faint">{reader.feedbackNote}</p> : null}
    </section>
  );
}

/** A part of the reader, set off from the one above by a hairline: the reader is already inside the page's card, so no card of its own. */
const part = "border-t border-[color:var(--line)]";

/**
 * The reader as Testbench's review: the candidate and the round, the verdict
 * as a tag beside them and the facts under them, then the loop, the feedback
 * and the member's Granola notes, each under a hairline on the reader's pane.
 */
function InterviewReader({ reader, own, granola, base }: { reader: Reader; own: React.ReactNode; granola: React.ReactNode; base: string }) {
  const [candidate, ...round] = facts(reader.title);
  return (
    <article className="@container mx-auto grid max-w-[860px]">
      <header className="grid gap-1.5 px-4 pt-2 pb-5 @2xl:px-6">
        <Link href={base} className="justify-self-start text-[12.5px] text-muted-foreground hover:text-foreground md:hidden">
          ← Interview Judgement
        </Link>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="m-0 min-w-0 font-sans text-[22px] leading-[30px] font-semibold tracking-[-0.02em] [overflow-wrap:anywhere]">
            {candidate}
            {round.map((r) => (
              <span key={r} className="ml-2.5 font-medium text-muted-foreground">
                {r}
              </span>
            ))}
          </h1>
          {reader.verdict ? <VerdictPill verdict={reader.verdict} /> : null}
        </div>
        <p className="m-0 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-muted-foreground">
          {facts(reader.sub).map((f) => (
            <span key={f} className="min-w-0 truncate">
              {f}
            </span>
          ))}
        </p>
      </header>
      <div className={part}>
        <Loop reader={reader} />
      </div>
      <div className={part}>
        <Feedback reader={reader} own={own} />
      </div>
      {granola}
    </article>
  );
}

export function InterviewsView({
  groups,
  counts,
  reviewed,
  reader,
  own = null,
  granola,
  open,
  readerError,
  base = "/client/interviews",
  home = false,
}: {
  groups: ListGroup[];
  counts: { verdict: Verdict; n: number }[];
  /** The past interviews this member has checked off; null when that could not be read. */
  reviewed: string[] | null;
  reader: Reader | null;
  /** The member's own feedback form, on an interview they ran that has started. Null when they can't file. */
  own?: React.ReactNode;
  /** The member's own Granola notes on this interview, already behind its Suspense boundary. Null when there can be none. */
  granola: React.ReactNode;
  /** An interview was picked (`?i=`): on a phone the reader replaces the list. */
  open: boolean;
  readerError: string | null;
  /** Where its links go: its own route, or Home's tab. */
  base?: string;
  /** Inside Home's tab, whose bar says where you are. */
  home?: boolean;
}) {
  const past = groups.filter((g) => g.key !== "upcoming").flatMap((g) => g.rows.map((r) => r.interviewId));
  const selected = groups.flatMap((g) => g.rows).find((r) => r.selected)?.interviewId ?? null;
  return (
    <ReviewProvider past={past} saved={reviewed} selected={selected}>
      <ListReader
        interviewList
        listLabel="Interviews"
        readerLabel="Interview"
        open={open}
        bar={
          home ? (
            <div className="px-[var(--page-gutter)] text-[13px] text-muted-foreground">
              <ReviewCount />
            </div>
          ) : (
            <PageBar title="Interview Judgement" lead={<ReviewCount />} />
          )
        }
        list={
          <>
            <InterviewList groups={groups} counts={counts} />
            <ReviewKey />
          </>
        }
        reader={
          reader ? (
            <InterviewReader reader={reader} own={own} granola={granola} base={base} />
          ) : (
            <Empty className="p-2">{readerError ?? "Pick an interview to read its loop and feedback."}</Empty>
          )
        }
      />
    </ReviewProvider>
  );
}
