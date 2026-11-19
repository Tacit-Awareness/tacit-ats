import { expect, test } from "vitest";
import { sidebarCounts } from "./sidebar-counts-rules";

test("Triage is applicants to route, offers to sign off and the team's calls", () => {
  const c = sidebarCounts({
    live: [
      { roleId: "j1", tone: "needs", column: "decide" },
      { roleId: "j1", tone: "running", column: "screening" },
      { roleId: "j2", tone: "failed", column: "booked" },
    ],
    applicants: [{ jobId: "j1" }, { jobId: "j2" }],
    approvals: 3,
    teams: [],
  });
  expect(c.triage).toBe(2 + 3 + 1);
});

test("a team counts what needs a look in its jobs, and is stuck when one is overdue", () => {
  const c = sidebarCounts({
    live: [
      { roleId: "j1", tone: "needs", column: "decide" },
      { roleId: "j1", tone: "waiting", column: "screening" },
      { roleId: "j2", tone: "failed", column: "booked" },
      { roleId: "j3", tone: "running", column: "new" },
    ],
    applicants: [{ jobId: "j3" }],
    approvals: 0,
    teams: [
      { id: "eng", jobIds: new Set(["j1", "j2"]) },
      { id: "infra", jobIds: new Set(["j1"]) },
      { id: "sales", jobIds: new Set(["j3"]) },
    ],
  });
  expect(c.teams.eng).toEqual({ attn: 2, stuck: true, triage: 0 });
  expect(c.teams.infra).toEqual({ attn: 1, stuck: false, triage: 0 });
  expect(c.teams.sales).toEqual({ attn: 0, stuck: false, triage: 1 });
});
