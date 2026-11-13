import Link from "next/link";
import { useId } from "react";
import { Count, Empty, PageBar, StatusGlyph, SubBar, Tabs, pillOption, pillTrack, textLink } from "@/components/page";
import { cn } from "@/lib/utils";
import { homeSubBase, type HomeSub } from "@/lib/client/home-tabs";
import { defaultWidgets, type Placed, type WidgetKey } from "@/lib/client/home-widgets";
import { HomeBoard } from "./home-board";
import { TargetChip, type TargetChipProps } from "./home-target";
import { Figure } from "./stat-number";

// Home's markup (design/tats's Recruiting Overview, in Testbench's dress), props
// only: page.tsx does the reads and the counting. The bar (the title), its
// Overview / New Applicants / Interview Judgement / Referrals tabs with the
// period, department and job as segmented controls, then the Overview as widgets, each drawn
// here and placed by home-board.tsx from the member's own layout. A number card
// says one thing, in one voice (Mona Sans): its name, one number (the app's
// number style, stat-number.tsx) with its change, and at most one quiet graphic
// (a line, columns, a split bar or rounded meters, plain SVG and CSS, no chart
// library), labelled directly and sparingly. What the old secondary lines said
// (how many are waiting, the oldest, how many are outstanding) is the number's
// or the graphic's hover. Its controls stay in Geist Mono and keep out of the
// way: a target that is set sits on the number's row (home-target.tsx); "Set a
// target" and the way to the pipeline show on the card's hover and whenever focus
// is inside it. Colour only for meaning: the accent for the data, red for a fall
// or a missed target. Styles are home-widgets.css.

export type Bar = { n: number; label: string; title: string; /** Reads red: past the target, or with none set, one of the oldest. */ late?: boolean };

export type WaitCard = { typical: string | null; waiting: number; oldest: string | null; buckets: Bar[]; target: TargetChipProps | null };

export type StageLine = {
  key: string;
  label: string;
  n: number;
  /** Counts per segment: under a day, 1 to 3 days, over 3. */
  segments: number[];
  typical: string | null;
  longest: string | null;
  people: { id: string; name: string; line: string; wait: string; href: string }[];
  more: { href: string; label: string } | null;
};

export type BottleneckIcon = keyof typeof ICONS;

export type Part = { label: string; n: number };

/** A filter as a segmented control of links (the URL is the filter state): its name for a screen reader, and its options. */
export type Segment = { label: string; options: { href: string; label: string; title?: string; active: boolean }[] };

export type HomeViewProps = {
  title: string;
  days: number;
  /** The period always; the department and the job when there is one to pick. */
  filters: { period: Segment; department: Segment | null; job: Segment | null };
  pipelineHref: string;
  newApps: { value: number; change: number | null; bars: Bar[]; target: TargetChipProps | null };
  /** Applications per day: this period and the one before, each oldest first, and their totals. */
  trend: { current: number[]; previous: number[]; total: number; before: number };
  /** Hires per week over the last 12 weeks, oldest first, their total and the 12 weeks before's. */
  hires: { weeks: number[]; total: number; before: number };
  sources: Part[];
  /** Waiting on this member's own sign-off: who and for which job, never the terms. */
  offers: { total: number; rows: { id: string; candidate: string; line: string; requestedBy: string | null; wait: string; href: string }[]; more: { href: string; label: string } | null };
  inProcess: { value: number; parts: Part[]; /** The parts are the company's own stages. */ byProcess: boolean };
  review: WaitCard;
  schedule: WaitCard;
  /** Null for someone who manages no job: the cards are not theirs. */
  feedback: {
    onTimeShare: number | null;
    filed: number;
    onTime: number;
    outstanding: number;
    onTimeHours: number;
    /** Typical time to feedback in words: what its target is compared with. */
    typical: string | null;
    target: TargetChipProps | null;
    /** A job or a department is picked, but the report covers every job they manage. */
    allJobs: boolean;
    interviewers: { id: string; name: string; median: string | null; medianHours: number | null; out: number }[];
  } | null;
  workload: {
    hours: string;
    interviews: number;
    held: number;
    booked: number;
    target: TargetChipProps | null;
    /** The rows are departments; otherwise interviewers. */
    byTeam: boolean;
    rows: { id: string; name: string; hours: number; label: string }[];
  };
  bottlenecks: { key: string; over: boolean; what: string; why: string; icon: BottleneckIcon; label: string; href: string }[];
  /** Null alongside `feedback`: not theirs. */
  outstanding: { total: number; rows: { id: string; interviewer: string; line: string; wait: string; href: string }[]; more: { href: string; label: string } | null } | null;
  stages: StageLine[];
  /** Where an admin changes the stages. Null for anyone else. */
  editStages: string | null;
  active: number;
  /** Null with too few closed to say. */
  efficiency: { closed: number; hires: number; rounds: { label: string; share: number; value: string; title: string }[]; perHire: string; hoursPerHire: string } | null;
  stays: { label: string; avgDays: number | null; stays: number }[];
  truncated: boolean;
  /** The member's layout (lib/client/home-widgets.ts); without one, its default. */
  layout?: Placed[];
};

// design/tats's own icons (its app.js `P`), 16px, stroked.
const ICONS = {
  home: "M2.5 7.2 8 2.8l5.5 4.4V13a.5.5 0 0 1-.5.5H9.5V10h-3v3.5H3a.5.5 0 0 1-.5-.5Z",
  ticket: "M2.5 5a1.5 1.5 0 0 0 0 3v3.5h11V8a1.5 1.5 0 0 1 0-3V2.5h-11ZM6.5 2.5v9",
  cal: "M3 4h10v9H3ZM3 7h10M6 2.5v3M10 2.5v3",
  quote: "M3.5 8.5h3v4h-3ZM3.5 8.5c0-2.5 1-4 3-4.5M9.5 8.5h3v4h-3ZM9.5 8.5c0-2.5 1-4 3-4.5",
  flag: "M3.5 14V2.8M3.5 3h8l-1.6 3 1.6 3h-8",
  clock: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 5v3.2l2 1.3",
  chevR: "M6 4l4 4-4 4",
  arrow: "M3.5 8h9M9 4.5 12.5 8 9 11.5",
  up: "M4 10l4-4 4 4",
  down: "M4 6l4 4 4-4",
} as const;

function Icon({ name, className }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className={cn("size-[15px] shrink-0", className)} aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

/** The tabs under the bar: Home's own and the pages its numbers lead to. */
const NAV: { sub: HomeSub | null; href: string; label: string }[] = [
  { sub: null, href: "/client", label: "Overview" },
  { sub: "tickets", href: homeSubBase("tickets"), label: "New Applicants" },
  { sub: "interviews", href: homeSubBase("interviews"), label: "Interview Judgement" },
  { sub: "referrals", href: homeSubBase("referrals"), label: "Referrals" },
];

const HomeTabs = ({ on }: { on: HomeSub | null }) => <Tabs strip label="Overview pages" tabs={NAV.map(({ sub, ...n }) => ({ ...n, active: sub === on }))} />;

/**
 * A filter as Testbench's small segmented control (`.seg.small`): its options as
 * links on one track, the picked one raised. One line always: a track wider than
 * its row scrolls sideways (home-widgets.css `.hm-seg`), never wraps.
 */
function Segments({ seg }: { seg: Segment }) {
  return (
    <div role="group" aria-label={seg.label} className={cn(pillTrack, "hm-seg")}>
      {seg.options.map((o) => (
        <Link key={o.href} href={o.href} title={o.title} aria-current={o.active ? "true" : undefined} className={pillOption(o.active, "sm")}>
          {o.label}
        </Link>
      ))}
    </div>
  );
}

/** A tab's page under Home's bar and tabs (design/tats's `.hm-sub`): the page brings its own actions, the bar says where you are. */
export function HomeTab({ sub, children }: { sub: HomeSub; children: React.ReactNode }) {
  return (
    <div className="home-sub flex min-h-0 min-w-0 flex-1 flex-col">
      <PageBar title="Recruiting Overview" icon={<Icon name="home" />} />
      <SubBar>
        <HomeTabs on={sub} />
      </SubBar>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  );
}

/** The three waits a time-in-stage bar splits into, short as the columns' own labels, and in words for a hover. */
const SEGMENTS = [
  { short: "<1d", long: "Under a day" },
  { short: "1–3d", long: "1 to 3 days" },
  { short: "3d+", long: "Over 3 days" },
];
/** Light to dark as the wait grows, so the oldest reads heaviest without a key. */
const SEGMENT_FILL = ["bg-[color:var(--line-strong)]", "bg-[color:var(--ink-4)]", "bg-[color:var(--ink)]"];

const count = (n: number) => n.toLocaleString("en-US");

/** A column chart: one rounded column per bin, its label under it and its count on its hover, so nothing floats over the columns. */
function Bars({ bars, late }: { bars: Bar[]; late?: boolean }) {
  const max = Math.max(1, ...bars.map((b) => b.n));
  return (
    <div className="hm-hist" role="img" aria-label={bars.map((b) => b.title).join(", ")}>
      {bars.map((b, i) => (
        <span key={`${b.label}-${i}`} title={b.title}>
          <span className="hm-col">
            <i className={cn(!b.n && "none", late && b.n && b.late && "over")} style={{ "--f": b.n ? Math.max(0.06, b.n / max) : 0 } as React.CSSProperties} />
          </span>
          <em>{b.label}</em>
        </span>
      ))}
    </div>
  );
}

const CHART_W = 300;

/**
 * A line chart: the first series solid with a fade under it and a point on now,
 * any second a quieter line behind, over a baseline and no grid. Scales to its
 * box; strokes keep their width. `ends` names each line at its right end, in the
 * chart's gutter, so there is no key.
 */
function Spark({ series, height = 84, label, ends }: { series: number[][]; height?: number; label: string; ends?: React.ReactNode[] }) {
  const id = useId();
  const n = series[0].length;
  const max = Math.max(1, ...series.flat()) * 1.15;
  const x = (i: number) => (n === 1 ? CHART_W : (i / (n - 1)) * CHART_W);
  const y = (v: number) => height - 2 - (v / max) * (height - 8);
  const line = (vs: number[]) => vs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const at = (vs: number[]) => (y(vs[vs.length - 1]) / height) * 100;
  // Each end label at its line's last value; when the two lines end close together, held at least a
  // line apart about their middle, in pixels, since the chart's height is whatever its card leaves it.
  const tops = series.map((vs) => Math.min(100, Math.max(0, at(vs))));
  const endTop = (i: number) => {
    if (tops.length !== 2) return `${tops[i].toFixed(1)}%`;
    const mid = ((tops[0] + tops[1]) / 2).toFixed(1);
    const upper = tops[i] < tops[1 - i] || (tops[i] === tops[1 - i] && i === 0);
    return upper ? `min(${tops[i].toFixed(1)}%, calc(${mid}% - 10px))` : `max(${tops[i].toFixed(1)}%, calc(${mid}% + 10px))`;
  };
  return (
    <div className={cn("wg-chart", ends && "ends")} style={{ height }} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${CHART_W} ${height}`} preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--accent)", stopOpacity: 0.14 }} />
            <stop offset="1" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <path className="wg-base" d={`M0 ${height - 0.5}H${CHART_W}`} />
        {series.slice(1).map((vs, i) => (
          <path key={i} className="wg-l2" d={line(vs)} />
        ))}
        <path d={`${line(series[0])}L${CHART_W} ${height}L0 ${height}Z`} fill={`url(#${id})`} />
        <path className="wg-l1" d={line(series[0])} />
      </svg>
      <i className="wg-dot" style={{ top: `${at(series[0]).toFixed(1)}%` }} />
      {ends?.map((e, i) => (
        <span key={i} className={cn("wg-end", i > 0 && "l2")} style={{ top: endTop(i) }}>
          {e}
        </span>
      ))}
    </div>
  );
}

/** A rise or a fall as a tag beside its number: green up, red down. What it is measured against is its hover, not a caption. */
function Change({ change, against }: { change: number; against: string }) {
  const up = change >= 0;
  const pct = Math.abs(Math.round(change * 100));
  return (
    <span className={cn("wg-delta", up ? "good" : "bad")} title={`${up ? "Up" : "Down"} ${pct}% ${against}`}>
      <Icon name={up ? "up" : "down"} className="size-[11px]" />
      <span className="sr-only">{up ? "Up" : "Down"} </span>
      {pct}%<span className="sr-only"> {against}</span>
    </span>
  );
}

/** The change against what came before, as the prototype's: nothing before, nothing to say. */
function Delta({ value, before, against }: { value: number; before: number; against: string }) {
  if (!before) return null;
  return <Change change={(value - before) / before} against={against} />;
}

/**
 * A whole, split: one rounded bar, each piece's name and count on its hover.
 * With `named`, each part is also written under the bar in the bar's order, its
 * name then its count, spaced apart and never dotted; hovering a name or its
 * piece of the bar lights both and quiets the rest (home-widgets.css), so there
 * is no colour key.
 */
function Shares({ parts, fills, named = true, label }: { parts: Part[]; fills?: string[]; named?: boolean; label?: string }) {
  const shade = (i: number) => fills?.[i] ?? `color-mix(in oklch, var(--accent) ${Math.round(100 - (i / Math.max(1, parts.length - 1)) * 72)}%, var(--paper))`;
  return (
    <div className="wg-shares">
      <div className="wg-seg" role="img" aria-label={label ?? parts.map((p) => `${p.label}: ${p.n}`).join(", ")}>
        {parts.map((p, i) => (p.n ? <i key={p.label} data-i={i} style={{ flex: p.n, background: shade(i) }} title={`${p.label}: ${count(p.n)}`} /> : null))}
      </div>
      {named ? (
        <div className="wg-key">
          {/* A part with nobody in it has no piece of the bar to name: it is in the bar's label for a screen reader, and the pipeline. */}
          {parts.map((p, i) =>
            p.n ? (
              <span key={p.label} data-i={i}>
                {p.label}
                <b>{count(p.n)}</b>
              </span>
            ) : null,
          )}
        </div>
      ) : null}
    </div>
  );
}

type Go = { href: string; label: string };

/**
 * A number card: its name, then the number with its change (and a target, when
 * one is set, at the row's far end), then its one graphic, which starts the
 * same gap under the number in every card (home-widgets.css), so a row of cards
 * lines up and none has a hole between its number and its graphic. Everything in it but its controls is
 * Mona Sans. "Set a target" and `go` (the way to the pipeline) are quiet: they
 * show on the card's hover and whenever focus is inside it (home-widgets.css
 * `.hm-reveal`), so a keyboard always finds them.
 */
function Card({ label, def, value, valueTitle, unit, change, target, go, children }: {
  label: string;
  def?: string;
  /** Left out, the card has no number (a widget with too little to count). */
  value?: string | number;
  /** Said on the number's hover: what the old secondary lines said, and what it covers when no tag says so. */
  valueTitle?: string;
  /** A word the number needs to make sense, beside it. */
  unit?: string;
  change?: React.ReactNode;
  target?: TargetChipProps | null;
  go?: Go;
  children?: React.ReactNode;
}) {
  return (
    <section className={cn("hm-card", value === undefined && "bare")}>
      <div className="wg-top">
        <div className="hm-head">
          <h3 className="hm-l" title={def}>
            {label}
          </h3>
          {go ? (
            <Link href={go.href} className="hm-go hm-icon hm-reveal" aria-label={go.label} title={go.label}>
              <Icon name="arrow" className="size-[14px]" />
            </Link>
          ) : null}
        </div>
        {value === undefined ? null : (
          <div className="hm-v">
            <b title={valueTitle}>
              <Figure value={value} />
              {valueTitle ? <span className="sr-only">, {valueTitle}</span> : null}
            </b>
            {unit ? <span className="hm-q">{unit}</span> : null}
            {change}
            {target ? (
              <span className={cn("hm-tg", target.canEdit && target.shown === null && "hm-reveal")}>
                <TargetChip {...target} />
              </span>
            ) : null}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

/** A list or a table: its heading (what it covers is the heading's hover), then the block. */
function Box({ title, def, count, aside, children }: { title: string; def?: string; count?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="hm-box">
      <div className="hm-h">
        <h3 title={def}>
          {title}
          {def ? <span className="sr-only">, {def}</span> : null}
        </h3>
        {count === undefined ? null : <Count>{count}</Count>}
        {aside ? <div className="hm-h-aside">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A box's link in its heading: quiet like a card's, shown on the box's hover and on focus inside it. */
const go = (href: string, label: string) => (
  <Link href={href} className="hm-go hm-reveal">
    {label}
    <Icon name="arrow" className="size-[13px]" />
  </Link>
);

/** A list row's second line: its facts side by side, spaced, never dotted, wrapping rather than cut short. */
const Facts = ({ line }: { line: string }) => (
  <span className="flex min-w-0 flex-wrap gap-x-3 text-faint">
    {line.split(" · ").map((x, i) => (
      <span key={i} className="max-w-full truncate">
        {x}
      </span>
    ))}
  </span>
);

/** A Linear-style row of a list widget: who, their facts under, the wait at the right. */
function PersonRow({ href, name, line, wait }: { href: string; name: string; line: string; wait: string }) {
  return (
    <Link href={href} className="hm-row">
      <span className="grid min-w-0">
        <b className="truncate font-medium">{name}</b>
        <Facts line={line} />
      </span>
      <em>{wait}</em>
    </Link>
  );
}

const more = (m: { href: string; label: string }) => (
  <Link href={m.href} className={cn(textLink, "mt-1 self-start px-2 py-1.5")}>
    {m.label}
  </Link>
);

/** The typical wait as the number; how many wait and the oldest are its hover; the columns split them by age. */
function Waits({ label, def, card, go }: { label: string; def: string; card: WaitCard; go: Go }) {
  return (
    <Card
      label={label}
      def={def}
      value={card.typical ?? "None"}
      valueTitle={card.waiting ? `Typical wait; ${card.waiting} waiting, oldest ${card.oldest}` : "Nobody waiting"}
      target={card.target}
      go={go}
    >
      <Bars bars={card.buckets} late />
    </Card>
  );
}

/** The feedback card's one bar: on time, late, still outstanding, each piece's count on its hover and no legend. */
function FeedbackSplit({ onTime, late, outstanding, hours }: { onTime: number; late: number; outstanding: number; hours: number }) {
  const parts = [
    { n: onTime, label: `Within ${hours}h` },
    { n: late, label: "Late" },
    { n: outstanding, label: "Outstanding" },
  ];
  if (!parts.some((x) => x.n)) return <Empty>No interviews ended in this period.</Empty>;
  return (
    <Shares
      parts={parts}
      fills={["var(--green)", "var(--amber)", "color-mix(in srgb, var(--red) 80%, var(--paper))"]}
      named={false}
      label={parts.map((x) => `${x.n} ${x.label.toLowerCase()}`).join(", ")}
    />
  );
}

/**
 * Rounded meters, a row each: its name, the meter, its value, the names in one
 * column as wide as the longest (up to half the card) so the meters line up.
 * Anything more about a row (`note`) is its hover.
 */
function Meters({ rows }: { rows: { key: string; name: string; share: number; value: string; note?: string }[] }) {
  return (
    <div className="hm-load">
      {rows.map((r) => (
        <div key={r.key} title={`${r.name}: ${r.value}${r.note ? `, ${r.note}` : ""}`}>
          <span>{r.name}</span>
          <span className="wg-meter">
            <i style={{ width: r.share > 0 ? `${Math.max(2, r.share * 100)}%` : 0 }} />
          </span>
          <b>{r.value}</b>
          {r.note ? <span className="sr-only">, {r.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

const plural = (n: number, one: string) => `${count(n)} ${one}${n === 1 ? "" : "s"}`;

/** Every widget this member can have, drawn. One whose numbers aren't theirs (feedback) is left out, so the gallery doesn't offer it. */
function widgetNodes(p: HomeViewProps): Partial<Record<WidgetKey, React.ReactNode>> {
  const maxStage = Math.max(1, ...p.stages.map((s) => s.n));
  const maxLoad = Math.max(1, ...p.workload.rows.map((x) => x.hours));
  const maxFeedback = Math.max(1, ...(p.feedback?.interviewers ?? []).map((x) => x.medianHours ?? 0));
  const maxStay = Math.max(1, ...p.stays.map((s) => s.avgDays ?? 0));
  const before = `the ${p.days} days before`;
  const pipeline: Go = { href: p.pipelineHref, label: "Open pipeline" };
  // With a job or a department picked, the feedback numbers still cover every job they manage: said on hover.
  const allJobs = p.feedback?.allJobs ? "Covers every job you manage" : undefined;
  const fb = p.feedback;

  return {
    apps: (
      <Card
        label="New applications"
        def="Applications added in the period, applied or sourced"
        value={count(p.newApps.value)}
        valueTitle={p.newApps.change === null ? `None in ${before}` : undefined}
        change={p.newApps.change === null ? null : <Change change={p.newApps.change} against={`on ${before}`} />}
        target={p.newApps.target}
      >
        <Spark series={[p.newApps.bars.map((b) => b.n)]} label={p.newApps.bars.map((b) => b.title).join(", ")} />
      </Card>
    ),
    active: (
      <Card
        label="Candidates in process"
        def={p.inProcess.byProcess ? "Everyone in an open job's pipeline, by stage of your interview process" : "Everyone in an open job's pipeline, by column of the Pipeline board"}
        value={count(p.inProcess.value)}
        go={pipeline}
      >
        <Shares parts={p.inProcess.parts} />
      </Card>
    ),
    review: <Waits label="Waiting for review" def="New candidates, sourced or contacted and not yet screened: how long they have waited" card={p.review} go={pipeline} />,
    sched: <Waits label="Waiting to be scheduled" def="Interviewing with nothing booked or held yet: how long since they moved to interviewing" card={p.schedule} go={pipeline} />,
    ...(fb
      ? {
          cards: (
            <Card
              label="Interviewer feedback on time"
              def={`Feedback filed within ${fb.onTimeHours}h of the interview ending, for interviews that ended in the period on the jobs you manage${allJobs ? `. ${allJobs}` : ""}`}
              value={fb.onTimeShare === null ? "None" : `${Math.round(fb.onTimeShare * 100)}%`}
              valueTitle={[
                fb.filed ? `${fb.onTime} of ${fb.filed} filed within ${fb.onTimeHours}h${fb.typical ? `, typically in ${fb.typical}` : ""}` : "None filed yet",
                fb.outstanding ? `${fb.outstanding} outstanding` : "all feedback is in",
              ].join("; ")}
              target={fb.target}
            >
              <FeedbackSplit onTime={fb.onTime} late={fb.filed - fb.onTime} outstanding={fb.outstanding} hours={fb.onTimeHours} />
            </Card>
          ),
        }
      : {}),
    load: (
      <Card
        label="Interview workload"
        def={`Interviewer hours${p.workload.byTeam ? ", by the job's department" : ""}: interviews held in the last ${p.days} days and booked in the next ${p.days}`}
        value={p.workload.hours}
        valueTitle={`${plural(p.workload.interviews, "interview")}: ${count(p.workload.held)} held, ${count(p.workload.booked)} booked`}
        target={p.workload.target}
      >
        {p.workload.rows.length ? (
          <Meters rows={p.workload.rows.map((x) => ({ key: x.id, name: x.name, share: x.hours / maxLoad, value: x.label }))} />
        ) : (
          <Empty>No interviews in this window.</Empty>
        )}
      </Card>
    ),
    trend: (
      <Card
        label="Applications over time"
        def="Applications added each day, this period against the period before"
        value={count(p.trend.total)}
        valueTitle={p.trend.before ? undefined : `None in ${before}`}
        change={<Delta value={p.trend.total} before={p.trend.before} against={`on ${before}, which had ${count(p.trend.before)}`} />}
        // New applications' target, since this chart says the same number and has its place on the default board.
        target={p.newApps.target}
      >
        <Spark
          series={[p.trend.current, p.trend.previous]}
          height={170}
          label={`${p.trend.total} applications this period, ${p.trend.before} the period before`}
          ends={["This period", "Last period"]}
        />
        <div className="wg-axis ends">
          <span>{p.days} days ago</span>
          <span>Now</span>
        </div>
      </Card>
    ),
    hires: (
      <Card
        label="Hires"
        def="Applications that reached hired, by the week they did"
        value={p.hires.total}
        valueTitle={p.hires.before ? undefined : "In the last 12 weeks, with none in the 12 weeks before"}
        change={<Delta value={p.hires.total} before={p.hires.before} against="on the 12 weeks before" />}
      >
        <Spark series={[p.hires.weeks]} label={`${p.hires.total} hires in the last 12 weeks`} />
        <div className="wg-axis">
          <span>12 weeks ago</span>
          <span>Now</span>
        </div>
      </Card>
    ),
    sources: (
      <Card label="Where applicants come from" value={count(p.sources.reduce((n, s) => n + s.n, 0))} valueTitle={`In the last ${p.days} days`}>
        <Shares parts={p.sources} />
      </Card>
    ),
    offers: (
      <Box title="Offers awaiting approval" count={p.offers.total}>
        {p.offers.rows.length === 0 ? (
          <Empty>No offers waiting on you.</Empty>
        ) : (
          <div className="hm-rows">
            {p.offers.rows.map((o) => (
              <PersonRow key={o.id} href={o.href} name={o.candidate} line={o.line} wait={o.wait} />
            ))}
            {p.offers.more ? more(p.offers.more) : null}
          </div>
        )}
      </Box>
    ),
    bottlenecks: (
      <Box title="Bottlenecks" count={p.bottlenecks.length}>
        {p.bottlenecks.length === 0 ? (
          <Empty>Nothing is waiting.</Empty>
        ) : (
          <div className="hm-rows">
            {p.bottlenecks.map((b) => (
              <Link key={b.key} href={b.href} className="hm-row hm-neck">
                <Icon name={b.icon} className={b.over ? "text-[color:var(--red)]" : "text-faint"} />
                <span className="grid min-w-0 gap-0.5">
                  <b className="font-medium">{b.what}</b>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-3 text-faint">
                    {b.over ? (
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-negative">
                        <StatusGlyph kind="alert" className="size-[13px]" />
                        Over target
                      </span>
                    ) : null}
                    <span>{b.why}</span>
                  </span>
                </span>
                {/* Where it goes, shown on the row's hover and focus: the whole row is the link. */}
                <span className="hm-go hm-row-go">
                  {b.label}
                  <Icon name="arrow" className="size-[13px]" />
                </span>
              </Link>
            ))}
          </div>
        )}
      </Box>
    ),
    stages: (
      <Box title="Time in stage" count={`${p.active} active`} aside={p.editStages ? go(p.editStages, "Edit stages") : undefined}>
        <div className="hm-stages grid">
          <div className="hm-st hm-st-h">
            <span>Stage</span>
            <span>Candidates</span>
            <span className="flex min-w-0 gap-3" title="Waiting: each bar splits who is waiting by how long, under a day, 1 to 3 days and over 3 days">
              <span className="sr-only">Waiting</span>
              {SEGMENTS.map((g, i) => (
                <span key={g.short} data-seg={i} title={g.long}>
                  {g.short}
                </span>
              ))}
            </span>
            <span>Typical</span>
            <span>Longest</span>
          </div>
          {p.stages.map((s) => {
            const row = (
              <>
                <span className="flex min-w-0 items-center gap-1.5">
                  <Icon name="chevR" className={cn("size-[13px] text-faint transition-transform duration-200 group-open:rotate-90", !s.n && "invisible")} />
                  <span className="truncate">{s.label}</span>
                </span>
                <b className="font-normal tabular-nums">{s.n}</b>
                <span className="flex min-w-0 items-center">
                  {s.n ? (
                    <span className="hm-split" style={{ width: `${(s.n / maxStage) * 100}%` }}>
                      {s.segments.map((n, i) =>
                        n ? <i key={i} data-seg={i} className={SEGMENT_FILL[i]} style={{ flex: n }} title={`${n} waiting ${SEGMENTS[i].long.toLowerCase()}`} /> : null,
                      )}
                    </span>
                  ) : null}
                </span>
                <span className="text-faint tabular-nums">{s.typical ?? "None"}</span>
                <span className="text-faint tabular-nums">{s.longest ?? ""}</span>
              </>
            );
            return s.n ? (
              <details key={s.key} className="group">
                <summary className="hm-st cursor-pointer list-none rounded-[8px] hover:bg-[color:var(--surface)] group-open:bg-[color:var(--surface)] [&::-webkit-details-marker]:hidden">{row}</summary>
                <div className="mb-2 ml-[18px] grid border-l border-[color:var(--line)] pl-2">
                  {s.people.map((x) => (
                    <Link key={x.id} href={x.href} className="hm-row min-h-[36px] py-1.5">
                      <span className="flex min-w-0 gap-3">
                        <b className="shrink-0 font-medium">{x.name}</b>
                        <span className="truncate text-faint">{x.line}</span>
                      </span>
                      <em>{x.wait}</em>
                    </Link>
                  ))}
                  {s.more ? more(s.more) : null}
                </div>
              </details>
            ) : (
              <div key={s.key} className="hm-st text-faint">
                {row}
              </div>
            );
          })}
        </div>
      </Box>
    ),
    stays: (
      <Card label="Average stay in each stage" def={`Applications added in the last ${p.days} days`}>
        {p.stays.every((s) => s.avgDays === null) ? (
          <Empty>No candidate added in this period has moved on yet.</Empty>
        ) : (
          <Meters
            rows={p.stays.map((s) => ({ key: s.label, name: s.label, share: (s.avgDays ?? 0) / maxStay, value: s.avgDays === null ? "None" : `${s.avgDays}d`, note: s.stays ? `${count(s.stays)} moved on` : undefined }))}
          />
        )}
      </Card>
    ),
    ...(fb
      ? {
          byiv: (
            <Card label="Time to feedback, by interviewer" def={allJobs}>
              {fb.interviewers.length === 0 ? (
                <Empty>No interviews ended in this period.</Empty>
              ) : (
                <Meters
                  rows={fb.interviewers.map((x) => ({ key: x.id, name: x.name, share: (x.medianHours ?? 0) / maxFeedback, value: x.median ?? "None", note: x.out ? `${count(x.out)} outstanding` : undefined }))}
                />
              )}
            </Card>
          ),
        }
      : {}),
    eff: p.efficiency ? (
      <Card
        label="Interview efficiency"
        def="Closed in the last 12 months"
        value={p.efficiency.perHire}
        unit="interviews per hire"
        valueTitle={`${p.efficiency.hoursPerHire} interviewer time per hire; ${count(p.efficiency.closed)} closed, ${count(p.efficiency.hires)} hired`}
      >
        {p.efficiency.rounds.length ? <Meters rows={p.efficiency.rounds.map((r) => ({ key: r.label, name: r.label, share: r.share, value: r.value, note: r.title }))} /> : null}
      </Card>
    ) : (
      <Card label="Interview efficiency" def="Closed in the last 12 months">
        <Empty>Not enough closed yet.</Empty>
      </Card>
    ),
    ...(p.outstanding
      ? {
          outfb: (
            <Box title="Outstanding feedback" count={p.outstanding.total} def={allJobs}>
              {p.outstanding.rows.length === 0 ? (
                <Empty>All feedback is in.</Empty>
              ) : (
                <div className="hm-rows">
                  {p.outstanding.rows.map((o) => (
                    <PersonRow key={o.id} href={o.href} name={o.interviewer} line={o.line} wait={o.wait} />
                  ))}
                  {p.outstanding.more ? more(p.outstanding.more) : null}
                </div>
              )}
            </Box>
          ),
        }
      : {}),
  };
}

export function HomeView(p: HomeViewProps) {
  return (
    <HomeBoard
      title={p.title}
      icon={<Icon name="home" />}
      filters={
        <>
          <Segments seg={p.filters.period} />
          {p.filters.department ? <Segments seg={p.filters.department} /> : null}
        </>
      }
      jobs={p.filters.job ? <Segments seg={p.filters.job} /> : null}
      tabs={<HomeTabs on={null} />}
      widgets={widgetNodes(p)}
      layout={p.layout ?? defaultWidgets()}
      foot={p.truncated ? <p className="m-0 text-[12.5px] text-faint">Some reads stopped at their limit, so these numbers are a floor.</p> : null}
    />
  );
}
