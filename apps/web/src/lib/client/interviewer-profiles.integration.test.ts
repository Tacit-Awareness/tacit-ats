import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";

/**
 * Saving an interviewer profile against the local stack, on members' own
 * tokens: the policies and the table's trigger decide, and the version the page
 * showed keeps one person's save from quietly undoing another's. The member
 * token is signed with the stack's JWT secret, as in pipeline.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "e7000000-0000-4000-8000-0000000000a1";
const GLOBEX = "e7000000-0000-4000-8000-0000000000a2";
const ADA = "e7a00000-0000-4000-8000-0000000000a1";
const LEE = "e7a00000-0000-4000-8000-0000000000a2";
const IVY = "e7a00000-0000-4000-8000-0000000000a3";
const GUS = "e7a00000-0000-4000-8000-0000000000a4";
const GONE = "e7a00000-0000-4000-8000-0000000000a5";
const NOBODY = "e7a00000-0000-4000-8000-0000000000ff";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  must(await db().from("audit_log").delete().in("org_id", ids));
  must(await db().from("interviewer_profiles").delete().in("org_id", ids));
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const member = (subject: string, workosOrgId = "org_itest_profile_acme") => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};

const ctx = (actorId: string, accessLevel: clientTools.ClientToolCtx["accessLevel"], orgId = ACME): clientTools.ClientToolCtx => ({ actorId, orgId, accessLevel, source: "dashboard" });
const ada = () => [member("user_profile_ada"), ctx(ADA, "admin")] as const;
const lee = () => [member("user_profile_lee"), ctx(LEE, "elevated")] as const;
const ivy = () => [member("user_profile_ivy"), ctx(IVY, "limited")] as const;

const EMPTY: clientTools.InterviewerProfileInput = { preference: null, weeklyCap: null, focusAreas: [], channel: null, awayUntil: null };
const FULL: clientTools.InterviewerProfileInput = { preference: "avoids", weeklyCap: 2, focusAreas: ["Go", "Distributed systems"], channel: "imessage", awayUntil: "2026-11-14" };

const row = async (id: string) => (await db().from("interviewer_profiles").select("*").eq("actor_id", id).maybeSingle()).data;
const version = async (id: string) => (await row(id))?.updated_at ?? null;
const audit = async () =>
  must(await db().from("audit_log").select("action, entity, entity_id, source, actor_id, before, after").eq("org_id", ACME).eq("action", "interviewer_profile.update")).data ?? [];

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-profile-acme", kind: "client", workos_org_id: "org_itest_profile_acme" },
    { id: GLOBEX, name: "Globex", slug: "itest-profile-globex", kind: "client", workos_org_id: "org_itest_profile_globex" },
  ]));
  must(await db().from("actors").insert([
    { id: ADA, org_id: ACME, slug: "itest-profile-ada", display_name: "Ada Admin", email: "ada@profile.test", access_level: "admin", auth_subject: "user_profile_ada" },
    { id: LEE, org_id: ACME, slug: "itest-profile-lee", display_name: "Lee Lead", email: "lee@profile.test", access_level: "elevated", auth_subject: "user_profile_lee" },
    { id: IVY, org_id: ACME, slug: "itest-profile-ivy", display_name: "Ivy Interviewer", email: "ivy@profile.test", access_level: "limited", auth_subject: "user_profile_ivy" },
    { id: GUS, org_id: GLOBEX, slug: "itest-profile-gus", display_name: "Gus Globex", email: "gus@profile.test", access_level: "admin", auth_subject: "user_profile_gus" },
    { id: GONE, org_id: ACME, slug: "itest-profile-gone", display_name: "Gone", email: "gone@profile.test", access_level: "limited", auth_subject: "user_profile_gone", archived_at: new Date().toISOString() },
  ]));
});

afterAll(clear);

describe("setInterviewerProfile", () => {
  test("an interviewer saves their own, round the whole way, and the audit row names fields and no values", async () => {
    expect(await clientTools.setInterviewerProfile(...ivy(), { memberId: IVY, expectedUpdatedAt: null, profile: FULL })).toEqual({ outcome: "changed" });
    expect(await row(IVY)).toMatchObject({
      org_id: ACME,
      interview_preference: "avoids",
      weekly_interview_cap: 2,
      focus_areas: ["Go", "Distributed systems"],
      preferred_channel: "imessage",
      away_until: "2026-11-14",
    });
    const rows = await audit();
    expect(rows).toEqual([
      {
        action: "interviewer_profile.update",
        entity: "actor",
        entity_id: IVY,
        source: "dashboard",
        actor_id: IVY,
        before: null,
        after: { fields: ["interview_preference", "weekly_interview_cap", "focus_areas", "preferred_channel", "away_until"] },
      },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/avoids|imessage|2026-11-14/);
  });

  test("clearing every field keeps the row, each one back to not said", async () => {
    await clientTools.setInterviewerProfile(...ivy(), { memberId: IVY, expectedUpdatedAt: null, profile: FULL });
    expect(await clientTools.setInterviewerProfile(...ivy(), { memberId: IVY, expectedUpdatedAt: await version(IVY), profile: EMPTY })).toEqual({ outcome: "changed" });
    expect(await row(IVY)).toMatchObject({ interview_preference: null, weekly_interview_cap: null, focus_areas: [], preferred_channel: null, away_until: null });
  });

  test("a limit of 0 is stored as 0, not as no limit", async () => {
    await clientTools.setInterviewerProfile(...ivy(), { memberId: IVY, expectedUpdatedAt: null, profile: { ...EMPTY, weeklyCap: 0 } });
    expect((await row(IVY))?.weekly_interview_cap).toBe(0);
  });

  test("the same values again leave no audit row and do not move the version", async () => {
    await clientTools.setInterviewerProfile(...ivy(), { memberId: IVY, expectedUpdatedAt: null, profile: FULL });
    const before = await version(IVY);
    expect(await clientTools.setInterviewerProfile(...ivy(), { memberId: IVY, expectedUpdatedAt: before, profile: FULL })).toEqual({ outcome: "unchanged" });
    expect(await version(IVY)).toBe(before);
    expect(await audit()).toHaveLength(1);
  });

  test("an admin saves a teammate's", async () => {
    expect(await clientTools.setInterviewerProfile(...ada(), { memberId: IVY, expectedUpdatedAt: null, profile: FULL })).toEqual({ outcome: "changed" });
    expect(await audit()).toMatchObject([{ actor_id: ADA, entity_id: IVY }]);
  });

  test("the hiring team and interviewers are refused someone else's, and the policy says so even past the code's check", async () => {
    await expect(clientTools.setInterviewerProfile(...lee(), { memberId: IVY, expectedUpdatedAt: null, profile: FULL })).rejects.toMatchObject({ code: "forbidden" });
    await expect(clientTools.setInterviewerProfile(...ivy(), { memberId: LEE, expectedUpdatedAt: null, profile: FULL })).rejects.toMatchObject({ code: "forbidden" });
    // a lie about the level gets past the code; the policy is what stops it
    const [db1] = lee();
    await expect(clientTools.setInterviewerProfile(db1, ctx(LEE, "admin"), { memberId: IVY, expectedUpdatedAt: null, profile: FULL })).rejects.toMatchObject({ code: "forbidden" });
    expect(await row(IVY)).toBeNull();
    expect(await audit()).toEqual([]);
  });

  test("an admin of another company finds nobody", async () => {
    const gus = member("user_profile_gus", "org_itest_profile_globex");
    await expect(clientTools.setInterviewerProfile(gus, ctx(GUS, "admin", GLOBEX), { memberId: IVY, expectedUpdatedAt: null, profile: FULL })).rejects.toMatchObject({ code: "not_found" });
    expect(await row(IVY)).toBeNull();
  });

  test("an id that is nobody, and someone archived, are not found", async () => {
    await expect(clientTools.setInterviewerProfile(...ada(), { memberId: NOBODY, expectedUpdatedAt: null, profile: FULL })).rejects.toMatchObject({ code: "not_found" });
    await expect(clientTools.setInterviewerProfile(...ada(), { memberId: GONE, expectedUpdatedAt: null, profile: FULL })).rejects.toMatchObject({ code: "not_found" });
  });

  test("a save from a page older than the row is reported and leaves the newer one", async () => {
    await clientTools.setInterviewerProfile(...ivy(), { memberId: IVY, expectedUpdatedAt: null, profile: FULL });
    const seen = await version(IVY);
    await clientTools.setInterviewerProfile(...ada(), { memberId: IVY, expectedUpdatedAt: seen, profile: { ...FULL, weeklyCap: 5 } });
    expect(await clientTools.setInterviewerProfile(...ivy(), { memberId: IVY, expectedUpdatedAt: seen, profile: { ...FULL, weeklyCap: 1 } })).toEqual({ outcome: "stale" });
    expect((await row(IVY))?.weekly_interview_cap).toBe(5);
    expect(await audit()).toHaveLength(2);
    // with what the page reloads to, the same save lands
    expect(await clientTools.setInterviewerProfile(...ivy(), { memberId: IVY, expectedUpdatedAt: await version(IVY), profile: { ...FULL, weeklyCap: 1 } })).toEqual({ outcome: "changed" });
  });

  test("a page that showed no profile cannot overwrite one made since", async () => {
    await clientTools.setInterviewerProfile(...ada(), { memberId: IVY, expectedUpdatedAt: null, profile: FULL });
    expect(await clientTools.setInterviewerProfile(...ivy(), { memberId: IVY, expectedUpdatedAt: null, profile: { ...FULL, weeklyCap: 1 } })).toEqual({ outcome: "stale" });
  });

  test("ten first saves at once leave one row, one change and nine reports, and no open claims", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => clientTools.setInterviewerProfile(...(i % 2 ? ada() : ivy()), { memberId: IVY, expectedUpdatedAt: null, profile: { ...FULL, weeklyCap: i + 1 } })),
    );
    expect(results.filter((r) => r.outcome === "changed")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "stale")).toHaveLength(9);
    expect(await audit()).toHaveLength(1);
    const open = must(await db().from("audit_log").select("id").eq("org_id", ACME).is("after", null)).data;
    expect(open).toEqual([]);
  });

  test("ten saves of one version at once: one lands", async () => {
    await clientTools.setInterviewerProfile(...ivy(), { memberId: IVY, expectedUpdatedAt: null, profile: FULL });
    const seen = await version(IVY);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => clientTools.setInterviewerProfile(...(i % 2 ? ada() : ivy()), { memberId: IVY, expectedUpdatedAt: seen, profile: { ...FULL, weeklyCap: i + 3 } })),
    );
    expect(results.filter((r) => r.outcome === "changed")).toHaveLength(1);
    expect(await audit()).toHaveLength(2);
  });

  test("what the rules let through, the table takes: every edge they trim and the limits", async () => {
    const focusAreas = ["​Go﻿", " Rust　", ...Array.from({ length: 18 }, (_, i) => `${i}`.padEnd(60, "x"))];
    await clientTools.setInterviewerProfile(...ivy(), { memberId: IVY, expectedUpdatedAt: null, profile: { ...EMPTY, focusAreas, weeklyCap: 40, awayUntil: "9999-12-31" } });
    expect((await row(IVY))?.focus_areas?.slice(0, 2)).toEqual(["Go", "Rust"]);
    expect((await row(IVY))?.weekly_interview_cap).toBe(40);
    await clientTools.setInterviewerProfile(...ivy(), { memberId: IVY, expectedUpdatedAt: await version(IVY), profile: { ...EMPTY, focusAreas: ["\u{1F468}‍\u{1F4BB} pairing"], awayUntil: "0001-01-01" } });
    expect(await row(IVY)).toMatchObject({ focus_areas: ["\u{1F468}‍\u{1F4BB} pairing"], away_until: "0001-01-01" });
  });

  test("a connector set to read-only stops the connector and not the dashboard", async () => {
    must(await db().from("orgs").update({ connector_access: "read_only" }).eq("id", ACME));
    expect(await clientTools.setInterviewerProfile(...ivy(), { memberId: IVY, expectedUpdatedAt: null, profile: FULL })).toEqual({ outcome: "changed" });
    const [client, level] = lee();
    await expect(clientTools.setInterviewerProfile(client, { ...level, source: "claude" }, { memberId: LEE, expectedUpdatedAt: null, profile: FULL })).rejects.toMatchObject({ code: "forbidden" });
    expect(await row(LEE)).toBeNull();
  });

  test("past the hourly limit nothing is written, on the real claim", async () => {
    must(await db().from("audit_log").insert(Array.from({ length: 300 }, () => ({ org_id: ACME, actor_id: IVY, source: "dashboard", action: "interviewer_profile.update", entity: "actor", after: {} }))));
    await expect(clientTools.setInterviewerProfile(...ivy(), { memberId: IVY, expectedUpdatedAt: null, profile: FULL })).rejects.toMatchObject({ code: "rate_limited" });
    expect(await row(IVY)).toBeNull();
  });

  test("a member's token straight at the table gets no further than the tool does", async () => {
    await clientTools.setInterviewerProfile(...lee(), { memberId: LEE, expectedUpdatedAt: null, profile: FULL });
    const before = await row(LEE);
    const [ivyDb] = ivy();
    const [adaDb] = ada();
    const gus = member("user_profile_gus", "org_itest_profile_globex");

    expect((await ivyDb.from("interviewer_profiles").select("actor_id").eq("actor_id", LEE)).data).toEqual([]);
    expect((await ivyDb.from("interviewer_profiles").update({ focus_areas: ["taken"] }).eq("actor_id", LEE).select("actor_id")).data).toEqual([]);
    expect((await ivyDb.from("interviewer_profiles").upsert({ actor_id: LEE, focus_areas: ["taken"] })).error?.code).toBe("42501");
    expect((await gus.from("interviewer_profiles").select("actor_id").eq("actor_id", LEE)).data).toEqual([]);
    expect((await gus.from("interviewer_profiles").update({ focus_areas: ["taken"] }).eq("actor_id", LEE).select("actor_id")).data).toEqual([]);
    expect((await adaDb.from("interviewer_profiles").upsert({ actor_id: GUS, focus_areas: ["taken"] })).error?.code).toBe("42501");
    // Not on the column grants, so an admin cannot move a row or back-date a version.
    expect((await adaDb.from("interviewer_profiles").update({ org_id: GLOBEX } as never).eq("actor_id", LEE)).error?.code).toBe("42501");
    expect((await adaDb.from("interviewer_profiles").update({ updated_at: "2000-01-01" } as never).eq("actor_id", LEE)).error?.code).toBe("42501");
    expect((await adaDb.from("interviewer_profiles").update({ actor_id: IVY }).eq("actor_id", LEE)).error?.code).toBe("22023");
    expect((await adaDb.from("interviewer_profiles").delete().eq("actor_id", LEE)).error?.code).toBe("42501");

    expect(await row(LEE)).toEqual(before);
    expect(await row(GUS)).toBeNull();
  });

  test("a repeat only the table sees is refused as a sentence on the field", async () => {
    // Dotted I: JS and Postgres may not lower it alike, and either way a table refusal has to read as one.
    const areas = ["İstanbul", "i̇stanbul"];
    const saved = await clientTools.setInterviewerProfile(...ivy(), { memberId: IVY, expectedUpdatedAt: null, profile: { ...EMPTY, focusAreas: areas } }).catch((e: unknown) => e);
    if (saved instanceof clientTools.ClientToolError) expect(saved).toMatchObject({ code: "invalid", field: "focusAreas" });
    else expect(saved).toMatchObject({ outcome: "changed" });
  });
});
