import Link from "next/link";
import { useId } from "react";
import { Avatar, Empty, PageBar, SubBar, Tabs, textLink } from "@/components/page";
import { cn } from "@/lib/utils";
import { FilterMenu, type FilterOption } from "@/components/filter-menu";
import { homeSubBase, type HomeSub } from "@/lib/client/home-tabs";
import { defaultWidgets, type Placed, type WidgetKey } from "@/lib/client/home-widgets";
import { HomeBoard } from "./home-board";
import { TargetChip, type TargetChipProps } from "./home-target";

// Home's markup (design/tats's Recruiting Overview), props only: page.tsx
// does the reads and the counting. The prototype's bar (the crumb, then the
// period, department and job chips) and its Overview / Applicant Tickets /
// Interviews / Referrals tabs, then the Overview as widgets, each drawn here
// and placed by home-board.tsx from the member's own layout: a rounded panel
// with the number first, a quiet label under it, the change or the count on
// the right, then one chart (a line, bars or a split bar, plain SVG and CSS,
// no chart library). Colour only for meaning: the chart's blue, red for a fall
// or a missed target. A card's target sits at the left of its foot
// (home-target.tsx). Styles are home-widgets.css.

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

export type HomeViewProps = {
  title: string;
  days: number;
  /** The chips: the period always, the department and the job when there is one to pick. */
  filters: { label: string; value: string; on: boolean; options: FilterOption[] }[];
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
  /** The member's layout (lib/client/home-widgets.ts); without one, the default. */
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
  { sub: "tickets", href: homeSubBase("tickets"), label: "Applicant Tickets" },
  { sub: "interviews", href: homeSubBase("interviews"), label: "Interviews" },
  { sub: "referrals", href: homeSubBase("referrals"), label: "Referrals" },
];

const HomeTabs = ({ on }: { on: HomeSub | null }) => <Tabs strip label="Overview pages" tabs={NAV.map(({ sub, ...n }) => ({ ...n, active: sub === on }))} />;

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

const SEGMENT_KEYS = ["Under a day", "1 to 3 days", "Over 3 days"];
const SEGMENT_FILL = ["bg-[color:var(--soft-strong)]", "bg-[color-mix(in_srgb,var(--ink)_45%,var(--paper))]", "bg-[color:var(--ink)]"];

/** A column chart: one bar per bin, its label under it, the count on hover. */
function Bars({ bars, late }: { bars: Bar[]; late?: boolean }) {
  const max = Math.max(1, ...bars.map((b) => b.n));
  return (
    <div className="hm-hist" role="img" aria-label={bars.map((b) => b.title).join(", ")}>
      {bars.map((b, i) => (
        <span key={`${b.label}-${i}`} title={b.title}>
          <i className={late && b.n && b.late ? "over" : undefined} style={{ height: b.n ? `${Math.max(6, (b.n / max) * 100)}%` : 0 }} />
          <em>{b.label}</em>
        </span>
      ))}
    </div>
  );
}

const CHART_W = 300;

/** A line chart: the first series solid with a fade under it and a dot on now, any second a lighter line behind. Scales to its box; strokes keep their width. */
function Spark({ series, height = 84, grid = 0, label }: { series: number[][]; height?: number; grid?: number; label: string }) {
  const id = useId();
  const n = series[0].length;
  const max = Math.max(1, ...series.flat()) * 1.15;
  const x = (i: number) => (n === 1 ? CHART_W : (i / (n - 1)) * CHART_W);
  const y = (v: number) => height - 2 - (v / max) * (height - 8);
  const line = (vs: number[]) => vs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  return (
    <div className="wg-chart" style={{ height }} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${CHART_W} ${height}`} preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--chart)", stopOpacity: 0.2 }} />
            <stop offset="1" style={{ stopColor: "var(--chart)", stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        {grid ? (
          Array.from({ length: grid + 1 }, (_, i) => <path key={i} className="wg-gl" d={`M${((i / grid) * CHART_W).toFixed(1)} 0V${height}`} />)
        ) : (
          <path className="wg-base" d={`M0 ${height - 0.5}H${CHART_W}`} />
        )}
        {series.slice(1).map((vs, i) => (
          <path key={i} className="wg-l2" d={line(vs)} />
        ))}
        <path d={`${line(series[0])}L${CHART_W} ${height}L0 ${height}Z`} fill={`url(#${id})`} />
        <path className="wg-l1" d={line(series[0])} />
      </svg>
      <i className="wg-dot" style={{ top: `${((y(series[0][n - 1]) / height) * 100).toFixed(1)}%` }} />
    </div>
  );
}

/** The change against what came before, as the prototype's: nothing before, nothing to say. */
function Delta({ value, before }: { value: number; before: number }) {
  if (!before) return null;
  const change = (value - before) / before;
  return (
    <b className={cn("wg-delta", change >= 0 ? "good" : "bad")}>
      {change >= 0 ? "▲" : "▼"} {Math.abs(Math.round(change * 100))}%
    </b>
  );
}

/** A share, split: one bar in shades of the chart colour, then a legend with each part's count and share. */
function Shares({ parts }: { parts: Part[] }) {
  const total = parts.reduce((s, p) => s + p.n, 0);
  const shade = (i: number) => `color-mix(in oklch, var(--chart) ${Math.round(100 - (i / Math.max(1, parts.length - 1)) * 72)}%, var(--paper))`;
  return (
    <>
      <div className="wg-seg">{parts.map((p, i) => (p.n ? <i key={p.label} style={{ flex: p.n, background: shade(i) }} title={`${p.label}: ${p.n}`} /> : null))}</div>
      <div className="wg-leg">
        {parts.map((p, i) => (
          <div key={p.label}>
            <i style={{ background: shade(i) }} />
            <span title={p.label}>{p.label}</span>
            <b>{p.n.toLocaleString("en-US")}</b>
            <em>{total ? Math.round((p.n / total) * 100) : 0}%</em>
          </div>
        ))}
      </div>
    </>
  );
}

function Card({ label, def, value, unit, side, target, foot, children }: {
  label: string;
  def: string;
  value: React.ReactNode;
  unit?: string;
  side: React.ReactNode;
  target?: TargetChipProps | null;
  foot?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="hm-card">
      <div className="wg-top">
        <div>
          <div className="hm-v">
            <b>{value}</b>
            {unit ? <span className="hm-sub">{unit}</span> : null}
          </div>
          <div className="hm-l" title={def}>
            {label}
          </div>
        </div>
        <div className="wg-side">{side}</div>
      </div>
      {children}
      {target || foot ? (
        <div className="hm-f">
          {target ? <TargetChip {...target} /> : <span />}
          {foot}
        </div>
      ) : null}
    </section>
  );
}

/** A list or a table: its heading, then the block. */
function Box({ title, count, aside, children }: { title: string; count?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="hm-box">
      <div className="hm-h">
        <b>{title}</b>
        {count === undefined ? null : <span>{count}</span>}
        {aside ? <div className="hm-h-aside">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

const go = (href: string, label: string) => (
  <Link href={href} className="hm-go">
    {label} →
  </Link>
);

function Waits({ label, def, card, foot }: { label: string; def: string; card: WaitCard; foot: React.ReactNode }) {
  return (
    <Card
      label={label}
      def={def}
      value={card.typical ?? "None"}
      unit={card.typical ? "typical" : undefined}
      side={
        card.waiting ? (
          <>
            <b className={card.target?.off ? "bad" : undefined}>
              {card.waiting} waiting
            </b>
            <span>oldest {card.oldest}</span>
          </>
        ) : (
          <>
            <b>0 waiting</b>
            <span>all clear</span>
          </>
        )
      }
      target={card.target}
      foot={foot}
    >
      <Bars bars={card.buckets} late />
    </Card>
  );
}

/** The feedback card's one bar: on time, late, still outstanding. */
function FeedbackSplit({ onTime, late, outstanding, hours }: { onTime: number; late: number; outstanding: number; hours: number }) {
  const parts = [
    { n: onTime, label: `Within ${hours}h`, fill: "bg-[color:var(--chart)]" },
    { n: late, label: "Late", fill: "bg-[color:var(--amber)]" },
    { n: outstanding, label: "Outstanding", fill: "bg-[color-mix(in_srgb,var(--red)_70%,var(--paper))]" },
  ];
  if (!parts.some((x) => x.n)) return <Empty>No interviews ended in this period.</Empty>;
  return (
    <>
      <div className="wg-seg" role="img" aria-label={parts.map((x) => `${x.n} ${x.label.toLowerCase()}`).join(", ")}>
        {parts.map((x) => (x.n ? <i key={x.label} className={x.fill} style={{ flex: x.n }} /> : null))}
      </div>
      <div className="wg-key flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
        {parts.map((x) => (
          <span key={x.label} className="inline-flex items-center gap-1.5">
            <i className={cn("block size-2", x.fill)} />
            {x.label} <b className="font-medium text-foreground tabular-nums">{x.n}</b>
          </span>
        ))}
      </div>
    </>
  );
}

/** A horizontal bar row: name, bar, value. */
function HBar({ lead, name, share, value, aside }: { lead?: React.ReactNode; name: string; share: number; value: string; aside?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_minmax(64px,110px)_minmax(0,1fr)_auto_auto] items-center gap-2 py-[5px] text-[13px]">
      {lead ?? <span />}
      <span className="truncate" title={name}>
        {name}
      </span>
      <span className="wg-meter">
        <i style={{ width: share > 0 ? `${Math.max(2, share * 100)}%` : 0 }} />
      </span>
      <em className="text-right tabular-nums not-italic">{value}</em>
      {aside ?? <span />}
    </div>
  );
}

/** Every widget this member can have, drawn. One whose numbers aren't theirs (feedback) is left out, so the gallery doesn't offer it. */
function widgetNodes(p: HomeViewProps): Partial<Record<WidgetKey, React.ReactNode>> {
  const maxStage = Math.max(1, ...p.stages.map((s) => s.n));
  const maxLoad = Math.max(1, ...p.workload.rows.map((x) => x.hours));
  const maxFeedback = Math.max(1, ...(p.feedback?.interviewers ?? []).map((x) => x.medianHours ?? 0));
  const maxStay = Math.max(1, ...p.stays.map((s) => s.avgDays ?? 0));
  const before = `the ${p.days} days before`;
  const allJobs = p.feedback?.allJobs ? <span>every job you manage</span> : undefined;

  return {
    apps: (
      <Card
        label="New applications"
        def="Applications added in the period, applied or sourced"
        value={p.newApps.value.toLocaleString("en-US")}
        side={
          p.newApps.change === null ? (
            <span>none in {before}</span>
          ) : (
            <>
              <b className={cn("wg-delta", p.newApps.change >= 0 ? "good" : "bad")}>
                {p.newApps.change >= 0 ? "▲" : "▼"} {Math.round(Math.abs(p.newApps.change) * 100)}%
              </b>
              <span>vs {before}</span>
            </>
          )
        }
        target={p.newApps.target}
      >
        <Spark series={[p.newApps.bars.map((b) => b.n)]} label={p.newApps.bars.map((b) => b.title).join(", ")} />
      </Card>
    ),
    active: (
      <Card
        label="Candidates in process"
        def={p.inProcess.byProcess ? "Everyone in an open job's pipeline, by stage of your interview process" : "Everyone in an open job's pipeline, by column of the Pipeline board"}
        value={p.inProcess.value.toLocaleString("en-US")}
        side={
          <>
            <b>{p.inProcess.parts.filter((x) => x.n).length}</b>
            <span>stages</span>
          </>
        }
        foot={go(p.pipelineHref, "Open Pipeline")}
      >
        <Shares parts={p.inProcess.parts} />
      </Card>
    ),
    review: (
      <Waits
        label="Waiting for review"
        def="New candidates, sourced or contacted and not yet screened: how long they have waited"
        card={p.review}
        foot={go(p.pipelineHref, "Open Pipeline")}
      />
    ),
    sched: (
      <Waits
        label="Waiting to be scheduled"
        def="Interviewing with nothing booked or held yet: how long since they moved to interviewing"
        card={p.schedule}
        foot={go(p.pipelineHref, "Open Pipeline")}
      />
    ),
    ...(p.feedback
      ? {
          cards: (
            <Card
              label="Interviewer feedback on time"
              def={`Feedback filed within ${p.feedback.onTimeHours}h of the interview ending, for interviews that ended in the period on the jobs you manage`}
              value={p.feedback.onTimeShare === null ? "None" : `${Math.round(p.feedback.onTimeShare * 100)}%`}
              unit={p.feedback.onTimeShare === null ? undefined : `of ${p.feedback.filed} filed`}
              side={
                <>
                  {p.feedback.outstanding ? <b className="bad">{p.feedback.outstanding} outstanding</b> : <b>All feedback is in</b>}
                  {p.feedback.typical ? <span>typically {p.feedback.typical}</span> : null}
                  {allJobs}
                </>
              }
              target={p.feedback.target}
            >
              <FeedbackSplit onTime={p.feedback.onTime} late={p.feedback.filed - p.feedback.onTime} outstanding={p.feedback.outstanding} hours={p.feedback.onTimeHours} />
            </Card>
          ),
        }
      : {}),
    load: (
      <Card
        label="Interview workload"
        def={`Interviewer hours${p.workload.byTeam ? ", by the job's department" : ""}: interviews held in the last ${p.days} days and booked in the next ${p.days}`}
        value={p.workload.hours}
        side={
          <>
            <b>{p.workload.interviews}</b>
            <span>
              {p.workload.held} held · {p.workload.booked} booked
            </span>
          </>
        }
        target={p.workload.target}
      >
        {p.workload.rows.length ? (
          <div className="hm-load">
            {p.workload.rows.map((x) => (
              <div key={x.id}>
                <span title={x.name}>{x.name}</span>
                <span className="wg-meter">
                  <i style={{ width: `${(x.hours / maxLoad) * 100}%` }} />
                </span>
                <b>{x.label}</b>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No interviews in this window.</Empty>
        )}
      </Card>
    ),
    trend: (
      <section className="hm-box">
        <div className="wg-top">
          <div>
            <div className="hm-l">Applications over time</div>
            <div className="hm-v big">
              <b>{p.trend.total.toLocaleString("en-US")}</b>
              <Delta value={p.trend.total} before={p.trend.before} />
              <span className="hm-sub">vs last period</span>
            </div>
          </div>
        </div>
        <Spark series={[p.trend.current, p.trend.previous]} height={170} grid={Math.min(p.trend.current.length - 1, 14)} label={`${p.trend.total} applications this period, ${p.trend.before} the period before`} />
        <div className="wg-axis">
          <span>{p.days} days ago</span>
          <span>Now</span>
        </div>
        <div className="wg-pp">
          <span>
            Last period <b className="l2">{p.trend.before.toLocaleString("en-US")}</b>
          </span>
          <span>
            This period <b>{p.trend.total.toLocaleString("en-US")}</b>
          </span>
        </div>
      </section>
    ),
    hires: (
      <section className="hm-box">
        <div className="wg-top">
          <div>
            <div className="hm-v">
              <b>{p.hires.total}</b>
            </div>
            <div className="hm-l" title="Applications that reached hired, by the week they did">
              Hires
            </div>
          </div>
          <div className="wg-side">
            <Delta value={p.hires.total} before={p.hires.before} />
            <span>vs the 12 weeks before</span>
          </div>
        </div>
        <Spark series={[p.hires.weeks]} label={`${p.hires.total} hires in the last 12 weeks`} />
        <div className="wg-axis">
          <span>12 weeks ago</span>
          <span>Now</span>
        </div>
      </section>
    ),
    sources: (
      <section className="hm-box">
        <div className="wg-top">
          <div>
            <div className="hm-v">
              <b>{p.sources.reduce((n, s) => n + s.n, 0).toLocaleString("en-US")}</b>
            </div>
            <div className="hm-l">Where applicants come from</div>
          </div>
          <div className="wg-side">
            <b>{p.days} days</b>
            <span>this period</span>
          </div>
        </div>
        <Shares parts={p.sources} />
      </section>
    ),
    offers: (
      <Box title="Offers awaiting approval" count={p.offers.total}>
        {p.offers.rows.length === 0 ? (
          <Empty>No offers waiting on you.</Empty>
        ) : (
          <div className="-mx-2 grid">
            {p.offers.rows.map((o) => (
              <Link key={o.id} href={o.href} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 px-2 py-2 text-[13.5px] hover:bg-[color:var(--hover)]">
                <Avatar name={o.requestedBy ?? o.candidate} size="md" />
                <span className="grid min-w-0">
                  <b className="truncate font-medium">{o.candidate}</b>
                  <span className="truncate text-[12.5px] text-muted-foreground">{o.line}</span>
                </span>
                <em className="whitespace-nowrap text-muted-foreground tabular-nums not-italic">{o.wait}</em>
              </Link>
            ))}
            {p.offers.more ? (
              <Link href={p.offers.more.href} className={cn(textLink, "px-2 py-1.5")}>
                {p.offers.more.label} →
              </Link>
            ) : null}
          </div>
        )}
      </Box>
    ),
    bottlenecks: (
      <Box title="Bottlenecks" count={p.bottlenecks.length}>
        {p.bottlenecks.length === 0 ? (
          <Empty>Nothing is waiting.</Empty>
        ) : (
          <div className="-mx-3 grid">
            {p.bottlenecks.map((b) => (
              <Link key={b.key} href={b.href} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 p-3 hover:bg-[color:var(--hover)]">
                <span className={cn("grid size-8 place-items-center rounded-lg bg-[color:var(--soft)]", b.over ? "text-[color:var(--red)]" : "text-muted-foreground")}>
                  <Icon name={b.icon} />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <b className="text-[14px] font-medium">{b.what}</b>
                  <span className="text-[13px] text-muted-foreground">
                    {b.over ? (
                      <>
                        <i className="mr-1.5 inline-block size-[7px] rounded-full bg-[color:var(--red)] align-[1px]" aria-hidden />
                        Over target ·{" "}
                      </>
                    ) : null}
                    {b.why}
                  </span>
                </span>
                <span className="text-[13px] font-medium whitespace-nowrap text-muted-foreground">{b.label} →</span>
              </Link>
            ))}
          </div>
        )}
      </Box>
    ),
    stages: (
      <Box title="Time in stage" count={`${p.active} active`} aside={p.editStages ? go(p.editStages, "Edit stages") : undefined}>
        <div className="flex flex-wrap gap-4 text-[12.5px] text-muted-foreground">
          {SEGMENT_KEYS.map((k, i) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <i className={cn("block size-2.5", SEGMENT_FILL[i])} />
              {k}
            </span>
          ))}
        </div>
        <div className="grid">
          <div className="grid grid-cols-[minmax(0,1.4fr)_90px_minmax(0,1.6fr)_80px] gap-3 border-b border-[color:var(--line-strong)] px-2 pb-1 pl-6 text-[12.5px] text-faint">
            <span>Stage</span>
            <span>Candidates</span>
            <span>Waiting</span>
            <span>Longest</span>
          </div>
          {p.stages.map((s) => {
            const row = (
              <>
                <span className="flex min-w-0 items-center gap-1.5">
                  <Icon name="chevR" className="size-[13px] text-faint transition-transform group-open:rotate-90" />
                  <span className="truncate">{s.label}</span>
                </span>
                <b className="font-medium tabular-nums">{s.n}</b>
                <span className="flex min-w-0 items-center gap-2">
                  {s.n ? (
                    <span className="flex h-2.5 gap-0.5" style={{ width: `${(s.n / maxStage) * 70}%` }}>
                      {s.segments.map((n, i) =>
                        n ? <i key={i} className={cn("block h-full min-w-[3px]", SEGMENT_FILL[i])} style={{ flex: n }} title={`${n} waiting ${SEGMENT_KEYS[i].toLowerCase()}`} /> : null,
                      )}
                    </span>
                  ) : null}
                  <em className="text-[13px] whitespace-nowrap text-muted-foreground not-italic">{s.typical ? `typical ${s.typical}` : "None"}</em>
                </span>
                <span className="text-[13px] text-muted-foreground tabular-nums">{s.longest ?? ""}</span>
              </>
            );
            const cls = "grid min-h-[40px] grid-cols-[minmax(0,1.4fr)_90px_minmax(0,1.6fr)_80px] items-center gap-3 px-2 text-[13.5px]";
            return s.n ? (
              <details key={s.key} className="group">
                <summary className={cn(cls, "cursor-pointer list-none hover:bg-[color:var(--hover)] group-open:bg-[color:var(--hover)] [&::-webkit-details-marker]:hidden")}>{row}</summary>
                <div className="mb-2 ml-4 grid border-l border-[color:var(--line)] pl-3">
                  {s.people.map((x) => (
                    <Link key={x.id} href={x.href} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1.5 text-[13px] hover:bg-[color:var(--hover)]">
                      <b className="font-medium">{x.name}</b>
                      <span className="truncate text-muted-foreground">{x.line}</span>
                      <em className="text-muted-foreground tabular-nums not-italic">{x.wait}</em>
                    </Link>
                  ))}
                  {s.more ? (
                    <Link href={s.more.href} className={cn(textLink, "px-2 py-1.5")}>
                      {s.more.label} →
                    </Link>
                  ) : null}
                </div>
              </details>
            ) : (
              <div key={s.key} className={cn(cls, "text-faint")}>
                {row}
              </div>
            );
          })}
        </div>
      </Box>
    ),
    stays: (
      <Box title="Average stay in each stage" aside={<span>applications added in the last {p.days} days</span>}>
        {p.stays.every((s) => s.avgDays === null) ? (
          <Empty>No candidate added in this period has moved on yet.</Empty>
        ) : (
          <div className="grid">
            {p.stays.map((s) => (
              <HBar
                key={s.label}
                name={s.label}
                share={(s.avgDays ?? 0) / maxStay}
                value={s.avgDays === null ? "—" : `${s.avgDays}d`}
                aside={<span className="text-right text-[12px] whitespace-nowrap text-faint">{s.stays ? `${s.stays} moved on` : ""}</span>}
              />
            ))}
          </div>
        )}
      </Box>
    ),
    ...(p.feedback
      ? {
          byiv: (
            <Box title="Time to feedback, by interviewer" aside={allJobs}>
              {p.feedback.interviewers.length === 0 ? (
                <Empty>No interviews ended in this period.</Empty>
              ) : (
                <div className="grid">
                  {p.feedback.interviewers.map((x) => (
                    <HBar
                      key={x.id}
                      lead={<Avatar name={x.name} />}
                      name={x.name}
                      share={(x.medianHours ?? 0) / maxFeedback}
                      value={x.median ?? "—"}
                      aside={<span className={cn("text-right text-[12px] whitespace-nowrap", x.out ? "text-negative" : "")}>{x.out ? `${x.out} out` : ""}</span>}
                    />
                  ))}
                </div>
              )}
            </Box>
          ),
        }
      : {}),
    eff: (
      <Box title="Interview efficiency" aside={<span>closed in the last 12 months</span>}>
        {p.efficiency ? (
          <>
            {p.efficiency.rounds.length ? (
              <div className="grid">
                {p.efficiency.rounds.map((r) => (
                  <div key={r.label} title={r.title} className="grid gap-1.5 py-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                      <span className="min-w-0">{r.label}</span>
                      <b className="font-medium tabular-nums">{r.value}</b>
                    </div>
                    <span className="wg-meter">
                      <i style={{ width: `${r.share * 100}%` }} />
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            <div className={cn("grid grid-cols-2 gap-4", p.efficiency.rounds.length ? "border-t border-[color:var(--line)] pt-3" : "")}>
              <div className="grid gap-0.5" title={`${p.efficiency.closed} closed, ${p.efficiency.hires} hired`}>
                <b className="text-[22px] font-medium tracking-[-0.01em] tabular-nums">{p.efficiency.perHire}</b>
                <span className="text-[12.5px] text-muted-foreground">interviews per hire</span>
              </div>
              <div className="grid gap-0.5">
                <b className="text-[22px] font-medium tracking-[-0.01em] tabular-nums">{p.efficiency.hoursPerHire}</b>
                <span className="text-[12.5px] text-muted-foreground">interviewer time per hire</span>
              </div>
            </div>
          </>
        ) : (
          <Empty>Not enough closed yet.</Empty>
        )}
      </Box>
    ),
    ...(p.outstanding
      ? {
          outfb: (
            <Box title="Outstanding feedback" count={p.outstanding.total} aside={allJobs}>
              {p.outstanding.rows.length === 0 ? (
                <Empty>All feedback is in.</Empty>
              ) : (
                <div className="-mx-2 grid">
                  {p.outstanding.rows.map((o) => (
                    <Link key={o.id} href={o.href} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 px-2 py-2 text-[13.5px] hover:bg-[color:var(--hover)]">
                      <Avatar name={o.interviewer} size="md" />
                      <span className="grid min-w-0">
                        <b className="truncate font-medium">{o.interviewer}</b>
                        <span className="truncate text-[12.5px] text-muted-foreground">{o.line}</span>
                      </span>
                      <em className="whitespace-nowrap text-muted-foreground tabular-nums not-italic">{o.wait}</em>
                    </Link>
                  ))}
                  {p.outstanding.more ? (
                    <Link href={p.outstanding.more.href} className={cn(textLink, "px-2 py-1.5")}>
                      {p.outstanding.more.label} →
                    </Link>
                  ) : null}
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
      filters={p.filters.map((f) => (
        <FilterMenu key={f.label} {...f} />
      ))}
      tabs={<HomeTabs on={null} />}
      widgets={widgetNodes(p)}
      layout={p.layout ?? defaultWidgets()}
      foot={p.truncated ? <p className="m-0 text-[12.5px] text-faint">Some reads stopped at their limit, so these numbers are a floor.</p> : null}
    />
  );
}
