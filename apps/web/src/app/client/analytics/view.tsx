import Link from "next/link";
import { Empty, Page, PageBar, SubBar, Tabs, pillOption, pillTrack } from "@/components/page";
import { cn } from "@/lib/utils";
import { FilterMenu, type FilterOption } from "@/components/filter-menu";
import { CareersChart, type ChartPoint } from "./chart";
import { ExportButton } from "./export-button";

// Analytics' markup (design/tats's #analytics), props only: page.tsx does the
// reads and the counting. The bar (the crumb, the department chip) and the
// Job Postings / Pipeline tabs; Job Postings is the careers page: the range,
// a card per metric (picking one charts it), the chart with the period
// before, then the top jobs and where applications came from. Pipeline is
// the explorer: measure, slice and segment, a stacked column per group and
// the same numbers as a table. Colour for the series and the rise or fall
// only.

type Link_ = { href: string; label: string; active: boolean };
type Filter = { label: string; value: string; on: boolean; options: FilterOption[] };

export type AnalyticsHeader = { filters: Filter[]; tabs: Link_[] };

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

/** The page bar (the crumb, the department chip) and the tabs under it, as Home's. */
function Bar({ filters, tabs }: AnalyticsHeader) {
  return (
    <>
      <PageBar
        title="Analytics"
        icon={
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden>
            <path d={ICON} />
          </svg>
        }
      >
        {filters.map((f) => (
          <FilterMenu key={f.label} {...f} />
        ))}
      </PageBar>
      <SubBar>
        <Tabs strip label="Analytics" tabs={tabs} />
      </SubBar>
    </>
  );
}

/** design/tats's segmented control, as links. */
function Segmented({ items, label }: { items: Link_[]; label: string }) {
  return (
    <div role="group" aria-label={label} className={pillTrack}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.active ? "true" : undefined} className={pillOption(i.active)}>
          {i.label}
        </Link>
      ))}
    </div>
  );
}

/** A ranked list: a soft bar behind each row, its share of the largest. */
export function Ranked({ title, col, rows }: { title: string; col: string; rows: { label: string; n: number; href?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <section className="grid content-start gap-1 px-4 pt-3.5 pb-4">
      <div className="flex justify-between px-2.5 pb-2 text-[13.5px]">
        <b className="font-medium">{title}</b>
        <span className="text-[13px] text-faint">{col}</span>
      </div>
      {rows.length === 0 ? (
        <Empty>None in this period.</Empty>
      ) : (
        rows.map((r) => {
          const inner = (
            <>
              <i className="absolute inset-y-0 left-0 bg-[color:var(--accent-soft)]" style={{ width: `${Math.max(4, (r.n / max) * 100)}%` }} />
              <span className="relative truncate">{r.label}</span>
              <b className="relative font-medium tabular-nums">{r.n.toLocaleString("en-US")}</b>
            </>
          );
          const cls = "relative flex h-9 items-center justify-between gap-3 px-2.5 text-[13.5px]";
          return r.href ? (
            <Link key={r.href} href={r.href} className={cn(cls, "hover:bg-[color:var(--hover)]")} title={`${r.n} applications`}>
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

export function CareersView({ header, p }: { header: AnalyticsHeader; p: CareersProps }) {
  return (
    <Page bar={<Bar {...header} />}>
      <div className="grid gap-2 bg-[color:var(--soft)] p-2">
        <div className="flex flex-wrap items-center gap-2.5 px-3.5 pt-3 pb-1.5">
          <h2 className="m-0 text-[17px] font-semibold">Careers page</h2>
          <span className="flex-1" />
          <Segmented items={p.ranges} label="Period" />
          <ExportButton rows={p.exportRows} filename={p.exportName} />
        </div>

        <div className="grid grid-cols-2 gap-1 min-[768px]:grid-cols-4 min-[768px]:gap-2">
          {p.cards.map((c) => (
            <Link
              key={c.key}
              href={c.href}
              aria-current={c.active ? "true" : undefined}
              title={c.def}
              className={cn(
                "grid min-w-0 content-start justify-items-start gap-1.5 px-3 py-3 transition-[background,box-shadow] min-[768px]:px-[18px] min-[768px]:py-4",
                c.active ? "bg-[color:var(--paper)] text-foreground shadow-[var(--shadow),0_0_0_1px_var(--line)]" : "text-faint hover:bg-[color-mix(in_srgb,var(--paper)_55%,transparent)]",
              )}
            >
              <span className={cn("text-[13px]", c.active && "text-muted-foreground")}>{c.label}</span>
              <b className="text-[22px] leading-[1.1] font-semibold tracking-[-0.02em] tabular-nums min-[768px]:text-[28px]">{c.value}</b>
              {c.change ? (
                <em
                  className={cn(
                    "inline-flex h-[22px] items-center gap-[3px] rounded-full pr-2 pl-1.5 text-[12px] font-medium not-italic tabular-nums",
                    !c.active ? "bg-[color:var(--soft-strong)] text-faint" : c.change.up ? "bg-[color:var(--green-soft)] text-[color:var(--green)]" : "bg-[color:var(--red-soft)] text-[color:var(--red)]",
                  )}
                >
                  {chevron(c.change.up)}
                  {c.change.text}
                </em>
              ) : (
                <em className="min-h-[22px] text-[12px] leading-[22px] text-faint not-italic">Nothing before to compare</em>
              )}
            </Link>
          ))}
        </div>

        <div className="overflow-hidden bg-[color:var(--paper)] shadow-[var(--shadow),0_0_0_1px_var(--line)]">
          <div className="flex flex-wrap items-center gap-2.5 px-5 pt-4 pb-1.5">
            <span className="inline-flex items-center gap-2 text-[13.5px] font-medium">
              <i className="block h-[3px] w-3.5 bg-[color:var(--accent)]" />
              {p.metric}
              {p.chart.compare ? (
                <>
                  <i className="ml-2 block h-[3px] w-3.5 bg-[color:var(--faint)]" />
                  <span className="font-normal text-faint">Period before</span>
                </>
              ) : null}
            </span>
            <span className="flex-1" />
            <Segmented
              label="Chart"
              items={[
                { href: p.toggles.line, label: "Line", active: !p.chart.bars },
                { href: p.toggles.bar, label: "Bars", active: p.chart.bars },
              ]}
            />
            <Link href={p.toggles.compare} role="switch" aria-checked={p.chart.compare} className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
              <span className={cn("relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors", p.chart.compare ? "bg-[color:var(--accent)]" : "bg-[color:var(--soft-strong)]")}>
                <i className={cn("absolute top-0.5 left-0.5 size-3.5 rounded-full bg-[color:var(--n0)] shadow-[var(--shadow)] transition-transform", p.chart.compare && "translate-x-3")} />
              </span>
              <span className="max-[767px]:sr-only">Compare to previous period</span>
            </Link>
          </div>
          <CareersChart {...p.chart} />
          <div className="mt-3 grid border-t border-[color:var(--line)] min-[768px]:grid-cols-2 min-[768px]:[&>*+*]:border-l max-[767px]:[&>*+*]:border-t [&>*+*]:border-[color:var(--line)]">
            <Ranked title="Top jobs" col="Applications" rows={p.jobs} />
            <Ranked title="Where they came from" col="Applications" rows={p.sources} />
          </div>
        </div>
      </div>
      <p className="m-0 text-[12px] text-faint">
        Days are UTC. Page views are page loads, not people, and only from a browser that runs scripts. Views that apply counts applications made on your public posts, from the first day views were recorded. Direct means no other site sent them: a link opened on its own, or your own careers page.
        {p.truncated ? " This read stopped at 5,000 rows, so the numbers are a floor." : ""}
      </p>
    </Page>
  );
}

export function ExplorerView({ header, p }: { header: AnalyticsHeader; p: ExplorerProps }) {
  const fill = (j: number) => ({ background: p.segments[j].color });
  return (
    <Page bar={<Bar {...header} />}>
      <section className="mx-auto box-border w-full max-w-[900px] overflow-hidden border border-[color:var(--line)] bg-[color:var(--paper)]">
        <div className="flex items-baseline px-4 pt-5 min-[768px]:px-6">
          <h2 className="m-0 text-[20px] font-semibold tracking-[-0.01em]">Pipeline</h2>
          <span className="flex-1" />
          <span className="text-[13px] text-muted-foreground">
            <b className="mr-0.5 text-[20px] font-semibold text-foreground tabular-nums">{p.total.toLocaleString("en-US")}</b> {p.unit}
          </span>
        </div>
        <div className="grid gap-2.5 px-4 pt-4 pb-1 min-[768px]:grid-cols-3 min-[768px]:px-6">
          {p.picks.map((f) => (
            <div key={f.label} className="grid gap-1.5">
              <span className="pl-0.5 text-[12.5px] text-faint">{f.label}</span>
              <FilterMenu {...f} />
            </div>
          ))}
        </div>

        {p.empty ? (
          <div className="px-6 py-8">
            <Empty>{p.empty}</Empty>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)_40px] grid-rows-[220px_auto] px-4 pt-[22px] pb-2 min-[768px]:px-6">
              <div className="relative grid border-b border-[color:var(--line-strong)]" style={{ gridTemplateColumns: `repeat(${p.rows.length}, minmax(0, 1fr))` }}>
                {[0.25, 0.5, 0.75, 1].map((f) => (
                  <i key={f} className="absolute inset-x-0 h-px bg-[color:var(--line)]" style={{ bottom: `${f * 100}%` }} />
                ))}
                {p.rows.map((r) => (
                  <div key={r.key} className="relative flex items-end justify-center" title={`${r.label} · ${r.total} ${p.unit}`}>
                    <div className="flex w-[18px] flex-col-reverse gap-0.5" style={{ height: `${(r.total / p.top) * 100}%` }}>
                      {r.by.map((v, j) =>
                        v ? <i key={j} className="block min-h-[3px] hover:opacity-80" style={{ flex: v, ...fill(j) }} title={`${p.segments[j].label}: ${v}`} /> : null,
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="relative">
                {[1, 0.75, 0.5, 0.25, 0].map((f) => (
                  <span key={f} className="absolute right-0 translate-y-1/2 text-[11.5px] text-faint tabular-nums" style={{ bottom: `${f * 100}%` }}>
                    {Math.round(p.top * f * 10) / 10}
                  </span>
                ))}
              </div>
              {/* Each column's name under it while they fit; the table below always has them. */}
              {p.rows.length <= LABELLED ? (
                <div className="grid pt-2" style={{ gridTemplateColumns: `repeat(${p.rows.length}, minmax(0, 1fr))` }}>
                  {p.rows.map((r) => (
                    <span key={r.key} className="truncate px-1 text-center text-[11.5px] text-faint" title={r.label}>
                      {r.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="overflow-x-auto border-t border-[color:var(--line)]">
              <table className="w-full min-w-[560px] border-collapse text-[13.5px]">
                <thead>
                  <tr className="h-10 border-b border-[color:var(--line-strong)] bg-[color:var(--surface)] text-[12.5px] text-faint">
                    <th className="pl-4 text-left font-normal min-[768px]:pl-6">{p.slice}</th>
                    <th className="px-2 text-right font-normal">{p.measure}</th>
                    {p.segments.map((s, j) => (
                      <th key={s.label} className="px-2 text-right font-normal whitespace-nowrap last:pr-4 min-[768px]:last:pr-6">
                        <i className="mr-1.5 inline-block size-[9px]" style={fill(j)} />
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={r.key} className="h-[46px] border-b border-[color:var(--line)]">
                      <td className="max-w-[260px] truncate pl-4 min-[768px]:pl-6">{r.label}</td>
                      <td className="px-2 text-right tabular-nums">{r.total}</td>
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
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 px-4 pt-4 pb-5 text-[13px] text-muted-foreground min-[768px]:px-6">
              {p.segments.map((s, j) => (
                <span key={s.label} className="inline-flex items-center">
                  <i className="mr-1.5 inline-block size-[9px]" style={fill(j)} />
                  {s.label}
                </span>
              ))}
            </div>
          </>
        )}
      </section>
      {p.note ? <p className="m-0 mx-auto w-full max-w-[900px] text-[12px] text-faint">{p.note}</p> : null}
    </Page>
  );
}
