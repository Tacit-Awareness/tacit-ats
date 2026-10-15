import { describe, expect, test, vi } from "vitest";
import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import type { IdentityProvider } from "@tacit/core";
import { ClientInviteError, inviteClientMember, listPendingInvites, withdrawClientInvite, type InvitationRevoker } from "./invite.js";

const idp = (over: Partial<IdentityProvider> = {}): IdentityProvider => ({
  createOrganization: vi.fn(async () => ({ id: "unused" })),
  sendInvitation: vi.fn(async () => ({ id: "inv_1" })),
  ...over,
});
const code = async (p: Promise<unknown>) =>
  p.then(() => "resolved", (e) => (e instanceof ClientInviteError ? e.code : `threw ${e}`));
const INPUT = { email: "  Grace@Acme.test ", displayName: "Grace", accessLevel: "elevated" as const, workosOrgId: "org_w", inviterUserId: "user_w" };

describe("inviteClientMember", () => {
  test("the database writes the actor as the inviter, then WorkOS sends the email", async () => {
    const fake = new FakeSupabase([{ data: [{ actor_id: "a-1", resent: false }] }]);
    const provider = idp();

    expect(await inviteClientMember(fake.asDb(), provider, INPUT)).toEqual({ actorId: "a-1", resent: false });
    expect(fake.calls[0]).toMatchObject({
      table: "invite_org_member", op: "rpc",
      args: { p_email: "grace@acme.test", p_display_name: "Grace", p_access_level: "elevated" },
    });
    expect(provider.sendInvitation).toHaveBeenCalledWith({ email: "grace@acme.test", organizationId: "org_w", inviterUserId: "user_w" });
  });

  test.each([
    ["42501", "forbidden"],
    ["22023", "invalid"],
    ["23505", "already_member"],
  ])("SQLSTATE %s is %s, and nothing is sent", async (sqlstate, expected) => {
    const fake = new FakeSupabase([{ error: { code: sqlstate, message: "no" } }]);
    const provider = idp();
    expect(await code(inviteClientMember(fake.asDb(), provider, INPUT))).toBe(expected);
    expect(provider.sendInvitation).not.toHaveBeenCalled();
  });

  test("WorkOS refusing a first invitation withdraws the actor again", async () => {
    const fake = new FakeSupabase([{ data: [{ actor_id: "a-1", resent: false }] }, { data: true }]);
    const provider = idp({ sendInvitation: vi.fn(async () => { throw new Error("down"); }) });

    expect(await code(inviteClientMember(fake.asDb(), provider, INPUT))).toBe("provider_failed");
    expect(fake.calls[1]).toMatchObject({ table: "withdraw_org_invite", op: "rpc", args: { p_actor: "a-1" } });
  });

  test("WorkOS refusing a re-send leaves the earlier invitation alone", async () => {
    const fake = new FakeSupabase([{ data: [{ actor_id: "a-1", resent: true }] }]);
    const provider = idp({ sendInvitation: vi.fn(async () => { throw new Error("down"); }) });

    expect(await code(inviteClientMember(fake.asDb(), provider, INPUT))).toBe("provider_failed");
    expect(fake.calls).toHaveLength(1);
  });
});

describe("listPendingInvites", () => {
  test("maps the rows", async () => {
    const fake = new FakeSupabase([{
      data: [{ actor_id: "a-1", display_name: "Grace", email: "grace@acme.test", access_level: "admin", invited_at: "2026-10-14T00:00:00Z" }],
    }]);
    expect(await listPendingInvites(fake.asDb())).toEqual([
      { actorId: "a-1", displayName: "Grace", email: "grace@acme.test", accessLevel: "admin", invitedAt: "2026-10-14T00:00:00Z" },
    ]);
  });
});

describe("withdrawClientInvite", () => {
  const revoker = (fail = false): InvitationRevoker => ({
    revokeInvitations: vi.fn(async () => { if (fail) throw new Error("down"); }),
  });
  const PENDING = [{ actor_id: "a-1", display_name: "G", email: "grace@acme.test", access_level: "limited", invited_at: "t" }];

  test("removes the actor, then revokes the WorkOS invitation for that address", async () => {
    const fake = new FakeSupabase([{ data: PENDING }, { data: true }]);
    const idpRevoke = revoker();
    expect(await withdrawClientInvite(fake.asDb(), idpRevoke, { actorId: "a-1", workosOrgId: "org_w" })).toEqual({ withdrawn: true });
    expect(idpRevoke.revokeInvitations).toHaveBeenCalledWith({ email: "grace@acme.test", organizationId: "org_w" });
  });

  test("nothing to withdraw touches no WorkOS invitation", async () => {
    const fake = new FakeSupabase([{ data: [] }, { data: false }]);
    const idpRevoke = revoker();
    expect(await withdrawClientInvite(fake.asDb(), idpRevoke, { actorId: "a-9", workosOrgId: "org_w" })).toEqual({ withdrawn: false });
    expect(idpRevoke.revokeInvitations).not.toHaveBeenCalled();
  });

  test("a failed revoke still reports the withdrawal", async () => {
    const fake = new FakeSupabase([{ data: PENDING }, { data: true }]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await withdrawClientInvite(fake.asDb(), revoker(true), { actorId: "a-1", workosOrgId: "org_w" })).toEqual({ withdrawn: true });
    spy.mockRestore();
  });

  test("a non-admin is refused", async () => {
    const fake = new FakeSupabase([{ data: [] }, { error: { code: "42501", message: "no" } }]);
    expect(await code(withdrawClientInvite(fake.asDb(), revoker(), { actorId: "a-1", workosOrgId: "org_w" }))).toBe("forbidden");
  });
});
