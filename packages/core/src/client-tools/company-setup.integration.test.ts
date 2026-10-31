import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import type { ClientToolCtx } from "./context.js";
import { getProcess, setProcess, PROCESS_GRAPH_MAX_BYTES } from "./process.js";
import { addInterviewType, archiveInterviewType, assignInterviewType, listInterviewTypes, prioritizeInterviewType, renameInterviewType, unassignInterviewType } from "./interview-types.js";
import { setInterviewerProfile, setMemberTitle } from "./interviewer-profiles.js";
import { addTeamMember, listTeams, removeTeamMember, setTeamLead } from "./teams.js";

/**
 * Teams, interview types, the process and a member's title against the local
 * stack, on members' own tokens: the policies and the tables decide (tacit-internal
 * 20261031120000_tats_onboarding). Each kind of member, and every audit row read back.
 */

const db = () => getSupabaseServiceClient();

const ACME = "e9000000-0000-4000-8000-0000000000a1";
const GLOBEX = "e9000000-0000-4000-8000-0000000000a2";
const ADA = "e9a00000-0000-4000-8000-0000000000a1"; // admin
const LEE = "e9a00000-0000-4000-8000-0000000000a2"; // hiring team
const IVY = "e9a00000-0000-4000-8000-0000000000a3"; // interviewer
const REX = "e9a00000-0000-4000-8000-0000000000a4"; // external recruiter
const GUS = "e9a00000-0000-4000-8000-0000000000a5"; // another company's admin
const GONE = "e9a00000-0000-4000-8000-0000000000a6"; // archived
const INFRA = "e9d00000-0000-4000-8000-0000000000a1";
const OLD = "e9d00000-0000-4000-8000-0000000000a2"; // an archived department
const THEIRS = "e9d00000-0000-4000-8000-0000000000a3"; // Globex's
const JOB = "e9e00000-0000-4000-8000-0000000000a1";
const AGENCY = "e9f00000-0000-4000-8000-0000000000a1";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  must(await db().from("audit_log").delete().in("org_id", ids));
  for (const table of ["interview_processes", "interviewer_interview_types", "interview_types", "department_members", "interviewer_profiles", "job_access", "access_roles", "departments", "roles", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const member = (subject: string, workosOrgId = "org_itest_setup_acme") => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};
const ctx = (actorId: string, accessLevel: ClientToolCtx["accessLevel"], orgId = ACME): ClientToolCtx => ({ actorId, orgId, accessLevel, source: "dashboard" });
const ada = () => [member("user_setup_ada"), ctx(ADA, "admin")] as const;
const lee = () => [member("user_setup_lee"), ctx(LEE, "elevated")] as const;
const ivy = () => [member("user_setup_ivy"), ctx(IVY, "limited")] as const;
const rex = () => [member("user_setup_rex"), ctx(REX, "elevated")] as const;
const gus = () => [member("user_setup_gus", "org_itest_setup_globex"), ctx(GUS, "admin", GLOBEX)] as const;

const audit = async (action: string) =>
  must(await db().from("audit_log").select("action, entity, entity_id, source, actor_id, before, after").eq("org_id", ACME).eq("action", action).not("after", "is", null)).data ?? [];
const memberships = async () =>
  must(await db().from("department_members").select("actor_id, is_lead").eq("department_id", INFRA).order("actor_id")).data ?? [];
const assignment = async (actorId: string, typeId: string) =>
  must(await db().from("interviewer_interview_types").select("prioritized").eq("actor_id", actorId).eq("type_id", typeId).maybeSingle()).data;

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-setup-acme", kind: "client", workos_org_id: "org_itest_setup_acme" },
    { id: GLOBEX, name: "Globex", slug: "itest-setup-globex", kind: "client", workos_org_id: "org_itest_setup_globex" },
  ]));
  must(await db().from("actors").insert([
    { id: ADA, org_id: ACME, slug: "itest-setup-ada", display_name: "Ada Admin", email: "ada@setup.test", access_level: "admin", auth_subject: "user_setup_ada" },
    { id: LEE, org_id: ACME, slug: "itest-setup-lee", display_name: "Lee Lead", email: "lee@setup.test", access_level: "elevated", auth_subject: "user_setup_lee" },
    { id: IVY, org_id: ACME, slug: "itest-setup-ivy", display_name: "Ivy Interviewer", email: "ivy@setup.test", access_level: "limited", auth_subject: "user_setup_ivy" },
    { id: REX, org_id: ACME, slug: "itest-setup-rex", display_name: "Rex Recruiter", email: "rex@setup.test", access_level: "elevated", auth_subject: "user_setup_rex" },
    { id: GONE, org_id: ACME, slug: "itest-setup-gone", display_name: "Gone Member", email: "gone@setup.test", access_level: "limited", auth_subject: "user_setup_gone", archived_at: new Date().toISOString() },
    { id: GUS, org_id: GLOBEX, slug: "itest-setup-gus", display_name: "Gus Globex", email: "gus@setup.test", access_level: "admin", auth_subject: "user_setup_gus" },
  ]));
  must(await db().from("departments").insert([
    { id: INFRA, org_id: ACME, name: "Infra" },
    { id: OLD, org_id: ACME, name: "Old", archived_at: new Date().toISOString() },
    { id: THEIRS, org_id: GLOBEX, name: "Theirs" },
  ]));
  const { data: company } = must(await db().from("companies").insert({ org_id: ACME, name: "Acme" }).select("id").single());
  must(await db().from("roles").insert({ id: JOB, org_id: ACME, company_id: company!.id, title: "Engineer", status: "open" }));
  must(await db().from("access_roles").insert({ id: AGENCY, org_id: ACME, name: "Agency", can_view_candidates: true, can_edit_pipeline: true, own_candidates_only: true }));
  must(await db().from("job_access").insert({ org_id: ACME, actor_id: REX, role_id: JOB, access_role_id: AGENCY }));
});

afterAll(clear);

describe("teams", () => {
  test("an admin adds, the hiring team reads, and adding twice changes nothing", async () => {
    expect(await addTeamMember(...ada(), { department: "infra", memberId: LEE })).toEqual({ outcome: "added", departmentId: INFRA });
    expect(await addTeamMember(...ada(), { department: INFRA, memberId: LEE })).toEqual({ outcome: "already_on_team", departmentId: INFRA });
    expect(await listTeams(...lee())).toEqual([
      { departmentId: INFRA, name: "Infra", parentId: null, path: "Infra", members: [{ memberId: LEE, name: "Lee Lead", lead: false }] },
    ]);
    expect(await audit("department.member_add")).toEqual([
      { action: "department.member_add", entity: "department", entity_id: INFRA, source: "dashboard", actor_id: ADA, before: null, after: { actor_id: LEE } },
    ]);
  });

  test("an interviewer and an external recruiter are told no, not handed an empty company", async () => {
    await expect(listTeams(...ivy())).rejects.toMatchObject({ code: "forbidden" });
    await expect(listTeams(...rex())).rejects.toMatchObject({ code: "forbidden" });
    must(await db().from("department_members").insert({ org_id: ACME, department_id: INFRA, actor_id: LEE }));
    expect((await rex()[0].from("department_members").select("actor_id")).data).toEqual([]);
    expect((await ivy()[0].from("department_members").select("actor_id")).data).toEqual([]);
  });

  test("only an admin writes, past a forged level too", async () => {
    await expect(addTeamMember(...lee(), { department: INFRA, memberId: LEE })).rejects.toMatchObject({ code: "forbidden" });
    const forged = await member("user_setup_lee").from("department_members").insert({ department_id: INFRA, actor_id: LEE });
    expect(forged.error?.code).toBe("42501");
    await expect(addTeamMember(member("user_setup_lee"), ctx(LEE, "admin"), { department: INFRA, memberId: LEE })).rejects.toThrow();
    expect(await memberships()).toEqual([]);
  });

  test("another company's team and member are not found", async () => {
    await expect(addTeamMember(...ada(), { department: THEIRS, memberId: LEE })).rejects.toMatchObject({ code: "not_found" });
    await expect(addTeamMember(...ada(), { department: INFRA, memberId: GUS })).rejects.toMatchObject({ code: "not_found" });
    await expect(addTeamMember(...gus(), { department: INFRA, memberId: GUS })).rejects.toMatchObject({ code: "not_found" });
  });

  test("an archived team and someone who left take no one new, and the list leaves out what a row outlives", async () => {
    await expect(addTeamMember(...ada(), { department: OLD, memberId: LEE })).rejects.toMatchObject({ code: "invalid" });
    await expect(addTeamMember(...ada(), { department: INFRA, memberId: GONE })).rejects.toMatchObject({ code: "not_found" });
    must(await db().from("department_members").insert([
      { org_id: ACME, department_id: INFRA, actor_id: GONE, is_lead: true },
      { org_id: ACME, department_id: OLD, actor_id: LEE, is_lead: false },
    ]));
    expect(await listTeams(...ada())).toEqual([{ departmentId: INFRA, name: "Infra", parentId: null, path: "Infra", members: [] }]);
  });

  test("removing the lead leaves no lead, and a second remove changes nothing", async () => {
    await setTeamLead(...ada(), { department: INFRA, memberId: LEE });
    expect(await removeTeamMember(...ada(), { department: INFRA, memberId: LEE })).toEqual({ outcome: "removed", departmentId: INFRA, wasLead: true });
    expect(await removeTeamMember(...ada(), { department: INFRA, memberId: LEE })).toEqual({ outcome: "not_on_team", departmentId: INFRA, wasLead: false });
    expect(await memberships()).toEqual([]);
    expect(await audit("department.member_remove")).toHaveLength(1);
  });

  test("a new lead replaces the old one in one write, and the old one stays on the team", async () => {
    await addTeamMember(...ada(), { department: INFRA, memberId: IVY });
    expect(await setTeamLead(...ada(), { department: INFRA, memberId: IVY })).toEqual({ outcome: "changed", departmentId: INFRA, leadId: IVY, added: false });
    expect(await setTeamLead(...ada(), { department: INFRA, memberId: LEE })).toEqual({ outcome: "changed", departmentId: INFRA, leadId: LEE, added: true });
    expect(await memberships()).toEqual([{ actor_id: LEE, is_lead: true }, { actor_id: IVY, is_lead: false }]);
    expect(await setTeamLead(...ada(), { department: INFRA, memberId: LEE })).toMatchObject({ outcome: "unchanged" });
    expect((await audit("department.lead")).map((r) => [r.before, r.after])).toEqual([
      [{ lead: null }, { lead: IVY }],
      [{ lead: IVY }, { lead: LEE }],
    ]);
  });

  test("a lead who left still holds the place, and is replaced all the same", async () => {
    must(await db().from("department_members").insert({ org_id: ACME, department_id: INFRA, actor_id: GONE, is_lead: true }));
    expect(await setTeamLead(...ada(), { department: INFRA, memberId: LEE })).toMatchObject({ outcome: "changed", leadId: LEE });
    expect((await memberships()).filter((r) => r.is_lead)).toEqual([{ actor_id: LEE, is_lead: true }]);
  });

  test("the lead can be cleared", async () => {
    await setTeamLead(...ada(), { department: INFRA, memberId: LEE });
    expect(await setTeamLead(...ada(), { department: INFRA, memberId: null })).toMatchObject({ outcome: "changed", leadId: null });
    expect(await memberships()).toEqual([{ actor_id: LEE, is_lead: false }]);
    expect(await setTeamLead(...ada(), { department: INFRA, memberId: null })).toMatchObject({ outcome: "unchanged" });
  });

  test("two new leads at once leave one, and the loser is told", async () => {
    const results = await Promise.allSettled(
      [LEE, IVY, REX].map((memberId) => setTeamLead(...ada(), { department: INFRA, memberId })),
    );
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThan(0);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "invalid" });
    expect((await memberships()).filter((r) => r.is_lead)).toHaveLength(1);
  });

  test("a read-only connector stops the connector and not the page", async () => {
    must(await db().from("orgs").update({ connector_access: "read_only" }).eq("id", ACME));
    await expect(addTeamMember(member("user_setup_ada"), { ...ctx(ADA, "admin"), source: "claude" }, { department: INFRA, memberId: LEE })).rejects.toMatchObject({ code: "forbidden" });
    expect(await addTeamMember(...ada(), { department: INFRA, memberId: LEE })).toMatchObject({ outcome: "added" });
  });
});

describe("interview types", () => {
  test("add, a repeat in any case, rename, and the hiring team reads", async () => {
    const made = await addInterviewType(...ada(), { name: "  System   design " });
    expect(made).toMatchObject({ outcome: "created", name: "System design" });
    expect(await addInterviewType(...ada(), { name: "SYSTEM DESIGN" })).toEqual({ outcome: "exists", typeId: made.typeId, name: "System design" });
    expect(await renameInterviewType(...ada(), { type: made.typeId, name: "Architecture" })).toEqual({ outcome: "renamed", typeId: made.typeId });
    expect(await listInterviewTypes(...lee())).toEqual([{ typeId: made.typeId, name: "Architecture", archived: false, interviewers: [] }]);
    expect((await audit("interview_type.update")).map((r) => [r.before, r.after])).toEqual([[{ name: "System design" }, { name: "Architecture" }]]);
  });

  test("a type can change only its case, and cannot take a name in use, archived or not", async () => {
    const a = await addInterviewType(...ada(), { name: "Coding" });
    const b = await addInterviewType(...ada(), { name: "Values" });
    expect(await renameInterviewType(...ada(), { type: a.typeId, name: "CODING" })).toMatchObject({ outcome: "renamed" });
    await expect(renameInterviewType(...ada(), { type: b.typeId, name: "coding" })).rejects.toMatchObject({ code: "invalid" });
    await archiveInterviewType(...ada(), { type: a.typeId });
    await expect(renameInterviewType(...ada(), { type: b.typeId, name: "coding" })).rejects.toMatchObject({ code: "invalid" });
  });

  test("archived, it leaves the list, keeps who ran it, and adding the name brings it back", async () => {
    const { typeId } = await addInterviewType(...ada(), { name: "Coding" });
    await assignInterviewType(...ada(), { type: typeId, memberId: LEE });
    await prioritizeInterviewType(...ada(), { type: typeId, memberId: LEE, prioritized: true });
    expect(await archiveInterviewType(...ada(), { type: typeId })).toEqual({ outcome: "changed", typeId, archived: true });
    expect(await archiveInterviewType(...ada(), { type: typeId })).toEqual({ outcome: "unchanged", typeId, archived: true });
    expect(await listInterviewTypes(...ada())).toEqual([]);
    expect(await listInterviewTypes(...ada(), { includeArchived: true })).toHaveLength(1);
    await expect(assignInterviewType(...ada(), { type: typeId, memberId: IVY })).rejects.toMatchObject({ code: "invalid" });
    await expect(prioritizeInterviewType(...ada(), { type: typeId, memberId: LEE, prioritized: false })).rejects.toMatchObject({ code: "invalid" });
    expect(await addInterviewType(...ada(), { name: "coding" })).toEqual({ outcome: "restored", typeId, name: "Coding" });
    expect(await listInterviewTypes(...ada())).toEqual([
      { typeId, name: "Coding", archived: false, interviewers: [{ memberId: LEE, name: "Lee Lead", prioritized: true }] },
    ]);
  });

  test("assign, again, star, and off: a second assign keeps the star", async () => {
    const { typeId } = await addInterviewType(...ada(), { name: "Coding" });
    await expect(prioritizeInterviewType(...ada(), { type: typeId, memberId: LEE, prioritized: true })).rejects.toMatchObject({ code: "not_found" });
    expect(await assignInterviewType(...ada(), { type: typeId, memberId: LEE })).toEqual({ outcome: "assigned", typeId });
    expect(await prioritizeInterviewType(...ada(), { type: typeId, memberId: LEE, prioritized: true })).toEqual({ outcome: "changed", typeId });
    expect(await prioritizeInterviewType(...ada(), { type: typeId, memberId: LEE, prioritized: true })).toEqual({ outcome: "unchanged", typeId });
    expect(await assignInterviewType(...ada(), { type: typeId, memberId: LEE })).toEqual({ outcome: "already_assigned", typeId });
    expect(await assignment(LEE, typeId)).toEqual({ prioritized: true });
    expect(await unassignInterviewType(...ada(), { type: typeId, memberId: LEE })).toEqual({ outcome: "unassigned", typeId });
    expect(await unassignInterviewType(...ada(), { type: typeId, memberId: LEE })).toEqual({ outcome: "not_assigned", typeId });
    expect(await audit("interview_type.assign")).toHaveLength(1);
    expect(await audit("interview_type.prioritize")).toHaveLength(1);
    expect(await audit("interview_type.unassign")).toHaveLength(1);
  });

  test("someone who left drops off the list while their row stays", async () => {
    const { typeId } = await addInterviewType(...ada(), { name: "Coding" });
    must(await db().from("interviewer_interview_types").insert({ org_id: ACME, actor_id: GONE, type_id: typeId }));
    expect((await listInterviewTypes(...ada()))[0]?.interviewers).toEqual([]);
    await expect(assignInterviewType(...ada(), { type: typeId, memberId: GONE })).rejects.toMatchObject({ code: "not_found" });
  });

  test("an interviewer and an external recruiter read none, their own assignment included, and only an admin writes", async () => {
    const { typeId } = await addInterviewType(...ada(), { name: "Coding" });
    await assignInterviewType(...ada(), { type: typeId, memberId: IVY });
    await assignInterviewType(...ada(), { type: typeId, memberId: REX });
    await expect(listInterviewTypes(...ivy())).rejects.toMatchObject({ code: "forbidden" });
    await expect(listInterviewTypes(...rex())).rejects.toMatchObject({ code: "forbidden" });
    expect((await ivy()[0].from("interviewer_interview_types").select("type_id")).data).toEqual([]);
    expect((await rex()[0].from("interview_types").select("id")).data).toEqual([]);
    await expect(addInterviewType(...lee(), { name: "Values" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(archiveInterviewType(...lee(), { type: typeId })).rejects.toMatchObject({ code: "forbidden" });
    await expect(assignInterviewType(...lee(), { type: typeId, memberId: LEE })).rejects.toMatchObject({ code: "forbidden" });
  });

  test("another company's type is not found, and its name is free", async () => {
    const { typeId } = await addInterviewType(...ada(), { name: "Coding" });
    await expect(archiveInterviewType(...gus(), { type: typeId })).rejects.toMatchObject({ code: "not_found" });
    await expect(assignInterviewType(...gus(), { type: typeId, memberId: GUS })).rejects.toMatchObject({ code: "not_found" });
    expect(await addInterviewType(...gus(), { name: "Coding" })).toMatchObject({ outcome: "created" });
    expect(await listInterviewTypes(...gus())).toHaveLength(1);
  });

  test("two admins adding one name at once make one type", async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => addInterviewType(...ada(), { name: "Coding" })));
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "invalid" });
    expect(await listInterviewTypes(...ada())).toHaveLength(1);
  });
});

describe("the interview process", () => {
  const GRAPH = {
    nodes: [
      { id: "s", kind: "start", label: "SECRET-QUESTION-TEXT" },
      { id: "a", kind: "stage", type: "interview", label: "Team" },
    ],
    edges: [{ from: "s", to: "a" }],
  };

  test("none drawn is null; a first save, the next, and the audit row is counts and never the graph", async () => {
    expect(await getProcess(...ada())).toBeNull();
    const first = await setProcess(...ada(), { graph: GRAPH, expectedUpdatedAt: null });
    expect(first).toMatchObject({ outcome: "created" });
    const read = await getProcess(...lee());
    expect(read).toEqual({ graph: GRAPH, updatedAt: first.outcome === "created" ? first.updatedAt : "", updatedBy: ADA });

    const next = { nodes: GRAPH.nodes, edges: [] };
    expect(await setProcess(...ada(), { graph: next, expectedUpdatedAt: read!.updatedAt })).toMatchObject({ outcome: "updated" });
    const rows = await audit("interview_process.update");
    expect(rows.map((r) => [r.entity, r.entity_id, r.before, r.after])).toEqual([
      ["interview_process", ACME, null, { nodes: 2, edges: 1 }],
      ["interview_process", ACME, { nodes: 2, edges: 1 }, { nodes: 2, edges: 0 }],
    ]);
    expect(JSON.stringify(rows)).not.toContain("SECRET-QUESTION-TEXT");
  });

  test("a save made since is stale and overwrites nothing, the same graph is no change, whatever its key order", async () => {
    const first = await setProcess(...ada(), { graph: GRAPH, expectedUpdatedAt: null });
    const seen = first.outcome === "created" ? first.updatedAt : "";
    await setProcess(...ada(), { graph: { nodes: [], edges: [] }, expectedUpdatedAt: seen });
    expect(await setProcess(...ada(), { graph: GRAPH, expectedUpdatedAt: seen })).toEqual({ outcome: "stale" });
    expect(await setProcess(...ada(), { graph: GRAPH, expectedUpdatedAt: null })).toEqual({ outcome: "stale" });
    expect((await getProcess(...ada()))?.graph).toEqual({ nodes: [], edges: [] });
    const updatedAt = (await getProcess(...ada()))!.updatedAt;
    expect(await setProcess(...ada(), { graph: { edges: [], nodes: [] }, expectedUpdatedAt: "2001-01-01T00:00:00Z" })).toEqual({ outcome: "unchanged", updatedAt });
    expect(await audit("interview_process.update")).toHaveLength(2);
  });

  test("ten saves from one version land once", async () => {
    const first = await setProcess(...ada(), { graph: GRAPH, expectedUpdatedAt: null });
    const seen = first.outcome === "created" ? first.updatedAt : "";
    const results = await Promise.all(Array.from({ length: 10 }, (_, n) => setProcess(...ada(), { graph: { nodes: [{ n }], edges: [] }, expectedUpdatedAt: seen })));
    expect(results.filter((r) => r.outcome === "updated")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "stale")).toHaveLength(9);
    expect(await audit("interview_process.update")).toHaveLength(2);
  });

  test("ten first saves at once make one row", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, n) => setProcess(...ada(), { graph: { nodes: [{ n }], edges: [] }, expectedUpdatedAt: null })));
    expect(results.filter((r) => r.outcome === "created")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "stale")).toHaveLength(9);
  });

  test("the shape, the size and what jsonb cannot hold are sentences, and nothing is written", async () => {
    for (const graph of [null, [], "x", { nodes: [] }, { nodes: {}, edges: [] }]) {
      await expect(setProcess(...ada(), { graph, expectedUpdatedAt: null })).rejects.toMatchObject({ code: "invalid", field: "graph" });
    }
    const big = { nodes: ["x".repeat(PROCESS_GRAPH_MAX_BYTES)], edges: [] };
    await expect(setProcess(...ada(), { graph: big, expectedUpdatedAt: null })).rejects.toMatchObject({ code: "invalid" });
    // Under the limit as JSON and over it as the text jsonb writes out, which spaces its commas.
    const spaced = { nodes: Array.from({ length: 100000 }, () => 1), edges: [] };
    await expect(setProcess(...ada(), { graph: spaced, expectedUpdatedAt: null })).rejects.toMatchObject({ code: "invalid" });
    await expect(setProcess(...ada(), { graph: { nodes: ["\u0000"], edges: [] }, expectedUpdatedAt: null })).rejects.toMatchObject({ code: "invalid" });
    await expect(setProcess(...ada(), { graph: { nodes: ["\ud800"], edges: [] }, expectedUpdatedAt: null })).rejects.toMatchObject({ code: "invalid" });
    expect(await getProcess(...ada())).toBeNull();
    expect(await audit("interview_process.update")).toEqual([]);
  });

  test("an interviewer and an external recruiter cannot read it, and are not told there is none", async () => {
    await setProcess(...ada(), { graph: GRAPH, expectedUpdatedAt: null });
    await expect(getProcess(...ivy())).rejects.toMatchObject({ code: "forbidden" });
    await expect(getProcess(...rex())).rejects.toMatchObject({ code: "forbidden" });
    expect((await rex()[0].from("interview_processes").select("graph")).data).toEqual([]);
  });

  test("only an admin writes, past a forged level too, and another company's is its own", async () => {
    await setProcess(...ada(), { graph: GRAPH, expectedUpdatedAt: null });
    await expect(setProcess(...lee(), { graph: GRAPH, expectedUpdatedAt: null })).rejects.toMatchObject({ code: "forbidden" });
    const forged = await member("user_setup_lee").from("interview_processes").update({ graph: { nodes: [], edges: [] } }).eq("org_id", ACME).select("org_id");
    expect(forged.data).toEqual([]);
    expect(await getProcess(...gus())).toBeNull();
    expect(await setProcess(...gus(), { graph: { nodes: [1], edges: [] }, expectedUpdatedAt: null })).toMatchObject({ outcome: "created" });
    expect((await getProcess(...ada()))?.graph).toEqual(GRAPH);
  });
});

describe("a member's title", () => {
  const title = async (id: string) => must(await db().from("interviewer_profiles").select("title").eq("actor_id", id).maybeSingle()).data?.title ?? null;

  test("an interviewer sets their own, on a row with nothing else in it, and the audit row names the field", async () => {
    expect(await setMemberTitle(...ivy(), { memberId: IVY, title: "  Staff engineer " })).toEqual({ outcome: "changed", title: "Staff engineer" });
    expect(await title(IVY)).toBe("Staff engineer");
    expect(await setMemberTitle(...ivy(), { memberId: IVY, title: "Staff engineer" })).toMatchObject({ outcome: "unchanged" });
    expect(await setMemberTitle(...ivy(), { memberId: IVY, title: "" })).toEqual({ outcome: "changed", title: null });
    expect(await title(IVY)).toBeNull();
    const rows = await audit("interviewer_profile.update");
    expect(rows.map((r) => r.after)).toEqual([{ fields: ["title"] }, { fields: ["title"] }]);
  });

  test("an admin sets anyone's in their company; nobody else does, past a forged level too", async () => {
    expect(await setMemberTitle(...ada(), { memberId: LEE, title: "Lead" })).toMatchObject({ outcome: "changed" });
    await expect(setMemberTitle(...lee(), { memberId: IVY, title: "x" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(setMemberTitle(...ada(), { memberId: GUS, title: "x" })).rejects.toMatchObject({ code: "not_found" });
    await expect(setMemberTitle(...ada(), { memberId: GONE, title: "x" })).rejects.toMatchObject({ code: "not_found" });
    await expect(setMemberTitle(member("user_setup_lee"), ctx(LEE, "admin"), { memberId: IVY, title: "x" })).rejects.toThrow();
    expect(await title(IVY)).toBeNull();
  });

  test("saving a profile leaves the title alone, and a title leaves the profile alone", async () => {
    await setMemberTitle(...ivy(), { memberId: IVY, title: "Staff engineer" });
    const { data } = must(await db().from("interviewer_profiles").select("updated_at").eq("actor_id", IVY).single());
    const profile = { preference: "loves", weeklyCap: 2, focusAreas: ["Go"], channel: null, awayUntil: null };
    expect(await setInterviewerProfile(...ivy(), { memberId: IVY, expectedUpdatedAt: data!.updated_at, profile })).toEqual({ outcome: "changed" });
    expect(await title(IVY)).toBe("Staff engineer");
    await setMemberTitle(...ivy(), { memberId: IVY, title: "Principal" });
    const row = must(await db().from("interviewer_profiles").select("interview_preference, focus_areas, title").eq("actor_id", IVY).single()).data;
    expect(row).toEqual({ interview_preference: "loves", focus_areas: ["Go"], title: "Principal" });
  });

  test("what the column would refuse is a sentence on the field", async () => {
    await expect(setMemberTitle(...ivy(), { memberId: IVY, title: "x".repeat(121) })).rejects.toMatchObject({ code: "invalid", field: "title" });
    await expect(setMemberTitle(...ivy(), { memberId: IVY, title: "two\nlines" })).rejects.toMatchObject({ code: "invalid", field: "title" });
    expect(await setMemberTitle(...ivy(), { memberId: IVY, title: " Lead " })).toEqual({ outcome: "changed", title: "Lead" });
  });
});
