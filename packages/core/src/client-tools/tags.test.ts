import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { searchCandidates } from "./reads.js";
import { archiveTag, createTag, listTags, tagCandidate, untagCandidate } from "./tags.js";

/**
 * What the tag tools add on top of the policies (pinned against real
 * Postgres in the SQL suite and apps/mcp's client.integration.test.ts): a
 * sentence before a refused write, the audit claim around an allowed one, a
 * tag found by id or by name ignoring case, and no claim for a no-op.
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

const STRONG = { id: "6c1f0b4e-0000-4000-8000-000000000001", name: "Strong", archived_at: null };
const OLD = { id: "6c1f0b4e-0000-4000-8000-000000000002", name: "Old", archived_at: "2026-10-01T00:00:00Z" };

describe("listTags", () => {
  test("an interviewer is refused without a query", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(listTags(fake.asDb(), ctx("limited")))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });

  test("live tags with how many candidates the member can see on each; archived ones on request", async () => {
    const fake = new FakeSupabase([{ data: [{ ...STRONG, person_tags: [{ count: 3 }] }] }, { data: [] }]);
    expect(await listTags(fake.asDb(), ctx("elevated"))).toEqual([{ tagId: STRONG.id, name: "Strong", archived: false, candidates: 3 }]);
    expect(fake.calls[0].filters).toEqual([{ method: "is", column: "archived_at", value: null }]);
    await listTags(fake.asDb(), ctx(), { includeArchived: true });
    expect(fake.calls[1].filters).toEqual([]);
  });
});

describe("createTag", () => {
  test("an empty or oversized name is refused before any read", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(createTag(fake.asDb(), ctx(), { name: "   " }))).code).toBe("invalid");
    expect((await refusal(createTag(fake.asDb(), ctx(), { name: "x".repeat(61) }))).code).toBe("invalid");
    expect(fake.calls).toEqual([]);
  });

  test("a name already there, ignoring case, is answered with and nothing is claimed", async () => {
    const fake = new FakeSupabase([{ data: [STRONG] }]);
    expect(await createTag(fake.asDb(), ctx(), { name: "  strong " })).toEqual({ outcome: "exists", tagId: STRONG.id, name: "Strong" });
    expect(rpcs(fake)).toEqual([]);
  });

  test("someone who cannot add candidates cannot make one", async () => {
    const fake = new FakeSupabase([{ data: [] }, { data: false }]);
    expect((await refusal(createTag(fake.asDb(), ctx("elevated"), { name: "Fast mover" }))).code).toBe("forbidden");
    expect(rpcs(fake)).toEqual(["can_add_people"]);
  });

  test("a new tag gets its id in code, is not read back, and is audited", async () => {
    const fake = new FakeSupabase([{ data: [STRONG] }, { data: true }, { data: "audit-1" }, { data: null }, { data: null }]);
    const r = await createTag(fake.asDb(), ctx("elevated"), { name: "Fast   mover" });
    expect(r).toMatchObject({ outcome: "created", name: "Fast mover" });
    const insert = fake.calls.find((c) => c.op === "insert");
    expect(insert).toMatchObject({ table: "tags", args: { id: r.tagId, name: "Fast mover" }, terminal: "await" });
    expect(fake.calls.at(-1)).toMatchObject({
      table: "client_finish_write", args: { p_entity_id: r.tagId, p_after: { name: "Fast mover" }, p_keep: true },
    });
  });

  test("an archived name: an admin brings it back, anyone else is told to ask one", async () => {
    const member = new FakeSupabase([{ data: [OLD] }]);
    expect((await refusal(createTag(member.asDb(), ctx("elevated"), { name: "old" }))).message).toMatch(/archived/);
    expect(rpcs(member)).toEqual([]);

    const admin = new FakeSupabase([{ data: [OLD] }, { data: "audit-1" }, { data: [{ id: OLD.id }] }, { data: null }]);
    expect(await createTag(admin.asDb(), ctx(), { name: "old" })).toEqual({ outcome: "restored", tagId: OLD.id, name: "Old" });
    expect(admin.calls.find((c) => c.op === "update")).toMatchObject({ table: "tags", args: { archived_at: null } });
  });
});

describe("archiveTag", () => {
  test("admins only, asked before any read", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(archiveTag(fake.asDb(), ctx("elevated"), { tag: "Strong" }))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });

  test("conditional on its still being live, so two archives record one", async () => {
    const fake = new FakeSupabase([{ data: [STRONG] }, { data: "audit-1" }, { data: [] }, { data: null }]);
    expect(await archiveTag(fake.asDb(), ctx(), { tag: STRONG.id })).toEqual({ outcome: "unchanged", tagId: STRONG.id, name: "Strong" });
    expect(fake.calls.find((c) => c.op === "update")?.filters).toEqual([
      { method: "eq", column: "id", value: STRONG.id }, { method: "is", column: "archived_at", value: null },
    ]);
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_keep: false } });
  });
});

describe("tagCandidate", () => {
  test("an interviewer is refused without a query", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(tagCandidate(fake.asDb(), ctx("limited"), { candidateId: "p-1", tag: "Strong" }))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });

  test("an unknown tag and an archived one are each a sentence, before the candidate is read", async () => {
    const unknown = new FakeSupabase([{ data: [STRONG] }]);
    expect((await refusal(tagCandidate(unknown.asDb(), ctx(), { candidateId: "p-1", tag: "Nope" }))).message).toMatch(/create_tag/);
    const archived = new FakeSupabase([{ data: [OLD] }]);
    const err = await refusal(tagCandidate(archived.asDb(), ctx(), { candidateId: "p-1", tag: "Old" }));
    expect(err.message).toMatch(/archived/);
    // A tag's name is member-written; a refusal goes back unfenced, so it does not carry it.
    expect(err.message).not.toContain("Old");
    expect([...unknown.calls, ...archived.calls].map((c) => c.table)).toEqual(["tags", "tags"]);
  });

  test("a candidate the member can see but not change is told so, and nothing is claimed", async () => {
    const fake = new FakeSupabase([{ data: [STRONG] }, { data: { id: "p-1" } }, { data: false }]);
    expect((await refusal(tagCandidate(fake.asDb(), ctx("elevated"), { candidateId: "p-1", tag: "Strong" }))).code).toBe("forbidden");
    expect(rpcs(fake)).toEqual(["can_edit_person"]);
  });

  test("a tag found by name ignoring case goes on with its own id, as the member, audited", async () => {
    const fake = new FakeSupabase([
      { data: [STRONG] }, { data: { id: "p-1" } }, { data: true }, { data: null },
      { data: "audit-1" }, { data: null }, { data: null },
    ]);
    expect(await tagCandidate(fake.asDb(), ctx(), { candidateId: "p-1", tag: "STRONG" }))
      .toEqual({ outcome: "tagged", tagId: STRONG.id, tag: "Strong" });
    const insert = fake.calls.find((c) => c.op === "insert");
    expect(insert).toMatchObject({
      table: "person_tags", args: { person_id: "p-1", tag_id: STRONG.id, added_by_actor_id: "actor-1" }, terminal: "await",
    });
    expect((insert?.args as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/);
    expect(fake.calls.find((c) => c.table === "client_claim_write")?.args).toMatchObject({ p_action: "tag.add", p_entity: "person" });
  });

  test("already tagged claims nothing; tagged by someone else meanwhile gives the claim back", async () => {
    const there = new FakeSupabase([{ data: [STRONG] }, { data: { id: "p-1" } }, { data: true }, { data: { id: "pt-1" } }]);
    expect((await tagCandidate(there.asDb(), ctx(), { candidateId: "p-1", tag: STRONG.id })).outcome).toBe("already_tagged");
    expect(rpcs(there)).toEqual(["can_edit_person"]);

    const raced = new FakeSupabase([
      { data: [STRONG] }, { data: { id: "p-1" } }, { data: true }, { data: null },
      { data: "audit-1" }, { error: { code: "23505", message: "duplicate key" } }, { data: null },
    ]);
    expect((await tagCandidate(raced.asDb(), ctx(), { candidateId: "p-1", tag: "Strong" })).outcome).toBe("already_tagged");
    expect(raced.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_keep: false } });
  });
});

describe("untagCandidate", () => {
  test("a tag they do not have claims nothing", async () => {
    const fake = new FakeSupabase([{ data: [STRONG] }, { data: { id: "p-1" } }, { data: true }, { data: null }]);
    expect(await untagCandidate(fake.asDb(), ctx(), { candidateId: "p-1", tag: "Strong" }))
      .toEqual({ outcome: "not_tagged", tagId: STRONG.id, tag: "Strong" });
    expect(rpcs(fake)).toEqual(["can_edit_person"]);
  });

  test("an archived tag still comes off, by the row's id, audited", async () => {
    const fake = new FakeSupabase([
      { data: [OLD] }, { data: { id: "p-1" } }, { data: true }, { data: { id: "pt-9" } },
      { data: "audit-1" }, { data: [{ id: "pt-9" }] }, { data: null },
    ]);
    expect((await untagCandidate(fake.asDb(), ctx(), { candidateId: "p-1", tag: "old" })).outcome).toBe("untagged");
    expect(fake.calls.find((c) => c.op === "delete")?.filters).toEqual([{ method: "eq", column: "id", value: "pt-9" }]);
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_before: { tag_id: OLD.id }, p_keep: true } });
  });
});

describe("searchCandidates by tag", () => {
  test("narrows to the people carrying it, inside the job when both are given", async () => {
    const fake = new FakeSupabase([
      { data: [{ person_id: "p-1" }, { person_id: "p-2" }] },
      { data: [STRONG] }, { data: [{ person_id: "p-2" }, { person_id: "p-3" }] },
      { data: [] },
    ]);
    await searchCandidates(fake.asDb(), ctx(), { jobId: "role-1", tag: "strong" });
    expect(fake.calls[2]).toMatchObject({ table: "person_tags", filters: [{ method: "eq", column: "tag_id", value: STRONG.id }] });
    expect(fake.calls[3].filters).toEqual([{ method: "in", column: "id", value: ["p-2"] }]);
  });

  test("an unknown tag is a sentence; an interviewer has no tags to search by", async () => {
    expect((await refusal(searchCandidates(new FakeSupabase([{ data: [] }]).asDb(), ctx(), { tag: "nope" }))).code).toBe("not_found");
    const fake = new FakeSupabase();
    expect((await refusal(searchCandidates(fake.asDb(), ctx("limited"), { tag: "Strong" }))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });
});
