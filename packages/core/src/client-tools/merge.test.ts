import { describe, expect, test, vi } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import type { FileStore } from "./files.js";
import { anonymizeCandidate, confirmationFor, findDuplicates, linkedinKey, mergeCandidates } from "./merge.js";

/**
 * What the duplicate, merge and erasure tools add on top of the database
 * (pinned against real Postgres in the SQL suite's section 26 and apps/mcp's
 * client.integration.test.ts): admins only, refused before any query; the
 * grouping; a sentence for each database refusal; the audit claim around each
 * write with no one's data in it; and Storage cleaned only after the
 * database has erased the rows.
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

const KEEP = "6c1f0b4e-0000-4000-8000-000000000001";
const MERGE = "6c1f0b4e-0000-4000-8000-000000000002";

const person = (id: string, over: Record<string, unknown> = {}) => ({
  id, display_name: null, email: null, linkedin_url: null, current_title: null, current_company: null,
  created_at: "2026-10-01T00:00:00Z", applications: [{ count: 1 }], ...over,
});

describe("linkedinKey", () => {
  test("one profile however it is written; anything else is not one", () => {
    for (const url of [
      "https://www.linkedin.com/in/ada-l/", "http://linkedin.com/in/Ada-L?trk=x", "uk.linkedin.com/in/ada-l#about",
      "https://de.www.linkedin.com/in/ada-l",
    ]) {
      expect(linkedinKey(url), url).toBe("linkedin.com/in/ada-l");
    }
    expect(linkedinKey("https://linkedin.com/company/acme")).toBeNull();
    expect(linkedinKey(null)).toBeNull();
  });
});

describe("findDuplicates", () => {
  test("anyone but an admin is refused without a query", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(findDuplicates(fake.asDb(), ctx("elevated")))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });

  test("groups by email (any case, or one on file), LinkedIn profile or exact name, chained", async () => {
    const rows = [
      person("a", { display_name: "Ada Lovelace", email: "Ada@Example.com" }),
      person("b", { display_name: "A. Lovelace", email: "ada@example.com " }),
      person("c", { display_name: "Countess", linkedin_url: "https://www.linkedin.com/in/ada/" }),
      person("d", { display_name: "Countess Ada", email: "countess@example.com", linkedin_url: "linkedin.com/in/ada" }),
      person("e", { display_name: "Grace Hopper" }),
      person("f", { display_name: "  grace   hopper " }),
      person("g", { display_name: "Alone", email: "alone@example.com" }),
    ];
    // d's address is also on file for b: a, b and d are one group, c joins through d's profile.
    const fake = new FakeSupabase([{ data: rows }, { data: [{ person_id: "b", value: "countess@example.com" }] }]);
    const d = await findDuplicates(fake.asDb(), ctx());
    expect(d.truncated).toBe(false);
    expect(d.scanned).toBe(7);
    expect(d.groups.map((g) => [g.matchedOn, g.candidates.map((c) => c.candidateId)])).toEqual([
      [["email", "linkedin"], ["a", "b", "c", "d"]],
      [["name"], ["e", "f"]],
    ]);
    // A merged candidate is hidden by the policy; an anonymized one is filtered here.
    expect(fake.calls[0].filters).toEqual([{ method: "is", column: "anonymized_at", value: null }]);
  });

  test("with a candidate_id, only their group; an id they cannot see is not found", async () => {
    const rows = [person("a", { email: "x@y.z" }), person("b", { email: "X@y.z" }), person("e", { display_name: "Sam" }), person("f", { display_name: "Sam" })];
    const fake = new FakeSupabase([{ data: rows }, { data: [] }]);
    const d = await findDuplicates(fake.asDb(), ctx(), { candidateId: "e" });
    expect(d.groups.map((g) => g.candidates.map((c) => c.candidateId))).toEqual([["e", "f"]]);

    const missing = new FakeSupabase([{ data: rows }, { data: null }]);
    expect((await refusal(findDuplicates(missing.asDb(), ctx(), { candidateId: "zzz" }))).code).toBe("not_found");
  });
});

describe("mergeCandidates", () => {
  test("anyone but an admin, or the same candidate twice, is refused without a query", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(mergeCandidates(fake.asDb(), ctx("elevated"), { keepId: KEEP, mergeId: MERGE }))).message)
      .toMatch(/Only an admin at your company can merge/);
    expect((await refusal(mergeCandidates(fake.asDb(), ctx(), { keepId: KEEP, mergeId: KEEP }))).code).toBe("invalid");
    expect(fake.calls).toEqual([]);
  });

  test("a candidate the admin cannot see is not found, naming which id", async () => {
    const fake = new FakeSupabase([{ data: [{ id: KEEP, display_name: "Kim", anonymized_at: null }] }]);
    expect((await refusal(mergeCandidates(fake.asDb(), ctx(), { keepId: KEEP, mergeId: MERGE }))).message).toMatch(/merge_id/);
    expect(rpcs(fake)).toEqual([]);
  });

  test("claims, merges through the definer function, and audits ids and counts only", async () => {
    const fake = new FakeSupabase([
      { data: [{ id: KEEP, display_name: "Kim", anonymized_at: null }, { id: MERGE, display_name: "Kimberly", anonymized_at: null }] },
      { data: "audit-1" },
      { data: { applications_merged: 1, moved: { "person_notes.person_id": 2 }, left_behind: { "person_tags.person_id": 1 }, filled: ["current_title"] } },
      { data: null },
    ]);
    const r = await mergeCandidates(fake.asDb(), ctx(), { keepId: KEEP, mergeId: MERGE });
    expect(r).toMatchObject({ keepName: "Kim", mergedName: "Kimberly", applicationsMerged: 1, filled: ["current_title"] });
    expect(rpcs(fake)).toEqual(["client_claim_write", "client_merge_candidates", "client_finish_write"]);
    expect(fake.calls[1].args).toMatchObject({ p_action: "person.merge", p_entity: "person" });
    expect(fake.calls[2].args).toEqual({ p_keep: KEEP, p_merge: MERGE });
    const finish = fake.calls[3].args as Record<string, unknown>;
    expect(finish).toMatchObject({ p_entity_id: KEEP, p_keep: true });
    expect(JSON.stringify(finish)).not.toMatch(/Kim/);
  });

  test("a refusal from the database is a sentence, and the claim is given back", async () => {
    const fake = new FakeSupabase([
      { data: [{ id: KEEP, display_name: "Kim", anonymized_at: null }, { id: MERGE, display_name: "Kimberly", anonymized_at: null }] },
      { data: "audit-1" },
      { error: { code: "55000", message: "candidate already merged" } },
      { data: null },
    ]);
    expect((await refusal(mergeCandidates(fake.asDb(), ctx(), { keepId: KEEP, mergeId: MERGE }))).message).toMatch(/already merged/);
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_keep: false } });
  });
});

describe("anonymizeCandidate", () => {
  const store = (remove: FileStore["remove"]): FileStore => ({ put: async () => {}, signedUrl: async () => null, remove });
  const found = { data: [{ id: KEEP, display_name: "Kim  Lee", anonymized_at: null }] };

  test("the confirmation is ANONYMIZE and the name on file, or the id when there is none", () => {
    expect(confirmationFor({ id: KEEP, display_name: " Kim   Lee " })).toBe("ANONYMIZE Kim Lee");
    expect(confirmationFor({ id: KEEP, display_name: null })).toBe(`ANONYMIZE ${KEEP}`);
  });

  test("anyone but an admin is refused without a query; a wrong confirmation before any write, without the name", async () => {
    const none = new FakeSupabase();
    expect((await refusal(anonymizeCandidate(none.asDb(), ctx("elevated"), null, { candidateId: KEEP, confirm: "ANONYMIZE Kim Lee" }))).code)
      .toBe("forbidden");
    expect(none.calls).toEqual([]);

    const fake = new FakeSupabase([found]);
    const err = await refusal(anonymizeCandidate(fake.asDb(), ctx(), null, { candidateId: KEEP, confirm: "ANONYMIZE Kim" }));
    expect(err.code).toBe("invalid");
    expect(err.message).not.toMatch(/Lee/);
    expect(rpcs(fake)).toEqual([]);
  });

  test("files and nothing to delete them with: nothing is erased", async () => {
    const fake = new FakeSupabase([found, { count: 2 }]);
    expect((await refusal(anonymizeCandidate(fake.asDb(), ctx(), store(undefined), { candidateId: KEEP, confirm: "ANONYMIZE Kim Lee" }))).code)
      .toBe("forbidden");
    expect(rpcs(fake)).toEqual([]);
  });

  test("erases through the definer function, then the stored files, and audits counts only", async () => {
    const remove = vi.fn(async () => {});
    const fake = new FakeSupabase([
      found, { count: 1 }, { data: "audit-1" },
      { data: { anonymized: 2, removed: { notes: 3, files: 1 }, storage_paths: [`org-1/${KEEP}/f1`] } },
      { data: null },
    ]);
    const r = await anonymizeCandidate(fake.asDb(), ctx(), store(remove), { candidateId: KEEP, confirm: " ANONYMIZE Kim Lee" });
    expect(r).toEqual({ candidateId: KEEP, records: 2, removed: { notes: 3, files: 1 }, filesRemoved: 1, storage: "removed" });
    expect(remove).toHaveBeenCalledWith([`org-1/${KEEP}/f1`]);
    expect(rpcs(fake)).toEqual(["client_claim_write", "client_anonymize_candidate", "client_finish_write"]);
    expect(fake.calls.find((c) => c.table === "client_claim_write")?.args).toMatchObject({ p_action: "person.anonymize" });
    const finish = fake.calls.at(-1)!.args as Record<string, unknown>;
    expect(finish).toMatchObject({ p_entity_id: KEEP, p_keep: true, p_before: null });
    expect(JSON.stringify(finish)).not.toMatch(/Kim|ANONYMIZE|f1/);
  });

  test("a Storage failure after the erasure is reported, not thrown: the rows are already gone", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = new FakeSupabase([
      found, { count: 1 }, { data: "audit-1" },
      { data: { anonymized: 1, removed: {}, storage_paths: ["p"] } },
      { data: null },
    ]);
    const r = await anonymizeCandidate(fake.asDb(), ctx(), store(async () => {
      throw new Error("storage down");
    }), { candidateId: KEEP, confirm: "ANONYMIZE Kim Lee" });
    expect(r).toMatchObject({ storage: "failed", filesRemoved: 0 });
  });

  test("an already anonymized candidate is refused", async () => {
    const fake = new FakeSupabase([{ data: [{ id: KEEP, display_name: "Anonymized candidate", anonymized_at: "2026-10-15T00:00:00Z" }] }]);
    expect((await refusal(anonymizeCandidate(fake.asDb(), ctx(), null, { candidateId: KEEP, confirm: "ANONYMIZE Anonymized candidate" }))).message)
      .toMatch(/already anonymized/);
  });
});
