import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { readChecklist } from "./onboarding";
import { readSkillSheet, readTeamMatrix, saveFocusAreas } from "./onboarding-teams";

/**
 * Onboarding's Teams and Interview skills steps on members' own tokens: what they
 * read, the writes behind each tick, who is refused, and that doing it all
 * completes the checklist. The tools' own edges are in packages/core's
 * company-setup.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "eb000000-0000-4000-8000-0000000000a1";
const GLOBEX = "eb000000-0000-4000-8000-0000000000a2";
const ADA = "eba00000-0000-4000-8000-0000000000a1"; // admin
const LEE = "eba00000-0000-4000-8000-0000000000a2"; // hiring team
const IVY = "eba00000-0000-4000-8000-0000000000a3"; // interviewer
const INA = "eba00000-0000-4000-8000-0000000000a4"; // invited, not signed in yet
const GUS = "eba00000-0000-4000-8000-0000000000a5"; // another company's admin
const ENG = "ebd00000-0000-4000-8000-0000000000a1";
const PLATFORM = "ebd00000-0000-4000-8000-0000000000a2";
const OLD = "ebd00000-0000-4000-8000-0000000000a3"; // archived
const KEPT = "ebd00000-0000-4000-8000-0000000000a4"; // live, inside the archived one
const FOREIGN = "ebd00000-0000-4000-8000-0000000000a5";
const CODING = "ebb00000-0000-4000-8000-0000000000a1";
const RETIRED = "ebb00000-0000-4000-8000-0000000000a2"; // archived
const EVERYONE = [ADA, LEE, IVY, INA];

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of ["interviewer_interview_types", "interview_types", "department_members", "interviewer_profiles", "departments"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("audit_log").delete().in("org_id", ids);
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const member = (subject: string, workosOrgId = "org_itest_step_acme") => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};
const ctx = (actorId: string, accessLevel: clientTools.ClientToolCtx["accessLevel"], orgId = ACME): clientTools.ClientToolCtx => ({ actorId, orgId, accessLevel, source: "dashboard" });

const ada = () => member("user_step_ada");
const ADMIN = ctx(ADA, "admin");
const lee = () => member("user_step_lee");
const HIRING = ctx(LEE, "elevated");

const item = async (key: string) => (await readChecklist(ada(), ADMIN)).items.find((i) => i.key === key)!;

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-step-acme", kind: "client", workos_org_id: "org_itest_step_acme" },
    { id: GLOBEX, name: "Globex", slug: "itest-step-globex", kind: "client", workos_org_id: "org_itest_step_globex" },
  ]));
  must(await db().from("actors").insert([
    { id: ADA, org_id: ACME, slug: "itest-step-ada", display_name: "Ada Admin", email: "ada@step.test", access_level: "admin", auth_subject: "user_step_ada" },
    { id: LEE, org_id: ACME, slug: "itest-step-lee", display_name: "Lee Lead", email: "lee@step.test", access_level: "elevated", auth_subject: "user_step_lee" },
    { id: IVY, org_id: ACME, slug: "itest-step-ivy", display_name: "Ivy Interviewer", email: "ivy@step.test", access_level: "limited", auth_subject: "user_step_ivy" },
    { id: INA, org_id: ACME, slug: "itest-step-ina", display_name: "Ina Invited", email: "ina@step.test", access_level: "limited" },
    { id: GUS, org_id: GLOBEX, slug: "itest-step-gus", display_name: "Gus Globex", email: "gus@step.test", access_level: "admin", auth_subject: "user_step_gus" },
  ]));
  must(await db().from("departments").insert([
    { id: ENG, org_id: ACME, name: "Engineering" },
    { id: OLD, org_id: ACME, name: "Old", archived_at: new Date().toISOString() },
    { id: FOREIGN, org_id: GLOBEX, name: "Theirs" },
  ]));
  must(await db().from("departments").insert([
    { id: PLATFORM, org_id: ACME, name: "Platform", parent_id: ENG },
    { id: KEPT, org_id: ACME, name: "Kept", parent_id: OLD },
  ]));
  must(await db().from("interview_types").insert([
    { id: CODING, org_id: ACME, name: "Coding" },
    { id: RETIRED, org_id: ACME, name: "Retired", archived_at: new Date().toISOString() },
  ]));
});

afterAll(clear);

describe("Teams", () => {
  test("reads live teams by path, leaves out the archived and another company's", async () => {
    const { matrix } = await readTeamMatrix(ada(), ADMIN);
    expect(matrix.teams.map((t) => t.path)).toEqual(["Engineering", "Engineering › Platform", "Old › Kept"]);
    expect(matrix.people.map((p) => p.id).sort()).toEqual([...EVERYONE].sort());
  });

  test("a tick, an untick and a lead land, and read back", async () => {
    await clientTools.addTeamMember(ada(), ADMIN, { department: ENG, memberId: IVY });
    await clientTools.setTeamLead(ada(), ADMIN, { department: ENG, memberId: LEE });
    let eng = (await readTeamMatrix(ada(), ADMIN)).matrix.teams.find((t) => t.id === ENG)!;
    expect(eng).toMatchObject({ lead: LEE });
    expect([...eng.members].sort()).toEqual([LEE, IVY].sort());

    await clientTools.removeTeamMember(ada(), ADMIN, { department: ENG, memberId: LEE });
    eng = (await readTeamMatrix(ada(), ADMIN)).matrix.teams.find((t) => t.id === ENG)!;
    expect(eng).toMatchObject({ lead: null, members: [IVY] });
  });

  test("the audit row says the dashboard did it", async () => {
    await clientTools.addTeamMember(ada(), ADMIN, { department: ENG, memberId: IVY });
    const { data } = must(await db().from("audit_log").select("action, source").eq("org_id", ACME).eq("action", "department.member_add"));
    expect(data).toEqual([{ action: "department.member_add", source: "dashboard" }]);
  });

  test("New team makes a live team, and brings back an archived one", async () => {
    expect(await clientTools.createDepartment(ada(), ADMIN, { name: "Sales" })).toMatchObject({ outcome: "created" });
    expect(await clientTools.createDepartment(ada(), ADMIN, { name: "Old" })).toMatchObject({ outcome: "restored" });
    expect((await readTeamMatrix(ada(), ADMIN)).matrix.teams.map((t) => t.path)).toEqual(["Engineering", "Engineering › Platform", "Old", "Old › Kept", "Sales"]);
  });

  test("the hiring team reads and is refused the writes, even past a forged level", async () => {
    expect((await readTeamMatrix(lee(), HIRING)).matrix.teams).toHaveLength(3);
    await expect(clientTools.addTeamMember(lee(), HIRING, { department: ENG, memberId: LEE })).rejects.toMatchObject({ code: "forbidden" });
    await expect(clientTools.createDepartment(lee(), HIRING, { name: "Nope" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(clientTools.addTeamMember(lee(), ctx(LEE, "admin"), { department: ENG, memberId: LEE })).rejects.toThrow();
    must(await db().from("department_members").select("actor_id").eq("department_id", ENG)).data?.forEach(() => expect.unreachable());
  });

  test("an interviewer reads nothing here", async () => {
    await expect(readTeamMatrix(member("user_step_ivy"), ctx(IVY, "limited"))).rejects.toMatchObject({ code: "forbidden" });
  });

  test("an archived team and another company's refuse a tick", async () => {
    await expect(clientTools.addTeamMember(ada(), ADMIN, { department: OLD, memberId: IVY })).rejects.toMatchObject({ code: "invalid" });
    await expect(clientTools.addTeamMember(ada(), ADMIN, { department: FOREIGN, memberId: IVY })).rejects.toMatchObject({ code: "not_found" });
    await expect(clientTools.addTeamMember(ada(), ADMIN, { department: ENG, memberId: GUS })).rejects.toMatchObject({ code: "not_found" });
  });

  test("the checklist completes once everyone is on a team, the invited too", async () => {
    expect(await item("teams")).toMatchObject({ done: false });
    for (const memberId of EVERYONE) await clientTools.addTeamMember(ada(), ADMIN, { department: PLATFORM, memberId });
    expect(await item("teams")).toMatchObject({ done: true, detail: "3 teams, 4 of 4 people on one" });
    await clientTools.removeTeamMember(ada(), ADMIN, { department: PLATFORM, memberId: INA });
    expect(await item("teams")).toMatchObject({ done: false });
  });
});

describe("Interview skills", () => {
  const save = (memberId: string, expectedUpdatedAt: string | null, focusAreas: string[]) => saveFocusAreas(ada(), ADMIN, { memberId, expectedUpdatedAt, focusAreas });
  const person = async (id: string) => (await readSkillSheet(ada(), ADMIN)).sheet.people.find((p) => p.id === id)!;

  test("an org with no live types sees none, and nothing is seeded", async () => {
    must(await db().from("interview_types").update({ archived_at: new Date().toISOString() }).eq("id", CODING));
    expect((await readSkillSheet(ada(), ADMIN)).sheet.types).toEqual([]);
  });

  test("an admin saves a teammate's first skills, and the rest of the profile is left alone", async () => {
    expect(await save(IVY, null, ["Go"])).toEqual({ outcome: "changed" });
    must(await db().from("interviewer_profiles").update({ interview_preference: "avoids", weekly_interview_cap: 2 }).eq("actor_id", IVY));
    const { version } = await person(IVY);
    expect(await save(IVY, version, ["Go", "Rust"])).toEqual({ outcome: "changed" });
    const { data } = must(await db().from("interviewer_profiles").select("focus_areas, interview_preference, weekly_interview_cap").eq("actor_id", IVY).single());
    expect(data).toEqual({ focus_areas: ["Go", "Rust"], interview_preference: "avoids", weekly_interview_cap: 2 });
  });

  test("a save made since the page read comes back stale and overwrites nothing", async () => {
    await save(IVY, null, ["Go"]);
    const { version } = await person(IVY);
    await clientTools.setMemberTitle(member("user_step_ivy"), ctx(IVY, "limited"), { memberId: IVY, title: "Engineer" });
    expect(await save(IVY, version, ["Rust"])).toEqual({ outcome: "stale" });
    expect((await person(IVY)).skills).toEqual(["Go"]);
  });

  test("the cap is 20, and the table is never asked", async () => {
    const over = Array.from({ length: 21 }, (_, i) => `Skill ${i}`);
    await expect(save(IVY, null, over)).rejects.toMatchObject({ code: "invalid", field: "focusAreas" });
    expect(await save(IVY, null, over.slice(0, 20))).toEqual({ outcome: "changed" });
  });

  test("the audit row names the field and never the skills", async () => {
    await save(IVY, null, ["Secret skill"]);
    const { data } = must(await db().from("audit_log").select("source, after").eq("org_id", ACME).eq("action", "interviewer_profile.update"));
    expect(data?.[0]?.source).toBe("dashboard");
    expect(JSON.stringify(data)).not.toContain("Secret skill");
  });

  test("the hiring team cannot save a teammate's, past a forged level either", async () => {
    await expect(saveFocusAreas(lee(), HIRING, { memberId: IVY, expectedUpdatedAt: null, focusAreas: ["Go"] })).rejects.toMatchObject({ code: "forbidden" });
    await expect(saveFocusAreas(lee(), ctx(LEE, "admin"), { memberId: IVY, expectedUpdatedAt: null, focusAreas: ["Go"] })).rejects.toMatchObject({ code: "forbidden" });
  });

  test("another company's member is not found", async () => {
    await expect(save(GUS, null, ["Go"])).rejects.toMatchObject({ code: "not_found" });
  });

  test("a type is added, renamed, assigned, starred and archived, and the sheet follows", async () => {
    const { typeId } = await clientTools.addInterviewType(ada(), ADMIN, { name: "Design" });
    await clientTools.renameInterviewType(ada(), ADMIN, { type: typeId, name: "System design" });
    await clientTools.assignInterviewType(ada(), ADMIN, { type: typeId, memberId: IVY });
    await clientTools.prioritizeInterviewType(ada(), ADMIN, { type: typeId, memberId: IVY, prioritized: true });
    let { sheet } = await readSkillSheet(ada(), ADMIN);
    expect(sheet.types.map((t) => t.name)).toEqual(["Coding", "System design"]);
    expect(sheet.people.find((p) => p.id === IVY)?.runs).toEqual({ [typeId]: true });

    await clientTools.archiveInterviewType(ada(), ADMIN, { type: typeId });
    ({ sheet } = await readSkillSheet(ada(), ADMIN));
    expect(sheet.types.map((t) => t.name)).toEqual(["Coding"]);
    expect(sheet.people.find((p) => p.id === IVY)?.runs).toEqual({});
  });

  test("a name an archived type holds brings it back, with who ran it", async () => {
    must(await db().from("interviewer_interview_types").insert({ org_id: ACME, actor_id: IVY, type_id: RETIRED, prioritized: true }));
    expect(await clientTools.addInterviewType(ada(), ADMIN, { name: "Retired" })).toMatchObject({ outcome: "restored", typeId: RETIRED });
    expect((await person(IVY)).runs).toEqual({ [RETIRED]: true });
  });

  test("an archived type and someone who does not run it refuse the star", async () => {
    await expect(clientTools.assignInterviewType(ada(), ADMIN, { type: RETIRED, memberId: IVY })).rejects.toMatchObject({ code: "invalid" });
    await expect(clientTools.prioritizeInterviewType(ada(), ADMIN, { type: CODING, memberId: IVY, prioritized: true })).rejects.toMatchObject({ code: "not_found" });
  });

  test("the hiring team reads and is refused the type writes", async () => {
    expect((await readSkillSheet(lee(), HIRING)).sheet.types).toHaveLength(1);
    await expect(clientTools.addInterviewType(lee(), HIRING, { name: "Nope" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(clientTools.assignInterviewType(lee(), HIRING, { type: CODING, memberId: LEE })).rejects.toMatchObject({ code: "forbidden" });
    await expect(clientTools.archiveInterviewType(lee(), HIRING, { type: CODING })).rejects.toMatchObject({ code: "forbidden" });
  });

  test("the checklist completes once everyone runs a live type", async () => {
    expect(await item("skills")).toMatchObject({ done: false, detail: "0 of 1 interview type covered" });
    for (const memberId of EVERYONE) await clientTools.assignInterviewType(ada(), ADMIN, { type: CODING, memberId });
    expect(await item("skills")).toMatchObject({ done: true, detail: "1 of 1 interview type covered" });
    await clientTools.archiveInterviewType(ada(), ADMIN, { type: CODING });
    expect(await item("skills")).toMatchObject({ done: false, detail: "No interview types yet" });
  });
});
