import type { QueueEntry } from "./applicant-queue";
import type { Issue } from "./inbox-issues";

// Triage's rules (design/tacit-tickets's Triage), pure and unit-tested: the
// queue's three groups, a Needs You row's status, and what a team narrows to.
// The page is app/client/triage/page.tsx.

/** How someone came in, the queue's groups in the prototype's order. */
export const ORIGINS = [
  { key: "referred", label: "Referred" },
  { key: "applied", label: "Applied" },
  { key: "sourced", label: "Sourced" },
] as const;
export type Origin = (typeof ORIGINS)[number]["key"];

/** A referral, someone added by hand (source `sourced`), or an application. */
export function originOf(e: Pick<QueueEntry, "source">): Origin {
  return e.source === "referral" ? "referred" : e.source === "sourced" ? "sourced" : "applied";
}

/** The queue in groups, each newest first, empty ones left out. */
export function triageGroups(queue: QueueEntry[]): { key: Origin; label: string; entries: QueueEntry[] }[] {
  return ORIGINS.map((o) => ({
    ...o,
    entries: queue.filter((e) => originOf(e) === o.key).sort((a, b) => Date.parse(b.appliedAt) - Date.parse(a.appliedAt)),
  })).filter((g) => g.entries.length > 0);
}

/** A Needs You row's mark: red for what is late, amber for everything else waiting on you. */
export const issueStatus = (i: Pick<Issue, "kind">): "failed" | "needs" => (i.kind === "late" ? "failed" : "needs");

/** A Needs You row's name: the candidate, else the job an approval is for. */
export const issueName = (i: Pick<Issue, "candidate" | "job" | "what">): string => i.candidate?.name ?? i.job.title ?? i.what;

/** Words stored with a dot between facts ("Job board · Careers"), as a comma: DESIGN.md has no dot separators. */
export const undot = (s: string) => s.replace(/\s+·\s+/g, ", ");

/** Under a team, only what is in its jobs: a Needs You item with no job stays only when no team is picked. */
export const inTeam = (jobIds: Set<string> | null, jobId: string | null) => !jobIds || (!!jobId && jobIds.has(jobId));
