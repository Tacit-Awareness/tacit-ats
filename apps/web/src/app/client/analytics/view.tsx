import Link from "next/link";
import { Empty, Page, PageBar, Pill, Tabs, pillOption, pillTrack } from "@/components/page";
import { cn } from "@/lib/utils";
import { FilterMenu, type FilterOption } from "@/components/filter-menu";
import { CareersChart, type ChartPoint } from "./chart";
import { ExportButton } from "./export-button";
import { Figure } from "../stat-number";
import "./analytics.css";

// Analytics' markup (design/tats's #analytics, in Testbench's dress), props
// only: page.tsx does the reads and the counting. The bar (the title, the Job
// Postings / Pipeline tabs beside it, the department on the right as Home's
// small segmented control). Job
// Postings is the careers page, sized to fit one screen: its heading with the
// range and Export, one stats card with a cell per metric (picking one charts it,
// Testbench's `.stats`; each number in the app's number style with its change
// beside it), then one white card with a short chart, the period before named at
// its line's end, and the top jobs and where applications came from as rounded
// meters. Pipeline is
// the explorer: measure, slice and segment, a stacked column per group and the
// same numbers as a table; its segments are named in plain text in stack order,
// and hovering a name, a column head or a piece of a column lights that segment
// everywhere (analytics.css), so there is no colour key. Colour for the series
// and the rise or fall only.

type Link_ = { href: string; label: string; active: boolean; title?: string };
type Filter = { label: string; value: string; on: boolean; options: FilterOption[] };

/** The bar's tabs, and its filters as small segmented controls (the department, as Home's). */
export type AnalyticsHeader = { filters: { label: string; options: Link_[] }[]; tabs: Link_[] };

export type CareersProps = {
  ranges: Link_[];
  cards: { key: string; label: string; def: string; value: string; change: { text: string; up: boolean } | null; href: string; active: boolean }[];
  metric: string;
  chart: { points: ChartPoint[]; top: number; share: boolean; compare: boolean; bars: boolean; step: number };
  toggles: { line: string; bar: string; compare: string };
  jobs: { label: string; n: number; href: string }[];
  sources: { label: string; n: number }[];
  exportRows: string[][];
  exportName: string;
  truncated: boolean;
};

export type ExplorerProps = {
  picks: Filter[];
  unit: string;
  total: number;
  /** The axis' top. */
  top: number;
  segments: { label: string; color: string }[];
  rows: { key: string; label: string; by: number[]; total: number }[];
  slice: string;
  measure: string;
  note: string | null;
  empty: string | null;
};

/** Columns the explorer names under the chart; past it, only the table does. */
const LABELLED = 10;

const ICON = "M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5";

/** The page bar: the crumb, then Job Postings / Pipeline beside it (design/tats-ui-update's `.cx-bar`), the department's segmented control right. */
function Bar({ filters, tabs }: AnalyticsHeader) {
  return (
    <>
      <PageBar
        title="Analytics"
        lead={<Tabs strip label="Analytics" tabs={tabs} />}
        icon={
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden>
            <path d={ICON} />
          </svg>
        }
      >
        {filters.map((f) => (
          <Segmented key={f.label} items={f.options} label={f.label} small />
        ))}
      </PageBar>
    </>
  );
}

/** design/tats's segmented control, as links; `small` is Testbench's `.seg.small`, for a filter in the bar as Home's. */
function Segmented({ items, label, small }: { items: Link_[]; label: string; small?: boolean }) {
  return (
    <div role="group" aria-label={label} className={cn(pillTrack, small && "overflow-x-auto [scrollbar-width:none]")}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} title={i.title} aria-current={i.active ? "true" : undefined} className={pillOption(i.active, small ? "sm" : "md")}>
          {i.label}
        </Link>
      ))}
    </div>
  );
}

/** design/tats's `.an-tog`: line or bars, as two icon options on Testbench's segmented track. */
function ChartToggle({ line, bar, bars }: { line: string; bar: string; bars: boolean }) {
  const btn = (on: boolean) =>
    cn("grid h-[26px] w-[30px] place-items-center rounded-[7px] transition-colors", on ? "bg-[color:var(--pick)] text-[color:var(--pick-ink)] shadow-[var(--pick-shadow)]" : "text-faint hover:text-foreground");
  const icon = (d: string) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden>
      <path d={d} />
    </svg>
  );
  return (
    <div role="group" aria-label="Chart" className="inline-flex gap-0.5 rounded-[10px] bg-[color:var(--track)] p-[3px] shadow-[inset_0_0_0_1px_rgba(22,23,26,0.03)]">
      <Link href={line} aria-label="Line chart" aria-current={!bars ? "true" : undefined} className={btn(!bars)}>
        {icon("M2 11.5l3.5-4 3 2.5L14 4")}
      </Link>
      <Link href={bar} aria-label="Bar chart" aria-current={bars ? "true" : undefined} className={btn(bars)}>
        {icon(ICON)}
      </Link>
    </div>
  );
}

/** A ranked list: each row's name in full, then a short rounded meter of its share of the largest, and its count. */
export function Ranked({ title, col, rows }: { title: string; col: string; rows: { label: string; n: number; href?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <section className="grid content-start gap-px px-3 pt-3.5 pb-3.5 min-[768px]:px-4">
      <div className="flex items-center justify-between px-2 pb-1.5">
        <h3 className="m-0 font-sans text-[15px] leading-[22px] font-semibold tracking-[-0.01em]">{title}</h3>
        <span className="text-[12.5px] text-faint">{col}</span>
      </div>
      {rows.length === 0 ? (
        <Empty className="px-2">None in this period.</Empty>
      ) : (
        rows.map((r) => {
          const inner = (
            <>
              <span className="truncate text-muted-foreground" title={r.label}>
                {r.label}
              </span>
              <span className="h-1.5 overflow-hidden rounded-[3px] bg-[color:var(--soft-strong)]">
                <i className="block h-full rounded-[3px] bg-[color:var(--accent)]" style={{ width: `${Math.max(3, (r.n / max) * 100)}%` }} />
              </span>
              <b className="text-right font-normal text-foreground tabular-nums">{r.n.toLocaleString("en-US")}</b>
            </>
          );
          const cls = "grid h-[30px] grid-cols-[minmax(0,1fr)_minmax(44px,20%)_36px] items-center gap-3 rounded-[7px] px-2 text-[12.5px]";
          return r.href ? (
            <Link key={r.href} href={r.href} className={cn(cls, "transition-colors hover:bg-[color:var(--surface)] [&:hover>span:first-child]:text-foreground")} title={`${r.n} applications`}>
              {inner}
            </Link>
          ) : (
            <div key={r.label} className={cls} title={`${r.n} applications`}>
              {inner}
            </div>
          );
        })
      )}
    </section>
  );
}

const chevron = (up: boolean) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="size-[11px]" aria-hidden>
    <path d={up ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} />
  </svg>
);

/** Beside a heading whose hover says what its numbers count: the footnotes design/tats printed under the page live there now. */
const info = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" className="size-[14px] text-faint" aria-hidden>
    <path d="M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 7.3v3.4M8 5.2h.01" />
  </svg>
);

/** What the careers numbers count, for the heading's hover: the footnote design/tats printed under the page. */
const ABOUT =
  "Days are UTC. Page views are page loads, not people, and only from a browser that runs scripts. Views that apply counts applications made on your public posts, from the first day views were recorded. Direct means no other site sent them: a link opened on its own, or your own careers page.";

export function CareersView({ header, p }: { header: AnalyticsHeader; p: CareersProps }) {
  return (
    <Page bar={<Bar {...header} />}>
      <div className="mx-auto grid w-full max-w-[1120px] gap-4 [@media(max-height:820px)]:gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="m-0 inline-flex items-center gap-2 font-sans text-[17px] leading-[24px] font-semibold tracking-[-0.01em]" title={ABOUT}>
            Careers page
            {info}
            <span className="sr-only">. {ABOUT}</span>
          </h2>
          <span className="flex-1" />
          <Segmented items={p.ranges} label="Period" />
          <ExportButton rows={p.exportRows} filename={p.exportName} />
        </div>

        <div className="grid grid-cols-2 overflow-hidden rounded-[14px] bg-card shadow-[var(--shadow)] min-[768px]:grid-cols-4">
          {p.cards.map((c) => (
            <Link
              key={c.key}
              href={c.href}
              aria-current={c.active ? "true" : undefined}
              title={c.def}
              // Each cell rules its own left and top edge, outside its box: the first column's and row's fall outside the clipped card, and a
              // later cell's rule paints over an earlier one's hover, so neither hover nor the picked cell's ink underline ever hides a rule.
              className={cn(
                "grid min-w-0 content-start justify-items-start gap-3.5 px-5 pt-5 pb-6 transition-colors min-[768px]:px-6 [@media(max-height:820px)]:pt-4 [@media(max-height:820px)]:pb-5",
                c.active ? "shadow-[-1px_0_0_var(--line),0_-1px_0_var(--line),inset_0_-2px_0_var(--ink)]" : "shadow-[-1px_0_0_var(--line),0_-1px_0_var(--line)] hover:bg-[color:var(--surface)]",
              )}
            >
              {/* One number style in every cell, picked or not: the picked one is the underline and its label in ink. Each cell
                  reads in one voice, the number's (stat-number.tsx): its label names it and its change belongs to it, so both are Mona Sans. */}
              <span className={cn("font-sans text-[13px] leading-[18px]", c.active ? "text-foreground" : "text-muted-foreground")}>{c.label}</span>
              <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5">
                <b className="text-[30px] leading-none font-normal text-foreground">
                  <Figure value={c.value} />
                </b>
                {c.change ? (
                  <Pill
                    tone={!c.active ? "grey" : c.change.up ? "green" : "red"}
                    className="h-[22px] gap-[3px] pr-[7px] pl-[5px] font-sans text-[12.5px] font-medium"
                    title={`${c.change.up ? "Up" : "Down"} ${c.change.text} on the period before`}
                  >
                    {chevron(c.change.up)}
                    <span className="sr-only">{c.change.up ? "Up" : "Down"} </span>
                    {c.change.text}
                  </Pill>
                ) : null}
              </span>
            </Link>
          ))}
        </div>

        <div className="overflow-hidden rounded-[14px] bg-card shadow-[var(--shadow)]">
          <div className="flex flex-wrap items-center gap-2.5 px-4 pt-3.5 pb-0 min-[768px]:px-5">
            <h3 className="m-0 font-sans text-[15px] leading-[22px] font-semibold tracking-[-0.01em]">{p.metric}</h3>
            <span className="flex-1" />
            <ChartToggle line={p.toggles.line} bar={p.toggles.bar} bars={p.chart.bars} />
            <Link href={p.toggles.compare} role="switch" aria-checked={p.chart.compare} className="inline-flex h-[30px] items-center gap-2 rounded-[7px] px-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground">
              <span className={cn("relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors", p.chart.compare ? "bg-[color:var(--accent)]" : "bg-[color:var(--soft-strong)] shadow-[inset_0_0_0_1px_var(--line-strong)]")}>
                <i className={cn("absolute top-0.5 left-0.5 size-3.5 rounded-full bg-[color:var(--n0)] shadow-[var(--shadow-sm)] transition-transform duration-200 ease-[var(--ease)]", p.chart.compare && "translate-x-3")} />
              </span>
              <span className="max-[767px]:sr-only">Compare to previous period</span>
            </Link>
          </div>
          <CareersChart {...p.chart} />
          <div className="mt-2 grid border-t border-[color:var(--line)] min-[768px]:grid-cols-2 min-[768px]:[&>*+*]:border-l max-[767px]:[&>*+*]:border-t [&>*+*]:border-[color:var(--line)]">
            <Ranked title="Top postings" col="Applications" rows={p.jobs} />
            <Ranked title="Where they came from" col="Applications" rows={p.sources} />
          </div>
        </div>
        {p.truncated ? <p className="m-0 text-[12px] text-faint">This read stopped at 5,000 rows, so the numbers are a floor.</p> : null}
      </div>
    </Page>
  );
}

export function ExplorerView({ header, p }: { header: AnalyticsHeader; p: ExplorerProps }) {
  const fill = (j: number) => ({ background: p.segments[j].color });
  return (
    <Page bar={<Bar {...header} />}>
      <section className="an-ex mx-auto box-border w-full max-w-[900px] overflow-hidden rounded-[14px] bg-card shadow-[var(--shadow)]">
        <div className="flex items-baseline gap-3 px-4 pt-5 min-[768px]:px-6">
          <h2 className="m-0 inline-flex items-center gap-2 font-sans text-[17px] leading-[24px] font-semibold tracking-[-0.01em]" title={p.note ?? undefined}>
            Pipeline
            {p.note ? (
              <>
                {info}
                <span className="sr-only">. {p.note}</span>
              </>
            ) : null}
          </h2>
          <span className="flex-1" />
          {/* The total and what it counts, in the number's one voice. */}
          <span className="inline-flex items-baseline gap-2 font-sans text-[13px] text-faint">
            <b className="text-[22px] leading-none font-normal text-foreground">
              <Figure value={p.total.toLocaleString("en-US")} />
            </b>
            {p.unit}
          </span>
        </div>
        <div className="grid gap-3 px-4 pt-4 pb-1 min-[768px]:grid-cols-3 min-[768px]:px-6">
          {p.picks.map((f) => (
            <div key={f.label} className="grid gap-1.5">
              <span className="text-[12.5px] text-muted-foreground">{f.label}</span>
              <FilterMenu {...f} block />
            </div>
          ))}
        </div>

        {p.empty ? (
          <div className="px-6 py-8">
            <Empty>{p.empty}</Empty>
          </div>
        ) : (
          <>
            {/* The axis on the left, as the careers chart's. */}
            <div className="grid grid-cols-[40px_minmax(0,1fr)] grid-rows-[220px_auto] px-4 pt-6 pb-2 min-[768px]:px-6">
              <div className="relative">
                {[1, 0.75, 0.5, 0.25, 0].map((f) => (
                  <span key={f} className="absolute right-2.5 translate-y-1/2 text-[11.5px] text-faint tabular-nums" style={{ bottom: `${f * 100}%` }}>
                    {Math.round(p.top * f * 10) / 10}
                  </span>
                ))}
              </div>
              <div className="relative grid border-b border-[color:var(--line-strong)]" style={{ gridTemplateColumns: `repeat(${p.rows.length}, minmax(0, 1fr))` }}>
                {[0.25, 0.5, 0.75, 1].map((f) => (
                  <i key={f} className="absolute inset-x-0 h-px bg-[color:var(--line)]" style={{ bottom: `${f * 100}%` }} />
                ))}
                {p.rows.map((r) => (
                  <div key={r.key} className="relative flex items-end justify-center" title={`${r.label}: ${r.total} ${p.unit}`}>
                    <div className="flex w-[18px] flex-col-reverse gap-0.5 overflow-hidden rounded-t-[4px]" style={{ height: `${(r.total / p.top) * 100}%` }}>
                      {r.by.map((v, j) => (v ? <i key={j} data-seg={j} className="block min-h-[3px]" style={{ flex: v, ...fill(j) }} title={`${p.segments[j].label}: ${v}`} /> : null))}
                    </div>
                  </div>
                ))}
              </div>
              {/* Each column's name under it while they fit; the table below always has them. */}
              {p.rows.length <= LABELLED ? (
                <div className="col-start-2 grid pt-2" style={{ gridTemplateColumns: `repeat(${p.rows.length}, minmax(0, 1fr))` }}>
                  {p.rows.map((r) => (
                    <span key={r.key} className="truncate px-1 text-center text-[11.5px] text-faint" title={r.label}>
                      {r.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            {/* The segments by name, bottom of the stack first; hover one to light it in the columns and the table. */}
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 px-4 pt-2 pb-4 text-[12.5px] text-muted-foreground min-[768px]:px-6">
              {p.segments.map((s, j) => (
                <span key={s.label} data-seg={j} className="an-key">
                  {s.label}
                </span>
              ))}
            </div>

            <div className="overflow-x-auto border-t border-[color:var(--line)]">
              <table className="w-full min-w-[560px] border-collapse text-[13px]">
                <thead>
                  <tr className="h-10 border-b border-[color:var(--line)] text-[12px] text-faint">
                    <th className="pl-4 text-left font-normal min-[768px]:pl-6">{p.slice}</th>
                    <th className="px-2 text-right font-normal">{p.measure}</th>
                    {p.segments.map((s, j) => (
                      <th key={s.label} data-seg={j} className="an-key px-2 text-right font-normal whitespace-nowrap last:pr-4 min-[768px]:last:pr-6">
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={r.key} className="h-12 border-b border-[color:var(--line)] last:border-b-0">
                      <td className="max-w-[260px] truncate pl-4 min-[768px]:pl-6">{r.label}</td>
                      <td className="px-2 text-right font-medium tabular-nums">{r.total}</td>
                      {r.by.map((v, j) => (
                        <td key={j} className={cn("px-2 text-right tabular-nums last:pr-4 min-[768px]:last:pr-6", !v && "text-faint")}>
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </Page>
  );
}
