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
    ]);
    const job = await createJob(fake.asDb(), ctx(), { title: "  Founding Engineer ", location: "NYC" });
    expect(job).toMatchObject({ title: "Founding Engineer", status: "open" });

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
