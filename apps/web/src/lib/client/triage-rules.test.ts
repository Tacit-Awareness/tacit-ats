import { expect, test } from "vitest";
import type { QueueEntry } from "./applicant-queue";
import { inTeam, issueName, issueStatus, originOf, triageGroups, undot } from "./triage-rules";

const entry = (id: string, source: string, appliedAt: string) => ({ applicationId: id, source, appliedAt }) as QueueEntry;

test("originOf: a referral, someone added by hand, else an application", () => {
  expect(originOf({ source: "referral" })).toBe("referred");
  expect(originOf({ source: "sourced" })).toBe("sourced");
  expect(originOf({ source: "job_board" })).toBe("applied");
  expect(originOf({ source: "applicant" })).toBe("applied");
});

test("the queue's groups are Referred, Applied, Sourced, each newest first, empty ones left out", () => {
  const groups = triageGroups([
    entry("a", "job_board", "2026-11-01T00:00:00Z"),
    entry("b", "referral", "2026-11-02T00:00:00Z"),
    entry("c", "job_board", "2026-11-03T00:00:00Z"),
  ]);
  expect(groups.map((g) => [g.label, g.entries.map((e) => e.applicationId)])).toEqual([
    ["Referred", ["b"]],
    ["Applied", ["c", "a"]],
  ]);
});

test("a Needs You row is red when late, amber otherwise, and named by its candidate or job", () => {
  expect(issueStatus({ kind: "late" })).toBe("failed");
  expect(issueStatus({ kind: "decide" })).toBe("needs");
  expect(issueName({ candidate: { id: "p", name: "Ada" }, job: { id: "j", title: "Engineer" }, what: "x" })).toBe("Ada");
  expect(issueName({ candidate: null, job: { id: "j", title: "Engineer" }, what: "x" })).toBe("Engineer");
});

test("undot turns a dot between facts into a comma", () => {
  expect(undot("Job board · Careers")).toBe("Job board, Careers");
  expect(undot("Referred by Sam")).toBe("Referred by Sam");
});

test("under a team, only its jobs; with none, everything", () => {
  const jobs = new Set(["j1"]);
  expect(inTeam(jobs, "j1")).toBe(true);
  expect(inTeam(jobs, "j2")).toBe(false);
  expect(inTeam(jobs, null)).toBe(false);
  expect(inTeam(null, null)).toBe(true);
});
