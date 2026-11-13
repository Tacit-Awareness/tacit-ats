import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createClientOrg, inviteOrgMember, type IdentityProvider } from "@tacit/core";
import { getSupabaseServiceClient } from "@tacit/db";

import { bindSupabaseUser } from "./bind.js";

// Staff onboarding (tacit-internal's ATS Admin, /admin/orgs, @tacit/core's createClientOrg and
// inviteOrgMember) handing over to this repo's first sign-in. The onboarding
// half on its own is tested in tacit-internal.

const db = () => getSupabaseServiceClient();

/** WorkOS, faked: hands out an organization id per call and records invitations. */
function fakeIdp(opts: { failCreate?: boolean; failInvite?: boolean } = {}) {
  const sent: Array<{ email: string; organizationId: string }> = [];
  let n = 0;
  const idp: IdentityProvider = {
    createOrganization: async () => {
      if (opts.failCreate) throw new Error("workos down");
      return { id: `org_test_${Date.now()}_${n++}` };
    },
    sendInvitation: async (input) => {
      if (opts.failInvite) throw new Error("workos refused");
      sent.push(input);
      return { id: `inv_${sent.length}` };
    },
  };
  return { idp, sent };
}

async function clearClientOrgs() {
  const { data: orgs } = await db().from("orgs").select("id").eq("kind", "client");
  const ids = (orgs ?? []).map((o) => o.id);
  if (!ids.length) return;
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

beforeEach(clearClientOrgs);
afterAll(clearClientOrgs);

describe("client org onboarding, then the first sign-in, against real Postgres", () => {
  test("an invited admin can sign in: the invitation's actor is what the first sign-in binds", async () => {
    const { idp, sent } = fakeIdp();
    const org = await createClientOrg(db(), idp, { name: "Acme" });
    const invited = await inviteOrgMember(db(), idp, {
      orgId: org.id, email: "Ada@Acme.test", displayName: "Ada", accessLevel: "admin",
    });
    expect(sent).toEqual([{ email: "ada@acme.test", organizationId: org.workosOrgId }]);

    const { data: actor } = await db()
      .from("actors").select("org_id, email, access_level, auth_subject").eq("id", invited.actorId).single();
    expect(actor).toEqual({ org_id: org.id, email: "ada@acme.test", access_level: "admin", auth_subject: null });

    // The round trip /client makes on a first sign-in (Supabase Auth: by the verified email).
    expect(
      await bindSupabaseUser(db(), { userId: "5a000000-0000-4000-8000-0000000000ad", email: "ada@acme.test", emailVerified: true }),
    ).toEqual({ status: "ok", companies: 1, firstSignIn: true });
    const { data: bound } = await db().from("actors").select("auth_subject").eq("id", invited.actorId).single();
    expect(bound?.auth_subject).toBe("5a000000-0000-4000-8000-0000000000ad");

    // Once signed in, a second invitation is refused rather than re-sent.
    await expect(
      inviteOrgMember(db(), idp, { orgId: org.id, email: "ada@acme.test", displayName: "Ada", accessLevel: "admin" }),
    ).rejects.toMatchObject({ code: "already_invited" });
    expect(sent).toHaveLength(1);
  });

  test("one address can be a member of two orgs, each with its own actor", async () => {
    const { idp } = fakeIdp();
    const acme = await createClientOrg(db(), idp, { name: "Acme" });
    const globex = await createClientOrg(db(), idp, { name: "Globex" });
    const a = await inviteOrgMember(db(), idp, { orgId: acme.id, email: "both@example.test", displayName: "Both", accessLevel: "admin" });
    const g = await inviteOrgMember(db(), idp, { orgId: globex.id, email: "both@example.test", displayName: "Both", accessLevel: "limited" });
    expect(a.actorId).not.toBe(g.actorId);

    // One Supabase user binds in both at once, by the verified email; the company is picked at sign-in.
    const userId = "5a000000-0000-4000-8000-0000000000b0";
    expect(await bindSupabaseUser(db(), { userId, email: "both@example.test", emailVerified: true })).toEqual({ status: "ok", companies: 2, firstSignIn: true });
    const { data: rows } = await db().from("actors").select("id, auth_subject").in("id", [a.actorId, g.actorId]);
    expect(rows?.every((r) => r.auth_subject === userId)).toBe(true);
  });
});
