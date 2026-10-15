import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { createOffer, getOffers, listRejectionReasons, updateOffer } from "./offers.js";

/**
 * What the offer and rejection-reason tools add on top of the policies and
 * the offer trigger (pinned against real Postgres in the SQL suite and
 * apps/mcp's client.integration.test.ts): a sentence before a refused write,
 * the audit claim around an allowed one, and notes kept out of the audit row.
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

const APP = { id: "app-1", role_id: "role-1" };
const OFFER = {
  id: "offer-1", application_id: "app-1", status: "draft", salary: 180000, currency: "USD", bonus: null, equity: "0.5%",
  start_date: "2026-12-01", expires_on: null, notes: "verbal yes likely", created_by_actor_id: "actor-1",
  created_at: "2026-10-14T00:00:00Z", extended_at: null, resolved_at: null,
};

describe("listRejectionReasons", () => {
  test("an interviewer is told they have none, without a query", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(listRejectionReasons(fake.asDb(), ctx("limited")))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });

  test("the live reasons, in the org's order", async () => {
    const fake = new FakeSupabase([{ data: [{ id: "r-1", kind: "rejected", name: "Skills or experience" }] }]);
    expect(await listRejectionReasons(fake.asDb(), ctx("elevated"))).toEqual([{ reasonId: "r-1", kind: "rejected", name: "Skills or experience" }]);
    expect(fake.calls[0].filters).toEqual([{ method: "is", column: "archived_at", value: null }]);
  });
});

describe("getOffers", () => {
  test("someone who cannot manage the job is told so", async () => {
    const fake = new FakeSupabase([{ data: APP }, { data: false }]);
    expect((await refusal(getOffers(fake.asDb(), ctx("elevated"), { applicationId: "app-1" }))).message).toMatch(/manage this job/);
  });

  test("an interviewer is refused without a query", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(getOffers(fake.asDb(), ctx("limited"), { applicationId: "app-1" }))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });

  test("offers come back with their author's name, and no approval when the job has no flow", async () => {
    const fake = new FakeSupabase([
      { data: APP }, { data: true }, { data: [OFFER] },
      // approval_flows, approval_requests
      { data: null }, { data: [] },
      { data: [{ id: "actor-1", display_name: "Ryan" }] },
    ]);
    const [o] = await getOffers(fake.asDb(), ctx(), { applicationId: "app-1" });
    expect(o).toMatchObject({ offerId: "offer-1", status: "draft", salary: 180000, equity: "0.5%", createdBy: "Ryan", approval: null });
  });

  test("on a job with an offer flow, each offer carries its latest request and decisions, named", async () => {
    const fake = new FakeSupabase([
      { data: APP }, { data: true }, { data: [OFFER] },
      { data: { id: "flow-1", updated_at: "t", updated_by_actor_id: "actor-1", approval_flow_approvers: [{ step: 1, actor_id: "actor-2" }, { step: 2, actor_id: "actor-3" }] } },
      { data: [{
        id: "req-1", offer_id: "offer-1", status: "pending", current_step: 2, requested_by_actor_id: "actor-1",
        created_at: "2026-10-15T00:00:00Z", resolved_at: null, used_at: null,
        approval_decisions: [{ step: 1, decision: "approved", actor_id: "actor-2", reason: null, created_at: "2026-10-15T01:00:00Z" }],
      }] },
      { data: [{ id: "actor-1", display_name: "Ryan" }, { id: "actor-2", display_name: "Fin" }] },
    ]);
    const [o] = await getOffers(fake.asDb(), ctx(), { applicationId: "app-1" });
    expect(o.approval).toEqual({
      required: true, status: "pending", requestId: "req-1", waitingStep: 2, steps: 2, requestedBy: "Ryan",
      requestedAt: "2026-10-15T00:00:00Z",
      decisions: [{ step: 1, decision: "approved", by: "Fin", at: "2026-10-15T01:00:00Z", reason: null }],
    });
    expect(fake.calls[4]).toMatchObject({ table: "approval_requests", filters: [{ method: "in", column: "offer_id", value: ["offer-1"] }] });
  });
});

describe("createOffer", () => {
  test("bad terms are refused before any read", async () => {
    const fake = new FakeSupabase();
    for (const terms of [{ salary: -1 }, { salary: 1.5 }, { currency: "dollars" }, { startDate: "next month" }, { bonus: "x".repeat(501) }]) {
      expect((await refusal(createOffer(fake.asDb(), ctx(), { applicationId: "app-1", ...terms }))).code).toBe("invalid");
    }
    expect(fake.calls).toEqual([]);
  });

  test("a second open offer is refused with the one there, and nothing is claimed", async () => {
    const fake = new FakeSupabase([{ data: APP }, { data: true }, { data: { id: "offer-1", status: "extended" } }]);
    const err = await refusal(createOffer(fake.asDb(), ctx(), { applicationId: "app-1", salary: 1 }));
    expect(err.message).toMatch(/already has an open offer \(offer-1, extended\)/);
    expect(rpcs(fake)).not.toContain("client_claim_write");
  });

  test("a draft is inserted with its own id and audited without its notes", async () => {
    const fake = new FakeSupabase([{ data: APP }, { data: true }, { data: null }, { data: "audit-1" }, { data: null }, { data: null }]);
    const { offerId } = await createOffer(fake.asDb(), ctx(), {
      applicationId: "app-1", salary: 180000, currency: "eur", startDate: "2026-12-01", notes: "  private context  ",
    });
    const insert = fake.calls.find((c) => c.op === "insert");
    expect(insert).toMatchObject({
      table: "offers",
      args: { id: offerId, application_id: "app-1", salary: 180000, currency: "EUR", start_date: "2026-12-01", notes: "private context" },
    });
    // Not read back: insert, no select.
    expect(insert?.terminal).toBe("await");
    const finish = fake.calls.find((c) => c.table === "client_finish_write");
    expect(finish?.args).toMatchObject({ p_after: { application_id: "app-1", status: "draft", salary: 180000, currency: "EUR" } });
    expect(JSON.stringify(finish?.args)).not.toContain("private context");
  });

  test("the database's refusal of a second open offer is a sentence, and the claim is given back", async () => {
    const fake = new FakeSupabase([
      { data: APP }, { data: true }, { data: null }, { data: "audit-1" },
      { error: { code: "23505", message: "duplicate key" } }, { data: null },
    ]);
    expect((await refusal(createOffer(fake.asDb(), ctx(), { applicationId: "app-1" }))).message).toMatch(/already has an open offer/);
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_keep: false } });
  });
});

describe("updateOffer", () => {
  test("nothing to change claims nothing", async () => {
    const fake = new FakeSupabase([{ data: OFFER }]);
    expect(await updateOffer(fake.asDb(), ctx(), { offerId: "offer-1", salary: 180000 })).toEqual({ outcome: "unchanged", status: "draft", changed: [] });
    expect(rpcs(fake)).toEqual([]);
  });

  test("an out-of-order move, a closed offer and an extended offer's terms are each a sentence", async () => {
    expect((await refusal(updateOffer(new FakeSupabase([{ data: OFFER }]).asDb(), ctx(), { offerId: "offer-1", status: "accepted" }))).message)
      .toMatch(/draft can only become extended or withdrawn/);
    expect((await refusal(updateOffer(new FakeSupabase([{ data: { ...OFFER, status: "declined" } }]).asDb(), ctx(), { offerId: "offer-1", notes: "x" }))).message)
      .toMatch(/closed/);
    expect((await refusal(updateOffer(new FakeSupabase([{ data: { ...OFFER, status: "extended" } }]).asDb(), ctx(), { offerId: "offer-1", salary: 190000 }))).message)
      .toMatch(/Withdraw it and draft a new one/);
  });

  test("extending a draft is conditional on the status read, audited without notes", async () => {
    const fake = new FakeSupabase([{ data: OFFER }, { data: "audit-1" }, { data: [{ id: "offer-1" }] }, { data: null }]);
    expect(await updateOffer(fake.asDb(), ctx(), { offerId: "offer-1", status: "extended", notes: "sent by email" }))
      .toEqual({ outcome: "updated", status: "extended", changed: ["notes", "status"] });
    const update = fake.calls.find((c) => c.op === "update");
    expect(update?.args).toEqual({ notes: "sent by email", status: "extended" });
    expect(update?.filters).toEqual([{ method: "eq", column: "id", value: "offer-1" }, { method: "eq", column: "status", value: "draft" }]);
    const finish = fake.calls.find((c) => c.table === "client_finish_write");
    expect(finish?.args).toMatchObject({ p_before: { status: "draft" }, p_after: { status: "extended" }, p_keep: true });
    expect(JSON.stringify(finish?.args)).not.toContain("sent by email");
  });

  test("the approval gate's refusal says how to ask for approval", async () => {
    const fake = new FakeSupabase([
      { data: OFFER }, { data: "audit-1" },
      { error: { code: "22023", message: "offers on this job need approval before they are extended, and this one is not approved" } },
      { data: null },
    ]);
    const err = await refusal(updateOffer(fake.asDb(), ctx(), { offerId: "offer-1", status: "extended" }));
    expect(err.message).toMatch(/need approval.*request_approval with the offer_id/);
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_keep: false } });
  });

  test("someone else closing it first is reported, and the claim is given back", async () => {
    const fake = new FakeSupabase([{ data: { ...OFFER, status: "extended" } }, { data: "audit-1" }, { data: [] }, { data: null }]);
    expect(await updateOffer(fake.asDb(), ctx(), { offerId: "offer-1", status: "accepted" }))
      .toEqual({ outcome: "changed_since", status: "extended", changed: [] });
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_keep: false } });
  });
});
