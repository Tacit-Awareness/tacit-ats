import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import {
  createCustomField, customFieldValuesFor, listCustomFields, setCustomField, updateCustomField,
} from "./custom-fields.js";

/**
 * What the custom field tools add on top of the policies and the value
 * trigger (pinned against real Postgres in the SQL suite and apps/mcp's
 * client.integration.test.ts): a sentence before a refused write, option
 * names turned into ids and back, the audit claim around an allowed write,
 * no claim for a no-op, and a long_text body kept out of the audit row.
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

const PERSON = "9a000000-0000-4000-8000-000000000001";
const OPT_REMOTE = "0b000000-0000-4000-8000-000000000001";
const OPT_ONSITE = "0b000000-0000-4000-8000-000000000002";
const OPT_OLD = "0b000000-0000-4000-8000-000000000003";
const WORK = {
  id: "f1000000-0000-4000-8000-000000000001", object: "candidate", name: "Work style", field_type: "single_select",
  private: false, position: 1, archived_at: null,
  custom_field_options: [
    { id: OPT_ONSITE, name: "Onsite", position: 2, archived_at: null },
    { id: OPT_REMOTE, name: "Remote", position: 1, archived_at: null },
    { id: OPT_OLD, name: "Hybrid", position: 3, archived_at: "2026-10-01T00:00:00Z" },
  ],
};
const NOTES = {
  id: "f1000000-0000-4000-8000-000000000002", object: "candidate", name: "Background", field_type: "long_text",
  private: false, position: 2, archived_at: null, custom_field_options: [],
};
const COMP = {
  id: "f1000000-0000-4000-8000-000000000003", object: "candidate", name: "Expected comp", field_type: "number",
  private: true, position: 3, archived_at: null, custom_field_options: [],
};

describe("listCustomFields", () => {
  test("an interviewer is refused without a query", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(listCustomFields(fake.asDb(), ctx("limited")))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });

  test("live fields with their live options in order; an unknown object is refused first", async () => {
    const fake = new FakeSupabase([{ data: [WORK, { ...NOTES, archived_at: "2026-10-02T00:00:00Z" }] }]);
    const fields = await listCustomFields(fake.asDb(), ctx("elevated"), { object: "candidate" });
    expect(fields).toEqual([{
      fieldId: WORK.id, object: "candidate", name: "Work style", type: "single_select", private: false, archived: false,
      options: [{ optionId: OPT_REMOTE, name: "Remote", archived: false }, { optionId: OPT_ONSITE, name: "Onsite", archived: false }],
    }]);
    expect(fake.calls[0].filters).toEqual([{ method: "eq", column: "object", value: "candidate" }]);
    expect((await refusal(listCustomFields(fake.asDb(), ctx(), { object: "company" }))).code).toBe("invalid");
  });
});

describe("createCustomField", () => {
  test("admins only, and bad input is refused, before any read", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(createCustomField(fake.asDb(), ctx("elevated"), { object: "job", name: "Team", type: "short_text" }))).code).toBe("forbidden");
    for (const bad of [
      { object: "job", name: "Team", type: "paragraph" },
      { object: "job", name: "   ", type: "short_text" },
      { object: "job", name: "Team", type: "single_select" },
      { object: "job", name: "Team", type: "single_select", options: ["A", "a"] },
      { object: "job", name: "Team", type: "short_text", options: ["A"] },
    ]) {
      expect((await refusal(createCustomField(fake.asDb(), ctx(), bad))).code).toBe("invalid");
    }
    expect(fake.calls).toEqual([]);
  });

  test("a name already there on that object is answered with, unless its type differs or it was archived", async () => {
    const same = new FakeSupabase([{ data: [WORK] }]);
    expect(await createCustomField(same.asDb(), ctx(), { object: "candidate", name: " work STYLE ", type: "single_select", options: ["x"] }))
      .toEqual({ outcome: "exists", fieldId: WORK.id, name: "Work style" });
    expect(rpcs(same)).toEqual([]);
    const other = new FakeSupabase([{ data: [WORK] }]);
    expect((await refusal(createCustomField(other.asDb(), ctx(), { object: "candidate", name: "Work style", type: "short_text" }))).message)
      .toMatch(/as single_select/);
    const archived = new FakeSupabase([{ data: [{ ...NOTES, archived_at: "2026-10-01T00:00:00Z" }] }]);
    expect((await refusal(createCustomField(archived.asDb(), ctx(), { object: "candidate", name: "Background", type: "long_text" }))).message)
      .toMatch(/update_custom_field/);
  });

  test("a new select field and its options get ids in code, in the order given, audited", async () => {
    const fake = new FakeSupabase([{ data: [WORK] }, { data: "audit-1" }, { data: null }, { data: null }, { data: null }]);
    const r = await createCustomField(fake.asDb(), ctx(), {
      object: "candidate", name: "Visa", type: "multi_select", private: true, options: ["H-1B", " Green   card "],
    });
    expect(r.outcome).toBe("created");
    const [field, options] = fake.calls.filter((c) => c.op === "insert");
    expect(field).toMatchObject({
      table: "custom_fields", args: { id: r.fieldId, object: "candidate", name: "Visa", field_type: "multi_select", private: true, position: 2 },
    });
    expect(options.table).toBe("custom_field_options");
    expect((options.args as Array<{ field_id: string; name: string; position: number }>).map((o) => [o.field_id, o.name, o.position]))
      .toEqual([[r.fieldId, "H-1B", 1], [r.fieldId, "Green card", 2]]);
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_entity_id: r.fieldId, p_keep: true } });
  });
});

describe("updateCustomField", () => {
  test("the options given become the live set: renamed by id, matched by name, added, the rest archived", async () => {
    const fake = new FakeSupabase([
      { data: [WORK] }, { data: "audit-1" }, ...Array.from({ length: 6 }, () => ({ data: null })),
    ]);
    const r = await updateCustomField(fake.asDb(), ctx(), {
      field: "work style",
      options: [{ optionId: OPT_REMOTE, name: "Fully remote" }, { name: "hybrid" }, { name: "Relocating" }],
    });
    expect(r).toMatchObject({
      outcome: "updated", changed: ["options"], added: ["Relocating"],
      renamed: [{ from: "Remote", to: "Fully remote" }, { from: "Hybrid", to: "hybrid" }], restored: ["hybrid"], archivedOptions: ["Onsite"],
    });
    const updates = fake.calls.filter((c) => c.op === "update").map((c) => [c.filters[0].value, c.args]);
    expect(updates).toEqual([
      [OPT_REMOTE, { name: "Fully remote" }],
      [OPT_OLD, { name: "hybrid", archived_at: null, position: 2 }],
      [OPT_ONSITE, { archived_at: expect.any(String) }],
    ]);
    expect(fake.calls.find((c) => c.op === "insert")).toMatchObject({
      table: "custom_field_options", args: [{ name: "Relocating", position: 3, field_id: WORK.id }],
    });
  });

  test("nothing to change claims nothing; a rename onto a sibling's name is refused", async () => {
    const same = new FakeSupabase([{ data: [WORK] }]);
    expect((await updateCustomField(same.asDb(), ctx(), { field: WORK.id, name: "Work style", private: false })).outcome).toBe("unchanged");
    expect(rpcs(same)).toEqual([]);
    const clash = new FakeSupabase([{ data: [WORK, NOTES] }, { data: [WORK, NOTES] }]);
    expect((await refusal(updateCustomField(clash.asDb(), ctx(), { field: "Work style", name: "background" }))).code).toBe("invalid");
    const notSelect = new FakeSupabase([{ data: [NOTES] }]);
    expect((await refusal(updateCustomField(notSelect.asDb(), ctx(), { field: "Background", options: [{ name: "A" }] }))).message)
      .toMatch(/Only a single_select/);
  });

  test("admins only", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(updateCustomField(fake.asDb(), ctx("elevated"), { field: "x", archived: true }))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });
});

describe("setCustomField", () => {
  test("an interviewer is refused without a query", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(setCustomField(fake.asDb(), ctx("limited"), { object: "candidate", objectId: PERSON, field: "x", value: "y" }))).code)
      .toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });

  test("an option chosen by name is stored as its id and shown by name", async () => {
    const fake = new FakeSupabase([
      { data: [WORK] }, { data: { id: PERSON } }, { data: true }, { data: null }, { data: "audit-1" }, { data: null }, { data: null },
    ]);
    const r = await setCustomField(fake.asDb(), ctx("elevated"), { object: "candidate", objectId: PERSON, field: "Work Style", value: "remote" });
    expect(r).toEqual({ outcome: "set", fieldId: WORK.id, field: "Work style", type: "single_select", value: "Remote" });
    expect(fake.calls.find((c) => c.op === "insert")).toMatchObject({
      table: "custom_field_values", args: { field_id: WORK.id, person_id: PERSON, value: OPT_REMOTE },
    });
    expect(fake.calls.at(-1)).toMatchObject({
      table: "client_finish_write", args: { p_entity_id: PERSON, p_after: { field_id: WORK.id, value: OPT_REMOTE }, p_keep: true },
    });
  });

  test("an archived option goes on no one new, but a value already holding it keeps it", async () => {
    const fresh = new FakeSupabase([{ data: [WORK] }, { data: { id: PERSON } }, { data: true }, { data: null }]);
    expect((await refusal(setCustomField(fresh.asDb(), ctx(), { object: "candidate", objectId: PERSON, field: "Work style", value: "Hybrid" }))).message)
      .toMatch(/archived/);
    const kept = new FakeSupabase([{ data: [WORK] }, { data: { id: PERSON } }, { data: true }, { data: { id: "v-1", value: OPT_OLD } }]);
    expect((await setCustomField(kept.asDb(), ctx(), { object: "candidate", objectId: PERSON, field: "Work style", value: "Hybrid" })).outcome)
      .toBe("unchanged");
    expect(rpcs(kept)).not.toContain("client_claim_write");
  });

  test("a long_text body stays out of the audit row", async () => {
    const fake = new FakeSupabase([
      { data: [NOTES] }, { data: { id: PERSON } }, { data: true }, { data: { id: "v-1", value: "old words" } },
      { data: "audit-1" }, { data: null }, { data: null },
    ]);
    const r = await setCustomField(fake.asDb(), ctx(), { object: "candidate", objectId: PERSON, field: "Background", value: "  Built the payments stack  " });
    expect(r).toMatchObject({ outcome: "set", value: "Built the payments stack" });
    expect(fake.calls.find((c) => c.op === "update")).toMatchObject({ args: { value: "Built the payments stack" } });
    const finish = fake.calls.at(-1)!;
    expect(JSON.stringify(finish.args)).not.toMatch(/payments|old words/);
  });

  test("null clears a value there, and is a no-op on one that is not", async () => {
    const there = new FakeSupabase([
      { data: [WORK] }, { data: { id: PERSON } }, { data: true }, { data: { id: "v-1", value: OPT_REMOTE } },
      { data: "audit-1" }, { data: [{ id: "v-1" }] }, { data: null },
    ]);
    expect((await setCustomField(there.asDb(), ctx(), { object: "candidate", objectId: PERSON, field: "Work style", value: null })).outcome).toBe("cleared");
    expect(there.calls.find((c) => c.op === "delete")?.filters).toEqual([{ method: "eq", column: "id", value: "v-1" }]);
    const none = new FakeSupabase([{ data: [WORK] }, { data: { id: PERSON } }, { data: true }, { data: null }]);
    expect((await setCustomField(none.asDb(), ctx(), { object: "candidate", objectId: PERSON, field: "Work style", value: null })).outcome).toBe("unchanged");
    expect(rpcs(none)).not.toContain("client_claim_write");
  });

  test("values that do not fit the type are refused before any claim", async () => {
    const cases: Array<[typeof WORK | typeof NOTES | typeof COMP | Record<string, unknown>, unknown]> = [
      [COMP, "lots"],
      [{ ...NOTES, field_type: "date" }, "next week"],
      [{ ...NOTES, field_type: "url" }, "example.com"],
      [{ ...NOTES, field_type: "yes_no" }, "maybe"],
      [WORK, ["Remote", "Onsite"]],
      [WORK, "Nope"],
    ];
    for (const [field, value] of cases) {
      const fake = new FakeSupabase([{ data: [field] }, { data: { id: PERSON } }, { data: true }, { data: null }]);
      const err = await refusal(setCustomField(fake.asDb(), ctx(), {
        object: "candidate", objectId: PERSON, field: (field as { name: string }).name, value: value as string,
      }));
      expect(err.code).toBe("invalid");
      expect(rpcs(fake)).not.toContain("client_claim_write");
    }
  });

  test("a private candidate field needs an admin or someone who manages one of their jobs", async () => {
    const fake = new FakeSupabase([
      { data: [COMP] }, { data: { id: PERSON } }, { data: true }, { data: [{ role_id: "role-1" }, { role_id: "role-2" }] },
      { data: false }, { data: false },
    ]);
    const err = await refusal(setCustomField(fake.asDb(), ctx("elevated"), { object: "candidate", objectId: PERSON, field: "Expected comp", value: 1 }));
    expect(err.message).toMatch(/private/);
    expect(rpcs(fake)).toEqual(["can_edit_person", "can_on_role", "can_on_role"]);
  });

  test("an offer's fields change only while it is a draft; a job's need someone who manages it", async () => {
    const offerField = { ...NOTES, object: "offer", field_type: "short_text", name: "Signing bonus" };
    const offer = new FakeSupabase([{ data: [offerField] }, { data: { id: "offer-1", status: "extended" } }]);
    expect((await refusal(setCustomField(offer.asDb(), ctx(), { object: "offer", objectId: "offer-1", field: "Signing bonus", value: "5k" }))).message)
      .toMatch(/only a draft offer/);
    const jobField = { ...NOTES, object: "job", field_type: "short_text", name: "Team" };
    const job = new FakeSupabase([{ data: [jobField] }, { data: { id: "role-1" } }, { data: false }]);
    expect((await refusal(setCustomField(job.asDb(), ctx("elevated"), { object: "job", objectId: "role-1", field: "Team", value: "Infra" }))).code)
      .toBe("forbidden");
  });

  test("an archived field takes no value, and an unknown one is a sentence", async () => {
    const archived = new FakeSupabase([{ data: [{ ...WORK, archived_at: "2026-10-01T00:00:00Z" }] }]);
    expect((await refusal(setCustomField(archived.asDb(), ctx(), { object: "candidate", objectId: PERSON, field: "Work style", value: "Remote" }))).message)
      .toMatch(/archived/);
    const unknown = new FakeSupabase([{ data: [WORK] }]);
    expect((await refusal(setCustomField(unknown.asDb(), ctx(), { object: "candidate", objectId: PERSON, field: "Nope", value: "x" }))).code)
      .toBe("not_found");
  });
});

describe("customFieldValuesFor", () => {
  test("live fields only, in the fields' order, options by name; nothing read for no ids", async () => {
    const none = new FakeSupabase();
    expect((await customFieldValuesFor(none.asDb(), "candidate", [])).size).toBe(0);
    expect(none.calls).toEqual([]);

    const fake = new FakeSupabase([{
      data: [
        { field_id: NOTES.id, person_id: PERSON, role_id: null, offer_id: null, value: "Built things",
          custom_fields: { name: "Background", field_type: "long_text", private: false, position: 2, archived_at: null, custom_field_options: [] } },
        { field_id: "multi", person_id: PERSON, role_id: null, offer_id: null, value: [OPT_ONSITE, OPT_REMOTE],
          custom_fields: { name: "Where", field_type: "multi_select", private: false, position: 1, archived_at: null,
            custom_field_options: [{ id: OPT_REMOTE, name: "Remote" }, { id: OPT_ONSITE, name: "Onsite" }] } },
        { field_id: "gone", person_id: PERSON, role_id: null, offer_id: null, value: true,
          custom_fields: { name: "Old", field_type: "yes_no", private: false, position: 0, archived_at: "2026-10-01T00:00:00Z", custom_field_options: [] } },
      ],
    }]);
    const values = (await customFieldValuesFor(fake.asDb(), "candidate", [PERSON])).get(PERSON);
    expect(values).toEqual([
      { fieldId: "multi", name: "Where", type: "multi_select", private: false, value: ["Onsite", "Remote"] },
      { fieldId: NOTES.id, name: "Background", type: "long_text", private: false, value: "Built things" },
    ]);
    expect(fake.calls[0].filters).toEqual([{ method: "in", column: "person_id", value: [PERSON] }]);
  });
});
