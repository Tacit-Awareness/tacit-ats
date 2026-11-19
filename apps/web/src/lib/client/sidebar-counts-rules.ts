import type { Tone } from "@/components/tickets/tone";

// The sidebar's counts (design/tacit-tickets's Sidebar: Triage's number, and each
// team's), pure and unit-tested. lib/client/sidebar-counts.ts reads; this adds up.
//
// Triage counts what waits on the member: new applicants to route, offers
// waiting on their sign-off, and live candidates whose next move is the team's
// call. A team (a department, with the departments inside it) counts its live
// candidates that need a look, amber or red, and is marked when any is overdue,
// as the prototype marks a team with a failed ticket.

export type TeamStat = { attn: number; stuck: boolean; triage: number };
export type SidebarCounts = { triage: number; teams: Record<string, TeamStat> };

export function sidebarCounts(input: {
  live: { roleId: string; tone: Tone; column: string }[];
  applicants: { jobId: string }[];
  approvals: number;
  /** Each live department, with every job in it or in a department inside it. */
  teams: { id: string; jobIds: Set<string> }[];
}): SidebarCounts {
  const decide = input.live.filter((l) => l.column === "decide").length;
  const teams: Record<string, TeamStat> = {};
  for (const t of input.teams) {
    const live = input.live.filter((l) => t.jobIds.has(l.roleId));
    teams[t.id] = {
      attn: live.filter((l) => l.tone === "needs" || l.tone === "failed").length,
      stuck: live.some((l) => l.tone === "failed"),
      triage: input.applicants.filter((a) => t.jobIds.has(a.jobId)).length,
    };
  }
  return { triage: input.applicants.length + input.approvals + decide, teams };
}
