import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { cleanPlan, getInterviewPlan, planStep, setInterviewPlan, stepsOf } from "./plans.js";

/**
 * What the interview-plan tools add on top of the policies (pinned against
 * real Postgres in apps/mcp's client.integration.test.ts): the plan checked
 * before anything is read, a sentence before a refused write, the audit claim
 * around an allowed one, and each step's progress for one candidate as far as
 * the caller can see it.
 */

const ctx = (accessLevel: ClientToolCtx["accessLevel"] = "admin"): ClientToolCtx => ({
  actorId: "actor-1", orgId: "org-1", accessLevel, source: "claude",
});
const rpcs = (fake: FakeSupabase) => fake.calls.filter((c) => c.op === "rpc").map((c) => c.table);

async function refusal(promise: Promise<unknown>): Promise<ClientToolError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ClientToolError);
  return err as ClientToolError;
}

const JOB = { id: "role-1", title: "Engineer", interview_steps: ["Recruiter screen", "Technical", "Onsite"] };
const interview = (id: string, step: string | null, status: string, interviewers: string[]) => ({
  id, application_id: "app-1", starts_at: `2026-10-2${id.at(-1)}T15:00:00Z`, ends_at: `2026-10-2${id.at(-1)}T16:00:00Z`,
  status, step, interviewer_actor_ids: interviewers,
});

describe("the plan itself", () => {
  test("names are trimmed, and a blank, overlong, multi-line or repeated one is refused", () => {
    expect(cleanPlan(["  Screen ", "Onsite"])).toEqual(["Screen", "Onsite"]);
    expect(() => cleanPlan(["Screen", " "])).toThrow(/needs a name/);
    expect(() => cleanPlan(["x".repeat(121)])).toThrow(/at most 120/);
    expect(() => cleanPlan(["Screen\nOnsite"])).toThrow(/one line/);
    expect(() => cleanPlan(["Onsite", "onsite"])).toThrow(/twice/);
    expect(() => cleanPlan(Array.from({ length: 16 }, (_, n) => `Step ${n}`))).toThrow(/at most 15/);
    expect(cleanPlan([])).toEqual([]);
  });

  test("a step is spelled as the plan spells it; without a plan anything goes", () => {
    expect(planStep(JOB.interview_steps, "onsite")).toBe("Onsite");
    expect(planStep([], "Coffee chat")).toBe("Coffee chat");
    expect(() => planStep(JOB.interview_steps, "Take-home")).toThrow(/The steps are: Recruiter screen, Technical, Onsite/);
  });

  test("only the strings of the stored list count, as on the staff side", () => {
    expect(stepsOf(["Screen", 3, null, "Onsite"])).toEqual(["Screen", "Onsite"]);
    expect(stepsOf({ not: "a list" })).toEqual([]);
  });
});

describe("getInterviewPlan", () => {
  test("a job the caller cannot see is not found", async () => {
    const fake = new FakeSupabase([{ data: null }]);
    expect((await refusal(getInterviewPlan(fake.asDb(), ctx(), { jobId: "role-x" }))).code).toBe("not_found");
  });

  test("the steps in order, and nothing more without an application", async () => {
    const fake = new FakeSupabase([{ data: JOB }]);
    expect(await getInterviewPlan(fake.asDb(), ctx(), { jobId: "role-1" }))
      .toEqual({ jobId: "role-1", title: "Engineer", steps: JOB.interview_steps, candidate: null });
  });

  test("a candidate's progress per step, with who has filed and whose feedback is hidden", async () => {
    const fake = new FakeSupabase([
      { data: JOB },
      { data: { id: "app-1", role_id: "role-1" } },
      {
        data: [
          interview("int-1", "Recruiter screen", "done", ["actor-1", "actor-2"]),
          interview("int-2", "technical", "scheduled", ["actor-3", "gone"]),
          interview("int-3", "Take-home", "cancelled", ["actor-2"]),
        ],
      },
      // Who filed, never what.
      { data: [{ interview_id: "int-1", interviewer_actor_id: "actor-1" }] },
      { data: [{ id: "actor-1", display_name: "Ada" }, { id: "actor-2", display_name: "Ivan" }, { id: "actor-3", display_name: "Sam" }] },
      // can_see_feedback for int-1/actor-2, then int-2/actor-3.
      { data: false },
      { data: true },
    ]);
    const plan = await getInterviewPlan(fake.asDb(), ctx("elevated"), { jobId: "role-1", applicationId: "app-1" });
    expect(fake.calls.find((c) => c.table === "interview_feedback")?.args).toBe("interview_id, interviewer_actor_id");
    const p = plan.candidate!;
    expect(p.seesAllInterviews).toBe(true);
    expect(p.steps.map((s) => [s.position, s.step, s.state])).toEqual([
      [1, "Recruiter screen", "done"], [2, "Technical", "scheduled"], [3, "Onsite", "not_scheduled"],
    ]);
    expect(p.steps[0].interviews[0].interviewers).toEqual([
      { userId: "actor-1", name: "Ada", feedback: "filed" },
      { userId: "actor-2", name: "Ivan", feedback: "hidden" },
    ]);
    // Someone no longer at the company drops out.
    expect(p.steps[1].interviews[0].interviewers).toEqual([{ userId: "actor-3", name: "Sam", feedback: "not_filed" }]);
    // A step the plan no longer has keeps its name, off-plan; a cancelled one expects no feedback.
    expect(p.offPlan.map((i) => [i.step, i.interviewers[0].feedback])).toEqual([["Take-home", null]]);
    expect(p.nextStep).toBe("Onsite");
    expect(rpcs(fake)).toEqual(["can_see_feedback", "can_see_feedback"]);
  });

  test("an interviewer sees only their own interview, and the other steps read as not visible", async () => {
    const fake = new FakeSupabase([
      { data: JOB },
      { data: null },
      { data: [interview("int-2", "Technical", "scheduled", ["actor-1"])] },
      { data: "role-1" },
      { data: [] },
      { data: [{ id: "actor-1", display_name: "Ivan" }] },
      { data: true },
    ]);
    const p = (await getInterviewPlan(fake.asDb(), ctx("limited"), { jobId: "role-1", applicationId: "app-1" })).candidate!;
    expect(p.seesAllInterviews).toBe(false);
    expect(p.steps.map((s) => s.state)).toEqual(["not_visible", "scheduled", "not_visible"]);
    expect(p.nextStep).toBeNull();
    expect(rpcs(fake)).toEqual(["application_role", "can_see_feedback"]);
  });

  test("an application the caller cannot see at all is not found; one on another job is refused", async () => {
    const hidden = new FakeSupabase([{ data: JOB }, { data: null }, { data: [] }]);
    expect((await refusal(getInterviewPlan(hidden.asDb(), ctx("limited"), { jobId: "role-1", applicationId: "app-x" }))).code).toBe("not_found");
    const elsewhere = new FakeSupabase([{ data: JOB }, { data: { id: "app-1", role_id: "role-2" } }, { data: [] }]);
    expect((await refusal(getInterviewPlan(elsewhere.asDb(), ctx(), { jobId: "role-1", applicationId: "app-1" }))).message).toMatch(/another job/);
  });
});

describe("setInterviewPlan", () => {
  test("a bad plan is refused before any read", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(setInterviewPlan(fake.asDb(), ctx(), { jobId: "role-1", steps: ["Screen", "SCREEN"] }))).code).toBe("invalid");
    expect(fake.calls).toEqual([]);
  });

  test("someone who cannot manage the job is told so, and nothing is claimed", async () => {
    const fake = new FakeSupabase([{ data: JOB }, { data: false }]);
    expect((await refusal(setInterviewPlan(fake.asDb(), ctx("elevated"), { jobId: "role-1", steps: ["Screen"] }))).code).toBe("forbidden");
    expect(rpcs(fake)).toEqual(["can_on_role"]);
  });

  test("the same plan changes nothing and leaves no audit row", async () => {
    const fake = new FakeSupabase([{ data: JOB }, { data: true }]);
    expect(await setInterviewPlan(fake.asDb(), ctx(), { jobId: "role-1", steps: [" Recruiter screen", "Technical", "Onsite"] }))
      .toEqual({ outcome: "unchanged", steps: JOB.interview_steps, removed: [], keptOnInterviews: [] });
    expect(rpcs(fake)).not.toContain("client_claim_write");
  });

  test("a new plan replaces the old whole; interviews on a removed step keep it, and the result says so", async () => {
    const fake = new FakeSupabase([
      { data: JOB }, { data: true },
      { data: [{ step: "Technical", status: "done" }, { step: "technical", status: "scheduled" }, { step: "Onsite", status: "cancelled" }] },
      { data: "audit-1" }, { data: [{ id: "role-1" }] }, { data: null },
    ]);
    const out = await setInterviewPlan(fake.asDb(), ctx(), { jobId: "role-1", steps: ["recruiter screen", "Take-home", "Onsite"] });
    expect(out).toEqual({
      outcome: "updated",
      steps: ["recruiter screen", "Take-home", "Onsite"],
      removed: ["Technical"],
      keptOnInterviews: [{ step: "Technical", interviews: 2, scheduled: 1 }],
    });
    const update = fake.calls.find((c) => c.op === "update")!;
    expect(update.table).toBe("roles");
    expect(update.args).toMatchObject({ interview_steps: ["recruiter screen", "Take-home", "Onsite"] });
    // No interview is written.
    expect(fake.calls.filter((c) => c.table === "interviews").map((c) => c.op)).toEqual(["select"]);
    expect(fake.calls.at(-1)?.args).toMatchObject({
      p_before: { interview_steps: JOB.interview_steps }, p_after: { interview_steps: ["recruiter screen", "Take-home", "Onsite"] }, p_keep: true,
    });
  });

  test("clearing the plan is allowed", async () => {
    const fake = new FakeSupabase([{ data: JOB }, { data: true }, { data: [] }, { data: "audit-1" }, { data: [{ id: "role-1" }] }, { data: null }]);
    expect(await setInterviewPlan(fake.asDb(), ctx(), { jobId: "role-1", steps: [] }))
      .toMatchObject({ outcome: "updated", steps: [], removed: JOB.interview_steps, keptOnInterviews: [] });
  });
});
