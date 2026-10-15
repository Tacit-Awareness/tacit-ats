import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import {
  dayStats, interviewerActivity, offerReport, parseSince, pipelineReport, rejectionReport, scan, sourceReport, timeToHire,
} from "./reports.js";

/**
 * The reports' arithmetic over rows as the member's token returns them. What
 * a member can read at all is the policies' (pinned in the SQL suite and
 * apps/mcp's client.integration.test.ts); these pin what is counted, how, and
 * that an interviewer is refused before any query.
 */

const ctx = (accessLevel: ClientToolCtx["accessLevel"] = "admin"): ClientToolCtx => ({
  actorId: "actor-1", orgId: "org-1", accessLevel, source: "claude",
});

async function refusal(promise: Promise<unknown>): Promise<ClientToolError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ClientToolError);
  return err as ClientToolError;
}

const t = (day: number, hour = 0) => new Date(Date.UTC(2026, 8, day, hour)).toISOString();

describe("shared", () => {
  test("since is a past date, or nothing", () => {
    expect(parseSince(undefined)).toBeNull();
    expect(parseSince("2026-09-01")).toBe("2026-09-01T00:00:00.000Z");
    expect(() => parseSince("last month")).toThrow(/YYYY-MM-DD/);
    expect(() => parseSince("2999-01-01")).toThrow(/future/);
  });

  test("a scan pages 1,000 at a time and says when it hit the cap", async () => {
    const pages: Array<[number, number]> = [];
    const full = (n: number) => Array.from({ length: n }, (_, i) => i);
    const out = await scan<number>(async (from, to) => {
      pages.push([from, to]);
      return { data: full(to - from + 1), error: null };
    }, 2500);
    expect(pages).toEqual([[0, 999], [1000, 1999], [2000, 2499]]);
    expect(out).toMatchObject({ truncated: true });
    expect(out.rows).toHaveLength(2500);

    const short = await scan<number>(async () => ({ data: full(3), error: null }));
    expect(short).toEqual({ rows: [0, 1, 2], truncated: false });
  });

  test("median and average days", () => {
    expect(dayStats([])).toEqual({ count: 0, medianDays: null, avgDays: null });
    expect(dayStats([1, 10, 4])).toEqual({ count: 3, medianDays: 4, avgDays: 5 });
    expect(dayStats([1, 2, 3, 4])).toEqual({ count: 4, medianDays: 2.5, avgDays: 2.5 });
  });
});

describe("refusals", () => {
  test("an interviewer gets no report, and nothing is read", async () => {
    for (const report of [pipelineReport, sourceReport, timeToHire, rejectionReport, offerReport, interviewerActivity]) {
      const fake = new FakeSupabase();
      expect((await refusal(report(fake.asDb(), ctx("limited")))).code).toBe("forbidden");
      expect(fake.calls).toEqual([]);
    }
  });

  test("a job the member cannot see is not found", async () => {
    const fake = new FakeSupabase([{ data: null }]);
    expect((await refusal(pipelineReport(fake.asDb(), ctx(), { jobId: "job-x" }))).code).toBe("not_found");
  });

  test("a hiring-team member who manages no job gets no interviewer activity", async () => {
    const fake = new FakeSupabase([{ data: [{ id: "job-1" }] }, { data: false }]);
    expect((await refusal(interviewerActivity(fake.asDb(), ctx("elevated")))).message).toMatch(/manage a job/);
  });
});

describe("pipelineReport", () => {
  test("counts now, how far each got, conversion and days in stage", async () => {
    const apps = [
      { id: "a", stage: "interviewing", source: "referral", created_at: t(1) },
      { id: "b", stage: "rejected", source: "sourced", created_at: t(1) },
      { id: "c", stage: "screening", source: "sourced", created_at: t(1) },
    ];
    const ev = (application_id: string, kind: string, from_stage: string | null, to_stage: string, at: string) =>
      ({ application_id, kind, from_stage, to_stage, created_at: at, applications: {} });
    const events = [
      ev("a", "added", null, "sourced", t(1)),
      ev("a", "stage_changed", "sourced", "screening", t(3)),
      ev("a", "stage_changed", "screening", "interviewing", t(7)),
      ev("b", "added", null, "sourced", t(1)),
      ev("b", "stage_changed", "sourced", "screening", t(2)),
      ev("b", "stage_changed", "screening", "rejected", t(4)),
      // c was added straight to screening.
      ev("c", "added", null, "screening", t(1)),
    ];
    const fake = new FakeSupabase([{ data: apps }, { data: events }]);
    const r = await pipelineReport(fake.asDb(), ctx(), { since: "2026-09-01" });
    const row = (s: string) => r.stages.find((x) => x.stage === s)!;
    expect(r.applications).toBe(3);
    expect(row("screening")).toEqual({ stage: "screening", now: 1, reached: 3, conversionToNext: 0.33, avgDaysInStage: 3, stays: 2 });
    expect(row("sourced")).toMatchObject({ now: 0, reached: 3, conversionToNext: 1, avgDaysInStage: 1.5, stays: 2 });
    expect(row("interviewing")).toMatchObject({ now: 1, reached: 1, conversionToNext: 0, stays: 0, avgDaysInStage: null });
    expect(row("rejected")).toMatchObject({ now: 1, reached: null, conversionToNext: null });
    expect(row("hired")).toMatchObject({ reached: 0, conversionToNext: null });
    // since narrows both reads by when the application was added.
    expect(fake.calls[0].filters).toContainEqual({ method: "gte", column: "created_at", value: "2026-09-01T00:00:00.000Z" });
    expect(fake.calls[1].filters).toContainEqual({ method: "gte", column: "applications.created_at", value: "2026-09-01T00:00:00.000Z" });
  });
});

describe("sourceReport", () => {
  test("per source, largest first, with the hire rate", async () => {
    const app = (source: string, stage: string) => ({ id: `${source}-${stage}-${Math.random()}`, source, stage, created_at: t(1) });
    const fake = new FakeSupabase([{
      data: [app("referral", "hired"), app("referral", "screening"), app("agency", "rejected"), app("referral", "withdrawn"), app("agency", "hired")],
    }]);
    const r = await sourceReport(fake.asDb(), ctx("elevated"));
    expect(r).toMatchObject({ applications: 5, hired: 2 });
    expect(r.sources).toEqual([
      { source: "referral", applications: 3, active: 1, hired: 1, rejected: 0, withdrawn: 1, hireRate: 0.33 },
      { source: "agency", applications: 2, active: 0, hired: 1, rejected: 1, withdrawn: 0, hireRate: 0.5 },
    ]);
  });
});

describe("timeToHire", () => {
  test("added to hired per hire, and job open to first hire, the last move to hired counting", async () => {
    const hire = (application_id: string, at: string, role_id: string, created: string) =>
      ({ application_id, created_at: at, applications: { role_id, created_at: created, stage: "hired" } });
    const fake = new FakeSupabase([
      { data: [hire("a", t(11), "job-1", t(1)), hire("b", t(5), "job-1", t(2)), hire("b", t(6), "job-1", t(2)), hire("c", t(21), "job-2", t(1))] },
      { data: [{ id: "job-1", title: "Engineer", created_at: t(1) }, { id: "job-2", title: "Designer", created_at: t(11) }] },
    ]);
    const r = await timeToHire(fake.asDb(), ctx());
    expect(r.hires).toBe(3);
    expect(r.applicationToHire).toEqual({ count: 3, medianDays: 10, avgDays: 11.3 });
    expect(r.jobs.map((j) => [j.title, j.days])).toEqual([["Engineer", 5], ["Designer", 10]]);
    expect(r.jobOpenToFirstHire).toEqual({ count: 2, medianDays: 7.5, avgDays: 7.5 });
  });

  test("since counts hires in range, and a job whose first hire came before it is left out", async () => {
    const hire = (application_id: string, at: string) =>
      ({ application_id, created_at: at, applications: { role_id: "job-1", created_at: t(1), stage: "hired" } });
    const fake = new FakeSupabase([{ data: [hire("a", "2026-08-20T00:00:00Z"), hire("b", t(11))] }]);
    const r = await timeToHire(fake.asDb(), ctx(), { since: "2026-09-01" });
    expect(r.hires).toBe(1);
    expect(r.jobs).toEqual([]);
    expect(fake.calls).toHaveLength(1);
  });
});

describe("rejectionReport", () => {
  test("closed applications per reason, by the move that closed them as they stand", async () => {
    const close = (application_id: string, to_stage: string, at: string, stage: string, reason: string | null) =>
      ({ application_id, to_stage, created_at: at, applications: { stage, rejection_reason_id: reason } });
    const fake = new FakeSupabase([
      {
        data: [
          close("a", "rejected", t(2), "rejected", "r-skills"),
          close("b", "rejected", t(2), "rejected", "r-skills"),
          close("c", "rejected", t(2), "rejected", null),
          // d was rejected, then moved to withdrawn: it counts once, as withdrawn.
          close("d", "rejected", t(2), "withdrawn", "r-timing"),
          close("d", "withdrawn", t(3), "withdrawn", "r-timing"),
        ],
      },
      { data: [{ id: "r-skills", kind: "rejected", name: "Skills or experience" }, { id: "r-timing", kind: "withdrew", name: "Timing" }] },
    ]);
    const r = await rejectionReport(fake.asDb(), ctx());
    expect(r).toMatchObject({ rejected: 3, withdrawn: 1 });
    expect(r.reasons).toEqual([
      { kind: "rejected", reason: "Skills or experience", applications: 2 },
      { kind: "rejected", reason: null, applications: 1 },
      { kind: "withdrew", reason: "Timing", applications: 1 },
    ]);
  });
});

describe("interviewerActivity", () => {
  const interview = (id: string, ends: string, who: string[]) => ({ id, ends_at: ends, interviewer_actor_ids: who, applications: { role_id: "job-1" } });

  test("an admin: filed on time, late, or not filed, per interviewer", async () => {
    const fake = new FakeSupabase([
      { data: [interview("i1", t(1, 10), ["u1", "u2"]), interview("i2", t(2, 10), ["u1"])] },
      { data: [
        { interview_id: "i1", interviewer_actor_id: "u1", submitted_at: t(1, 12) },
        { interview_id: "i2", interviewer_actor_id: "u1", submitted_at: t(4, 10) },
      ] },
      { data: [{ id: "u1", display_name: "Ivan" }, { id: "u2", display_name: "Una" }] },
    ]);
    const r = await interviewerActivity(fake.asDb(), ctx());
    expect(r.interviewers).toEqual([
      { userId: "u1", name: "Ivan", interviews: 2, feedbackFiled: 2, onTime: 1, late: 1, notFiled: 0, notVisible: 0, medianHoursToFeedback: 25 },
      { userId: "u2", name: "Una", interviews: 1, feedbackFiled: 0, onTime: 0, late: 0, notFiled: 1, notVisible: 0, medianHoursToFeedback: null },
    ]);
    expect(fake.calls.filter((c) => c.op === "rpc")).toEqual([]);
  });

  test("a hiring manager: only the jobs they manage, and a filing they may not see is not visible, not missing", async () => {
    const fake = new FakeSupabase([
      { data: [{ id: "job-1" }, { id: "job-2" }] },
      { data: true },
      { data: false },
      { data: [interview("i1", t(1, 10), ["me", "u2"]), { ...interview("i2", t(1, 10), ["u3"]), applications: { role_id: "job-2" } }] },
      { data: [] },
      { data: true },
      { data: false },
      { data: [{ id: "me", display_name: "Hana" }, { id: "u2", display_name: "Una" }] },
    ]);
    const r = await interviewerActivity(fake.asDb(), ctx("elevated"));
    expect(r.interviewers.map((i) => [i.name, i.notFiled, i.notVisible])).toEqual([["Hana", 1, 0], ["Una", 0, 1]]);
    expect(fake.calls.filter((c) => c.op === "rpc").map((c) => c.table)).toEqual([
      "can_on_role", "can_on_role", "can_see_feedback", "can_see_feedback",
    ]);
  });
});

describe("offerReport", () => {
  test("by status, the acceptance rate and days to an answer", async () => {
    const fake = new FakeSupabase([{
      data: [
        { status: "accepted", extended_at: t(1), resolved_at: t(3) },
        { status: "declined", extended_at: t(1), resolved_at: t(5) },
        { status: "accepted", extended_at: t(2), resolved_at: t(3) },
        { status: "draft", extended_at: null, resolved_at: null },
      ],
    }]);
    const r = await offerReport(fake.asDb(), ctx("elevated"));
    expect(r).toMatchObject({
      offers: 4,
      byStatus: { draft: 1, extended: 0, accepted: 2, declined: 1, withdrawn: 0 },
      acceptanceRate: 0.67,
      daysToAnswer: { count: 3, medianDays: 2, avgDays: 2.3 },
    });
  });
});
