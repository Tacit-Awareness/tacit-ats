import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { readLabelChoices, setCandidateLabel } from "./candidate-edits";
import { searchForMenu } from "./candidate-search";
import { readCandidateCard, readMemberCard } from "./hover-card";
import { toolCtx } from "./tool-ctx";

/**
 * The hover card and ⌘K reads, and the label writes, against the local stack on
 * members' own tokens: the policies decide who comes back and which lines a card
 * has, and nothing from another company ever does.
 */

const db = () => getSupabaseServiceClient();

const ACME = "c1000000-0000-4000-8000-0000000000a1";
const GLOBEX = "c2000000-0000-4000-8000-0000000000a2";
const ACME_WORKOS = "org_itest_interactions_acme";
const GLOBEX_WORKOS = "org_itest_interactions_globex";
const ADMIN = "c1a00000-0000-4000-8000-0000000000a1";
const LEAD = "c1a00000-0000-4000-8000-0000000000a2";
const IVY = "c1a00000-0000-4000-8000-0000000000a3";
const GLOBEX_ADMIN = "c2a00000-0000-4000-8000-0000000000a1";
const ENGINEER = "c1b00000-0000-4000-8000-0000000000a1";
const DESIGNER = "c1b00000-0000-4000-8000-0000000000a2";
const GLOBEX_ROLE = "c2b00000-0000-4000-8000-0000000000a1";
const DEPT = "c1f00000-0000-4000-8000-0000000000a1";
const GRACE = "c1c00000-0000-4000-8000-0000000000a1";
const HENRY = "c1c00000-0000-4000-8000-0000000000a2";
const GRETA = "c2c00000-0000-4000-8000-0000000000a1";
const GOLD = "c1e00000-0000-4000-8000-0000000000a1";
const OLD = "c1e00000-0000-4000-8000-0000000000a2";
const GLOBEX_TAG = "c2e00000-0000-4000-8000-0000000000a1";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of ["person_tags", "tags", "department_members", "interviewer_profiles", "application_events", "interviews", "applications", "hiring_team", "people", "roles", "departments", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("audit_log").delete().in("actor_id", [ADMIN, LEAD, IVY]);
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const client = (subject: string, workosOrgId: string) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};
const who = (subject: string, workos: string, actorId: string, org: string, accessLevel: "admin" | "elevated" | "limited") =>
  ({ db: client(subject, workos), actorId, accessLevel, org: { id: org, name: "", slug: "" } }) as never as Parameters<typeof readCandidateCard>[0];

const admin = () => who("user_ix_ada", ACME_WORKOS, ADMIN, ACME, "admin");
const lead = () => who("user_ix_lee", ACME_WORKOS, LEAD, ACME, "elevated");
const ivy = () => who("user_ix_ivy", ACME_WORKOS, IVY, ACME, "limited");
const globex = () => who("user_ix_gia", GLOBEX_WORKOS, GLOBEX_ADMIN, GLOBEX, "admin");

const NOW = Date.now();
const H = 3_600_000;
const at = (h: number) => new Date(NOW + h * H).toISOString();
const labels = (r: { rows: { label: string }[] } | null) => r?.rows.map((x) => x.label);

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-ix-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-ix-globex", kind: "client", workos_org_id: GLOBEX_WORKOS },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-ix-admin", display_name: "Ada Admin", email: "ada@ix.test", access_level: "admin", auth_subject: "user_ix_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-ix-lead", display_name: "Lee Lead", email: "lee@ix.test", access_level: "elevated", auth_subject: "user_ix_lee" },
    { id: IVY, org_id: ACME, slug: "itest-ix-ivy", display_name: "Ivy Interviewer", email: "ivy@ix.test", access_level: "limited", auth_subject: "user_ix_ivy" },
    { id: GLOBEX_ADMIN, org_id: GLOBEX, slug: "itest-ix-gia", display_name: "Gia Globex", email: "gia@ix.test", access_level: "admin", auth_subject: "user_ix_gia" },
  ]));
  must(await db().from("departments").insert({ id: DEPT, org_id: ACME, name: "Platform" }));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer", DEPT], [DESIGNER, "Designer", null]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role", null]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title, department_id]) => ({ id, org_id: org, company_id: company!.id, title, status: "open", department_id }))));
  }
  must(await db().from("hiring_team").insert({ org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" }));
  must(await db().from("people").insert([
    { id: GRACE, org_id: ACME, display_name: "Grace Hopper", email: "grace@ix.test", current_title: "Staff Engineer", current_company: "Navy", location: "Arlington", summary: "PRIVATE SUMMARY" },
    { id: HENRY, org_id: ACME, display_name: "Grant Henry", email: "henry@ix.test" },
    { id: GRETA, org_id: GLOBEX, display_name: "Greta Globex", email: "greta@ix.test" },
  ]));
  must(await db().from("applications").insert([
    { org_id: ACME, person_id: GRACE, role_id: ENGINEER, stage: "interviewing", owner_actor_id: LEAD, source: "referral", source_detail: "From Sam" },
    { org_id: ACME, person_id: HENRY, role_id: DESIGNER, stage: "screening", owner_actor_id: null, source: "job_board", source_detail: null },
    { org_id: GLOBEX, person_id: GRETA, role_id: GLOBEX_ROLE, stage: "screening", owner_actor_id: null, source: "job_board", source_detail: null },
  ]));
  const { data: apps } = must(await db().from("applications").select("id, person_id").eq("org_id", ACME));
  const graceApp = apps!.find((a) => a.person_id === GRACE)!.id;
  must(await db().from("interviews").insert({ org_id: ACME, application_id: graceApp, starts_at: at(24), ends_at: at(25), status: "scheduled", step: "Onsite", interviewer_actor_ids: [IVY] }));
  must(await db().from("interviewer_profiles").insert({ org_id: ACME, actor_id: IVY, interview_preference: "loves", weekly_interview_cap: 3, focus_areas: ["Go"], preferred_channel: "slack", title: "Engineer" }));
  must(await db().from("department_members").insert({ org_id: ACME, department_id: DEPT, actor_id: IVY }));
  must(await db().from("tags").insert([
    { id: GOLD, org_id: ACME, name: "Gold" },
    { id: OLD, org_id: ACME, name: "Old", archived_at: at(-1) },
    { id: GLOBEX_TAG, org_id: GLOBEX, name: "Theirs" },
  ]));
});

afterAll(clear);

describe("a candidate's hover card", () => {
  test("an admin reads every line, and the card holds nothing private", async () => {
    const card = await readCandidateCard(admin(), GRACE, NOW);
    expect(card).toMatchObject({ name: "Grace Hopper", line: "Staff Engineer at Navy · Arlington", state: { stage: "Interviewing" } });
    expect(card?.rows).toEqual([
      { label: "Role", value: "Founding Engineer" },
      { label: "Source", value: "Referral", faint: "From Sam" },
      { label: "Team", value: "Platform" },
      { label: "Owner", value: "Lee Lead" },
      { label: "Interviewer", value: "Ivy Interviewer" },
    ]);
    const text = JSON.stringify(card);
    expect(text).not.toContain("grace@ix.test");
    expect(text).not.toContain("PRIVATE");
  });

  test("a hiring manager reads their job's candidate and nobody on another job", async () => {
    expect(labels(await readCandidateCard(lead(), GRACE, NOW))).toContain("Role");
    expect(await readCandidateCard(lead(), HENRY, NOW)).toBeNull();
  });

  test("an interviewer gets the person they interview with no job lines, and nobody else", async () => {
    const card = await readCandidateCard(ivy(), GRACE, NOW);
    expect(card).toMatchObject({ name: "Grace Hopper", state: null, rows: [] });
    expect(await readCandidateCard(ivy(), HENRY, NOW)).toBeNull();
  });

  test("another company's candidate is nobody, both ways", async () => {
    expect(await readCandidateCard(admin(), GRETA, NOW)).toBeNull();
    expect(await readCandidateCard(globex(), GRACE, NOW)).toBeNull();
  });
});

describe("a member's hover card", () => {
  test("an admin reads what they told the team, and the week", async () => {
    const card = await readMemberCard(admin(), IVY, new Date(NOW));
    expect(card).toMatchObject({ name: "Ivy Interviewer", line: "Engineer · Platform", link: { href: "/client/interviewers" } });
    expect(labels(card)).toEqual(["Interviews", "Skills", "Reach on"]);
    expect(card?.rows[0]?.value).toBe("Likes it");
    expect(JSON.stringify(card)).not.toContain("ivy@ix.test");
  });

  test("an interviewer reading a teammate gets a name and no rows; their own profile they read", async () => {
    must(await db().from("interviewer_profiles").insert({ org_id: ACME, actor_id: LEAD, interview_preference: "either" }));
    const other = await readMemberCard(ivy(), LEAD, new Date(NOW));
    expect(other).toMatchObject({ name: "Lee Lead", rows: [], link: null });
    expect(labels(await readMemberCard(ivy(), IVY, new Date(NOW)))).toContain("Skills");
  });

  test("another company's member is nobody", async () => {
    expect(await readMemberCard(admin(), GLOBEX_ADMIN, new Date(NOW))).toBeNull();
    expect(await readMemberCard(globex(), IVY, new Date(NOW))).toBeNull();
  });
});

describe("⌘K's candidates", () => {
  const names = async (m: ReturnType<typeof admin>, q: string) => (await searchForMenu(m, q)).map((h) => h.name).sort();

  test("an admin finds their company's people and never another's", async () => {
    expect(await names(admin(), "gr")).toEqual(["Grace Hopper", "Grant Henry"]);
    expect(await names(globex(), "gr")).toEqual(["Greta Globex"]);
  });

  test("a hit carries a line and no email", async () => {
    const [hit] = await searchForMenu(admin(), "grace");
    expect(hit).toEqual({ candidateId: GRACE, name: "Grace Hopper", line: "Staff Engineer at Navy · Founding Engineer" });
  });

  test("a hiring manager finds only their job's people", async () => {
    expect(await names(lead(), "gr")).toEqual(["Grace Hopper"]);
  });

  test("an interviewer finds only the people they interview", async () => {
    expect(await names(ivy(), "gr")).toEqual(["Grace Hopper"]);
    expect(await names(ivy(), "henry")).toEqual([]);
  });
});

describe("labels on a candidate", () => {
  const on = async (id: string) => must(await db().from("person_tags").select("tag_id").eq("person_id", id)).data!.map((t) => t.tag_id);

  test("the menu offers live labels and an archived one they carry, this company's only", async () => {
    const a = admin();
    expect((await readLabelChoices(a.db, GRACE, []))?.map((t) => t.name)).toEqual(["Gold"]);
    expect((await readLabelChoices(a.db, GRACE, ["Old"]))?.map((t) => t.name)).toEqual(["Gold", "Old"]);
  });

  test("an admin puts one on and takes it off, audited, and a repeat changes nothing", async () => {
    const a = admin();
    const args = { candidateId: GRACE, tagId: GOLD };
    expect(await setCandidateLabel(a.db, toolCtx(a), { ...args, on: true })).toEqual({ ok: true, changed: true });
    expect(await on(GRACE)).toEqual([GOLD]);
    expect(await setCandidateLabel(a.db, toolCtx(a), { ...args, on: true })).toEqual({ ok: true, changed: false });
    expect(await setCandidateLabel(a.db, toolCtx(a), { ...args, on: false })).toEqual({ ok: true, changed: true });
    expect(await on(GRACE)).toEqual([]);
    const audit = must(await db().from("audit_log").select("action").eq("actor_id", ADMIN).in("action", ["tag.add", "tag.remove"])).data!;
    expect(audit.map((r) => r.action).sort()).toEqual(["tag.add", "tag.remove"]);
  });

  test("an archived label goes on no one new", async () => {
    const a = admin();
    expect(await setCandidateLabel(a.db, toolCtx(a), { candidateId: GRACE, tagId: OLD, on: true })).toEqual({ ok: false, error: "label_archived" });
  });

  test("an interviewer can't, by hand, and gets no menu asked for them", async () => {
    const i = ivy();
    expect(await readLabelChoices(i.db, GRACE, [])).toBeNull();
    expect(await setCandidateLabel(i.db, toolCtx(i), { candidateId: GRACE, tagId: GOLD, on: true })).toEqual({ ok: false, error: "label_forbidden" });
    expect(await on(GRACE)).toEqual([]);
  });

  test("another company's candidate or label is gone, and nothing is written", async () => {
    const a = admin();
    expect(await setCandidateLabel(a.db, toolCtx(a), { candidateId: GRETA, tagId: GOLD, on: true })).toEqual({ ok: false, error: "label_gone" });
    expect(await setCandidateLabel(a.db, toolCtx(a), { candidateId: GRACE, tagId: GLOBEX_TAG, on: true })).toEqual({ ok: false, error: "label_gone" });
    expect(await on(GRETA)).toEqual([]);
    expect(await on(GRACE)).toEqual([]);
  });
});
