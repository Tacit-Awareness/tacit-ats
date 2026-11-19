import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import type { AccessLevel } from "./session";
import { readCareers } from "./analytics";

// Insights' read (design/tacit-tickets's Insights), on the member's OWN client
// (never a privileged one): the client connector's own reports, the ones
// Claude reads, so the page and the connector say the same numbers, each
// counting only what the member's token can read (core's pipelineReport,
// sourceReport, timeToHire, interviewerActivity, offerReport, rejectionReport
// and, for admins, eeocReport), and the careers page's views and applications
// (lib/client/analytics.ts's readCareers) for Job Posts. A report a member may
// not have (interviewerActivity for someone who manages no job, eeocReport for
// anyone but an admin) is null, and its card is left out.

const DAY = 86_400_000;

export type InsightsRead = {
  pipeline: clientTools.PipelineReport;
  sources: clientTools.SourceReport;
  hire: clientTools.TimeToHire;
  load: clientTools.InterviewerActivity | null;
  offers: clientTools.OfferReport;
  rejections: clientTools.RejectionReport;
  eeoc: clientTools.EeocReport | null;
  careers: Awaited<ReturnType<typeof readCareers>>;
  truncated: boolean;
};

const forbiddenAsNull = (err: unknown) => {
  if (err instanceof clientTools.ClientToolError && err.code === "forbidden") return null;
  throw err;
};

export async function readInsights(db: Db, member: { actorId: string; orgId: string; accessLevel: AccessLevel }, days: number, now: Date): Promise<InsightsRead> {
  // Reports write no audit row, so the source is never read.
  const ctx: clientTools.ClientToolCtx = { ...member, source: "claude" };
  const since = new Date(now.getTime() - days * DAY).toISOString().slice(0, 10);
  const [pipeline, sources, hire, load, offers, rejections, eeoc, careers] = await Promise.all([
    clientTools.pipelineReport(db, ctx, { since }),
    clientTools.sourceReport(db, ctx, { since }),
    clientTools.timeToHire(db, ctx, { since }),
    clientTools.interviewerActivity(db, ctx, { since }).catch(forbiddenAsNull),
    clientTools.offerReport(db, ctx, { since }),
    clientTools.rejectionReport(db, ctx, { since }),
    member.accessLevel === "admin" ? clientTools.eeocReport(db, ctx, { since }).catch(forbiddenAsNull) : null,
    readCareers(db, { range: days > 30 ? "quarter" : "month", departmentId: null }, now),
  ]);
  return {
    pipeline,
    sources,
    hire,
    load,
    offers,
    rejections,
    eeoc,
    careers,
    truncated: [pipeline, sources, hire, load, offers, rejections, eeoc].some((r) => r?.truncated) || careers.truncated,
  };
}
