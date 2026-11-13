import type { clientTools } from "@tacit-ats/core";
import { describe, expect, test } from "vitest";
import { candidateCard, leadApplication, memberCard } from "./hover-card";
import type { StoredProfile } from "./interviewer-profile";

const NOW = Date.parse("2026-10-31T12:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const app = (over: Partial<clientTools.CandidateDetail["applications"][number]> = {}): clientTools.CandidateDetail["applications"][number] => ({
  applicationId: "a1",
  jobId: "j1",
  jobTitle: "Engineer",
  stage: "screening",
  source: "job_board",
  sourceDetail: null,
  nextAction: null,
  nextActionDue: null,
  lastTouchAt: day(2),
  rejectionReason: null,
  rejectionNote: null,
  offer: null,
  answers: null,
  ...over,
});

const person = (over: Partial<clientTools.CandidateDetail> = {}) =>
  ({
    candidateId: "p1",
    name: "Ann Lee",
    headline: "Engineer at Acme",
    full: true,
    email: "ann@secret.test",
    location: "Lisbon",
    linkedinUrl: null,
    summary: "A private summary",
    tags: [],
    applications: [app()],
    notes: [{ noteId: "n1", text: "A private note", author: null, createdAt: day(1), mine: false }],
    files: [],
    emails: [],
    customFields: [],
    prospect: false,
    prospectSource: null,
    prospectSourceDetail: null,
    pools: [],
    ...over,
  }) as clientTools.CandidateDetail;

const NOBODY = { team: null, owner: null, interviewer: null };

describe("a candidate's card", () => {
  test("a live job leads a closed one, then the latest touched", () => {
    const closed = app({ applicationId: "closed", stage: "rejected", lastTouchAt: day(0) });
    const old = app({ applicationId: "old", lastTouchAt: day(9) });
    const fresh = app({ applicationId: "fresh", lastTouchAt: day(1) });
    expect(leadApplication([closed, old, fresh])?.applicationId).toBe("fresh");
    expect(leadApplication([])).toBeNull();
  });

  test("says who and where they stand, with the rows the reads gave", () => {
    const card = candidateCard(person({ applications: [app({ sourceDetail: "From Sam" }), app({ applicationId: "a2", lastTouchAt: day(5) })] }), { team: "Platform", owner: "Ola", interviewer: "Ivy" }, NOW);
    expect(card).toMatchObject({ kind: "candidate", name: "Ann Lee", line: "Engineer at Acme · Lisbon", state: { stage: "Screening" }, link: { href: "/client/candidates/p1" } });
    expect(card.state?.note).toContain("touched");
    expect(card.rows).toEqual([
      { label: "Role", value: "Engineer", faint: "+1 more" },
      { label: "Source", value: "Job board", faint: "From Sam" },
      { label: "Team", value: "Platform" },
      { label: "Owner", value: "Ola" },
      { label: "Interviewer", value: "Ivy" },
    ]);
  });

  test("no row when it isn't readable, and no Testbench row ever", () => {
    expect(candidateCard(person(), NOBODY, NOW).rows.map((r) => r.label)).toEqual(["Role", "Source"]);
  });

  test("an interviewer's five-field read has no job, so no stage and no rows", () => {
    const card = candidateCard(person({ full: false, applications: [], location: null }), NOBODY, NOW);
    expect(card.state).toBeNull();
    expect(card.rows).toEqual([]);
    expect(card.line).toBe("Engineer at Acme");
  });

  test("carries no email, note or summary, whatever it was given", () => {
    const text = JSON.stringify(candidateCard(person(), NOBODY, NOW));
    expect(text).not.toContain("secret.test");
    expect(text).not.toContain("private");
  });
});

describe("a member's card", () => {
  const profile: StoredProfile = { preference: "loves", weeklyCap: 3, focusAreas: ["Go", "Systems"], channel: "slack", awayUntil: null, updatedAt: "" };
  const link = { href: "/client/interviewers", label: "See interviewers" };

  test("says what they told the team, the week against their limit", () => {
    const card = memberCard("Ivy", { title: "Engineer", teams: ["Platform"], profile: { ...profile }, thisWeek: 2 }, link, new Date(NOW));
    expect(card).toMatchObject({ kind: "member", name: "Ivy", line: "Engineer · Platform", state: null, link });
    expect(card.rows).toEqual([
      { label: "Interviews", value: "Likes it", faint: "2 of 3 this week" },
      { label: "Skills", value: "Go, Systems" },
      { label: "Reach on", value: "Slack" },
    ]);
  });

  test("away takes the load's place", () => {
    const card = memberCard("Ivy", { title: null, teams: [], profile: { ...profile, awayUntil: "2026-11-14" }, thisWeek: 2 }, link, new Date(NOW));
    expect(card.rows[0]).toEqual({ label: "Interviews", value: "Likes it", faint: "Away through Nov 14" });
  });

  test("a profile with nothing said claims nothing about it", () => {
    const card = memberCard("Ivy", { title: null, teams: [], profile: { preference: null, weeklyCap: null, focusAreas: [], channel: null, awayUntil: null, updatedAt: "" }, thisWeek: 1 }, link, new Date(NOW));
    expect(card.rows).toEqual([{ label: "Interviews", value: "1 this week" }]);
  });

  test("a profile the reader can't read is no rows at all", () => {
    expect(memberCard("Ivy", { title: null, teams: [], profile: null, thisWeek: 0 }, null, new Date(NOW))).toEqual({ kind: "member", name: "Ivy", line: null, state: null, rows: [], link: null });
  });
});
