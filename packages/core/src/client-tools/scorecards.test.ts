import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { getScorecard, setScorecard } from "./scorecards.js";

/**
 * What the scorecard tools add on top of the policies and the guard trigger
 * (pinned against real Postgres in the SQL suite and apps/mcp's
 * client.integration.test.ts): a sentence before a refused write, the plan
 * that makes setting the same list twice a no-op, and the audit claim around
 * a write that changes something.
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

const JOB = { id: "role-1", title: "Founding Engineer" };
const attr = (id: string, name: string, position: number, archived = false, description: string | null = null) => ({
  id, name, description, position, archived_at: archived ? "2026-10-01T00:00:00Z" : null,
});

describe("getScorecard", () => {
  test("a job the member cannot see is not found", async () => {
    const fake = new FakeSupabase([{ data: null }]);
    expect((await refusal(getScorecard(fake.asDb(), ctx("limited"), { jobId: "role-1" }))).code).toBe("not_found");
  });

  test("the live attributes in order, unless archived ones are asked for", async () => {
    const live = new FakeSupabase([{ data: JOB }, { data: [attr("a-1", "Systems design", 10)] }]);
    const card = await getScorecard(live.asDb(), ctx("limited"), { jobId: "role-1" });
    expect(card).toEqual({
      jobId: "role-1", jobTitle: "Founding Engineer",
      attributes: [{ attributeId: "a-1", name: "Systems design", description: null, position: 10, archived: false }],
    });
    expect(live.calls[1].filters).toContainEqual({ method: "is", column: "archived_at", value: null });

    const all = new FakeSupabase([{ data: JOB }, { data: [attr("a-2", "Taste", 20, true)] }]);
    expect((await getScorecard(all.asDb(), ctx(), { jobId: "role-1", includeArchived: true })).attributes[0].archived).toBe(true);
    expect(all.calls[1].filters.map((f) => f.method)).not.toContain("is");
  });
});

describe("setScorecard", () => {
  test("a bad list is refused before any read", async () => {
    const fake = new FakeSupabase();
    for (const attributes of [
      [{ name: "  " }],
      [{ name: "x".repeat(121) }],
      [{ name: "Communication" }, { name: " communication " }],
      Array.from({ length: 26 }, (_, i) => ({ name: `A${i}` })),
      [{ name: "Taste", description: "x".repeat(1001) }],
    ]) {
      expect((await refusal(setScorecard(fake.asDb(), ctx(), { jobId: "role-1", attributes }))).code).toBe("invalid");
    }
    expect(fake.calls).toEqual([]);
  });

  test("an interviewer is refused without a query, someone who cannot manage the job after asking", async () => {
    const limited = new FakeSupabase();
    expect((await refusal(setScorecard(limited.asDb(), ctx("limited"), { jobId: "role-1", attributes: [] }))).code).toBe("forbidden");
    expect(limited.calls).toEqual([]);

    const elevated = new FakeSupabase([{ data: JOB }, { data: false }]);
    expect((await refusal(setScorecard(elevated.asDb(), ctx("elevated"), { jobId: "role-1", attributes: [] }))).message).toMatch(/manage this job/);
    expect(rpcs(elevated)).toEqual(["can_on_role"]);
  });

  test("the same list again changes nothing and claims nothing", async () => {
    const same = new FakeSupabase([
      { data: JOB }, { data: true }, { data: [attr("a-1", "Systems design", 10), attr("a-2", "Communication", 20)] },
    ]);
    const again = await setScorecard(same.asDb(), ctx(), { jobId: "role-1", attributes: [{ name: "Systems design" }, { name: "Communication" }] });
    expect(again).toMatchObject({ outcome: "unchanged", added: [], renamed: [], restored: [], archived: [], reordered: false });
    expect(again.attributes.map((a) => a.attributeId)).toEqual(["a-1", "a-2"]);
    expect(rpcs(same)).toEqual(["can_on_role"]);
  });

  test("adds, renames, brings back, reorders and archives in one audited write", async () => {
    const fake = new FakeSupabase([
      { data: JOB }, { data: true },
      { data: [
        attr("a-1", "Systems design", 10), attr("a-2", "Communication", 20, false, "MEMBER-PROSE"),
        attr("a-3", "Taste", 30, true), attr("a-4", "Speed", 40),
      ] },
      { data: "audit-1" }, { data: null }, { data: null }, { data: null }, { data: null }, { data: null }, { data: null },
    ]);
    const r = await setScorecard(fake.asDb(), ctx(), {
      jobId: "role-1",
      attributes: [{ name: "Communication" }, { attributeId: "a-1", name: "System design" }, { name: "Taste" }, { name: "Ownership" }],
    });
    expect(r).toMatchObject({
      outcome: "updated", added: ["Ownership"], renamed: [{ from: "Systems design", to: "System design" }],
      restored: ["Taste"], archived: ["Speed"], reordered: true,
    });
    expect(r.attributes.map((a) => [a.name, a.position])).toEqual([["Communication", 10], ["System design", 20], ["Taste", 30], ["Ownership", 40]]);
    // Kept: an attribute matched by name keeps its description when none is passed.
    expect(r.attributes[0].description).toBe("MEMBER-PROSE");

    const writes = fake.calls.filter((c) => c.op === "update" || c.op === "insert");
    expect(writes.map((c) => c.args)).toEqual([
      { position: 10 },
      { name: "System design", position: 20 },
      // Taste was already at 30: only the archive mark changes.
      { archived_at: null },
      { archived_at: expect.any(String) },
      [{ id: r.attributes[3].attributeId, role_id: "role-1", name: "Ownership", description: null, position: 40 }],
    ]);
    expect(writes[3].filters).toEqual([{ method: "in", column: "id", value: ["a-4"] }]);
    // The new row is not read back: its id is made here.
    expect(writes[4].terminal).toBe("await");
    const finish = fake.calls.find((c) => c.table === "client_finish_write");
    expect(finish?.args).toMatchObject({
      p_entity_id: "role-1", p_keep: true,
      p_before: { attributes: ["Systems design", "Communication", "Speed"] },
      p_after: { attributes: ["Communication", "System design", "Taste", "Ownership"] },
    });
    expect(JSON.stringify(finish?.args)).not.toContain("MEMBER-PROSE");
  });

  test("a rename onto a name the job already has, archived or not, is a sentence", async () => {
    const fake = new FakeSupabase([{ data: JOB }, { data: true }, { data: [attr("a-1", "Systems design", 10), attr("a-3", "Taste", 30, true)] }]);
    const err = await refusal(setScorecard(fake.asDb(), ctx(), { jobId: "role-1", attributes: [{ attributeId: "a-1", name: "taste" }] }));
    expect(err.message).toMatch(/already called "Taste" \(archived\)/);
    expect(rpcs(fake)).not.toContain("client_claim_write");
  });

  test("an attribute id from another job is not found", async () => {
    const fake = new FakeSupabase([{ data: JOB }, { data: true }, { data: [attr("a-1", "Systems design", 10)] }]);
    expect((await refusal(setScorecard(fake.asDb(), ctx(), { jobId: "role-1", attributes: [{ attributeId: "a-9", name: "X" }] }))).code)
      .toBe("not_found");
  });

  test("the database's refusal of a shared name is a sentence, and the claim is given back", async () => {
    const fake = new FakeSupabase([
      { data: JOB }, { data: true }, { data: [] }, { data: "audit-1" }, { error: { code: "23505", message: "duplicate key" } }, { data: null },
    ]);
    expect((await refusal(setScorecard(fake.asDb(), ctx(), { jobId: "role-1", attributes: [{ name: "Taste" }] }))).message).toMatch(/share a name/);
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_keep: false } });
  });
});
