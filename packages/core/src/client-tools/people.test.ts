import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { findOrAddPerson, findPersonByEmail, isUniqueViolation, normalizeEmail } from "./people.js";
import { addProspect } from "./pools.js";
import { addCandidate } from "./writes.js";

/**
 * Find-or-create by email: one normalisation, the identifier always claimed,
 * and a lost race (a unique violation, or the identifier owned by someone
 * else) reusing the person who won rather than failing or duplicating. The
 * race itself needs real Postgres; this pins what the code does with each
 * answer the database can give.
 */

const ctx = (accessLevel: ClientToolCtx["accessLevel"] = "admin"): ClientToolCtx => ({
  actorId: "actor-1", orgId: "org-1", accessLevel, source: "claude",
});
const WINNER = "8e2f0b4e-0000-4000-8000-0000000000aa";
const DUP = { code: "23505", message: 'duplicate key value violates unique constraint "people_org_email_key"' };
const ops = (fake: FakeSupabase) => fake.calls.map((c) => `${c.op}:${c.table}`);

describe("normalizeEmail", () => {
  test("trims any whitespace and lowercases", () => {
    expect(normalizeEmail("  Ada.Lovelace@Example.COM\t\n")).toBe("ada.lovelace@example.com");
    expect(normalizeEmail("ada@example.com")).toBe("ada@example.com");
  });
  test("nothing left is null", () => {
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
  test("the same address however it is typed is one key", () => {
    const keys = new Set([" ADA@example.com", "ada@EXAMPLE.com ", "Ada@Example.Com"].map(normalizeEmail));
    expect(keys.size).toBe(1);
  });
});

describe("isUniqueViolation", () => {
  test("only 23505", () => {
    expect(isUniqueViolation(DUP)).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });
});

describe("findPersonByEmail", () => {
  test("the identifier's owner, looked up under the normalised address", async () => {
    const fake = new FakeSupabase([{ data: { person_id: WINNER } }]);
    expect(await findPersonByEmail(fake.asDb(), "org-1", " Ada@Example.com ")).toBe(WINNER);
    expect(fake.calls[0]).toMatchObject({ table: "person_identifiers" });
    expect(fake.calls[0].filters).toContainEqual({ method: "eq", column: "value", value: "ada@example.com" });
    expect(fake.calls[0].filters).toContainEqual({ method: "eq", column: "org_id", value: "org-1" });
  });

  test("else a people row with that email and no identifier (one that lost the race), oldest first, wildcards escaped", async () => {
    const fake = new FakeSupabase([{ data: null }, { data: [{ id: WINNER }] }]);
    expect(await findPersonByEmail(fake.asDb(), "org-1", "a_b%c@example.com")).toBe(WINNER);
    expect(fake.calls[1]).toMatchObject({ table: "people", op: "select" });
    expect(fake.calls[1].filters).toContainEqual({ method: "ilike", column: "email", value: "a\\_b\\%c@example.com" });
    expect(fake.calls[1].modifiers).toContainEqual({ method: "order", column: "created_at", options: { ascending: true } });
  });

  test("no one", async () => {
    const fake = new FakeSupabase([{ data: null }, { data: [] }]);
    expect(await findPersonByEmail(fake.asDb(), "org-1", "ada@example.com")).toBeNull();
  });
});

describe("findOrAddPerson", () => {
  const who = { name: "Ada", email: "ADA@example.com ", linkedinUrl: null };

  test("someone on file is reused and nothing is inserted", async () => {
    const fake = new FakeSupabase([{ data: { person_id: WINNER } }]);
    expect(await findOrAddPerson(fake.asDb(), ctx(), who)).toEqual({ personId: WINNER, created: false });
    expect(fake.calls.some((c) => c.op === "insert")).toBe(false);
  });

  test("a new person is inserted under the normalised email and the email identifier is claimed for them", async () => {
    const fake = new FakeSupabase([{ data: null }, { data: [] }, { data: null }, { data: "ident-1" }]);
    const r = await findOrAddPerson(fake.asDb(), ctx(), who);
    expect(r.created).toBe(true);
    expect(fake.calls[2]).toMatchObject({
      table: "people", op: "insert",
      args: { id: r.personId, org_id: "org-1", email: "ada@example.com", added_by_actor_id: "actor-1" },
    });
    expect(fake.calls[3]).toMatchObject({
      table: "client_add_contact", op: "rpc", args: { p_person: r.personId, p_kind: "email", p_value: "ada@example.com" },
    });
  });

  test("the identifier already this person's (the trigger wrote it) is a plain add", async () => {
    const fake = new FakeSupabase([{ data: null }, { data: [] }, { data: null }, { data: null }, { data: null }]);
    const r = await findOrAddPerson(fake.asDb(), ctx(), who);
    // The re-read found the identifier's owner is no one else: the scripted null owner.
    expect(r.created).toBe(true);
    expect(ops(fake)).toEqual([
      "select:person_identifiers", "select:people", "insert:people", "rpc:client_add_contact", "select:person_identifiers",
    ]);
  });

  test("a unique violation on the insert re-reads and reuses the person who won", async () => {
    const fake = new FakeSupabase([
      { data: null }, { data: [] }, // no one yet
      { error: DUP }, // another add landed first
      { data: { person_id: WINNER } }, // the re-read finds them
    ]);
    expect(await findOrAddPerson(fake.asDb(), ctx(), who)).toEqual({ personId: WINNER, created: false });
    expect(ops(fake)).toEqual(["select:person_identifiers", "select:people", "insert:people", "select:person_identifiers"]);
  });

  test("a unique violation whose winner has no identifier is found by the people row", async () => {
    const fake = new FakeSupabase([{ data: null }, { data: [] }, { error: DUP }, { data: null }, { data: [{ id: WINNER }] }]);
    expect(await findOrAddPerson(fake.asDb(), ctx(), who)).toEqual({ personId: WINNER, created: false });
  });

  test("a unique violation whose winner the member cannot see is a sentence, not a crash", async () => {
    const fake = new FakeSupabase([{ data: null }, { data: [] }, { error: DUP }, { data: null }, { data: [] }]);
    const err = await findOrAddPerson(fake.asDb(), ctx(), who).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ClientToolError);
    expect(err).toMatchObject({ code: "invalid", field: "email" });
  });

  test("any other insert error is thrown as it is", async () => {
    const fake = new FakeSupabase([{ data: null }, { data: [] }, { error: { code: "42501", message: "denied" } }]);
    await expect(findOrAddPerson(fake.asDb(), ctx(), who)).rejects.toThrow("denied");
  });

  test("losing the identifier race reuses its owner and takes the duplicate row back", async () => {
    const fake = new FakeSupabase([
      { data: null }, { data: [] }, { data: null }, // looked up, no one; inserted
      { data: null }, // client_add_contact: on file already
      { data: { person_id: WINNER } }, // ...for someone else
      { data: null }, // the duplicate deleted
    ]);
    expect(await findOrAddPerson(fake.asDb(), ctx(), who)).toEqual({ personId: WINNER, created: false });
    const inserted = (fake.calls[2].args as { id: string }).id;
    expect(fake.calls[5]).toMatchObject({ table: "people", op: "delete", filters: [{ method: "eq", column: "id", value: inserted }] });
  });

  test("a refused identifier claim (an elevated member's) leaves the new row as the answer", async () => {
    const fake = new FakeSupabase([{ data: null }, { data: [] }, { data: null }, { error: { code: "42501", message: "no" } }]);
    expect((await findOrAddPerson(fake.asDb(), ctx("elevated"), who)).created).toBe(true);
  });

  test("without an email a row is always made and nothing is claimed", async () => {
    const fake = new FakeSupabase([{ data: null }]);
    const r = await findOrAddPerson(fake.asDb(), ctx(), { name: "Ada", email: null, linkedinUrl: null });
    expect(r.created).toBe(true);
    expect(ops(fake)).toEqual(["insert:people"]);
  });

  test("lookedUp skips the caller's own lookup", async () => {
    const fake = new FakeSupabase([{ data: null }, { data: "ident-1" }]);
    await findOrAddPerson(fake.asDb(), ctx(), { ...who, lookedUp: true });
    expect(ops(fake)).toEqual(["insert:people", "rpc:client_add_contact"]);
  });
});

describe("the tools over it", () => {
  test("addCandidate: a parallel add that lost the insert lands in the winner's application, not a second person", async () => {
    const fake = new FakeSupabase([
      { data: true }, { data: true }, { data: "audit-1" }, // can_on_role, can_add_people, the claim
      { data: null }, { data: [] }, { error: DUP }, { data: { person_id: WINNER } }, // missed, raced, re-read
      { error: { code: "23505", message: "applications_person_id_role_id_key" } }, // the winner is in the job already
      { data: { id: "app-1", stage: "sourced" } }, // their application
      { data: { org_id: "org-acme" } }, { data: null }, // the submission's org check, then finish_write
    ]);
    const r = await addCandidate(fake.asDb(), ctx(), { jobId: "role-1", name: "Ada", email: "Ada@Example.com" });
    expect(r).toMatchObject({ outcome: "already_in_pipeline", candidateId: WINNER, newCandidate: false, applicationId: "app-1" });
    expect(fake.calls.filter((c) => c.table === "applications" && c.op === "insert")[0]?.args).toMatchObject({ person_id: WINNER });
  });

  test("addProspect: a parallel add that lost the insert answers exists, and its claim is given back", async () => {
    const fake = new FakeSupabase([
      { data: true }, { data: null }, { data: [] }, // can_add_people, no one on file
      { data: "audit-1" }, { error: DUP }, { data: { person_id: WINNER } }, { data: null },
    ]);
    const r = await addProspect(fake.asDb(), ctx(), { name: "Ada", email: "ada@example.com" });
    expect(r).toEqual({ outcome: "exists", candidateId: WINNER, pool: null });
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_keep: false } });
  });
});
