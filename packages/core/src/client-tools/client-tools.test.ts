import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { getJobPipeline, searchCandidates } from "./reads.js";
import { addCandidate, addNote, updateStage } from "./writes.js";

/**
 * The client tools' own logic with the database scripted. What a member may
 * see and change is the policies' call and is pinned against real Postgres
 * (apps/mcp's client.integration.test.ts, the SQL suite); this pins what the
 * code adds on top: the sentence before a refused write, the audit claim
 * around an allowed one, and the interviewer's narrower reads.
 */

const ctx = (accessLevel: ClientToolCtx["accessLevel"] = "admin"): ClientToolCtx => ({
  actorId: "actor-1",
  orgId: "org-1",
  accessLevel,
  source: "claude",
});

const rpcs = (fake: FakeSupabase) => fake.calls.filter((c) => c.op === "rpc").map((c) => c.table);

async function refusal(promise: Promise<unknown>): Promise<ClientToolError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ClientToolError);
  return err as ClientToolError;
}

const APP = { id: "app-1", stage: "screening", role_id: "role-1", added_by_actor_id: "actor-2" };

describe("updateStage", () => {
  test("a member who may not change the application is told so, and nothing is claimed", async () => {
    const fake = new FakeSupabase([{ data: APP }, { data: false }]);
    const err = await refusal(updateStage(fake.asDb(), ctx("elevated"), { applicationId: "app-1", stage: "interviewing" }));
    expect(err.code).toBe("forbidden");
    expect(rpcs(fake)).toEqual(["can_edit_application"]);
  });

  test("an application the member cannot read is not found", async () => {
    const fake = new FakeSupabase([{ data: null }]);
    expect((await refusal(updateStage(fake.asDb(), ctx(), { applicationId: "app-x", stage: "offer" }))).code).toBe("not_found");
  });

  test("no move and no claim when it is already there, or moved since the user looked", async () => {
    const same = new FakeSupabase([{ data: APP }, { data: true }]);
    expect(await updateStage(same.asDb(), ctx(), { applicationId: "app-1", stage: "screening" }))
      .toEqual({ outcome: "unchanged", stage: "screening", reason: null });
    const since = new FakeSupabase([{ data: APP }, { data: true }]);
    expect(await updateStage(since.asDb(), ctx(), { applicationId: "app-1", stage: "offer", expectedStage: "sourced" }))
      .toEqual({ outcome: "changed_since", stage: "screening", reason: null });
    expect([...rpcs(same), ...rpcs(since)]).not.toContain("client_claim_write");
  });

  test("the web app's writes are claimed with source dashboard", async () => {
    const fake = new FakeSupabase([
      { data: APP }, { data: true },
      { data: "audit-1" },
      { data: { stage: "screening" } }, { data: [{ id: "app-1" }] }, { data: null },
      { data: null },
    ]);
    await updateStage(fake.asDb(), { ...ctx(), source: "dashboard" }, { applicationId: "app-1", stage: "interviewing" });
    expect(fake.calls.find((c) => c.table === "client_claim_write")?.args).toEqual({
      p_source: "dashboard", p_action: "application.stage_change", p_entity: "application",
    });
  });

  test("a move is claimed first and completed with before and after", async () => {
    const fake = new FakeSupabase([
      { data: APP }, { data: true },
      { data: "audit-1" },
      { data: { stage: "screening" } }, { data: [{ id: "app-1" }] }, { data: null },
      { data: null },
    ]);
    expect(await updateStage(fake.asDb(), ctx(), { applicationId: "app-1", stage: "interviewing" }))
      .toEqual({ outcome: "moved", stage: "interviewing", reason: null });
    expect(rpcs(fake)).toEqual(["can_edit_application", "client_claim_write", "client_finish_write"]);
    const [claim, finish] = fake.calls.filter((c) => c.table.startsWith("client_"));
    expect(claim.args).toEqual({ p_source: "claude", p_action: "application.stage_change", p_entity: "application" });
    expect(finish.args).toEqual({
      p_audit: "audit-1", p_entity_id: "app-1",
      p_before: { stage: "screening" }, p_after: { stage: "interviewing" }, p_keep: true,
    });
  });

  test("the hourly limit refuses before anything is written", async () => {
    const fake = new FakeSupabase([{ data: APP }, { data: true }, { data: null }]);
    const err = await refusal(updateStage(fake.asDb(), ctx(), { applicationId: "app-1", stage: "offer" }));
    expect(err.code).toBe("rate_limited");
    expect(fake.calls.filter((c) => c.op === "update")).toEqual([]);
  });

  test("closing an application needs a reason, and a reason goes with nothing else", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(updateStage(fake.asDb(), ctx(), { applicationId: "app-1", stage: "rejected" }))).message)
      .toMatch(/list_rejection_reasons/);
    expect((await refusal(updateStage(fake.asDb(), ctx(), { applicationId: "app-1", stage: "offer", reasonId: "r-1" }))).code)
      .toBe("invalid");
    expect(fake.calls).toEqual([]);
  });

  test("a reason of the other kind is refused before any claim", async () => {
    const fake = new FakeSupabase([{ data: APP }, { data: true }, { data: { id: "r-1", kind: "rejected", name: "Skills", archived_at: null } }]);
    const err = await refusal(updateStage(fake.asDb(), ctx(), { applicationId: "app-1", stage: "withdrawn", reasonId: "r-1" }));
    expect(err.message).toMatch(/move them to rejected/);
    expect(rpcs(fake)).not.toContain("client_claim_write");
  });

  test("a rejection writes the reason and note with the move, and names the reason in the event", async () => {
    const fake = new FakeSupabase([
      { data: APP }, { data: true }, { data: { id: "r-1", kind: "rejected", name: "Skills or experience", archived_at: null } },
      { data: "audit-1" },
      { data: { stage: "screening" } }, { data: [{ id: "app-1" }] }, { data: null },
      { data: null },
    ]);
    expect(await updateStage(fake.asDb(), ctx(), { applicationId: "app-1", stage: "rejected", reasonId: "r-1", note: " needs depth " }))
      .toEqual({ outcome: "moved", stage: "rejected", reason: "Skills or experience" });
    expect(fake.calls.find((c) => c.op === "update")?.args).toMatchObject({
      stage: "rejected", rejection_reason_id: "r-1", rejection_note: "needs depth",
    });
    expect(fake.calls.find((c) => c.table === "application_events")?.args).toMatchObject({ to_stage: "rejected", detail: "Skills or experience" });
    // The note stays on the application, out of the audit row.
    expect(fake.calls.find((c) => c.table === "client_finish_write")?.args).toMatchObject({
      p_after: { stage: "rejected", rejection_reason: "Skills or experience" },
    });
  });

  test("the same stage with a reason replaces the reason", async () => {
    const fake = new FakeSupabase([
      { data: { ...APP, stage: "withdrawn" } }, { data: true }, { data: { id: "r-2", kind: "withdrew", name: "Timing", archived_at: null } },
      { data: "audit-1" }, { data: [{ id: "app-1" }] }, { data: null },
    ]);
    expect(await updateStage(fake.asDb(), ctx(), { applicationId: "app-1", stage: "withdrawn", reasonId: "r-2" }))
      .toEqual({ outcome: "reason_set", stage: "withdrawn", reason: "Timing" });
    expect(fake.calls.find((c) => c.op === "update")?.args).toMatchObject({ rejection_reason_id: "r-2", rejection_note: null });
  });

  test("someone else's rejection isn't overwritten by a stale page rejecting them too", async () => {
    const fake = new FakeSupabase([
      { data: { ...APP, stage: "rejected" } }, { data: true }, { data: { id: "r-2", kind: "rejected", name: "Timing", archived_at: null } },
    ]);
    expect(await updateStage(fake.asDb(), ctx(), { applicationId: "app-1", stage: "rejected", expectedStage: "interviewing", reasonId: "r-2", note: "mine" }))
      .toEqual({ outcome: "changed_since", stage: "rejected", reason: null });
    expect(fake.calls.find((c) => c.op === "update")).toBeUndefined();
    expect(rpcs(fake)).not.toContain("client_claim_write");
  });

  test("an unknown stage is refused before any read", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(updateStage(fake.asDb(), ctx(), { applicationId: "app-1", stage: "maybe" }))).code).toBe("invalid");
    expect(fake.calls).toEqual([]);
  });
});

describe("addCandidate", () => {
  test("needs the job's pipeline permission and the right to add people, asked before any claim", async () => {
    const noJob = new FakeSupabase([{ data: false }]);
    expect((await refusal(addCandidate(noJob.asDb(), ctx("elevated"), { jobId: "role-1", name: "Ada" }))).code).toBe("forbidden");
    const noPeople = new FakeSupabase([{ data: true }, { data: false }]);
    expect((await refusal(addCandidate(noPeople.asDb(), ctx("elevated"), { jobId: "role-1", name: "Ada" }))).code).toBe("forbidden");
    expect(rpcs(noPeople)).toEqual(["can_on_role", "can_add_people"]);
  });

  test("an unknown source or an oversized detail is refused before any read", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(addCandidate(fake.asDb(), ctx(), { jobId: "role-1", name: "Ada", source: "linkedin" }))).message)
      .toMatch(/agency, job_board, event, other/);
    expect((await refusal(addCandidate(fake.asDb(), ctx(), { jobId: "role-1", name: "Ada", sourceDetail: "x".repeat(201) }))).code)
      .toBe("invalid");
    expect(fake.calls).toEqual([]);
  });

  test("a refused field is named, for a form to point at", async () => {
    const fake = new FakeSupabase([{ data: true }, { data: true }, { data: "audit-1" }, { data: null }]);
    const err = await refusal(addCandidate(fake.asDb(), ctx(), { jobId: "role-1", name: "   " }));
    expect(err).toMatchObject({ code: "invalid", field: "name" });
  });

  test("the source and its detail go on the new application; the audit row keeps the source only", async () => {
    const fake = new FakeSupabase([
      { data: true }, { data: true }, { data: "audit-1" },
      // A new person (no email to look up), the application, its event, the funnel's org check,
      // and the submission's (a client org's own job is never sent on to anyone).
      { data: null }, { data: { id: "app-1" } }, { data: null }, { data: null },
      { data: null }, { data: { org_id: "org-acme" } },
    ]);
    const r = await addCandidate(fake.asDb(), ctx(), { jobId: "role-1", name: "Ada", source: "agency", sourceDetail: "  Hunt & Co  " });
    expect(r).toMatchObject({ outcome: "added", applicationId: "app-1" });
    expect(fake.calls.find((c) => c.table === "applications" && c.op === "insert")?.args)
      .toMatchObject({ source: "agency", source_detail: "Hunt & Co" });
    expect(fake.calls.find((c) => c.table === "application_events")?.args).toMatchObject({ kind: "added", detail: "agency" });
    const finish = fake.calls.find((c) => c.table === "client_finish_write");
    expect(finish?.args).toMatchObject({ p_after: { source: "agency" } });
    expect(JSON.stringify(finish?.args)).not.toContain("Hunt");
  });

  test("an invalid email is a sentence, and its claim is given back", async () => {
    const fake = new FakeSupabase([{ data: true }, { data: true }, { data: "audit-1" }, { data: null }]);
    const err = await refusal(addCandidate(fake.asDb(), ctx(), { jobId: "role-1", name: "Ada", email: "not an email" }));
    expect(err.code).toBe("invalid");
    expect(err.message).toMatch(/valid email/);
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_audit: "audit-1", p_keep: false } });
  });
});

describe("addNote", () => {
  test("an interviewer notes only on someone they interview", async () => {
    const fake = new FakeSupabase([{ data: [{ person_id: "p-2" }] }]);
    const err = await refusal(addNote(fake.asDb(), ctx("limited"), { candidateId: "p-1", text: "Strong" }));
    expect(err.code).toBe("not_found");
    expect(rpcs(fake)).toEqual(["my_interview_candidates"]);
  });

  test("a note is written as the member and audited", async () => {
    const fake = new FakeSupabase([{ data: { id: "p-1" } }, { data: "audit-1" }, { data: { id: "note-1" } }, { data: null }]);
    expect(await addNote(fake.asDb(), ctx(), { candidateId: "p-1", text: "  Strong systems depth  " })).toEqual({ noteId: "note-1" });
    const insert = fake.calls.find((c) => c.op === "insert");
    expect(insert).toMatchObject({ table: "person_notes", args: { person_id: "p-1", actor_id: "actor-1", text: "Strong systems depth" } });
  });

  test("an empty or oversized note is refused without a read", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(addNote(fake.asDb(), ctx(), { candidateId: "p-1", text: "   " }))).code).toBe("invalid");
    expect((await refusal(addNote(fake.asDb(), ctx(), { candidateId: "p-1", text: "x".repeat(5001) }))).code).toBe("invalid");
    expect(fake.calls).toEqual([]);
  });
});

describe("reads", () => {
  test("an interviewer is refused a pipeline without a query", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(getJobPipeline(fake.asDb(), ctx("limited"), "role-1"))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });

  test("an interviewer searches only the people they interview", async () => {
    const fake = new FakeSupabase([{
      data: [
        { person_id: "p-1", display_name: "Ada Lovelace", current_title: "CTO", current_company: "Acme", linkedin_url: null },
        { person_id: "p-2", display_name: "Grace Hopper", current_title: null, current_company: null, linkedin_url: null },
      ],
    }]);
    expect(await searchCandidates(fake.asDb(), ctx("limited"), { query: "ada" })).toEqual([
      { candidateId: "p-1", name: "Ada Lovelace", headline: "CTO at Acme", applications: [] },
    ]);
    expect(fake.calls.map((c) => c.table)).toEqual(["my_interview_candidates"]);
  });

  test("a search term cannot add a clause to PostgREST's or()", async () => {
    const fake = new FakeSupabase([{ data: [] }]);
    await searchCandidates(fake.asDb(), ctx(), { query: "ada,id.neq.0),(x" });
    const or = fake.calls[0].filters.find((f) => f.method === "or");
    expect(or?.value).toBe(
      "display_name.ilike.%ada id.neq.0 x%,email.ilike.%ada id.neq.0 x%,current_company.ilike.%ada id.neq.0 x%,current_title.ilike.%ada id.neq.0 x%",
    );
  });
});
