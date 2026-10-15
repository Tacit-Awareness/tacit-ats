import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { addOpenings, closeOpening, listOpenings } from "./openings.js";
import { updateStage } from "./writes.js";

/**
 * What the openings tools add on top of the policies and the database's
 * filling (pinned against real Postgres in the SQL suite's section 23 and
 * apps/mcp's client.integration.test.ts): a sentence before a refused write,
 * the claim around an allowed one, new ids made in code with the numbers read
 * afterwards, and a hire reporting the opening it filled.
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

const JOB = { id: "role-1", title: "SRE", status: "open" };
const row = (id: string, number: number, status: string, extra: Record<string, unknown> = {}) => ({
  id, number, opening_code: null, status, target_start_date: null, close_reason: null, filled_by_application_id: null,
  filled_at: null, closed_at: null, applications: null, ...extra,
});

describe("listOpenings", () => {
  test("an interviewer is refused without a query; a job the member cannot see is not found", async () => {
    const fake = new FakeSupabase([{ data: null }]);
    expect((await refusal(listOpenings(fake.asDb(), ctx("limited"), { jobId: "role-1" }))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
    expect((await refusal(listOpenings(fake.asDb(), ctx(), { jobId: "role-x" }))).code).toBe("not_found");
  });

  test("counts every opening, lists the status asked for, and names who filled one", async () => {
    const fake = new FakeSupabase([{ data: JOB }, { data: [
      row("o-1", 1, "filled", { filled_by_application_id: "app-1", applications: { person_id: "p-1", people: { display_name: "Pat" } } }),
      row("o-2", 2, "open"),
      row("o-3", 3, "closed", { close_reason: "Budget" }),
    ] }]);
    const r = await listOpenings(fake.asDb(), ctx("elevated"), { jobId: "role-1", status: "filled" });
    expect(r.counts).toEqual({ open: 1, filled: 1, closed: 1 });
    expect(r.openings).toEqual([expect.objectContaining({ openingId: "o-1", filledByCandidateId: "p-1", filledByName: "Pat" })]);
  });
});

describe("addOpenings", () => {
  test("bad counts, codes and dates are refused before any read", async () => {
    const fake = new FakeSupabase();
    for (const input of [
      { jobId: "role-1", count: 0 }, { jobId: "role-1", count: 51 }, { jobId: "role-1", count: 2, codes: ["A"] },
      { jobId: "role-1", codes: ["A", "a"] }, { jobId: "role-1", targetStartDate: "2026-02-30" },
    ]) {
      expect((await refusal(addOpenings(fake.asDb(), ctx(), input))).code).toBe("invalid");
    }
    expect(fake.calls).toEqual([]);
  });

  test("someone who cannot manage the job is told so, and nothing is claimed", async () => {
    const fake = new FakeSupabase([{ data: JOB }, { data: false }]);
    expect((await refusal(addOpenings(fake.asDb(), ctx("elevated"), { jobId: "role-1", count: 2 }))).code).toBe("forbidden");
    expect(rpcs(fake)).toEqual(["can_on_role"]);
  });

  test("ids made in code, one insert, then the numbers read back separately", async () => {
    const fake = new FakeSupabase([
      { data: JOB }, { data: true }, { data: "audit-1" }, { data: null }, { data: null },
      { data: JOB }, { data: [] },
    ]);
    const insertIds: string[] = [];
    const r = await addOpenings(fake.asDb(), ctx(), { jobId: "role-1", codes: ["ENG-7", "ENG-8"], targetStartDate: "2026-12-01" });
    const insert = fake.calls.find((c) => c.table === "openings" && c.op === "insert")!;
    for (const o of insert.args as Array<{ id: string }>) insertIds.push(o.id);
    expect(insert.args).toEqual([
      { id: expect.any(String), role_id: "role-1", opening_code: "ENG-7", target_start_date: "2026-12-01" },
      { id: expect.any(String), role_id: "role-1", opening_code: "ENG-8", target_start_date: "2026-12-01" },
    ]);
    expect(insert.terminal).toBe("await");
    expect(fake.calls.find((c) => c.table === "client_finish_write")?.args).toMatchObject({
      p_entity_id: "role-1", p_after: { opening_ids: insertIds, count: 2, codes: ["ENG-7", "ENG-8"] }, p_keep: true,
    });
    expect(r.jobStatus).toBe("open");
  });

  test("a code already used is a sentence, and the claim is given back", async () => {
    const fake = new FakeSupabase([
      { data: JOB }, { data: true }, { data: "audit-1" }, { error: { code: "23505", message: "dup" } }, { data: null },
    ]);
    expect((await refusal(addOpenings(fake.asDb(), ctx(), { jobId: "role-1", codes: ["ENG-1"] }))).message).toMatch(/already used/);
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_keep: false } });
  });
});

describe("closeOpening", () => {
  const OPENING = { id: "o-2", role_id: "role-1", number: 2, status: "open" };

  test("a blank reason is refused first; an unknown opening is not found", async () => {
    const fake = new FakeSupabase([{ data: null }]);
    expect((await refusal(closeOpening(fake.asDb(), ctx(), { openingId: "o-2", reason: "  " }))).code).toBe("invalid");
    expect(fake.calls).toEqual([]);
    expect((await refusal(closeOpening(fake.asDb(), ctx(), { openingId: "o-x", reason: "Budget" }))).code).toBe("not_found");
  });

  test("a filled opening is not closed", async () => {
    const fake = new FakeSupabase([{ data: { ...OPENING, status: "filled" } }, { data: true }]);
    expect((await refusal(closeOpening(fake.asDb(), ctx(), { openingId: "o-2", reason: "Budget" }))).message).toMatch(/filled/);
    expect(rpcs(fake)).toEqual(["can_on_role"]);
  });

  test("closed conditionally on its still being open; the reason stays out of the audit row", async () => {
    const fake = new FakeSupabase([
      { data: OPENING }, { data: true }, { data: "audit-1" }, { data: [{ id: "o-2" }] }, { data: null },
      { data: [{ status: "closed" }, { status: "open" }] },
    ]);
    const r = await closeOpening(fake.asDb(), ctx(), { openingId: "o-2", reason: " Budget  moved " });
    expect(r).toEqual({ outcome: "closed", openingId: "o-2", jobId: "role-1", number: 2, counts: { open: 1, filled: 0, closed: 1 } });
    const update = fake.calls.find((c) => c.op === "update")!;
    expect(update.args).toEqual({ status: "closed", close_reason: "Budget moved" });
    expect(update.filters).toEqual([{ method: "eq", column: "id", value: "o-2" }, { method: "eq", column: "status", value: "open" }]);
    expect(JSON.stringify(fake.calls.find((c) => c.table === "client_finish_write")?.args)).not.toContain("Budget");
  });

  test("an opening already closed changes nothing and claims nothing", async () => {
    const fake = new FakeSupabase([{ data: { ...OPENING, status: "closed" } }, { data: true }, { data: [{ status: "closed" }] }]);
    expect((await closeOpening(fake.asDb(), ctx(), { openingId: "o-2", reason: "Budget" })).outcome).toBe("unchanged");
    expect(rpcs(fake)).toEqual(["can_on_role"]);
  });
});

describe("a move to hired", () => {
  const APP = { id: "app-1", stage: "offer", role_id: "role-1", added_by_actor_id: "actor-2" };

  test("reports the opening the database filled, how many are left and the job's status", async () => {
    const fake = new FakeSupabase([
      { data: APP }, { data: true },
      { data: "audit-1" },
      // moveStage: read, conditional update, event, the funnel read (not Tacit's org: nothing to advance); the finish.
      { data: { stage: "offer" } }, { data: [{ id: "app-1" }] }, { data: null }, { data: null },
      { data: null },
      { data: { id: "o-1", number: 1, opening_code: "ENG-1" } },
      { data: [] }, { data: { status: "filled" } },
    ]);
    const r = await updateStage(fake.asDb(), ctx(), { applicationId: "app-1", stage: "hired" });
    expect(r).toEqual({
      outcome: "moved", stage: "hired", reason: null,
      opening: { openingId: "o-1", number: 1, code: "ENG-1", openLeft: 0, jobStatus: "filled" },
    });
    expect(fake.calls.find((c) => c.table === "openings")?.filters).toEqual([
      { method: "eq", column: "filled_by_application_id", value: "app-1" },
    ]);
  });

  test("a move to anything else reads no opening", async () => {
    const fake = new FakeSupabase([
      { data: APP }, { data: true }, { data: "audit-1" },
      { data: { stage: "offer" } }, { data: [{ id: "app-1" }] }, { data: null }, { data: null },
    ]);
    expect(await updateStage(fake.asDb(), ctx(), { applicationId: "app-1", stage: "interviewing" }))
      .toEqual({ outcome: "moved", stage: "interviewing", reason: null });
    expect(fake.calls.map((c) => c.table)).not.toContain("openings");
  });
});
