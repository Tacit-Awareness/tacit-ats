import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { READ_ONLY_REFUSAL, withAudit } from "./audit.js";
import { getConnectorSettings, setConnectorAccess } from "./connector.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { addNote } from "./writes.js";

const ctx = (accessLevel: ClientToolCtx["accessLevel"] = "admin"): ClientToolCtx => ({
  actorId: "actor-1", orgId: "org-1", accessLevel, source: "claude",
});

async function refusal(promise: Promise<unknown>): Promise<ClientToolError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ClientToolError);
  return err as ClientToolError;
}

const READ_ONLY = { code: "42501", message: "the client connector is read-only for this org" };
const lastFinish = (fake: FakeSupabase) => fake.calls.filter((c) => c.table === "client_finish_write").at(-1);

describe("getConnectorSettings", () => {
  test("reads the member's own org, with who last changed it", async () => {
    const fake = new FakeSupabase([
      { data: { connector_access: "read_only", connector_access_set_at: "2026-10-15T10:00:00Z", setter: { display_name: "Ada" } } },
    ]);
    expect(await getConnectorSettings(fake.asDb(), ctx("limited")))
      .toEqual({ access: "read_only", setBy: "Ada", setAt: "2026-10-15T10:00:00Z" });
    expect(fake.calls[0]).toMatchObject({ table: "orgs", filters: [{ method: "eq", column: "id", value: "org-1" }] });
  });

  test("never changed: nobody and no date", async () => {
    const fake = new FakeSupabase([{ data: { connector_access: "read_write", connector_access_set_at: null, setter: null } }]);
    expect(await getConnectorSettings(fake.asDb(), ctx())).toEqual({ access: "read_write", setBy: null, setAt: null });
  });
});

describe("setConnectorAccess", () => {
  test("only an admin, and nothing is claimed first", async () => {
    const fake = new FakeSupabase();
    const err = await refusal(setConnectorAccess(fake.asDb(), ctx("elevated"), { access: "read_only" }));
    expect(err.code).toBe("forbidden");
    expect(err.message).toMatch(/Only an admin/);
    expect(fake.calls).toEqual([]);
  });

  test("an unknown value is refused before a query", async () => {
    const fake = new FakeSupabase();
    const err = await refusal(setConnectorAccess(fake.asDb(), ctx(), { access: "read_some" as "read_only" }));
    expect(err.code).toBe("invalid");
    expect(fake.calls).toEqual([]);
  });

  test("claims as org.connector_access, the one claim a read-only org still takes, and audits before and after", async () => {
    const fake = new FakeSupabase([{ data: "audit-1" }, { data: "read_write" }, { data: null }]);
    expect(await setConnectorAccess(fake.asDb(), ctx(), { access: "read_only" }))
      .toEqual({ outcome: "changed", previous: "read_write", access: "read_only" });
    expect(fake.calls[0]).toMatchObject({ table: "client_claim_write", args: { p_action: "org.connector_access", p_entity: "org" } });
    expect(fake.calls[1]).toMatchObject({ table: "set_connector_access", op: "rpc", args: { p_access: "read_only" } });
    expect(lastFinish(fake)?.args).toMatchObject({
      p_entity_id: "org-1", p_before: { connector_access: "read_write" }, p_after: { connector_access: "read_only" }, p_keep: true,
    });
  });

  test("already that way: unchanged, and the claim is given back", async () => {
    const fake = new FakeSupabase([{ data: "audit-1" }, { data: "read_only" }, { data: null }]);
    expect(await setConnectorAccess(fake.asDb(), ctx(), { access: "read_only" }))
      .toEqual({ outcome: "unchanged", previous: "read_only", access: "read_only" });
    expect(lastFinish(fake)?.args).toMatchObject({ p_keep: false });
  });

  test("the database's own admin check is a sentence too", async () => {
    const fake = new FakeSupabase([{ data: "audit-1" }, { error: { code: "42501", message: "only an admin can change the connector's access" } }, { data: null }]);
    const err = await refusal(setConnectorAccess(fake.asDb(), ctx(), { access: "read_write" }));
    expect(err.message).toMatch(/Only an admin/);
    expect(lastFinish(fake)?.args).toMatchObject({ p_audit: "audit-1", p_keep: false });
  });
});

describe("a read-only org", () => {
  test("withAudit answers the refused claim with a sentence naming the setting and who can change it, and writes nothing", async () => {
    const fake = new FakeSupabase([{ error: READ_ONLY }]);
    let wrote = false;
    const err = await refusal(withAudit(fake.asDb(), ctx(), { action: "note.add", entity: "person" }, async () => {
      wrote = true;
      return { result: null, entityId: null, changed: true };
    }));
    expect(err.code).toBe("forbidden");
    expect(err.message).toBe(READ_ONLY_REFUSAL);
    expect(err.message).toMatch(/read-only/);
    expect(err.message).toMatch(/admin/);
    expect(err.message).toMatch(/set_connector_access/);
    expect(wrote).toBe(false);
    expect(fake.calls.map((c) => c.table)).toEqual(["client_claim_write"]);
  });

  test("another 42501 from the claim is not mistaken for it", async () => {
    const fake = new FakeSupabase([{ error: { code: "42501", message: "not a signed-in member of an org" } }]);
    const err = await withAudit(fake.asDb(), ctx(), { action: "note.add", entity: "person" }, async () => ({ result: null, entityId: null, changed: true }))
      .then(() => null, (e: unknown) => e);
    expect(err).not.toBeInstanceOf(ClientToolError);
  });

  test("a tool's write is refused with that sentence", async () => {
    const fake = new FakeSupabase([
      { data: { id: "person-1" } }, // the candidate, read
      { error: READ_ONLY }, // the claim
    ]);
    const err = await addNote(fake.asDb(), ctx("elevated"), { candidateId: "person-1", text: "Strong call." })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ClientToolError);
    expect((err as ClientToolError).message).toBe(READ_ONLY_REFUSAL);
    expect(fake.calls.some((c) => c.table === "person_notes" && c.op === "insert")).toBe(false);
  });
});
