import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import {
  addProspect, addToPool, archivePool, convertProspect, createPool, listPool, listPools, removeFromPool,
} from "./pools.js";
import { searchCandidates } from "./reads.js";

/**
 * What the prospect and pool tools add on top of the policies (pinned against
 * real Postgres in the SQL suite's section 24 and apps/mcp's
 * client.integration.test.ts): a sentence before a refused write, the audit
 * claim around an allowed one, a pool found by id or by name ignoring case,
 * no claim for a no-op, and new rows given their id in code.
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

const STAFF = { id: "7d1f0b4e-0000-4000-8000-000000000001", name: "Staff engineers", archived_at: null };
const OLD = { id: "7d1f0b4e-0000-4000-8000-000000000002", name: "Old", archived_at: "2026-10-01T00:00:00Z" };
const PERSON = "8e2f0b4e-0000-4000-8000-000000000001";
const JOB = "9f3f0b4e-0000-4000-8000-000000000001";

describe("interviewers", () => {
  test("are refused every pool and prospect tool without a query", async () => {
    const fake = new FakeSupabase();
    const db = fake.asDb();
    const limited = ctx("limited");
    for (const call of [
      listPools(db, limited),
      createPool(db, limited, { name: "Mine" }),
      addToPool(db, limited, { candidateId: PERSON, pool: "Staff engineers" }),
      removeFromPool(db, limited, { candidateId: PERSON, pool: "Staff engineers" }),
      listPool(db, limited, { pool: "Staff engineers" }),
      addProspect(db, limited, { name: "Pat" }),
      convertProspect(db, limited, { candidateId: PERSON, jobId: JOB }),
      searchCandidates(db, limited, { prospectsOnly: true }),
      searchCandidates(db, limited, { pool: "Staff engineers" }),
    ]) {
      expect((await refusal(call)).code).toBe("forbidden");
    }
    expect(fake.calls).toEqual([]);
  });
});

describe("pools", () => {
  test("listPools: live pools with how many people the member can see; archived ones on request", async () => {
    const fake = new FakeSupabase([{ data: [{ ...STAFF, pool_memberships: [{ count: 4 }] }] }, { data: [] }]);
    expect(await listPools(fake.asDb(), ctx("elevated"))).toEqual([{ poolId: STAFF.id, name: "Staff engineers", archived: false, members: 4 }]);
    expect(fake.calls[0].filters).toEqual([{ method: "is", column: "archived_at", value: null }]);
    await listPools(fake.asDb(), ctx(), { includeArchived: true });
    expect(fake.calls[1].filters).toEqual([]);
  });

  test("createPool: a bad name is refused before any read; an existing one is answered with, unclaimed", async () => {
    const fake = new FakeSupabase([{ data: [STAFF] }]);
    expect((await refusal(createPool(fake.asDb(), ctx(), { name: "  " }))).code).toBe("invalid");
    expect((await refusal(createPool(fake.asDb(), ctx(), { name: "x".repeat(81) }))).code).toBe("invalid");
    expect(fake.calls).toEqual([]);
    expect(await createPool(fake.asDb(), ctx(), { name: "STAFF   engineers" })).toEqual({ outcome: "exists", poolId: STAFF.id, name: "Staff engineers" });
    expect(rpcs(fake)).toEqual([]);
  });

  test("createPool: someone who cannot add candidates is refused; a new pool gets its id in code and is audited", async () => {
    const refused = new FakeSupabase([{ data: [] }, { data: false }]);
    expect((await refusal(createPool(refused.asDb(), ctx("elevated"), { name: "Designers" }))).code).toBe("forbidden");

    const fake = new FakeSupabase([{ data: [] }, { data: true }, { data: "audit-1" }, { data: null }, { data: null }]);
    const r = await createPool(fake.asDb(), ctx("elevated"), { name: "Designers" });
    expect(r).toMatchObject({ outcome: "created", name: "Designers" });
    expect(fake.calls.find((c) => c.op === "insert")).toMatchObject({ table: "talent_pools", args: { id: r.poolId, name: "Designers" }, terminal: "await" });
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_entity_id: r.poolId, p_keep: true } });
  });

  test("createPool: an archived name is restored by an admin, refused for anyone else", async () => {
    const member = new FakeSupabase([{ data: [OLD] }]);
    expect((await refusal(createPool(member.asDb(), ctx("elevated"), { name: "old" }))).message).toMatch(/archived/);
    const admin = new FakeSupabase([{ data: [OLD] }, { data: "audit-1" }, { data: [{ id: OLD.id }] }, { data: null }]);
    expect(await createPool(admin.asDb(), ctx(), { name: "old" })).toEqual({ outcome: "restored", poolId: OLD.id, name: "Old" });
  });

  test("archivePool: admins only, and an unknown pool is not found", async () => {
    const fake = new FakeSupabase([{ data: [STAFF] }]);
    expect((await refusal(archivePool(fake.asDb(), ctx("elevated"), { pool: "Staff engineers" }))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
    expect((await refusal(archivePool(fake.asDb(), ctx(), { pool: "Nope" }))).code).toBe("not_found");
  });
});

describe("people in pools", () => {
  test("a bad stage is refused before any read", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(addToPool(fake.asDb(), ctx(), { candidateId: PERSON, pool: "x", stage: "hired" }))).code).toBe("invalid");
    expect(fake.calls).toEqual([]);
  });

  test("someone the member cannot see, or who cannot work pools, is refused before a claim", async () => {
    const unseen = new FakeSupabase([{ data: [STAFF] }, { data: null }]);
    expect((await refusal(addToPool(unseen.asDb(), ctx(), { candidateId: PERSON, pool: STAFF.id }))).code).toBe("not_found");
    const cannot = new FakeSupabase([{ data: [STAFF] }, { data: { id: PERSON } }, { data: false }]);
    expect((await refusal(addToPool(cannot.asDb(), ctx("elevated"), { candidateId: PERSON, pool: "staff engineers" }))).code).toBe("forbidden");
    expect(rpcs(cannot)).toEqual(["can_add_people"]);
  });

  test("a new member of a pool is inserted under an id made in code, at new unless told", async () => {
    const fake = new FakeSupabase([
      { data: [STAFF] }, { data: { id: PERSON } }, { data: true }, { data: null },
      { data: "audit-1" }, { data: null }, { data: null },
    ]);
    expect(await addToPool(fake.asDb(), ctx("elevated"), { candidateId: PERSON, pool: "Staff engineers" }))
      .toEqual({ outcome: "added", poolId: STAFF.id, pool: "Staff engineers", stage: "new" });
    const insert = fake.calls.find((c) => c.op === "insert");
    expect(insert).toMatchObject({
      table: "pool_memberships", args: { pool_id: STAFF.id, person_id: PERSON, stage: "new", added_by_actor_id: "actor-1" }, terminal: "await",
    });
    expect((insert!.args as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("already in the pool: nothing claimed without a stage; with one, a move conditional on the stage read", async () => {
    const same = new FakeSupabase([{ data: [STAFF] }, { data: { id: PERSON } }, { data: true }, { data: { id: "m-1", stage: "new" } }]);
    expect((await addToPool(same.asDb(), ctx(), { candidateId: PERSON, pool: "Staff engineers" })).outcome).toBe("already_in_pool");
    expect(rpcs(same)).toEqual(["can_add_people"]);

    const move = new FakeSupabase([
      { data: [STAFF] }, { data: { id: PERSON } }, { data: true }, { data: { id: "m-1", stage: "new" } },
      { data: "audit-1" }, { data: [{ id: "m-1" }] }, { data: null },
    ]);
    expect(await addToPool(move.asDb(), ctx(), { candidateId: PERSON, pool: "Staff engineers", stage: "engaged" }))
      .toEqual({ outcome: "stage_changed", poolId: STAFF.id, pool: "Staff engineers", stage: "engaged" });
    const update = move.calls.find((c) => c.op === "update");
    expect(update).toMatchObject({ table: "pool_memberships", args: { stage: "engaged" } });
    expect(update!.filters).toEqual([{ method: "eq", column: "id", value: "m-1" }, { method: "eq", column: "stage", value: "new" }]);
  });

  test("an archived pool takes no one new", async () => {
    const fake = new FakeSupabase([{ data: [OLD] }, { data: { id: PERSON } }, { data: true }, { data: null }]);
    expect((await refusal(addToPool(fake.asDb(), ctx(), { candidateId: PERSON, pool: "Old" }))).message).toMatch(/archived/);
    expect(rpcs(fake)).toEqual(["can_add_people"]);
  });

  test("removeFromPool: not in it is a no-op; in it is a delete of that row", async () => {
    const none = new FakeSupabase([{ data: [STAFF] }, { data: { id: PERSON } }, { data: true }, { data: null }]);
    expect((await removeFromPool(none.asDb(), ctx(), { candidateId: PERSON, pool: STAFF.id })).outcome).toBe("not_in_pool");
    const there = new FakeSupabase([
      { data: [STAFF] }, { data: { id: PERSON } }, { data: true }, { data: { id: "m-1", stage: "engaged" } },
      { data: "audit-1" }, { data: [{ id: "m-1" }] }, { data: null },
    ]);
    expect(await removeFromPool(there.asDb(), ctx(), { candidateId: PERSON, pool: STAFF.id }))
      .toEqual({ outcome: "removed", poolId: STAFF.id, pool: "Staff engineers", stage: null });
    expect(there.calls.find((c) => c.op === "delete")!.filters).toEqual([{ method: "eq", column: "id", value: "m-1" }]);
  });

  test("listPool: the members the member can read, with their stage and how many jobs they are in", async () => {
    const fake = new FakeSupabase([
      { data: [STAFF] },
      {
        data: [{
          person_id: PERSON, stage: "contacted", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z",
          people: { display_name: "Pat", current_title: "Staff Engineer", current_company: "Initech", applications: [{ count: 0 }] },
        }],
      },
    ]);
    const view = await listPool(fake.asDb(), ctx("elevated"), { pool: "staff engineers", stage: "contacted" });
    expect(view).toEqual({
      poolId: STAFF.id, name: "Staff engineers", archived: false,
      members: [{
        candidateId: PERSON, name: "Pat", headline: "Staff Engineer at Initech", stage: "contacted", jobs: 0,
        addedAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z",
      }],
    });
    expect(fake.calls[1].filters).toEqual([
      { method: "eq", column: "pool_id", value: STAFF.id }, { method: "eq", column: "stage", value: "contacted" },
    ]);
  });
});

describe("prospects", () => {
  test("a bad email or source is refused before any query", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(addProspect(fake.asDb(), ctx(), { name: "Pat", email: "not an email" }))).code).toBe("invalid");
    expect((await refusal(addProspect(fake.asDb(), ctx(), { name: "Pat", source: "linkedin" }))).code).toBe("invalid");
    expect((await refusal(addProspect(fake.asDb(), ctx(), { name: "  " }))).code).toBe("invalid");
    expect(fake.calls).toEqual([]);
  });

  test("someone who cannot add candidates is refused", async () => {
    const fake = new FakeSupabase([{ data: false }]);
    expect((await refusal(addProspect(fake.asDb(), ctx("elevated"), { name: "Pat" }))).code).toBe("forbidden");
  });

  test("a new prospect: their row under an id made in code, in the member's org, with the source; the detail stays out of the audit", async () => {
    const fake = new FakeSupabase([
      { data: true }, { data: null }, { data: "audit-1" }, { data: null }, { data: null },
    ]);
    const r = await addProspect(fake.asDb(), ctx("elevated"), {
      name: " Pat   Prospect ", email: "PAT@example.com", source: "referral", sourceDetail: "Ada Lovelace",
    });
    expect(r).toMatchObject({ outcome: "added", pool: null });
    const insert = fake.calls.find((c) => c.op === "insert");
    expect(insert).toMatchObject({
      table: "people",
      args: {
        id: r.candidateId, org_id: "org-1", display_name: "Pat Prospect", email: "pat@example.com", linkedin_url: null,
        added_by_actor_id: "actor-1", prospect_source: "referral", prospect_source_detail: "Ada Lovelace",
      },
      terminal: "await",
    });
    const finish = fake.calls.at(-1)!;
    expect(finish).toMatchObject({ table: "client_finish_write", args: { p_entity_id: r.candidateId, p_keep: true } });
    expect(JSON.stringify(finish.args)).not.toContain("Ada");
  });

  test("an email already on file is reused, not duplicated or changed, and put in the pool asked for", async () => {
    const fake = new FakeSupabase([
      { data: true }, { data: [STAFF] }, { data: { person_id: PERSON } },
      { data: null }, { data: "audit-1" }, { data: null }, { data: null },
    ]);
    const r = await addProspect(fake.asDb(), ctx(), { name: "Pat", email: "pat@example.com", pool: "Staff engineers" });
    expect(r).toEqual({
      outcome: "exists", candidateId: PERSON, pool: { outcome: "added", poolId: STAFF.id, pool: "Staff engineers", stage: "new" },
    });
    expect(fake.calls.filter((c) => c.op === "insert").map((c) => c.table)).toEqual(["pool_memberships"]);
  });

  test("an unknown or archived pool is refused before anyone is added", async () => {
    const unknown = new FakeSupabase([{ data: true }, { data: [] }]);
    expect((await refusal(addProspect(unknown.asDb(), ctx(), { name: "Pat", pool: "Nope" }))).code).toBe("not_found");
    const archived = new FakeSupabase([{ data: true }, { data: [OLD] }]);
    expect((await refusal(addProspect(archived.asDb(), ctx(), { name: "Pat", pool: "Old" }))).code).toBe("invalid");
    expect([...unknown.calls, ...archived.calls].some((c) => c.op === "insert")).toBe(false);
  });

  test("convertProspect: someone unseen is not found; a job without pipeline access is refused", async () => {
    const unseen = new FakeSupabase([{ data: null }]);
    expect((await refusal(convertProspect(unseen.asDb(), ctx(), { candidateId: PERSON, jobId: JOB }))).code).toBe("not_found");
    const noAccess = new FakeSupabase([{ data: { id: PERSON, prospect_source: null, prospect_source_detail: null } }, { data: false }]);
    expect((await refusal(convertProspect(noAccess.asDb(), ctx("elevated"), { candidateId: PERSON, jobId: JOB }))).code).toBe("forbidden");
    expect(rpcs(noAccess)).toEqual(["can_on_role"]);
  });

  test("convertProspect: the application carries the prospect's source, unless one is given", async () => {
    const script = () => [
      { data: { id: PERSON, prospect_source: "referral", prospect_source_detail: "Ada" } }, { data: true },
      { data: "audit-1" }, { data: { id: "app-1" } }, { data: null }, { data: null }, { data: null },
      // addToPipeline's submission check: a client org's own job is never sent on.
      { data: { org_id: "org-acme" } },
    ];
    const kept = new FakeSupabase(script());
    expect(await convertProspect(kept.asDb(), ctx(), { candidateId: PERSON, jobId: JOB }))
      .toEqual({ outcome: "added", applicationId: "app-1", candidateId: PERSON, stage: "sourced", source: "referral" });
    expect(kept.calls.find((c) => c.op === "insert")).toMatchObject({
      table: "applications", args: { person_id: PERSON, role_id: JOB, source: "referral", source_detail: "Ada", added_by_actor_id: "actor-1" },
    });

    const given = new FakeSupabase(script());
    await convertProspect(given.asDb(), ctx(), { candidateId: PERSON, jobId: JOB, source: "event" });
    const args = given.calls.find((c) => c.op === "insert")!.args as Record<string, unknown>;
    expect(args.source).toBe("event");
    expect(args).not.toHaveProperty("source_detail");
  });
});

describe("searchCandidates", () => {
  test("pool narrows to its members, and an unknown pool is not found", async () => {
    const fake = new FakeSupabase([{ data: [STAFF] }, { data: [{ person_id: PERSON }] }, { data: [] }]);
    await searchCandidates(fake.asDb(), ctx(), { pool: "staff engineers" });
    expect(fake.calls[2].filters).toEqual([{ method: "in", column: "id", value: [PERSON] }]);
    expect((await refusal(searchCandidates(new FakeSupabase([{ data: [] }]).asDb(), ctx(), { pool: "nope" }))).code).toBe("not_found");
  });

  test("prospects_only keeps people in no job, as the database says", async () => {
    const row = (id: string, apps: number) => ({
      id, display_name: id, current_title: null, current_company: null,
      applications: Array.from({ length: apps }, (_, i) => ({ id: `a${i}`, role_id: "r", stage: "sourced", roles: null })),
    });
    const fake = new FakeSupabase([
      { data: [row("in-a-job", 1), row("hidden-job", 0), row("prospect", 0)] },
      { data: false }, { data: true },
    ]);
    const hits = await searchCandidates(fake.asDb(), ctx(), { prospectsOnly: true });
    expect(hits.map((h) => h.candidateId)).toEqual(["prospect"]);
    expect(fake.calls.filter((c) => c.op === "rpc").map((c) => c.args)).toEqual([{ p_person: "hidden-job" }, { p_person: "prospect" }]);
    expect(await searchCandidates(new FakeSupabase().asDb(), ctx(), { prospectsOnly: true, jobId: JOB })).toEqual([]);
  });
});
