import Link from "next/link";
import { Page, PageBar, Section, textLink } from "@/components/page";
import { readCareers, readExplorer } from "@/lib/client/analytics";
import {
  MEASURES,
  METRICS,
  METRIC_KEYS,
  RANGES,
  ORIGINS,
  RANGE_KEYS,
  SEGMENTS,
  SLICES,
  axisTop,
  dailyRows,
  explore,
  metricChange,
  metricValue,
  parseMeasure,
  parseMetric,
  parseRange,
  parseSegment,
  parseSlice,
  periodTotals,
  series,
} from "@/lib/client/analytics-metrics";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { CareersView, ExplorerView, type AnalyticsHeader } from "./view";

// design/tats's Analytics (#analytics, under New Applicants in Top of
// Funnel): two tabs. Job Postings (the default) is the careers page's views
// and applications: the range (?range=week|month|quarter), the metric charted
// (?metric=), line or bars (?chart=bar) and the period before (?compare=1).
// Pipeline (?tab=pipeline) is the explorer: ?measure=, ?slice=, ?segment=.
// Both take the department filter (?department=). lib/client/analytics.ts
// reads on the member's own token, lib/client/analytics-metrics.ts counts,
// view.tsx draws; this file words it. An interviewer gets the pointer home.

type Params = Record<string, string>;

/** The series colours (globals.css), in segment order; a seventh and on are grey. */
const color = (i: number) => (i < 6 ? `var(--series-${i + 1})` : "var(--faint)");

export default async function ClientAnalytics({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, accessLevel } = gate.ctx;

  if (accessLevel === "limited") {
    return (
      <Page bar={<PageBar title="Analytics" />}>
        <Section>
          <p className="m-0 text-[13px] text-muted-foreground">
            You&apos;re an interviewer here. The people you interview are on your{" "}
            <Link href="/client" className={textLink}>
              home page
            </Link>
            .
          </p>
        </Section>
      </Page>
    );
  }

  const raw = await searchParams;
  const sp: Params = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, (Array.isArray(v) ? v[0] : v) ?? ""]));
  const pipelineTab = sp.tab === "pipeline";
  const now = new Date();

  /** This page's URL with some parameters changed; an empty value drops one. */
  const href = (next: Params) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...next })) if (v) params.set(k, v);
    const qs = params.toString();
    return `/client/analytics${qs ? `?${qs}` : ""}`;
  };

  const header = (departments: { id: string; path: string }[], departmentId: string | null): AnalyticsHeader => ({
    filters: departments.length
      ? [
          {
            label: "Department",
            // "All", as Home's, its hover in full.
            options: [
              { href: href({ department: "" }), label: "All", title: "All departments", active: departmentId === null },
              ...departments.map((d) => ({ href: href({ department: d.id }), label: d.path, active: d.id === departmentId })),
            ],
          },
        ]
      : [],
    // Each tab keeps only the department: the other tab's choices mean nothing here.
    tabs: [
      { href: departmentId ? `/client/analytics?department=${departmentId}` : "/client/analytics", label: "Job Postings", active: !pipelineTab },
      { href: `/client/analytics?tab=pipeline${departmentId ? `&department=${departmentId}` : ""}`, label: "Pipeline", active: pipelineTab },
    ],
  });

  if (pipelineTab) {
    const measure = parseMeasure(sp.measure);
    const slice = parseSlice(sp.slice);
    const segment = parseSegment(sp.segment);
    const read = await readExplorer(db, { departmentId: sp.department || null }, now);
    const ex = explore(read.apps, read.names, measure, slice, segment);
    const menu = <K extends string>(label: string, param: string, map: Record<K, { label: string }>, current: K) => ({
      label,
      value: map[current].label,
      on: false,
      options: (Object.keys(map) as K[]).map((k) => ({ href: href({ [param]: k }), label: map[k].label, active: k === current })),
    });
    const unit = MEASURES[measure].unit[ex.total === 1 ? 0 : 1];
    return (
      <ExplorerView
        header={header(read.departments, read.departmentId)}
        p={{
          picks: [menu("Measure", "measure", MEASURES, measure), menu("Slice", "slice", SLICES, slice), menu("Segment", "segment", SEGMENTS, segment)],
          unit,
          total: ex.total,
          top: axisTop(Math.max(0, ...ex.rows.map((r) => r.total))),
          segments: ex.segments.map((s, i) => ({ label: s.label, color: color(i) })),
          rows: ex.rows,
          slice: SLICES[slice].label,
          measure: MEASURES[measure].label,
          note:
            slice === "interviewer"
              ? `Someone interviewed by two people counts under each, so the rows can add up to more than the ${ex.total} ${unit} in all.`
              : "Live candidates in open jobs, as on the Pipeline board.",
          empty: read.apps.length === 0 ? (read.departmentId ? "Nobody is in this department's open jobs yet." : "Nobody is in an open job's pipeline yet.") : ex.rows.length === 0 ? "No interviews yet." : null,
        }}
      />
    );
  }

  const range = parseRange(sp.range);
  const metric = parseMetric(sp.metric);
  const read = await readCareers(db, { range, departmentId: sp.department || null }, now);
  const { current, previous } = periodTotals(read, range, now.getTime());
  const s = series(read, metric, range, now.getTime());
  const compare = sp.compare === "1";
  const share = METRICS[metric].share;
  const peak = Math.max(0, ...s.points.flatMap((x) => [x.current ?? 0, compare ? (x.previous ?? 0) : 0]));

  const cards = METRIC_KEYS.map((k) => {
    const v = metricValue(k, current);
    const d = metricChange(k, current, previous);
    return {
      key: k,
      label: METRICS[k].label,
      def: METRICS[k].def,
      value: v === null ? "None" : METRICS[k].share ? `${v.toFixed(METRICS[k].digits)}%` : v.toLocaleString("en-US"),
      // To one place, a trailing ".0" dropped: "640%", "7.6 pts".
      change: d === null ? null : { text: METRICS[k].share ? `${+Math.abs(d).toFixed(1)} pts` : `${+Math.abs(d).toFixed(1)}%`, up: d >= 0 },
      href: href({ metric: k === "applications" ? "" : k }),
      active: k === metric,
    };
  });

  return (
    <CareersView
      header={header(read.departments, read.departmentId)}
      p={{
        ranges: RANGE_KEYS.map((k) => ({ href: href({ range: k === "month" ? "" : k }), label: RANGES[k].label, active: k === range })),
        cards,
        metric: METRICS[metric].label,
        chart: { points: s.points, top: axisTop(peak), share, compare, bars: sp.chart === "bar", step: s.step },
        toggles: { line: href({ chart: "" }), bar: href({ chart: "bar" }), compare: href({ compare: compare ? "" : "1" }) },
        jobs: [...current.byJob]
          .map(([id, n]) => ({ label: read.jobs[id] ?? "A job you can't see", n, href: `/client/jobs/${id}` }))
          .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)),
        sources: ORIGINS.map((o) => ({ label: o.label, n: current.byOrigin[o.key] }))
          .filter((x) => x.n)
          .sort((a, b) => b.n - a.n),
        exportRows: dailyRows(read, range, now.getTime()),
        exportName: `applications-${RANGES[range].days}d-${now.toISOString().slice(0, 10)}.csv`,
        truncated: read.truncated,
      }}
    />
  );
}
