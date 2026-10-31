import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";
import type { clientTools } from "@tacit-ats/core";

import { changeMemberAccess, readMembers, soleAdmin } from "./member-access";

/**
 * Changing a member's access against the local stack, on members' own tokens:
 * set_org_member_access decides who may, and that the org keeps an admin. The
 * member token is signed with the stack's JWT secret, as in
 * pipeline.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "e6000000-0000-4000-8000-0000000000a1";
const GLOBEX = "e6000000-0000-4000-8000-0000000000a2";
const ADA = "e6a00000-0000-4000-8000-0000000000a1";
const LEE = "e6a00000-0000-4000-8000-0000000000a2";
const IVY = "e6a00000-0000-4000-8000-0000000000a3";
const PAM = "e6a00000-0000-4000-8000-0000000000a4";
const GUS = "e6a00000-0000-4000-8000-0000000000a5";
const TESS = "e6a00000-0000-4000-8000-0000000000a6";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  must(await db().from("audit_log").delete().in("org_id", ids));
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const member = (subject: string, workosOrgId = "org_itest_access_acme") => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};

const ctx = (actorId: string, accessLevel: clientTools.ClientToolCtx["accessLevel"]): clientTools.ClientToolCtx => ({ actorId, orgId: ACME, accessLevel, source: "dashboard" });

const levelOf = async (id: string) => (await db().from("actors").select("access_level").eq("id", id).single()).data?.access_level;
const audit = async () =>
  must(await db().from("audit_log").select("action, entity, entity_id, source, before, after").eq("org_id", ACME).eq("action", "member.access_change").order("created_at")).data ?? [];

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-access-acme", kind: "client", workos_org_id: "org_itest_access_acme" },
    { id: GLOBEX, name: "Globex", slug: "itest-access-globex", kind: "client", workos_org_id: "org_itest_access_globex" },
  ]));
  must(await db().from("actors").insert([
    { id: ADA, org_id: ACME, slug: "itest-access-ada", display_name: "Ada Admin", email: "ada@access.test", access_level: "admin", auth_subject: "user_access_ada" },
    { id: LEE, org_id: ACME, slug: "itest-access-lee", display_name: "Lee Lead", email: "lee@access.test", access_level: "elevated", auth_subject: "user_access_lee" },
    { id: IVY, org_id: ACME, slug: "itest-access-ivy", display_name: "Ivy Interviewer", email: "ivy@access.test", access_level: "limited", auth_subject: "user_access_ivy" },
    { id: GUS, org_id: GLOBEX, slug: "itest-access-gus", display_name: "Gus Globex", email: "gus@access.test", access_level: "limited", auth_subject: "user_access_gus" },
  ]));
});

afterAll(clear);

describe("changeMemberAccess", () => {
  test("an admin changes a member's level, and the audit row says what and from where", async () => {
    expect(await changeMemberAccess(member("user_access_ada"), ctx(ADA, "admin"), { actorId: IVY, level: "elevated" })).toEqual({ ok: true, changed: true });
    expect(await levelOf(IVY)).toBe("elevated");
    expect(await audit()).toEqual([
      { action: "member.access_change", entity: "actor", entity_id: IVY, source: "dashboard", before: { access_level: "limited" }, after: { access_level: "elevated" } },
    ]);
  });

  test("the level they already have changes nothing and leaves no audit row", async () => {
    expect(await changeMemberAccess(member("user_access_ada"), ctx(ADA, "admin"), { actorId: IVY, level: "limited" })).toEqual({ ok: true, changed: false });
    expect(await audit()).toEqual([]);
  });

  test("the last admin cannot be lowered, and the claim is given back", async () => {
    for (const level of ["elevated", "limited"]) {
      expect(await changeMemberAccess(member("user_access_ada"), ctx(ADA, "admin"), { actorId: ADA, level })).toEqual({ ok: false, error: "last_admin" });
    }
    expect(await levelOf(ADA)).toBe("admin");
    expect(await audit()).toEqual([]);
  });

  test("an admin invited but not signed in does not count as the admin left", async () => {
    must(await db().from("actors").insert({ id: PAM, org_id: ACME, slug: "itest-access-pam", display_name: "Pam Pending", email: "pam@access.test", access_level: "admin" }));
    expect(await changeMemberAccess(member("user_access_ada"), ctx(ADA, "admin"), { actorId: ADA, level: "elevated" })).toEqual({ ok: false, error: "last_admin" });
    expect(await levelOf(ADA)).toBe("admin");
  });

  test("with a second admin one can step down, and is no admin on the very next try", async () => {
    const ada = member("user_access_ada");
    expect((await changeMemberAccess(ada, ctx(ADA, "admin"), { actorId: LEE, level: "admin" })).ok).toBe(true);
    expect(await changeMemberAccess(ada, ctx(ADA, "admin"), { actorId: ADA, level: "limited" })).toEqual({ ok: true, changed: true });
    expect(await levelOf(ADA)).toBe("limited");

    // Even with a page still open from when she was: the database asks again.
    expect(await changeMemberAccess(ada, ctx(ADA, "admin"), { actorId: IVY, level: "admin" })).toEqual({ ok: false, error: "access_forbidden" });
    expect(await levelOf(IVY)).toBe("limited");
  });

  test("two admins lowering each other at once leave one", async () => {
    must(await db().from("actors").update({ access_level: "admin" }).eq("id", LEE));
    const outcomes = await Promise.all([
      changeMemberAccess(member("user_access_ada"), ctx(ADA, "admin"), { actorId: LEE, level: "elevated" }),
      changeMemberAccess(member("user_access_lee"), ctx(LEE, "admin"), { actorId: ADA, level: "elevated" }),
    ]);
    // The loser is refused either as the last admin or, already lowered, as no admin at all.
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect([await levelOf(ADA), await levelOf(LEE)].sort()).toEqual(["admin", "elevated"]);
  });

  test("the hiring team and interviewers cannot, whatever the page sent", async () => {
    expect(await changeMemberAccess(member("user_access_lee"), ctx(LEE, "elevated"), { actorId: LEE, level: "admin" })).toEqual({ ok: false, error: "access_forbidden" });
    expect(await changeMemberAccess(member("user_access_ivy"), ctx(IVY, "limited"), { actorId: IVY, level: "admin" })).toEqual({ ok: false, error: "access_forbidden" });
    // A context claiming admin gets no further: the definer function asks who the token is.
    expect(await changeMemberAccess(member("user_access_lee"), ctx(LEE, "admin"), { actorId: LEE, level: "admin" })).toEqual({ ok: false, error: "access_forbidden" });
    expect(await levelOf(LEE)).toBe("elevated");
    expect(await levelOf(IVY)).toBe("limited");
  });

  test("someone at another company is not found", async () => {
    expect(await changeMemberAccess(member("user_access_ada"), ctx(ADA, "admin"), { actorId: GUS, level: "admin" })).toEqual({ ok: false, error: "member_gone" });
    expect(await levelOf(GUS)).toBe("limited");
  });

  test("another company's admin reaches nothing here, and a claim on the wrong org is nobody", async () => {
    must(await db().from("actors").update({ access_level: "admin" }).eq("id", GUS));
    const gus = member("user_access_gus", "org_itest_access_globex");
    expect(await changeMemberAccess(gus, { ...ctx(GUS, "admin"), orgId: GLOBEX }, { actorId: IVY, level: "admin" })).toEqual({ ok: false, error: "member_gone" });
    const crossed = member("user_access_ada", "org_itest_access_globex");
    expect(await changeMemberAccess(crossed, ctx(ADA, "admin"), { actorId: GUS, level: "limited" })).toEqual({ ok: false, error: "member_gone" });
    expect(await levelOf(IVY)).toBe("limited");
    expect(await levelOf(GUS)).toBe("admin");
  });

  test("an archived member is gone, leaves no claim, and an archived admin is not the admin left", async () => {
    must(await db().from("actors").insert({ id: PAM, org_id: ACME, slug: "itest-access-pam", display_name: "Pam Past", email: "pam@access.test", access_level: "admin", auth_subject: "user_access_pam", archived_at: new Date().toISOString() }));
    expect(await changeMemberAccess(member("user_access_ada"), ctx(ADA, "admin"), { actorId: PAM, level: "limited" })).toEqual({ ok: false, error: "member_gone" });
    expect(await changeMemberAccess(member("user_access_ada"), ctx(ADA, "admin"), { actorId: ADA, level: "limited" })).toEqual({ ok: false, error: "last_admin" });
    expect(await levelOf(PAM)).toBe("admin");
    expect(await audit()).toEqual([]);
  });

  test("the same change sent five times at once happens once and is audited once", async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => changeMemberAccess(member("user_access_ada"), ctx(ADA, "admin"), { actorId: IVY, level: "elevated" })),
    );
    expect(outcomes.filter((o) => o.ok && o.changed)).toHaveLength(1);
    expect(outcomes.filter((o) => o.ok && !o.changed)).toHaveLength(4);
    expect(await audit()).toHaveLength(1);
  });

  test("two admins setting one member at once: each audit row says what that write really changed", async () => {
    must(await db().from("actors").update({ access_level: "admin" }).eq("id", LEE));
    await Promise.all([
      changeMemberAccess(member("user_access_ada"), ctx(ADA, "admin"), { actorId: IVY, level: "elevated" }),
      changeMemberAccess(member("user_access_lee"), ctx(LEE, "admin"), { actorId: IVY, level: "admin" }),
    ]);
    const rows = await audit();
    const final = await levelOf(IVY);
    const after = rows.map((r) => (r.after as { access_level: string }).access_level);
    const before = rows.map((r) => (r.before as { access_level: string }).access_level);
    expect(rows).toHaveLength(2);
    expect(after).toContain(final);
    expect(before.sort()).toEqual(["limited", after.find((a) => a !== final)].sort());
  });

  test("four admins each lowering the next at once leave an admin", async () => {
    must(await db().from("actors").update({ access_level: "admin" }).eq("id", LEE));
    must(await db().from("actors").update({ access_level: "admin" }).eq("id", IVY));
    must(await db().from("actors").insert({ id: PAM, org_id: ACME, slug: "itest-access-pam", display_name: "Pam Peer", email: "pam@access.test", access_level: "admin", auth_subject: "user_access_pam" }));
    const ring = [["user_access_ada", ADA, LEE], ["user_access_lee", LEE, IVY], ["user_access_ivy", IVY, PAM], ["user_access_pam", PAM, ADA]];
    await Promise.all(ring.map(([subject, me, them]) => changeMemberAccess(member(subject), ctx(me, "admin"), { actorId: them, level: "limited" })));
    const levels = await Promise.all([ADA, LEE, IVY, PAM].map(levelOf));
    expect(levels.filter((l) => l === "admin").length).toBeGreaterThanOrEqual(1);
  });

  test("the hourly limit refuses and changes nothing", async () => {
    must(await db().from("audit_log").insert(Array.from({ length: 300 }, () => ({ org_id: ACME, actor_id: ADA, source: "dashboard", action: "x.y", entity: "z", after: {} }))));
    expect(await changeMemberAccess(member("user_access_ada"), ctx(ADA, "admin"), { actorId: IVY, level: "admin" })).toEqual({ ok: false, error: "rate_limited" });
    expect(await levelOf(IVY)).toBe("limited");
  });

  test("a Tacit submitter is listed, but raised to admin still is not the admin left", async () => {
    must(await db().from("actors").insert({ id: TESS, org_id: ACME, slug: "itest-access-tess", display_name: "Tess (Tacit)", email: "tess@access.test", access_level: "limited", tacit_agency: true }));
    const ada = member("user_access_ada");
    expect((await readMembers(ada)).rows.map((m) => m.id)).toContain(TESS);
    expect(await changeMemberAccess(ada, ctx(ADA, "admin"), { actorId: TESS, level: "admin" })).toEqual({ ok: true, changed: true });
    expect(await changeMemberAccess(ada, ctx(ADA, "admin"), { actorId: ADA, level: "limited" })).toEqual({ ok: false, error: "last_admin" });
    expect(await levelOf(ADA)).toBe("admin");
  });
});

describe("readMembers", () => {
  test("reads past the database's 1000 rows a read, so a second admin late in the alphabet is seen", async () => {
    must(await db().from("actors").insert(
      Array.from({ length: 1500 }, (_, i) => ({ org_id: ACME, slug: `itest-access-m${i}`, display_name: `Member ${String(i).padStart(4, "0")}`, email: `m${i}@access.test`, access_level: "limited", auth_subject: `user_access_m${i}` })),
    ));
    must(await db().from("actors").insert({ id: PAM, org_id: ACME, slug: "itest-access-zed", display_name: "Zed Admin", email: "zed@access.test", access_level: "admin", auth_subject: "user_access_zed" }));
    const { rows, truncated } = await readMembers(member("user_access_ada"));
    expect(truncated).toBe(false);
    expect(new Set(rows.map((m) => m.id)).size).toBe(1504);
    expect(rows.map((m) => m.id)).toContain(PAM);
    expect(soleAdmin(rows as { id: string; access_level: string }[], truncated)).toBeNull();
  });
});
