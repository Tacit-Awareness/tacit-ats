import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { listJobs } from "./reads.js";
import {
  createDepartment, createOffice, departmentAndBelow, listDepartments, listOffices, updateDepartment, updateOffice,
} from "./structure.js";

/**
 * What the department and office tools add on top of the policies (pinned
 * against real Postgres in the SQL suite's section 23 and apps/mcp's
 * client.integration.test.ts): a sentence before a refused write, the audit
 * claim around an allowed one, names matched ignoring case, a parent that
 * would loop refused before the database has to, and no claim for a no-op.
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

const ENG = { id: "d0000000-0000-4000-8000-000000000001", name: "Engineering", parent_id: null, archived_at: null };
const PLATFORM = { id: "d0000000-0000-4000-8000-000000000002", name: "Platform", parent_id: ENG.id, archived_at: null };
const INFRA = { id: "d0000000-0000-4000-8000-000000000003", name: "Infra", parent_id: PLATFORM.id, archived_at: null };
const OLD = { id: "d0000000-0000-4000-8000-000000000004", name: "Old", parent_id: null, archived_at: "2026-10-01T00:00:00Z" };
const NYC = { id: "0f000000-0000-4000-8000-000000000001", name: "New York", location: "New York, NY", archived_at: null };

describe("departments", () => {
  test("an interviewer is refused without a query", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(listDepartments(fake.asDb(), ctx("limited")))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });

  test("listed by their place in the tree, with the jobs the member can see; archived on request", async () => {
    const rows = [{ ...ENG, roles: [{ count: 2 }] }, { ...INFRA, roles: [{ count: 0 }] }, { ...OLD, roles: [] }, { ...PLATFORM, roles: [{ count: 1 }] }];
    const fake = new FakeSupabase([{ data: rows }, { data: rows }]);
    expect((await listDepartments(fake.asDb(), ctx("elevated"))).map((d) => [d.path, d.jobs])).toEqual([
      ["Engineering", 2], ["Engineering > Platform", 1], ["Engineering > Platform > Infra", 0],
    ]);
    expect((await listDepartments(fake.asDb(), ctx(), { includeArchived: true })).map((d) => d.name)).toContain("Old");
  });

  test("one inside another, at any depth", () => {
    expect(departmentAndBelow([ENG, PLATFORM, INFRA, OLD], ENG.id).sort()).toEqual([ENG.id, PLATFORM.id, INFRA.id].sort());
  });

  test("made by admins only, asked before any read", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(createDepartment(fake.asDb(), ctx("elevated"), { name: "Sales" }))).code).toBe("forbidden");
    expect((await refusal(createDepartment(fake.asDb(), ctx(), { name: "x".repeat(101) }))).code).toBe("invalid");
    expect(fake.calls).toEqual([]);
  });

  test("a new one inside a parent named any case; its id made in code, not read back, audited", async () => {
    const fake = new FakeSupabase([{ data: [ENG] }, { data: "audit-1" }, { data: null }, { data: null }]);
    const r = await createDepartment(fake.asDb(), ctx(), { name: " Data  Science ", parent: "engineering" });
    expect(r).toMatchObject({ outcome: "created", name: "Data Science", parent: "Engineering" });
    const insert = fake.calls.find((c) => c.op === "insert")!;
    expect(insert).toMatchObject({ table: "departments", args: { id: r.id, name: "Data Science", parent_id: ENG.id }, terminal: "await" });
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_entity_id: r.id, p_keep: true } });
  });

  test("a name already there is answered with; an archived one comes back; an archived parent is refused", async () => {
    const there = new FakeSupabase([{ data: [ENG, PLATFORM] }]);
    expect(await createDepartment(there.asDb(), ctx(), { name: "PLATFORM" })).toMatchObject({ outcome: "exists", id: PLATFORM.id, parent: "Engineering" });
    expect(rpcs(there)).toEqual([]);
    const back = new FakeSupabase([{ data: [OLD] }, { data: "audit-1" }, { data: [{ id: OLD.id }] }, { data: null }]);
    expect((await createDepartment(back.asDb(), ctx(), { name: "old" })).outcome).toBe("restored");
    const parent = new FakeSupabase([{ data: [OLD] }]);
    expect((await refusal(createDepartment(parent.asDb(), ctx(), { name: "New", parent: "Old" }))).message).toMatch(/archived/);
  });

  test("moving one inside its own child is refused before the claim", async () => {
    const fake = new FakeSupabase([{ data: [ENG, PLATFORM, INFRA] }]);
    const err = await refusal(updateDepartment(fake.asDb(), ctx(), { department: "Engineering", parent: "Infra" }));
    expect(err.message).toMatch(/inside itself/);
    expect(rpcs(fake)).toEqual([]);
  });

  test("rename, move to the top and archive in one change; the same again is no claim", async () => {
    const fake = new FakeSupabase([{ data: [ENG, PLATFORM] }, { data: "audit-1" }, { data: [{ id: PLATFORM.id }] }, { data: null }]);
    const r = await updateDepartment(fake.asDb(), ctx(), { department: PLATFORM.id, name: "Platform Eng", parent: null, archived: true });
    expect(r).toEqual({ outcome: "updated", departmentId: PLATFORM.id, changed: ["name", "parent", "archived"] });
    expect(fake.calls.find((c) => c.op === "update")?.args).toMatchObject({ name: "Platform Eng", parent_id: null, archived_at: expect.any(String) });
    expect(fake.calls.at(-1)?.args).toMatchObject({ p_after: { name: "Platform Eng", parent_id: null, archived: true } });

    const same = new FakeSupabase([{ data: [ENG, PLATFORM] }]);
    expect(await updateDepartment(same.asDb(), ctx(), { department: "platform", name: "Platform", parent: "Engineering", archived: false }))
      .toEqual({ outcome: "unchanged", departmentId: PLATFORM.id, changed: [] });
    expect(rpcs(same)).toEqual([]);
  });

  test("a rename onto another department's name is refused", async () => {
    const fake = new FakeSupabase([{ data: [ENG, PLATFORM] }]);
    expect((await refusal(updateDepartment(fake.asDb(), ctx(), { department: "Platform", name: "engineering" }))).message).toMatch(/already has that name/);
  });
});

describe("offices", () => {
  test("an interviewer is refused; the hiring team lists live ones with their job counts", async () => {
    expect((await refusal(listOffices(new FakeSupabase().asDb(), ctx("limited")))).code).toBe("forbidden");
    const fake = new FakeSupabase([{ data: [{ ...NYC, job_offices: [{ count: 3 }] }] }]);
    expect(await listOffices(fake.asDb(), ctx("elevated"))).toEqual([
      { officeId: NYC.id, name: "New York", location: "New York, NY", archived: false, jobs: 3 },
    ]);
    expect(fake.calls[0].filters).toEqual([{ method: "is", column: "archived_at", value: null }]);
  });

  test("made by admins with a location, audited", async () => {
    expect((await refusal(createOffice(new FakeSupabase().asDb(), ctx("elevated"), { name: "Paris" }))).code).toBe("forbidden");
    const fake = new FakeSupabase([{ data: [NYC] }, { data: "audit-1" }, { data: null }, { data: null }]);
    const r = await createOffice(fake.asDb(), ctx(), { name: "Paris", location: " Paris,  France " });
    expect(fake.calls.find((c) => c.op === "insert")?.args).toEqual({ id: r.id, name: "Paris", location: "Paris, France" });
  });

  test("a location cleared and the office archived; nothing to change is no claim", async () => {
    const fake = new FakeSupabase([{ data: [NYC] }, { data: "audit-1" }, { data: [{ id: NYC.id }] }, { data: null }]);
    expect(await updateOffice(fake.asDb(), ctx(), { office: "new york", location: null, archived: true }))
      .toEqual({ outcome: "updated", officeId: NYC.id, changed: ["location", "archived"] });
    const same = new FakeSupabase([{ data: [NYC] }]);
    expect((await updateOffice(same.asDb(), ctx(), { office: NYC.id, location: "New York, NY" })).outcome).toBe("unchanged");
    expect(rpcs(same)).toEqual([]);
  });
});

describe("listJobs by department and office", () => {
  test("an interviewer cannot filter by either", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(listJobs(fake.asDb(), ctx("limited"), { department: "Engineering" }))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });

  test("a department takes in the ones inside it; an office narrows to its jobs; each job carries both and its openings", async () => {
    const fake = new FakeSupabase([
      { data: [ENG, PLATFORM, INFRA] },
      { data: [NYC] },
      { data: [{ role_id: "role-1" }, { role_id: "role-1" }] },
      { data: [{
        id: "role-1", title: "SRE", status: "open", location: null, seniority: null, applications: [{ count: 4 }],
        departments: { name: "Infra" }, job_offices: [{ offices: { name: "Remote" } }, { offices: { name: "New York" } }],
        openings: [{ status: "open" }, { status: "filled" }, { status: "open" }],
      }] },
      // The job's custom fields (custom-fields.ts customFieldValuesFor).
      { data: [] },
    ]);
    const jobs = await listJobs(fake.asDb(), ctx("elevated"), { department: "engineering", office: "New York" });
    expect(jobs).toEqual([{
      jobId: "role-1", title: "SRE", status: "open", location: null, seniority: null, inPipeline: 4, customFields: [],
      department: "Infra", offices: ["New York", "Remote"], openings: { open: 2, filled: 1, closed: 0 },
    }]);
    const roles = fake.calls.find((c) => c.table === "roles")!;
    expect(roles.filters).toContainEqual({ method: "in", column: "department_id", value: [ENG.id, PLATFORM.id, INFRA.id] });
    expect(roles.filters).toContainEqual({ method: "in", column: "id", value: ["role-1"] });
  });

  test("an office with no jobs is an empty answer, and an unknown department a sentence", async () => {
    const empty = new FakeSupabase([{ data: [NYC] }, { data: [] }]);
    expect(await listJobs(empty.asDb(), ctx(), { office: NYC.id })).toEqual([]);
    const unknown = new FakeSupabase([{ data: [ENG] }]);
    expect((await refusal(listJobs(unknown.asDb(), ctx(), { department: "Sales" }))).code).toBe("not_found");
  });
});
