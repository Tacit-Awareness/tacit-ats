import { describe, expect, test } from "vitest";
import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { bindClientActor, type ClientIdentity } from "./bind.js";

const ORG = { id: "org-acme" };
const who = (over: Partial<ClientIdentity> = {}): ClientIdentity => ({
  workosUserId: "user_1",
  workosOrgId: "org_acme",
  email: "Ada@Acme.test",
  emailVerified: true,
  ...over,
});

describe("bindClientActor", () => {
  test("a first sign-in binds the invited actor, matched by address inside the token's org", async () => {
    const fake = new FakeSupabase([
      { data: ORG },
      { data: null },
      { data: { id: "actor-1", auth_subject: null } },
      { data: [{ id: "actor-1" }] },
    ]);

    expect(await bindClientActor(fake.asDb(), who())).toEqual({
      status: "ok", actorId: "actor-1", orgId: "org-acme", firstSignIn: true,
    });

    // Only a client org answers, found by the WorkOS organization alone.
    expect(fake.calls[0]).toMatchObject({
      table: "orgs",
      filters: [
        { method: "eq", column: "workos_org_id", value: "org_acme" },
        { method: "eq", column: "kind", value: "client" },
      ],
    });
    // Every actor read and the write stay inside that org.
    expect(fake.calls[2].filters).toEqual([
      { method: "eq", column: "org_id", value: "org-acme" },
      { method: "ilike", column: "email", value: "ada@acme.test" },
      { method: "is", column: "archived_at", value: null },
    ]);
    expect(fake.calls[3]).toMatchObject({
      table: "actors",
      op: "update",
      args: { auth_subject: "user_1" },
      filters: [
        { method: "eq", column: "id", value: "actor-1" },
        { method: "eq", column: "org_id", value: "org-acme" },
        { method: "is", column: "auth_subject", value: null },
      ],
    });
  });

  test("a returning user resolves by subject and needs no email", async () => {
    const fake = new FakeSupabase([{ data: ORG }, { data: { id: "actor-1", archived_at: null } }]);
    expect(await bindClientActor(fake.asDb(), who({ email: null, emailVerified: false }))).toEqual({
      status: "ok", actorId: "actor-1", orgId: "org-acme", firstSignIn: false,
    });
    expect(fake.calls).toHaveLength(2);
  });

  test("an archived actor is refused like someone never invited", async () => {
    const fake = new FakeSupabase([{ data: ORG }, { data: { id: "actor-1", archived_at: "2026-10-01T00:00:00Z" } }]);
    expect(await bindClientActor(fake.asDb(), who())).toEqual({ status: "forbidden", reason: "not_invited" });
  });

  test("no organization in the token: refused before any read", async () => {
    const fake = new FakeSupabase();
    expect(await bindClientActor(fake.asDb(), who({ workosOrgId: null }))).toEqual({ status: "forbidden", reason: "no_org" });
    expect(fake.calls).toHaveLength(0);
  });

  test("an organization Tacit has no client org for is refused", async () => {
    const fake = new FakeSupabase([{ data: null }]);
    expect(await bindClientActor(fake.asDb(), who())).toEqual({ status: "forbidden", reason: "unknown_org" });
  });

  test("an unverified address never binds, and is not even looked up", async () => {
    const fake = new FakeSupabase([{ data: ORG }, { data: null }]);
    expect(await bindClientActor(fake.asDb(), who({ emailVerified: false }))).toEqual({
      status: "forbidden", reason: "email_unverified",
    });
    expect(fake.calls).toHaveLength(2);
  });

  test("nobody invited that address: refused, and no actor is created", async () => {
    const fake = new FakeSupabase([{ data: ORG }, { data: null }, { data: null }]);
    expect(await bindClientActor(fake.asDb(), who())).toEqual({ status: "forbidden", reason: "not_invited" });
    expect(fake.calls.some((c) => c.op === "insert" || c.op === "upsert")).toBe(false);
  });

  test("an address already bound to a different WorkOS user is refused", async () => {
    const fake = new FakeSupabase([{ data: ORG }, { data: null }, { data: { id: "actor-1", auth_subject: "user_other" } }]);
    expect(await bindClientActor(fake.asDb(), who())).toEqual({ status: "forbidden", reason: "subject_mismatch" });
  });

  test("losing the bind race to another subject is refused; losing it to yourself is fine", async () => {
    const lost = new FakeSupabase([
      { data: ORG }, { data: null }, { data: { id: "actor-1", auth_subject: null } },
      { data: [] }, { data: { auth_subject: "user_other" } },
    ]);
    expect(await bindClientActor(lost.asDb(), who())).toEqual({ status: "forbidden", reason: "subject_mismatch" });

    const same = new FakeSupabase([
      { data: ORG }, { data: null }, { data: { id: "actor-1", auth_subject: null } },
      { data: [] }, { data: { auth_subject: "user_1" } },
    ]);
    expect(await bindClientActor(same.asDb(), who())).toMatchObject({ status: "ok", actorId: "actor-1" });
  });

  test("a LIKE wildcard in the address is matched as text", async () => {
    const fake = new FakeSupabase([{ data: ORG }, { data: null }, { data: null }]);
    await bindClientActor(fake.asDb(), who({ email: "a%_b@acme.test" }));
    expect(fake.calls[2].filters[1]).toEqual({ method: "ilike", column: "email", value: "a\\%\\_b@acme.test" });
  });
});
