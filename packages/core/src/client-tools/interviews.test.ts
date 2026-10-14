import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { getFeedback, listMyInterviews, scheduleInterview, submitFeedback, updateInterview } from "./interviews.js";

const ctx = (accessLevel: ClientToolCtx["accessLevel"] = "admin"): ClientToolCtx => ({
  actorId: "actor-1", orgId: "org-1", accessLevel, source: "claude",
});

async function refusal(promise: Promise<unknown>): Promise<ClientToolError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ClientToolError);
  return err as ClientToolError;
}

const NOW = new Date("2026-10-20T12:00:00Z");
const row = (id: string, startsAt: string) => ({
  interview_id: id, application_id: "app-1", person_id: "p-1", candidate_name: "Pat", job_id: "role-1", job_title: "Engineer",
  starts_at: startsAt, ends_at: new Date(Date.parse(startsAt) + 3_600_000).toISOString(), status: "scheduled", step: null,
  location_or_link: null, feedback_filed: false,
});

describe("listMyInterviews", () => {
  test("upcoming soonest first, past most recent first", async () => {
    const data = [row("past-old", "2026-10-01T10:00:00Z"), row("next", "2026-10-22T10:00:00Z"), row("soon", "2026-10-21T10:00:00Z"), row("past-new", "2026-10-19T10:00:00Z")];
    const upcoming = await listMyInterviews(new FakeSupabase([{ data }]).asDb(), ctx("limited"), {}, NOW);
    expect(upcoming.map((i) => i.interviewId)).toEqual(["soon", "next"]);
    const past = await listMyInterviews(new FakeSupabase([{ data }]).asDb(), ctx("limited"), { when: "past" }, NOW);
    expect(past.map((i) => i.interviewId)).toEqual(["past-new", "past-old"]);
  });
});

describe("scheduleInterview", () => {
  const base = {
    applicationId: "app-1", startsAt: "2026-10-21T15:00:00-07:00", endsAt: "2026-10-21T16:00:00-07:00", interviewerIds: ["actor-2"],
  };

  test("a time without its offset is refused before any read", async () => {
    const fake = new FakeSupabase();
    const err = await refusal(scheduleInterview(fake.asDb(), ctx(), { ...base, startsAt: "2026-10-21T15:00:00" }));
    expect(err.message).toMatch(/with its offset/);
    expect(fake.calls).toEqual([]);
  });

  test("an interview that ends before it starts, or runs past 8 hours, is refused", async () => {
    expect((await refusal(scheduleInterview(new FakeSupabase().asDb(), ctx(), { ...base, endsAt: "2026-10-21T14:00:00-07:00" }))).message)
      .toMatch(/end after it starts/);
    expect((await refusal(scheduleInterview(new FakeSupabase().asDb(), ctx(), { ...base, endsAt: "2026-10-22T15:00:00-07:00" }))).message)
      .toMatch(/8 hours/);
  });

  test("someone who cannot schedule on the job is told so, and nothing is claimed", async () => {
    const fake = new FakeSupabase([{ data: { id: "app-1", role_id: "role-1" } }, { data: false }]);
    expect((await refusal(scheduleInterview(fake.asDb(), ctx("elevated"), base))).code).toBe("forbidden");
    expect(fake.calls.map((c) => c.table)).not.toContain("client_claim_write");
  });

  test("an interviewer from outside the company is refused", async () => {
    const fake = new FakeSupabase([{ data: { id: "app-1", role_id: "role-1" } }, { data: true }, { data: [] }]);
    expect((await refusal(scheduleInterview(fake.asDb(), ctx(), base))).code).toBe("not_found");
  });

  test("the interview is written in UTC under an id made here, and not read back", async () => {
    const fake = new FakeSupabase([
      { data: { id: "app-1", role_id: "role-1" } }, { data: true }, { data: [{ id: "actor-2" }] },
      { data: "audit-1" }, { data: null }, { data: null },
    ]);
    const { interviewId } = await scheduleInterview(fake.asDb(), ctx(), { ...base, interviewerIds: ["actor-2", "actor-2"] });
    const insert = fake.calls.find((c) => c.op === "insert")!;
    expect(insert.args).toMatchObject({
      id: interviewId, application_id: "app-1", starts_at: "2026-10-21T22:00:00.000Z", interviewer_actor_ids: ["actor-2"],
    });
    expect(insert.terminal).toBe("await");
  });

  test("a step outside the job's plan is refused with the plan's steps, before any claim", async () => {
    const fake = new FakeSupabase([
      { data: { id: "app-1", role_id: "role-1" } }, { data: true }, { data: { interview_steps: ["Recruiter screen", "Onsite"] } },
    ]);
    const err = await refusal(scheduleInterview(fake.asDb(), ctx(), { ...base, step: "Take-home" }));
    expect(err.message).toMatch(/The steps are: Recruiter screen, Onsite/);
    expect(fake.calls.map((c) => c.table)).not.toContain("client_claim_write");
  });

  test("a step in the plan is written as the plan spells it; with no plan, any step goes", async () => {
    const planned = new FakeSupabase([
      { data: { id: "app-1", role_id: "role-1" } }, { data: true }, { data: { interview_steps: ["Recruiter screen", "Onsite"] } },
      { data: [{ id: "actor-2" }] }, { data: "audit-1" }, { data: null }, { data: null },
    ]);
    await scheduleInterview(planned.asDb(), ctx(), { ...base, step: " onsite " });
    expect(planned.calls.find((c) => c.op === "insert")?.args).toMatchObject({ step: "Onsite" });

    const open = new FakeSupabase([
      { data: { id: "app-1", role_id: "role-1" } }, { data: true }, { data: { interview_steps: [] } },
      { data: [{ id: "actor-2" }] }, { data: "audit-1" }, { data: null }, { data: null },
    ]);
    await scheduleInterview(open.asDb(), ctx(), { ...base, step: "Coffee chat" });
    expect(open.calls.find((c) => c.op === "insert")?.args).toMatchObject({ step: "Coffee chat" });
  });

  test("a second scheduled interview on one step is a sentence, and the claim is given back", async () => {
    const fake = new FakeSupabase([
      { data: { id: "app-1", role_id: "role-1" } }, { data: true }, { data: { interview_steps: [] } },
      { data: [{ id: "actor-2" }] }, { data: "audit-1" }, { error: { code: "23505", message: "duplicate key" } }, { data: null },
    ]);
    expect((await refusal(scheduleInterview(fake.asDb(), ctx(), { ...base, step: "Onsite" }))).message).toMatch(/already has a scheduled "Onsite"/);
    expect(fake.calls.at(-1)?.args).toMatchObject({ p_keep: false });
  });
});

describe("updateInterview", () => {
  const current = {
    id: "int-1", application_id: "app-1", starts_at: "2026-10-21T22:00:00+00:00", ends_at: "2026-10-21T23:00:00+00:00",
    status: "scheduled", step: null, interviewer_actor_ids: ["actor-2"], location_or_link: null,
  };

  test("cancelling writes only the status, with the old one in the audit row", async () => {
    const fake = new FakeSupabase([
      { data: current }, { data: "role-1" }, { data: true }, { data: "audit-1" }, { data: [{ id: "int-1" }] }, { data: null },
    ]);
    expect(await updateInterview(fake.asDb(), ctx(), { interviewId: "int-1", status: "cancelled", startsAt: "2026-10-21T22:00:00Z" }))
      .toEqual({ outcome: "updated", changed: ["status"] });
    expect(fake.calls.at(-1)?.args).toMatchObject({ p_before: { status: "scheduled" }, p_after: { status: "cancelled" } });
  });
});

describe("submitFeedback", () => {
  const interview = (over: object = {}) => ({
    id: "int-1", application_id: "app-1", starts_at: "2026-10-20T10:00:00Z", ends_at: "2026-10-20T11:00:00Z",
    status: "scheduled", step: null, interviewer_actor_ids: ["actor-1"], ...over,
  });

  test("only an interviewer on it, only once it has started, never on a cancelled one", async () => {
    const notMine = new FakeSupabase([{ data: interview({ interviewer_actor_ids: ["actor-2"] }) }]);
    expect((await refusal(submitFeedback(notMine.asDb(), ctx(), { interviewId: "int-1", recommendation: "yes", notes: "ok" }, NOW))).code).toBe("forbidden");
    const early = new FakeSupabase([{ data: interview({ starts_at: "2026-10-21T10:00:00Z" }) }]);
    expect((await refusal(submitFeedback(early.asDb(), ctx(), { interviewId: "int-1", recommendation: "yes", notes: "ok" }, NOW))).message).toMatch(/not happened yet/);
    const cancelled = new FakeSupabase([{ data: interview({ status: "cancelled" }) }]);
    expect((await refusal(submitFeedback(cancelled.asDb(), ctx(), { interviewId: "int-1", recommendation: "yes", notes: "ok" }, NOW))).message).toMatch(/cancelled/);
  });

  test("the notes are saved and kept out of the audit row", async () => {
    const fake = new FakeSupabase([{ data: interview() }, { data: null }, { data: "audit-1" }, { data: { id: "fb-1" } }, { data: null }]);
    expect(await submitFeedback(fake.asDb(), ctx("limited"), { interviewId: "int-1", recommendation: "strong_yes", rating: 4, notes: "SECRET-NOTES" }, NOW))
      .toEqual({ feedbackId: "fb-1", replaced: false });
    expect(fake.calls.find((c) => c.op === "upsert")?.args).toMatchObject({ notes: "SECRET-NOTES", interviewer_actor_id: "actor-1" });
    expect(JSON.stringify(fake.calls.at(-1)?.args)).not.toContain("SECRET-NOTES");
  });

  test("a rating outside 1 to 4 is refused before any read", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(submitFeedback(fake.asDb(), ctx(), { interviewId: "int-1", recommendation: "yes", rating: 5, notes: "x" }, NOW))).code).toBe("invalid");
    expect(fake.calls).toEqual([]);
  });
});

describe("getFeedback", () => {
  test("one of interview_id or application_id", async () => {
    expect((await refusal(getFeedback(new FakeSupabase().asDb(), ctx(), {}))).code).toBe("invalid");
    expect((await refusal(getFeedback(new FakeSupabase().asDb(), ctx(), { interviewId: "a", applicationId: "b" }))).code).toBe("invalid");
  });

  test("says when the caller's own feedback is outstanding", async () => {
    const fake = new FakeSupabase([
      { data: [{ id: "int-1", application_id: "app-1", starts_at: "x", ends_at: "y", status: "done", step: null, interviewer_actor_ids: ["actor-1", "actor-2"] }] },
      { data: [] },
      { data: [{ id: "actor-1", display_name: "Ada" }, { id: "actor-2", display_name: "Ivan" }] },
    ]);
    const out = await getFeedback(fake.asDb(), ctx("elevated"), { applicationId: "app-1" });
    expect(out.yoursOutstanding).toBe(true);
    expect(out.interviews[0].interviewers.map((i) => i.name)).toEqual(["Ada", "Ivan"]);
  });
});
