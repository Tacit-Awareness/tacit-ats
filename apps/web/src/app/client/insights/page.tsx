import Link from "next/link";
import { FileText } from "lucide-react";
import { Page, PageBar, Section, textLink } from "@/components/page";
import { Header } from "@/components/tickets/header";
import { heading } from "@/components/tickets/styles";
import { readInsights } from "@/lib/client/insights";
import { INSIGHT_RANGES, days, hireBars, loadBars, offerBars, parseInsightRange, pipelineBars, postRows, rejectionBars, sourceBars, type Bar } from "@/lib/client/insights-rules";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";

// Insights (design/tacit-tickets's Insights, in the workspace menu and G then N):
// the client connector's own reports as the prototype's bars
// (lib/client/insights.ts reads, insights-rules.ts shapes), so the page says
// what Claude would. Overview: Pipeline, Sources, Time To Hire, Interviewer
// Load; Outcomes: Offers, Rejections, Equal Opportunity (admins, totals only,
// small groups hidden by core); Job Posts: views and applications per post.
// `?tab=`, `?range=30|90`. Analytics and the Recruiting Overview stay, in ⌘K.
// Left out: interviewers' weekly limits beside their load (the report has
// their interviews, not their limits).

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "outcomes", label: "Outcomes" },
  { key: "posts", label: "Job Posts" },
] as const;

function Bars({ title, rows, unit = "", total }: { title: string; rows: Bar[]; unit?: string; total?: number }) {
  const shown = rows.filter((r) => r.value > 0);
  const max = total ?? Math.max(...shown.map((r) => r.value), 1);
  return (
    <section className="rounded-xl border border-line-strong px-4 pt-3.5 pb-4">
      <h3 className={heading}>{title}</h3>
      {shown.length ? (
        <div className="mt-3.5 flex flex-col gap-3">
          {shown.map((r) => (
            <div key={r.name}>
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-body">{r.name}</span>
                {r.note && <span className="text-xs text-dim">{r.note}</span>}
                <span className="w-9 text-right text-ink tabular-nums">
                  {r.value}
                  {unit}
                </span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sel">
                <div className="h-full rounded-full bg-mute" style={{ width: `${Math.max((r.value / max) * 100, 2)}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-mute">Nothing in this range yet.</p>
      )}
    </section>
  );
}

export default async function ClientInsights({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, actorId, accessLevel, org } = gate.ctx;
  if (accessLevel === "limited") {
    return (
      <Page bar={<PageBar title="Insights" />}>
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

  const sp = await searchParams;
  const range = parseInsightRange(one(sp.range));
  const tab = TABS.find((t) => t.key === one(sp.tab))?.key ?? "overview";
  const r = await readInsights(db, { actorId, orgId: org.id, accessLevel }, INSIGHT_RANGES[range], new Date());
  const href = (next: { tab?: string; range?: string }) => {
    const p = new URLSearchParams();
    const t = next.tab ?? tab;
    const g = next.range ?? range;
    if (t !== "overview") p.set("tab", t);
    if (g !== "30") p.set("range", g);
    const q = p.toString();
    return q ? `/client/insights?${q}` : "/client/insights";
  };

  const stats: [string, string | number][] = [
    ["Applied", r.pipeline.applications],
    ["Hired", r.hire.hires],
    ["Time To Hire", days(r.hire.applicationToHire.medianDays)],
    ["Offers Accepted", r.offers.acceptanceRate === null ? "None yet" : `${Math.round(r.offers.acceptanceRate * 100)}%`],
  ];
  const posts = postRows(r.careers, r.careers.jobs);
  const eeo = r.eeoc;

  return (
    <div className="list-reader flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="@container flex min-h-0 min-w-0 flex-1 flex-col">
        <Header
          title="Insights"
          tabs={TABS.map((t) => ({ label: t.label, href: href({ tab: t.key }), on: t.key === tab }))}
          right={
            <div className="inline-flex rounded-lg bg-well p-0.5" role="group" aria-label="Range">
              {(["30", "90"] as const).map((g) => (
                <Link
                  key={g}
                  href={href({ range: g })}
                  aria-current={g === range ? "true" : undefined}
                  className={`flex h-7 items-center rounded-md px-2.5 whitespace-nowrap transition-colors ${g === range ? "bg-panel text-ink shadow-[0_0_0_1px_var(--line-strong)]" : "text-mute hover:text-ink"}`}
                >
                  {g} Days
                </Link>
              ))}
            </div>
          }
        />
        <div className="scroll-quiet flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[880px] px-6 py-6">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line-strong bg-line @2xl:grid-cols-4">
              {stats.map(([k, v]) => (
                <div key={k} className="bg-panel px-4 py-3.5">
                  <div className="text-mute">{k}</div>
                  <div className={`mt-1 ${heading} tabular-nums`}>{v}</div>
                </div>
              ))}
            </div>
            <div key={range + tab} className="anim-rise mt-3 grid grid-cols-1 gap-3 @2xl:grid-cols-2">
              {tab === "overview" ? (
                <>
                  <Bars title="Pipeline" rows={pipelineBars(r.pipeline)} />
                  <Bars title="Sources" rows={sourceBars(r.sources)} />
                  <Bars title="Time To Hire" rows={hireBars(r.hire)} unit="d" />
                  {r.load && <Bars title="Interviewer Load" rows={loadBars(r.load)} />}
                </>
              ) : tab === "posts" ? (
                <section className="overflow-hidden rounded-xl border border-line-strong @2xl:col-span-2">
                  <div className="grid h-9 grid-cols-[minmax(0,1fr)_72px_72px_72px] items-center gap-3 border-b border-line px-4 text-xs text-dim">
                    <span>Role</span>
                    <span className="text-right">Views</span>
                    <span className="text-right">Applied</span>
                    <span className="text-right">Rate</span>
                  </div>
                  {posts.map((x) => (
                    <div key={x.roleId} className="grid h-10 grid-cols-[minmax(0,1fr)_72px_72px_72px] items-center gap-3 border-b border-line px-4 tabular-nums last:border-b-0">
                      <span className="truncate text-ink">{x.title}</span>
                      <span className="text-right text-body">{x.views}</span>
                      <span className="text-right text-body">{x.applied}</span>
                      <span className="text-right text-mute">{x.views ? `${Math.round((x.applied / x.views) * 100)}%` : ""}</span>
                    </div>
                  ))}
                  {!posts.length && (
                    <div className="flex min-h-[200px] flex-col items-center justify-center px-8 py-8 text-center">
                      <span className="flex size-11 items-center justify-center rounded-xl bg-sel text-mute">
                        <FileText size={18} />
                      </span>
                      <div className="mt-4 font-medium text-ink">No live posts</div>
                      <p className="mt-1.5 max-w-[300px] text-mute">Views and applications appear here once a post goes live.</p>
                    </div>
                  )}
                </section>
              ) : (
                <>
                  <Bars title="Offers" rows={offerBars(r.offers)} />
                  <Bars title="Rejections" rows={rejectionBars(r.rejections)} />
                  {eeo && (
                    <section className="rounded-xl border border-line-strong px-4 pt-3.5 pb-4 @2xl:col-span-2">
                      <h3 className={heading}>Equal Opportunity</h3>
                      <p className="mt-2 text-body">
                        {typeof eeo.responses === "number" ? `${eeo.responses} of ${eeo.applications} applicants answered.` : `Fewer than ${eeo.minCell} of ${eeo.applications} applicants answered.`} Totals only; any group under {eeo.minCell} is hidden.
                      </p>
                    </section>
                  )}
                </>
              )}
            </div>
            {r.truncated && <p className="mt-4 text-xs text-dim">Some reports reached their limit, so a number may be a floor.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
