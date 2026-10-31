import Link from "next/link";
import { Avatar, Empty, Page, PageBar, Section, SubBar, Tabs, textLink } from "@/components/page";
import { cn } from "@/lib/utils";
import { FilterMenu, type FilterOption } from "@/components/filter-menu";
import { TargetChip, type TargetChipProps } from "./home-target";

// Home's markup (design/tats's Recruiting Overview), props only: page.tsx
// does the reads and the counting. The prototype's bar (the crumb, then the
// period, department and job chips) and its Overview / Applicant Tickets /
// Interviews / Referrals tabs; six cards, then "Where are candidates getting
// stuck?": the bottlenecks beside time in stage, then feedback by
// interviewer, the average stay per stage and the feedback outstanding. Bars
// are plain CSS, no chart library. Colour only for meaning: red for a
// falling count, the longest waits and a missed target. A card's target sits
// at the left of its foot (home-target.tsx).

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

export type HomeViewProps = {
  title: string;
  days: number;
  /** The chips: the period always, the department and the job when there is one to pick. */
  filters: { label: string; value: string; on: boolean; options: FilterOption[] }[];
  pipelineHref: string;
  newApps: { value: number; change: number | null; bars: Bar[]; target: TargetChipProps | null };
  inProcess: { value: number; bars: Bar[] };
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
  workload: { hours: string; interviews: number; held: number; booked: number; target: TargetChipProps | null; people: { id: string; name: string; hours: number; label: string }[] };
  bottlenecks: { key: string; over: boolean; what: string; why: string; icon: BottleneckIcon; label: string; href: string }[];
  /** Null alongside `feedback`: not theirs. */
  outstanding: { total: number; rows: { id: string; interviewer: string; line: string; wait: string; href: string }[]; more: { href: string; label: string } | null } | null;
  stages: StageLine[];
  active: number;
  stays: { label: string; avgDays: number | null; stays: number }[];
  truncated: boolean;
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
const NAV = [
  { href: "/client", label: "Overview" },
  { href: "/client/applicants", label: "Applicant Tickets" },
  { href: "/client/interviews", label: "Interviews" },
  { href: "/client/referrals", label: "Referrals" },
];

const SEGMENT_KEYS = ["Under a day", "1 to 3 days", "Over 3 days"];
const SEGMENT_FILL = ["bg-[color:var(--soft-strong)]", "bg-[color-mix(in_srgb,var(--ink)_45%,var(--paper))]", "bg-[color:var(--ink)]"];

/** A column chart: one bar per bin, its label under it, the count on hover. */
function Bars({ bars, tone }: { bars: Bar[]; tone?: (b: Bar) => string | undefined }) {
  const max = Math.max(1, ...bars.map((b) => b.n));
  return (
    <div className="mt-2 grid h-16 auto-cols-fr grid-flow-col gap-1.5" role="img" aria-label={bars.map((b) => b.title).join(", ")}>
      {bars.map((b, i) => (
        <span key={`${b.label}-${i}`} title={b.title} className="group grid min-w-0 grid-rows-[minmax(0,1fr)_auto] gap-1">
          <i
            className={cn(
              "w-full self-end transition-colors group-hover:bg-muted-foreground",
              tone?.(b) ?? "bg-[color:var(--soft-strong)]",
            )}
            style={{ height: b.n ? `${Math.max(6, (b.n / max) * 100)}%` : 0 }}
          />
          <em className="truncate text-center text-[11px] whitespace-nowrap text-faint not-italic">{b.label}</em>
        </span>
      ))}
    </div>
  );
}

function Card({ label, def, value, unit, ctx, target, foot, children }: {
  label: string;
  def: string;
  value: React.ReactNode;
  unit?: string;
  ctx: React.ReactNode;
  target?: TargetChipProps | null;
  foot?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2 border border-[color:var(--line)] bg-card px-5 pt-4 pb-4">
      <span
        title={def}
        className="w-fit cursor-help text-[13.5px] text-muted-foreground underline decoration-[color:var(--line-strong)] decoration-dotted underline-offset-4"
      >
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        <b className="text-[28px] leading-[1.15] font-medium tracking-[-0.02em] text-foreground tabular-nums">{value}</b>
        {unit ? <span className="text-[12.5px] text-muted-foreground">{unit}</span> : null}
      </div>
      <div className="flex min-h-[18px] flex-wrap items-baseline gap-2 text-[12.5px] text-muted-foreground">{ctx}</div>
      {children}
      {target || foot ? (
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-[color:var(--line)] pt-3">
          {target ? <TargetChip {...target} /> : <span />}
          {foot}
        </div>
      ) : null}
    </section>
  );
}

const go = (href: string, label: string) => (
  <Link href={href} className="inline-flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap text-[color:var(--accent)] hover:underline hover:underline-offset-3">
    {label} →
  </Link>
);

function Waits({ label, def, card, noun, foot }: { label: string; def: string; card: WaitCard; noun: [string, string]; foot: React.ReactNode }) {
  return (
    <Card
      label={label}
      def={def}
      value={card.typical ?? "None"}
      unit={card.typical ? "typical" : undefined}
      ctx={card.waiting ? `${card.waiting} ${card.waiting === 1 ? noun[0] : noun[1]} waiting · oldest ${card.oldest}` : "Nothing waiting"}
      target={card.target}
      foot={foot}
    >
      <Bars bars={card.buckets} tone={(b) => (b.n && b.late ? "bg-[color-mix(in_srgb,var(--red)_70%,var(--paper))]" : undefined)} />
    </Card>
  );
}

/** The feedback card's one bar: on time, late, still outstanding. */
function FeedbackSplit({ onTime, late, outstanding, hours }: { onTime: number; late: number; outstanding: number; hours: number }) {
  const parts = [
    { n: onTime, label: `Within ${hours}h`, fill: "bg-muted-foreground" },
    { n: late, label: "Late", fill: "bg-[color:var(--amber)]" },
    { n: outstanding, label: "Outstanding", fill: "bg-[color-mix(in_srgb,var(--red)_70%,var(--paper))]" },
  ];
  if (!parts.some((x) => x.n)) return <Empty>No interviews ended in this period.</Empty>;
  return (
    <div className="mt-2 grid gap-2">
      <div className="flex h-2.5 gap-0.5" role="img" aria-label={parts.map((x) => `${x.n} ${x.label.toLowerCase()}`).join(", ")}>
        {parts.map((x) => (x.n ? <i key={x.label} className={cn("block h-full min-w-[4px]", x.fill)} style={{ flex: x.n }} /> : null))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
        {parts.map((x) => (
          <span key={x.label} className="inline-flex items-center gap-1.5">
            <i className={cn("block size-2.5", x.fill)} />
            {x.label} <b className="font-medium text-foreground tabular-nums">{x.n}</b>
          </span>
        ))}
      </div>
    </div>
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
      <span className="h-2 overflow-hidden bg-[color:var(--soft)]">
        <i className="block h-full bg-muted-foreground" style={{ width: share > 0 ? `${Math.max(2, share * 100)}%` : 0 }} />
      </span>
      <em className="text-right tabular-nums not-italic">{value}</em>
      {aside ?? <span />}
    </div>
  );
}

export function HomeView(p: HomeViewProps) {
  const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
  const maxStage = Math.max(1, ...p.stages.map((s) => s.n));
  const maxLoad = Math.max(1, ...p.workload.people.map((x) => x.hours));
  const maxFeedback = Math.max(1, ...(p.feedback?.interviewers ?? []).map((x) => x.medianHours ?? 0));
  const maxStay = Math.max(1, ...p.stays.map((s) => s.avgDays ?? 0));

  return (
    <Page
      bar={
        <>
          <PageBar title={p.title} icon={<Icon name="home" />}>
            {p.filters.map((f) => (
              <FilterMenu key={f.label} {...f} />
            ))}
          </PageBar>
          <SubBar>
            <Tabs strip label="Overview pages" tabs={NAV.map((n, i) => ({ ...n, active: i === 0 }))} />
          </SubBar>
        </>
      }
    >

      <div data-tour="kpis" className="grid gap-4 min-[768px]:grid-cols-2 min-[1100px]:grid-cols-3">
        <Card
          label="New applications"
          def="Applications added in the period, applied or sourced"
          value={p.newApps.value.toLocaleString("en-US")}
          ctx={
            p.newApps.change === null ? (
              `none in the ${p.days} days before`
            ) : (
              <>
                <span className={cn("tabular-nums", p.newApps.change >= 0 ? "text-positive" : "text-negative")}>
                  {p.newApps.change >= 0 ? "+" : "−"}
                  {pct(p.newApps.change)}
                </span>
                vs the {p.days} days before
              </>
            )
          }
          target={p.newApps.target}
        >
          <Bars bars={p.newApps.bars} />
        </Card>

        <Card
          label="Candidates in process"
          def="Everyone in an open job's pipeline, by column of the Pipeline board"
          value={p.inProcess.value.toLocaleString("en-US")}
          unit="active"
          ctx={`across ${p.inProcess.bars.filter((b) => b.n).length} stages`}
          foot={go(p.pipelineHref, "Open Pipeline")}
        >
          <Bars bars={p.inProcess.bars} />
        </Card>

        <Waits
          label="Waiting for review"
          def="New candidates, sourced or contacted and not yet screened: how long they have waited"
          card={p.review}
          noun={["candidate", "candidates"]}
          foot={go(p.pipelineHref, "Open Pipeline")}
        />

        <Waits
          label="Waiting to be scheduled"
          def="Interviewing with nothing booked or held yet: how long since they moved to interviewing"
          card={p.schedule}
          noun={["candidate", "candidates"]}
          foot={go(p.pipelineHref, "Open Pipeline")}
        />

        {p.feedback ? (
          <Card
            label="Interviewer feedback on time"
            def={`Feedback filed within ${p.feedback.onTimeHours}h of the interview ending, for interviews that ended in the period on the jobs you manage`}
            value={p.feedback.onTimeShare === null ? "None" : `${Math.round(p.feedback.onTimeShare * 100)}%`}
            unit={p.feedback.onTimeShare === null ? undefined : `of ${p.feedback.filed} filed`}
            ctx={
              <>
                {p.feedback.outstanding ? (
                  <span className="text-negative">{p.feedback.outstanding} outstanding</span>
                ) : (
                  <span>All feedback is in</span>
                )}
                {p.feedback.typical ? <span>· typically {p.feedback.typical}</span> : null}
                {p.feedback.allJobs ? <span className="text-faint">· every job you manage</span> : null}
              </>
            }
            target={p.feedback.target}
          >
            <FeedbackSplit onTime={p.feedback.onTime} late={p.feedback.filed - p.feedback.onTime} outstanding={p.feedback.outstanding} hours={p.feedback.onTimeHours} />
          </Card>
        ) : null}

        <Card
          label="Interview workload"
          def={`Interviewer hours: interviews held in the last ${p.days} days and booked in the next ${p.days}`}
          value={p.workload.hours}
          ctx={`${p.workload.held} held · ${p.workload.booked} booked`}
          target={p.workload.target}
        >
          {p.workload.people.length ? (
            <div className="mt-1 grid">
              {p.workload.people.map((x) => (
                <HBar key={x.id} name={x.name} share={x.hours / maxLoad} value={x.label} />
              ))}
            </div>
          ) : (
            <Empty>No interviews in this window.</Empty>
          )}
        </Card>
      </div>

      <h2 className="m-0 mt-2 text-[15px] font-semibold">Where are candidates getting stuck?</h2>

      <div data-tour="stuck" className="grid items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Section title="Bottlenecks" count={p.bottlenecks.length}>
          {p.bottlenecks.length === 0 ? (
            <Empty>Nothing is waiting.</Empty>
          ) : (
            <div className="-mx-3 grid">
              {p.bottlenecks.map((b) => (
                <Link key={b.key} href={b.href} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 p-3 hover:bg-[color:var(--hover)]">
                  <span className={cn("grid size-8 place-items-center bg-[color:var(--soft)]", b.over ? "text-[color:var(--red)]" : "text-muted-foreground")}>
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
                  <span className="text-[13px] font-medium whitespace-nowrap text-[color:var(--accent)]">{b.label} →</span>
                </Link>
              ))}
            </div>
          )}
        </Section>

        <Section title="Time in stage" count={`${p.active} active`}>
          <div className="flex flex-wrap gap-4 text-[12.5px] text-muted-foreground">
            {SEGMENT_KEYS.map((k, i) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <i className={cn("block size-2.5", SEGMENT_FILL[i])} />
                {k}
              </span>
            ))}
          </div>
          <div className="grid">
            <div className="grid grid-cols-[minmax(0,1.3fr)_72px_minmax(0,1.6fr)_64px] gap-3 border-b border-[color:var(--line)] px-2 pb-1 text-[12.5px] text-faint">
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
              const cls = "grid min-h-[40px] grid-cols-[minmax(0,1.3fr)_72px_minmax(0,1.6fr)_64px] items-center gap-3 px-2 text-[13.5px]";
              return s.n ? (
                <details key={s.key} className="group">
                  <summary className={cn(cls, "cursor-pointer list-none hover:bg-[color:var(--hover)] group-open:bg-[color:var(--hover)] [&::-webkit-details-marker]:hidden")}>{row}</summary>
                  <div className="mb-2 ml-4 grid border-l border-[color:var(--line)] pl-3">
                    {s.people.map((x) => (
                      <Link key={x.id} href={x.href} className="grid grid-cols-[22px_auto_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1.5 text-[13px] hover:bg-[color:var(--hover)]">
                        <Avatar name={x.name} />
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
        </Section>
      </div>

      <div className={cn("grid items-start gap-4", p.feedback ? "min-[768px]:grid-cols-2 min-[1100px]:grid-cols-3" : "")}>
        {p.feedback ? (
          <Section title="Time to feedback, by interviewer" aside={p.feedback.allJobs ? <span>every job you manage</span> : undefined}>
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
          </Section>
        ) : null}

        <Section title="Average stay in each stage" aside={<span>applications added in the last {p.days} days</span>}>
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
        </Section>

        {p.outstanding ? (
          <Section title="Outstanding feedback" count={p.outstanding.total} aside={p.feedback?.allJobs ? <span>every job you manage</span> : undefined}>
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
          </Section>
        ) : null}
      </div>

      {p.truncated ? <p className="m-0 text-[12.5px] text-faint">Some reads stopped at their limit, so these numbers are a floor.</p> : null}
    </Page>
  );
}
