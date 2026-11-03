import { describe, expect, test, vi } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { addToHiringTeam, createJob, inviteMember, setMemberAccess, updateJob } from "./admin.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";

const ctx = (accessLevel: ClientToolCtx["accessLevel"] = "admin"): ClientToolCtx => ({
  actorId: "actor-1", orgId: "org-1", accessLevel, source: "claude",
});

async function refusal(promise: Promise<unknown>): Promise<ClientToolError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ClientToolError);
  return err as ClientToolError;
}

const lastFinish = (fake: FakeSupabase) => fake.calls.filter((c) => c.table === "client_finish_write").at(-1);
const DEPT = "d0000000-0000-4000-8000-000000000001";
const DEPT_2 = "d0000000-0000-4000-8000-000000000002";
const OFFICE = "0f000000-0000-4000-8000-000000000001";
const OFFICE_2 = "0f000000-0000-4000-8000-000000000002";

describe("createJob", () => {
  test("only an admin, and nothing is read or claimed first", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(createJob(fake.asDb(), ctx("elevated"), { title: "Engineer" }))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });

  test("a company's first job makes its company row from the org's name; neither row is read back", async () => {
    const fake = new FakeSupabase([
      { data: "audit-1" },
      { data: [] }, { data: { name: "Acme" } }, { data: null },
      { data: null },
      { data: null },
      { data: null },
    ]);
    const job = await createJob(fake.asDb(), ctx(), { title: "  Founding Engineer ", location: "NYC" });
    expect(job).toMatchObject({ title: "Founding Engineer", status: "open", openings: 1, department: null, offices: [] });

    const company = fake.calls.find((c) => c.table === "companies" && c.op === "insert")!;
    const role = fake.calls.find((c) => c.table === "roles" && c.op === "insert")!;
    expect(company.args).toMatchObject({ name: "Acme" });
    expect(role.args).toMatchObject({
      id: job.jobId, company_id: (company.args as { id: string }).id, title: "Founding Engineer", status: "open", location: "NYC",
    });
    // A RETURNING row on a member's token fails the roles read policy: nothing selects after either insert.
    expect(company.terminal).toBe("await");
    expect(role.terminal).toBe("await");
    expect(lastFinish(fake)?.args).toMatchObject({ p_entity_id: job.jobId, p_keep: true });
    // One opening by default, its id made here and not read back.
    const opening = fake.calls.find((c) => c.table === "openings" && c.op === "insert")!;
    expect(opening.args).toEqual([{ id: expect.any(String), role_id: job.jobId }]);
    expect(opening.terminal).toBe("await");
  });

  test("a department and offices by name, and several openings, in the one audited write", async () => {
    const fake = new FakeSupabase([
      { data: [{ id: DEPT, name: "Engineering", parent_id: null, archived_at: null }] },
      { data: [{ id: OFFICE, name: "New York", location: "New York, NY", archived_at: null }] },
      { data: "audit-1" },
      { data: [{ id: "company-1" }] },
      { data: null }, { data: null }, { data: null },
      { data: null },
    ]);
    const job = await createJob(fake.asDb(), ctx(), { title: "SRE", department: "engineering", offices: ["new york", OFFICE], openings: 3 });
    expect(job).toMatchObject({ department: "Engineering", offices: ["New York"], openings: 3 });
    expect(fake.calls.find((c) => c.table === "roles" && c.op === "insert")?.args).toMatchObject({ department_id: DEPT });
    expect(fake.calls.find((c) => c.table === "job_offices")?.args).toEqual([{ id: expect.any(String), role_id: job.jobId, office_id: OFFICE }]);
    expect(fake.calls.find((c) => c.table === "openings")?.args).toHaveLength(3);
    expect(lastFinish(fake)?.args).toMatchObject({ p_after: { department_id: DEPT, office_ids: [OFFICE], openings: 3 } });
  });

  test("an archived department, an unknown office or a bad count is refused before the claim", async () => {
    const archived = new FakeSupabase([{ data: [{ id: DEPT, name: "Engineering", parent_id: null, archived_at: "2026-10-01T00:00:00Z" }] }]);
    expect((await refusal(createJob(archived.asDb(), ctx(), { title: "SRE", department: "Engineering" }))).message).toMatch(/archived/);
    const unknown = new FakeSupabase([{ data: [] }]);
    expect((await refusal(createJob(unknown.asDb(), ctx(), { title: "SRE", offices: ["Mars"] }))).code).toBe("not_found");
    const count = new FakeSupabase();
    expect((await refusal(createJob(count.asDb(), ctx(), { title: "SRE", openings: 51 }))).code).toBe("invalid");
    for (const f of [archived, unknown, count]) expect(f.calls.map((c) => c.table)).not.toContain("client_claim_write");
  });

  test("a job made closed gets no opening unless asked", async () => {
    const fake = new FakeSupabase([{ data: "audit-1" }, { data: [{ id: "company-1" }] }, { data: null }, { data: null }]);
    expect((await createJob(fake.asDb(), ctx(), { title: "Old role", status: "closed" })).openings).toBe(0);
    expect(fake.calls.map((c) => c.table)).not.toContain("openings");
  });

  test("an empty title or an unknown status is refused before the claim", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(createJob(fake.asDb(), ctx(), { title: "  " }))).code).toBe("invalid");
    expect((await refusal(createJob(fake.asDb(), ctx(), { title: "X", status: "pending_approval" as never }))).code).toBe("invalid");
    expect(fake.calls).toEqual([]);
  });
});

describe("updateJob", () => {
  const JOB = { id: "role-1", title: "Engineer", status: "open", location: null, seniority: null, description: null };

  test("only the columns that change are written and audited", async () => {
    const fake = new FakeSupabase([{ data: JOB }, { data: true }, { data: "audit-1" }, { data: [{ id: "role-1" }] }, { data: null }]);
    const r = await updateJob(fake.asDb(), ctx(), { jobId: "role-1", title: "Engineer", status: "paused" });
    expect(r).toEqual({ outcome: "updated", changed: ["status"] });
    expect(fake.calls.find((c) => c.op === "update")?.args).toMatchObject({ status: "paused" });
    expect(lastFinish(fake)?.args).toMatchObject({ p_before: { status: "open" }, p_after: { status: "paused" }, p_keep: true });
  });

  test("no change is no claim", async () => {
    const fake = new FakeSupabase([{ data: JOB }, { data: true }]);
    expect(await updateJob(fake.asDb(), ctx(), { jobId: "role-1", status: "open" })).toEqual({ outcome: "unchanged", changed: [] });
    expect(fake.calls.map((c) => c.table)).toEqual(["roles", "can_on_role"]);
  });

  test("a department and the office set: only the difference is written, in one audited change", async () => {
    const fake = new FakeSupabase([
      { data: { ...JOB, department_id: DEPT } }, { data: true },
      { data: [{ id: DEPT, name: "Engineering", parent_id: null, archived_at: null }, { id: DEPT_2, name: "Platform", parent_id: DEPT, archived_at: null }] },
      { data: [{ office_id: OFFICE }] },
      { data: [
        { id: OFFICE, name: "New York", location: null, archived_at: null },
        { id: OFFICE_2, name: "Remote", location: null, archived_at: null },
      ] },
      { data: "audit-1" },
      { data: [{ id: "role-1" }] },
      { data: [{ id: "jo-1" }] },
      { data: null },
      { data: null },
    ]);
    const r = await updateJob(fake.asDb(), ctx(), { jobId: "role-1", department: "platform", offices: ["Remote"] });
    expect(r).toEqual({ outcome: "updated", changed: ["department", "offices"] });
    expect(fake.calls.find((c) => c.table === "roles" && c.op === "update")?.args).toMatchObject({ department_id: DEPT_2 });
    const removed = fake.calls.find((c) => c.table === "job_offices" && c.op === "delete")!;
    expect(removed.filters).toEqual([
      { method: "eq", column: "role_id", value: "role-1" }, { method: "in", column: "office_id", value: [OFFICE] },
    ]);
    expect(fake.calls.find((c) => c.table === "job_offices" && c.op === "insert")?.args)
      .toEqual([{ id: expect.any(String), role_id: "role-1", office_id: OFFICE_2 }]);
    expect(lastFinish(fake)?.args).toMatchObject({
      p_before: { department_id: DEPT, office_ids: [OFFICE] },
      p_after: { department_id: DEPT_2, office_ids_added: [OFFICE_2], office_ids_removed: [OFFICE] },
    });
  });

  test("the department it already has, even archived, and the same offices change nothing", async () => {
    const fake = new FakeSupabase([
      { data: { ...JOB, department_id: DEPT } }, { data: true },
      { data: [{ id: DEPT, name: "Engineering", parent_id: null, archived_at: "2026-10-01T00:00:00Z" }] },
      { data: [{ office_id: OFFICE }] },
      { data: [{ id: OFFICE, name: "New York", location: null, archived_at: "2026-10-01T00:00:00Z" }] },
    ]);
    expect(await updateJob(fake.asDb(), ctx(), { jobId: "role-1", department: DEPT, offices: ["New York"] }))
      .toEqual({ outcome: "unchanged", changed: [] });
    expect(fake.calls.map((c) => c.table)).not.toContain("client_claim_write");
  });

  test("a status picked against one the job no longer has is refused, nothing claimed", async () => {
    // Read open; someone paused it since; this caller still thinks it is closed.
    const fake = new FakeSupabase([{ data: { ...JOB, status: "paused" } }, { data: true }]);
    const err = await refusal(updateJob(fake.asDb(), ctx(), { jobId: "role-1", title: "Staff engineer", status: "open", expectedStatus: "closed" }));
    expect(err.code).toBe("invalid");
    expect(err.message).toMatch(/status changed since it was read/);
    expect(fake.calls.map((c) => c.table)).toEqual(["roles", "can_on_role"]);
  });

  test("the expected status is a condition on the write, and a write that misses it is the same refusal", async () => {
    const ok = new FakeSupabase([{ data: JOB }, { data: true }, { data: "audit-1" }, { data: [{ id: "role-1" }] }, { data: null }]);
    expect(await updateJob(ok.asDb(), ctx(), { jobId: "role-1", status: "paused", expectedStatus: "open" })).toEqual({ outcome: "updated", changed: ["status"] });
    expect(ok.calls.find((c) => c.op === "update")?.filters).toEqual([
      { method: "eq", column: "id", value: "role-1" }, { method: "eq", column: "status", value: "open" },
    ]);

    // Moved on between the read and the write: no row matched, the claim is given back.
    const raced = new FakeSupabase([{ data: JOB }, { data: true }, { data: "audit-1" }, { data: [] }, { data: null }]);
    expect((await refusal(updateJob(raced.asDb(), ctx(), { jobId: "role-1", status: "paused", expectedStatus: "open" }))).message).toMatch(/status changed/);
    expect(lastFinish(raced)?.args).toMatchObject({ p_keep: false });
  });

  test("an expected status that does not match is no refusal when the status is not changing", async () => {
    // A title alone, or the status it already has: the status is not written, so it is not checked.
    const fake = new FakeSupabase([{ data: { ...JOB, status: "paused" } }, { data: true }, { data: "audit-1" }, { data: [{ id: "role-1" }] }, { data: null }]);
    expect(await updateJob(fake.asDb(), ctx(), { jobId: "role-1", title: "Staff engineer", status: "paused", expectedStatus: "open" }))
      .toEqual({ outcome: "updated", changed: ["title"] });
    expect(fake.calls.find((c) => c.op === "update")?.args).not.toHaveProperty("status");
    expect(fake.calls.find((c) => c.op === "update")?.filters).toEqual([{ method: "eq", column: "id", value: "role-1" }]);
  });

  test("seeing a job is not managing it", async () => {
    const fake = new FakeSupabase([{ data: JOB }, { data: false }]);
    expect((await refusal(updateJob(fake.asDb(), ctx("elevated"), { jobId: "role-1", status: "closed" }))).code).toBe("forbidden");
  });
});

describe("hiring team and access", () => {
  test("someone not in the company is not found, and nothing is claimed", async () => {
    const fake = new FakeSupabase([{ data: { id: "role-1", title: "E", status: "open" } }, { data: true }, { data: null }]);
    const err = await refusal(addToHiringTeam(fake.asDb(), ctx(), { jobId: "role-1", userId: "stranger", teamRole: "recruiter" }));
    expect(err.code).toBe("not_found");
    expect(fake.calls.map((c) => c.table)).not.toContain("client_claim_write");
  });

  test("the last admin cannot step down: a sentence, and the claim is given back", async () => {
    const fake = new FakeSupabase([
      { data: { id: "actor-1", display_name: "Ada" } },
      { data: "audit-1" },
      { error: { code: "23514", message: "the org would have no admin" } },
      { data: null },
    ]);
    const err = await refusal(setMemberAccess(fake.asDb(), ctx(), { userId: "actor-1", access: "elevated" }));
    expect(err.message).toMatch(/no admin left/);
    expect(lastFinish(fake)?.args).toMatchObject({ p_audit: "audit-1", p_keep: false });
  });

  test("a change is audited with the level before and after", async () => {
    const fake = new FakeSupabase([{ data: { id: "actor-2", display_name: "Ivan" } }, { data: "audit-1" }, { data: "limited" }, { data: null }]);
    expect(await setMemberAccess(fake.asDb(), ctx(), { userId: "actor-2", access: "elevated" }))
      .toEqual({ outcome: "changed", previous: "limited", access: "elevated" });
    expect(lastFinish(fake)?.args).toMatchObject({ p_before: { access_level: "limited" }, p_after: { access_level: "elevated" }, p_keep: true });
  });
});

describe("inviteMember", () => {
  const deps = (invitations: Parameters<typeof inviteMember>[2]["invitations"]) => ({ invitations, workosOrgId: "org_acme", inviterUserId: "user_ada" });

  test("without WorkOS configured it refuses before anything is written", async () => {
    const fake = new FakeSupabase();
    const err = await refusal(inviteMember(fake.asDb(), ctx(), deps(null), { email: "a@b.co", name: "A", access: "limited" }));
    expect(err.message).toMatch(/not turned on/);
    expect(fake.calls).toEqual([]);
  });

  test("the invitation names the inviter and the token's organization", async () => {
    const sendInvitation = vi.fn(async () => ({ id: "inv_1" }));
    const idp = { createOrganization: vi.fn(), sendInvitation, revokeInvitations: vi.fn() };
    const fake = new FakeSupabase([{ data: "audit-1" }, { data: [{ actor_id: "actor-9", resent: false }] }, { data: null }]);
    expect(await inviteMember(fake.asDb(), ctx(), deps(idp), { email: " New@Acme.test ", name: "Nia", access: "elevated" }))
      .toEqual({ outcome: "invited", userId: "actor-9" });
    expect(sendInvitation).toHaveBeenCalledWith({ email: "new@acme.test", organizationId: "org_acme", inviterUserId: "user_ada" });
  });

  test("someone already a member is a sentence, and the claim is given back", async () => {
    const idp = { createOrganization: vi.fn(), sendInvitation: vi.fn(), revokeInvitations: vi.fn() };
    const fake = new FakeSupabase([{ data: "audit-1" }, { error: { code: "23505", message: "already a member" } }, { data: null }]);
    const err = await refusal(inviteMember(fake.asDb(), ctx(), deps(idp), { email: "ada@acme.test", name: "Ada", access: "admin" }));
    expect(err.message).toMatch(/already a member/);
    expect(idp.sendInvitation).not.toHaveBeenCalled();
    expect(lastFinish(fake)?.args).toMatchObject({ p_keep: false });
  });
});
