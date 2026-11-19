import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import type { AccessLevel } from "./session";
import { readApplicantQueue } from "./applicants";
import { departmentOptions, jobsInDepartment } from "./department-tree";
import { readDepartments } from "./departments";
import { liveTone } from "./home-tickets-rules";
import { readPipeline } from "./pipeline";
import { sidebarCounts, type SidebarCounts } from "./sidebar-counts-rules";

// The sidebar's counts, on the member's OWN client (never a privileged one), so
// they count only what their token can read: the Pipeline's read
// (lib/client/pipeline.ts), New Applicants' queue (lib/client/applicants.ts), the
// offers waiting on their sign-off (core's listMyApprovals) and the departments.
// Asked for by the sidebar after the page has drawn (GET /client/sidebar), so no
// page waits on it. An interviewer gets none: the reads refuse them.

export async function readSidebarCounts(db: Db, member: { actorId: string; orgId: string; accessLevel: AccessLevel }, now: Date): Promise<SidebarCounts> {
  if (member.accessLevel === "limited") return { triage: 0, teams: {} };
  const ctx: clientTools.ClientToolCtx = { ...member, source: "claude" };
  // A tool that refuses this member (forbidden) counts nothing, as its page shows them nothing.
  const none = (err: unknown): never[] => {
    if (err instanceof clientTools.ClientToolError && err.code === "forbidden") return [];
    throw err;
  };
  const [pipeline, applicants, approvals, structure] = await Promise.all([
    readPipeline(db, now),
    readApplicantQueue(db, member).catch(none),
    clientTools.listMyApprovals(db, ctx).catch(none),
    readDepartments(db),
  ]);
  const waiting = new Set(approvals.flatMap((a) => (a.kind === "offer" && a.applicationId ? [a.applicationId] : [])));
  return sidebarCounts({
    live: pipeline.entries.map((e) => ({ roleId: e.roleId, column: e.column, tone: liveTone({ column: e.column, stalled: e.stalled, waitingOnMe: waiting.has(e.applicationId) }) })),
    applicants: applicants.map((a) => ({ jobId: a.jobId })),
    approvals: approvals.filter((a) => a.kind === "offer").length,
    teams: departmentOptions(structure.departments).map((d) => ({ id: d.id, jobIds: jobsInDepartment(structure, d.id) })),
  });
}
