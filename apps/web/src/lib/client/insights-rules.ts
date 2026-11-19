import type { clientTools } from "@tacit-ats/core";
import { stageLabel } from "./crm-views";
import type { CareersData } from "./analytics-metrics";

// Insights' rules (design/tacit-tickets's Insights), pure and unit-tested: the
// connector's own reports turned into the prototype's bars, a row's name, its
// number and a note. The read is lib/client/insights.ts.

export type Bar = { name: string; value: number; note?: string };

export const INSIGHT_RANGES = { "30": 30, "90": 90 } as const;
export type InsightRange = keyof typeof INSIGHT_RANGES;
export const parseInsightRange = (raw: string | undefined): InsightRange => (raw === "90" ? "90" : "30");

const pct = (x: number | null) => (x === null ? undefined : `${Math.round(x * 100)}%`);

/** How far applications got, stage by stage, with the share that went on to the next. */
export function pipelineBars(r: Pick<clientTools.PipelineReport, "stages">): Bar[] {
  return r.stages.flatMap((s, i) => {
    if (s.reached === null) return [];
    const prev = r.stages[i - 1];
    return [{ name: stageLabel(s.stage), value: s.reached, note: i > 0 ? pct(prev?.conversionToNext ?? null) : undefined }];
  });
}

const SOURCE_WORDS: Record<string, string> = { job_board: "Job board", applicant: "Applied", candidate: "Applied", referral: "Referral", sourced: "Sourced", suggested: "Suggested", agency: "Agency", event: "Event", other: "Other" };
export const sourceName = (s: string) => SOURCE_WORDS[s] ?? s.replace(/_/g, " ");

export function sourceBars(r: Pick<clientTools.SourceReport, "sources">): Bar[] {
  return r.sources.map((s) => ({ name: sourceName(s.source), value: s.applications, note: s.hired ? `${s.hired} hired` : undefined }));
}

export function hireBars(r: Pick<clientTools.TimeToHire, "jobs">): Bar[] {
  return [...r.jobs].sort((a, b) => b.days - a.days).map((j) => ({ name: j.title, value: Math.round(j.days) }));
}

export function loadBars(r: Pick<clientTools.InterviewerActivity, "interviewers">): Bar[] {
  return [...r.interviewers]
    .sort((a, b) => b.interviews - a.interviews)
    .map((m) => ({ name: m.name ?? "Someone", value: m.interviews, note: m.interviews ? `${m.feedbackFiled} filed` : undefined }));
}

export function offerBars(r: Pick<clientTools.OfferReport, "byStatus">): Bar[] {
  const s = r.byStatus;
  return [
    { name: "Drafted", value: s.draft },
    { name: "Extended", value: s.extended },
    { name: "Accepted", value: s.accepted },
    { name: "Declined", value: s.declined },
    { name: "Withdrawn", value: s.withdrawn },
  ];
}

export function rejectionBars(r: Pick<clientTools.RejectionReport, "reasons">): Bar[] {
  return [...r.reasons].sort((a, b) => b.applications - a.applications).map((x) => ({ name: x.reason ?? (x.kind === "withdrew" ? "Withdrew, no reason" : "No reason given"), value: x.applications }));
}

export type PostRow = { roleId: string; title: string; views: number; applied: number };

/** Each job's views and applications through its public post in the range, most applied first; jobs with neither are left out. */
export function postRows(data: Pick<CareersData, "apps" | "views">, titles: Record<string, string>): PostRow[] {
  const by = new Map<string, PostRow>();
  const row = (roleId: string) => by.get(roleId) ?? { roleId, title: titles[roleId] ?? "Untitled", views: 0, applied: 0 };
  for (const v of data.views) by.set(v.roleId, { ...row(v.roleId), views: row(v.roleId).views + v.views });
  for (const a of data.apps) if (a.group === "careers" && a.channel) by.set(a.roleId, { ...row(a.roleId), applied: row(a.roleId).applied + 1 });
  return [...by.values()].sort((a, b) => b.applied - a.applied || b.views - a.views);
}

/** "12d", or nothing to say. */
export const days = (d: number | null) => (d === null ? "None yet" : `${Math.round(d)}d`);
