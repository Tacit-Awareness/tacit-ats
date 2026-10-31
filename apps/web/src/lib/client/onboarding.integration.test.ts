import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { onboardingAccess, readChecklist, readPeople, readTitles } from "./onboarding";

/**
 * What Onboarding reads, against the local stack on members' own tokens. Who gets
 * in, what the checklist counts when a row has outlived its department, type or
 * member, and that a company's own title reads never reach another's. The writes
 * are in packages/core's company-setup.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "ea000000-0000-4000-8000-0000000000a1";
const GLOBEX = "ea000000-0000-4000-8000-0000000000a2";
const ADA = "eaa00000-0000-4000-8000-0000000000a1"; // admin
const LEE = "eaa00000-0000-4000-8000-0000000000a2"; // hiring team
const IVY = "eaa00000-0000-4000-8000-0000000000a3"; // interviewer
const REX = "eaa00000-0000-4000-8000-0000000000a4"; // external recruiter
const GUS = "eaa00000-0000-4000-8000-0000000000a5"; // another company's admin
const GONE = "eaa00000-0000-4000-8000-0000000000a6"; // left
const INVITED = "eaa00000-0000-4000-8000-0000000000a7"; // not signed in yet
const INFRA = "ead00000-0000-4000-8000-0000000000a1";
const OLD = "ead00000-0000-4000-8000-0000000000a2"; // archived
const AGENCY = "eaf00000-0000-4000-8000-0000000000a1";
const JOB = "eae00000-0000-4000-8000-0000000000a1";
const CODING = "eab00000-0000-4000-8000-0000000000a1";
const RETIRED = "eab00000-0000-4000-8000-0000000000a2"; // archived
const ONE_TEAM = [ADA, LEE, IVY, REX, INVITED];

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of ["interview_processes", "interviewer_interview_types", "interview_types", "department_members", "interviewer_profiles", "job_access", "access_roles", "departments", "roles", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const member = (subject: string, workosOrgId = "org_itest_onb_acme") => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};
const ctx = (actorId: string, accessLevel: clientTools.ClientToolCtx["accessLevel"], orgId = ACME): clientTools.ClientToolCtx => ({ actorId, orgId, accessLevel, source: "dashboard" });

const item = async (key: string) => (await readChecklist(member("user_onb_ada"), ctx(ADA, "admin"))).items.find((i) => i.key === key)!;

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-onb-acme", kind: "client", workos_org_id: "org_itest_onb_acme" },
    { id: GLOBEX, name: "Globex", slug: "itest-onb-globex", kind: "client", workos_org_id: "org_itest_onb_globex" },
  ]));
  must(await db().from("actors").insert([
    { id: ADA, org_id: ACME, slug: "itest-onb-ada", display_name: "Ada Admin", email: "ada@onb.test", access_level: "admin", auth_subject: "user_onb_ada" },
    { id: LEE, org_id: ACME, slug: "itest-onb-lee", display_name: "Lee Lead", email: "lee@onb.test", access_level: "elevated", auth_subject: "user_onb_lee" },
    { id: IVY, org_id: ACME, slug: "itest-onb-ivy", display_name: "Ivy Interviewer", email: "ivy@onb.test", access_level: "limited", auth_subject: "user_onb_ivy" },
    { id: REX, org_id: ACME, slug: "itest-onb-rex", display_name: "Rex Recruiter", email: "rex@onb.test", access_level: "elevated", auth_subject: "user_onb_rex" },
    { id: GONE, org_id: ACME, slug: "itest-onb-gone", display_name: "Gone Member", email: "gone@onb.test", access_level: "limited", auth_subject: "user_onb_gone", archived_at: new Date().toISOString() },
    { id: INVITED, org_id: ACME, slug: "itest-onb-inv", display_name: "Ina Invited", email: "ina@onb.test", access_level: "limited" },
    { id: GUS, org_id: GLOBEX, slug: "itest-onb-gus", display_name: "Gus Globex", email: "gus@onb.test", access_level: "admin", auth_subject: "user_onb_gus" },
  ]));
  must(await db().from("departments").insert([
    { id: INFRA, org_id: ACME, name: "Infra" },
    { id: OLD, org_id: ACME, name: "Old", archived_at: new Date().toISOString() },
  ]));
  must(await db().from("interview_types").insert([
    { id: CODING, org_id: ACME, name: "Coding" },
    { id: RETIRED, org_id: ACME, name: "Retired", archived_at: new Date().toISOString() },
  ]));
  const { data: company } = must(await db().from("companies").insert({ org_id: ACME, name: "Acme" }).select("id").single());
  must(await db().from("roles").insert({ id: JOB, org_id: ACME, company_id: company!.id, title: "Engineer", status: "open" }));
  must(await db().from("access_roles").insert({ id: AGENCY, org_id: ACME, name: "Agency", can_view_candidates: true, can_edit_pipeline: true, own_candidates_only: true }));
  must(await db().from("job_access").insert({ org_id: ACME, actor_id: REX, role_id: JOB, access_role_id: AGENCY }));
});

afterAll(clear);

describe("who gets in", () => {
  test("an admin edits, the hiring team reads, an interviewer and an external recruiter do not", async () => {
    expect(await onboardingAccess(member("user_onb_ada"), "admin")).toBe("edit");
    expect(await onboardingAccess(member("user_onb_lee"), "elevated")).toBe("read");
    expect(await onboardingAccess(member("user_onb_ivy"), "limited")).toBe("none");
    expect(await onboardingAccess(member("user_onb_rex"), "elevated")).toBe("none");
  });

  test("the checklist refuses, rather than calling a company empty, for those two", async () => {
    await expect(readChecklist(member("user_onb_ivy"), ctx(IVY, "limited"))).rejects.toMatchObject({ code: "forbidden" });
    await expect(readChecklist(member("user_onb_rex"), ctx(REX, "elevated"))).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("the checklist", () => {
  test("a company with nothing set up has People ticked, and nothing else", async () => {
    const list = await readChecklist(member("user_onb_ada"), ctx(ADA, "admin"));
    expect(list).toMatchObject({ done: 1, complete: false });
    expect(list.items.map((i) => [i.key, i.done])).toEqual([["people", true], ["teams", false], ["skills", false], ["process", false], ["review", false]]);
  });

  test("the hiring team reads the same list", async () => {
    must(await db().from("department_members").insert({ org_id: ACME, department_id: INFRA, actor_id: LEE, is_lead: false }));
    expect((await readChecklist(member("user_onb_lee"), ctx(LEE, "elevated"))).items.find((i) => i.key === "teams")?.detail).toBe("1 team, 1 of 5 people on one");
  });

  test("a member on an archived team, and someone who left, count for nothing", async () => {
    must(await db().from("department_members").insert(ONE_TEAM.slice(0, 4).map((actor_id) => ({ org_id: ACME, department_id: OLD, actor_id, is_lead: false }))));
    must(await db().from("department_members").insert({ org_id: ACME, department_id: INFRA, actor_id: GONE, is_lead: false }));
    expect(await item("teams")).toMatchObject({ done: false, detail: "1 team, 0 of 5 people on one" });
  });

  test("Teams is done with everyone on a live team, the invited too", async () => {
    must(await db().from("department_members").insert(ONE_TEAM.map((actor_id) => ({ org_id: ACME, department_id: INFRA, actor_id, is_lead: false }))));
    expect(await item("teams")).toMatchObject({ done: true, detail: "1 team, 5 of 5 people on one" });
  });

  test("an archived type does not cover anyone, and is not counted", async () => {
    must(await db().from("interviewer_interview_types").insert(ONE_TEAM.map((actor_id) => ({ org_id: ACME, actor_id, type_id: RETIRED, prioritized: false }))));
    expect(await item("skills")).toMatchObject({ done: false, detail: "0 of 1 interview type covered" });
    must(await db().from("interviewer_interview_types").insert(ONE_TEAM.map((actor_id) => ({ org_id: ACME, actor_id, type_id: CODING, prioritized: false }))));
    expect(await item("skills")).toMatchObject({ done: true, detail: "1 of 1 interview type covered" });
  });

  test("the process counts its steps and is done with an interview in it", async () => {
    const graph = { nodes: [{ kind: "start" }, { kind: "stage", type: "review" }], edges: [] };
    must(await db().from("interview_processes").insert({ org_id: ACME, graph }));
    expect(await item("process")).toMatchObject({ done: false, detail: "1 step, 0 interviews" });
    must(await db().from("interview_processes").update({ graph: { nodes: [...graph.nodes, { kind: "stage", type: "interview" }], edges: [] } }).eq("org_id", ACME));
    expect(await item("process")).toMatchObject({ done: true, detail: "2 steps, 1 interview" });
  });

  test("another company's rows are not counted, and its own list starts empty", async () => {
    must(await db().from("department_members").insert({ org_id: ACME, department_id: INFRA, actor_id: LEE, is_lead: false }));
    const list = await readChecklist(member("user_onb_gus", "org_itest_onb_globex"), ctx(GUS, "admin", GLOBEX));
    expect(list.done).toBe(0);
    expect(list.items.map((i) => i.detail)).toEqual(["Just you so far", "No teams yet", "No interview types yet", "Not drawn yet", "4 steps to go"]);
  });
});

describe("People", () => {
  test("an admin sees who is invited apart from who has signed in, and every title", async () => {
    must(await db().from("interviewer_profiles").insert([{ org_id: ACME, actor_id: LEE, title: "Lead" }, { org_id: ACME, actor_id: IVY, title: "Engineer" }]));
    const people = await readPeople(member("user_onb_ada"), true);
    expect(people.members.map((m) => m.id).sort()).toEqual([ADA, LEE, IVY, REX].sort());
    expect(people.pending.map((p) => p.actorId)).toEqual([INVITED]);
    expect(people.titles).toEqual({ [LEE]: "Lead", [IVY]: "Engineer" });
  });

  test("the hiring team reads titles and no invitations", async () => {
    must(await db().from("interviewer_profiles").insert({ org_id: ACME, actor_id: IVY, title: "Engineer" }));
    const people = await readPeople(member("user_onb_lee"), false);
    expect(people.pending).toEqual([]);
    expect(people.titles).toEqual({ [IVY]: "Engineer" });
  });

  test("an interviewer and an external recruiter read only their own title", async () => {
    must(await db().from("interviewer_profiles").insert([{ org_id: ACME, actor_id: IVY, title: "Engineer" }, { org_id: ACME, actor_id: REX, title: "Agency" }, { org_id: ACME, actor_id: LEE, title: "Lead" }]));
    expect(await readTitles(member("user_onb_ivy"))).toEqual({ [IVY]: "Engineer" });
    expect((await readPeople(member("user_onb_rex"), false)).titles).toEqual({ [REX]: "Agency" });
  });
});
