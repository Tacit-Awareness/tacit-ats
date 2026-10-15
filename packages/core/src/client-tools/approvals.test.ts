import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { decideApproval, getApprovalFlow, listMyApprovals, requestApproval, setApprovalFlow } from "./approvals.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";

/**
 * What the approval tools add on top of the definer functions and the gates
 * (pinned against real Postgres in the SQL suite's section 21 and apps/mcp's
 * client.integration.test.ts): a sentence before a refused write, the audit
 * claim immediately before the function call, and a rejection's reason kept
 * out of the audit row.
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

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FLOW = {
  id: "flow-1", updated_at: "2026-10-15T00:00:00Z", updated_by_actor_id: A,
  approval_flow_approvers: [{ step: 2, actor_id: C }, { step: 1, actor_id: A }, { step: 2, actor_id: B }],
};

describe("setApprovalFlow", () => {
  test("a malformed flow is refused before any read", async () => {
    const fake = new FakeSupabase();
    for (const steps of [[[]], [[A], [A]], [["not-an-id"]], Array.from({ length: 11 }, () => [A])]) {
      expect((await refusal(setApprovalFlow(fake.asDb(), ctx(), { jobId: "role-1", kind: "offer", steps }))).code).toBe("invalid");
    }
    expect((await refusal(setApprovalFlow(fake.asDb(), ctx(), { jobId: "role-1", kind: "hire" as "offer", steps: [] }))).code).toBe("invalid");
    expect(fake.calls).toEqual([]);
  });

  test("an interviewer is refused without a query; someone who cannot manage the job is told so", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(setApprovalFlow(fake.asDb(), ctx("limited"), { jobId: "role-1", kind: "offer", steps: [] }))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
    const other = new FakeSupabase([{ data: { id: "role-1" } }, { data: false }]);
    expect((await refusal(setApprovalFlow(other.asDb(), ctx("elevated"), { jobId: "role-1", kind: "offer", steps: [[A]] }))).message)
      .toMatch(/manage this job/);
    expect(rpcs(other)).toEqual(["can_on_role"]);
  });

  test("an approver who is not a member is named, and nothing is claimed", async () => {
    const fake = new FakeSupabase([{ data: { id: "role-1" } }, { data: true }, { data: [{ id: A, display_name: "Ada" }] }]);
    const err = await refusal(setApprovalFlow(fake.asDb(), ctx(), { jobId: "role-1", kind: "offer", steps: [[A], [B]] }));
    expect(err.message).toMatch(new RegExp(`user id ${B}`));
    expect(rpcs(fake)).not.toContain("client_claim_write");
  });

  test("the flow goes to set_approval_flow lower-cased, claimed first, and its resets are reported", async () => {
    const fake = new FakeSupabase([
      { data: { id: "role-1" } }, { data: true }, { data: [{ id: A, display_name: "Ada" }, { id: B, display_name: "Bo" }] },
      { data: "audit-1" }, { data: [{ changed: true, requests_reset: 2 }] }, { data: null },
    ]);
    const r = await setApprovalFlow(fake.asDb(), ctx(), { jobId: "role-1", kind: "job_open", steps: [[A.toUpperCase()], [B]] });
    expect(r).toEqual({ outcome: "set", steps: 2, requestsReset: 2 });
    expect(rpcs(fake)).toEqual(["can_on_role", "client_claim_write", "set_approval_flow", "client_finish_write"]);
    expect(fake.calls.find((c) => c.table === "set_approval_flow")?.args).toEqual({ p_role: "role-1", p_kind: "job_open", p_steps: [[A], [B]] });
    expect(fake.calls.at(-1)?.args).toMatchObject({ p_keep: true });
  });

  test("the same flow again gives the claim back", async () => {
    const fake = new FakeSupabase([
      { data: { id: "role-1" } }, { data: true }, { data: "audit-1" }, { data: [{ changed: false, requests_reset: 0 }] }, { data: null },
    ]);
    expect(await setApprovalFlow(fake.asDb(), ctx(), { jobId: "role-1", kind: "offer", steps: [] }))
      .toEqual({ outcome: "unchanged", steps: 0, requestsReset: 0 });
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_keep: false } });
  });
});

describe("getApprovalFlow", () => {
  test("a job the member cannot see and no flow is not found", async () => {
    const fake = new FakeSupabase([{ data: null }, { data: null }]);
    expect((await refusal(getApprovalFlow(fake.asDb(), ctx(), { jobId: "role-x", kind: "offer" }))).code).toBe("not_found");
  });

  test("steps in order, any-one-of approvers named, and an archived approver marked inactive", async () => {
    const fake = new FakeSupabase([
      { data: { id: "role-1", title: "Founding Engineer" } },
      { data: FLOW },
      { data: [{ id: A, display_name: "Ada" }, { id: B, display_name: "Bo" }] },
    ]);
    const f = await getApprovalFlow(fake.asDb(), ctx(), { jobId: "role-1", kind: "offer" });
    expect(f.steps).toEqual([
      { step: 1, approvers: [{ userId: A, name: "Ada", active: true }] },
      { step: 2, approvers: [{ userId: B, name: "Bo", active: true }, { userId: C, name: null, active: false }] },
    ]);
    expect(f).toMatchObject({ title: "Founding Engineer", updatedBy: "Ada", latestRequest: null });
  });

  test("job_open carries the latest request to open the job", async () => {
    const fake = new FakeSupabase([
      { data: null },
      { data: FLOW },
      { data: [{ id: "req-1", offer_id: null, status: "approved", current_step: null, requested_by_actor_id: B, created_at: "t0", resolved_at: "t1", used_at: null,
        approval_decisions: [{ step: 2, decision: "approved", actor_id: C, reason: "ok", created_at: "t1" }, { step: 1, decision: "approved", actor_id: A, reason: null, created_at: "t0" }] }] },
      { data: [{ id: A, display_name: "Ada" }, { id: B, display_name: "Bo" }] },
    ]);
    const f = await getApprovalFlow(fake.asDb(), ctx("limited"), { jobId: "role-1", kind: "job_open" });
    expect(f.title).toBeNull();
    expect(f.latestRequest).toMatchObject({ requestId: "req-1", status: "approved", requestedBy: "Bo" });
    expect(f.latestRequest?.decisions.map((d) => [d.step, d.by])).toEqual([[1, "Ada"], [2, null]]);
  });
});

describe("requestApproval", () => {
  test("exactly one of offer and job, and never an interviewer", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(requestApproval(fake.asDb(), ctx(), {}))).code).toBe("invalid");
    expect((await refusal(requestApproval(fake.asDb(), ctx(), { offerId: "o", jobId: "j" }))).code).toBe("invalid");
    expect((await refusal(requestApproval(fake.asDb(), ctx("limited"), { offerId: "o" }))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });

  test("an offer that is not a draft, and a job with no flow, are sentences without a claim", async () => {
    const extended = new FakeSupabase([{ data: { id: "o-1", status: "extended", application_id: "app-1" } }]);
    expect((await refusal(requestApproval(extended.asDb(), ctx(), { offerId: "o-1" }))).message).toMatch(/Only a draft/);
    const noFlow = new FakeSupabase([{ data: { id: "role-1", status: "paused" } }, { data: true }, { data: null }]);
    expect((await refusal(requestApproval(noFlow.asDb(), ctx(), { jobId: "role-1" }))).message).toMatch(/no approval flow for opening it/);
    expect(rpcs(noFlow)).not.toContain("client_claim_write");
  });

  test("an offer's request is made through request_approval and names who approves first", async () => {
    const fake = new FakeSupabase([
      { data: { id: "o-1", status: "draft", application_id: "app-1" } },
      { data: { role_id: "role-1" } },
      { data: true },
      { data: FLOW },
      { data: "audit-1" },
      { data: [{ request_id: "req-1", request_status: "pending", outcome: "requested" }] },
      { data: [{ id: A, display_name: "Ada" }] },
      { data: null },
    ]);
    expect(await requestApproval(fake.asDb(), ctx(), { offerId: "o-1" })).toEqual({
      requestId: "req-1", kind: "offer", outcome: "requested", status: "pending", firstStep: ["Ada"],
    });
    expect(fake.calls.find((c) => c.table === "request_approval")?.args).toEqual({ p_kind: "offer", p_target: "o-1" });
    expect(fake.calls.at(-1)?.args).toMatchObject({ p_keep: true });
  });

  test("one already waiting is answered with, and the claim given back", async () => {
    const fake = new FakeSupabase([
      { data: { id: "role-1", status: "closed" } }, { data: true }, { data: FLOW }, { data: "audit-1" },
      { data: [{ request_id: "req-1", request_status: "pending", outcome: "already_pending" }] },
      { data: [{ id: A, display_name: "Ada" }] }, { data: null },
    ]);
    expect((await requestApproval(fake.asDb(), ctx(), { jobId: "role-1" })).outcome).toBe("already_pending");
    expect(fake.calls.at(-1)?.args).toMatchObject({ p_keep: false });
  });
});

describe("listMyApprovals", () => {
  test("an offer comes with its candidate and terms, a job opening with neither", async () => {
    const fake = new FakeSupabase([
      { data: [
        { request_id: "r-1", kind: "offer", waiting_step: 1, steps: 2, job_id: "role-1", job_title: "Engineer", job_status: "open",
          offer_id: "o-1", application_id: "app-1", candidate_id: "p-1", candidate_name: "Ann", salary: 200000, currency: "USD",
          bonus: null, equity: null, start_date: null, expires_on: null, requested_by_actor_id: A, requested_at: "t" },
        { request_id: "r-2", kind: "job_open", waiting_step: 1, steps: 1, job_id: "role-2", job_title: "Designer", job_status: "paused",
          offer_id: null, application_id: null, candidate_id: null, candidate_name: null, salary: null, currency: null,
          bonus: null, equity: null, start_date: null, expires_on: null, requested_by_actor_id: null, requested_at: "t" },
      ] },
      { data: [{ id: A, display_name: "Ada" }] },
    ]);
    const [offer, job] = await listMyApprovals(fake.asDb(), ctx("limited"));
    expect(offer).toMatchObject({ candidateName: "Ann", requestedBy: "Ada", terms: { salary: 200000, currency: "USD" } });
    expect(job).toMatchObject({ kind: "job_open", candidateId: null, terms: null, requestedBy: null });
  });
});

describe("decideApproval", () => {
  const PENDING = { id: "req-1", kind: "offer", role_id: "role-1", offer_id: "o-1", status: "pending", current_step: 2 };

  test("a rejection needs a reason, before any read", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(decideApproval(fake.asDb(), ctx(), { requestId: "req-1", decision: "reject", reason: "  " }))).code).toBe("invalid");
    expect(fake.calls).toEqual([]);
  });

  test("a request no longer pending is answered, not refused, and claims nothing", async () => {
    const fake = new FakeSupabase([{ data: { ...PENDING, status: "reset", current_step: null } }]);
    expect(await decideApproval(fake.asDb(), ctx(), { requestId: "req-1", decision: "approve" }))
      .toMatchObject({ outcome: "not_pending", status: "reset" });
    expect(rpcs(fake)).toEqual([]);
  });

  test("someone not at the waiting step is told which step it waits on", async () => {
    const fake = new FakeSupabase([{ data: PENDING }, { data: [] }]);
    expect((await refusal(decideApproval(fake.asDb(), ctx(), { requestId: "req-1", decision: "approve" }))).message)
      .toMatch(/waiting on step 2, and you are not an approver at that step/);
    expect(fake.calls[1].filters).toEqual(expect.arrayContaining([
      { method: "eq", column: "actor_id", value: "actor-1" },
      { method: "eq", column: "step", value: 2 },
      { method: "eq", column: "approval_flows.role_id", value: "role-1" },
    ]));
  });

  test("a rejection goes to decide_approval with its reason, which stays out of the audit row", async () => {
    const fake = new FakeSupabase([
      { data: PENDING }, { data: [{ id: "ap-1" }] }, { data: "audit-1" },
      { data: [{ request_status: "rejected", waiting_step: null, outcome: "rejected" }] }, { data: null },
    ]);
    expect(await decideApproval(fake.asDb(), ctx("limited"), { requestId: "req-1", decision: "reject", reason: " Over the band " }))
      .toEqual({ outcome: "rejected", status: "rejected", waitingStep: null, kind: "offer", offerId: "o-1", jobId: "role-1" });
    expect(fake.calls.find((c) => c.table === "decide_approval")?.args).toEqual({ p_request: "req-1", p_approve: false, p_reason: "Over the band" });
    expect(fake.calls.find((c) => c.table === "client_claim_write")?.args).toMatchObject({ p_action: "approval.reject", p_entity: "approval_request" });
    const finish = fake.calls.at(-1);
    expect(finish?.args).toMatchObject({ p_keep: true, p_after: { decision: "reject", status: "rejected" } });
    expect(JSON.stringify(finish?.args)).not.toContain("Over the band");
  });

  test("the database refusing the step after all is a sentence, and the claim is given back", async () => {
    const fake = new FakeSupabase([
      { data: PENDING }, { data: [{ id: "ap-1" }] }, { data: "audit-1" },
      { error: { code: "42501", message: "you are not an approver at the step this request waits on" } }, { data: null },
    ]);
    expect((await refusal(decideApproval(fake.asDb(), ctx(), { requestId: "req-1", decision: "approve" }))).code).toBe("forbidden");
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_keep: false } });
  });
});
