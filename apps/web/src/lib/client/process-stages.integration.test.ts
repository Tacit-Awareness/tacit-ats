import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { coverageOf } from "./coverage";
import { readCandidates, readStageNames } from "./crm";
import { crmTable, withStageNames } from "./crm-views";
import { readHome } from "./home";
import { readInterviewRoute, readInterviews } from "./interviews";
import { readChecklist } from "./onboarding";
import { readSkillSheet } from "./onboarding-teams";
import { readPipeline } from "./pipeline";
import { readDrawnProcess } from "./process";
import type { ProcessDoc, ProcessEdge, ProcessNode } from "./process-graph";

/**
 * Stage names, the routing graph's read and the checklist's end, on members' own
 * tokens. What matters most here: the process is the company's, and an interviewer's
 * token never asks for it, whichever page they open. They and everyone else who may
 * not read it fall back to today's labels.
 */

const db = () => getSupabaseServiceClient();

const ACME = "ec000000-0000-4000-8000-0000000000a1";
const ADA = "eca00000-0000-4000-8000-0000000000a1"; // admin
const LEE = "eca00000-0000-4000-8000-0000000000a2"; // hiring team
const IVY = "eca00000-0000-4000-8000-0000000000a3"; // interviewer
const REX = "eca00000-0000-4000-8000-0000000000a4"; // external recruiter
const ENG = "ecd00000-0000-4000-8000-0000000000a1";
const SALES = "ecd00000-0000-4000-8000-0000000000a2";
const MATCHED = "ece00000-0000-4000-8000-0000000000a1"; // Engineering, plan as the process says
const OWN_PLAN = "ece00000-0000-4000-8000-0000000000a2"; // Engineering, its own plan
const SELLER = "ece00000-0000-4000-8000-0000000000a3"; // Sales, plan as the process says
const ACCESS = "ecf00000-0000-4000-8000-0000000000a1";
const person = (n: number) => `ecb00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const application = (n: number) => `ecc00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  must(await db().from("audit_log").delete().eq("org_id", ACME));
  for (const table of ["interview_processes", "interviews", "applications", "interviewer_interview_types", "interview_types", "department_members", "job_access", "access_roles", "roles", "departments", "people", "companies"] as const) {
    must(await db().from(table).delete().eq("org_id", ACME));
  }
  await db().from("actors").delete().eq("org_id", ACME);
  await db().from("orgs").delete().eq("id", ACME);
}

const member = (subject: string) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId: "org_itest_stages" }));
};
const ctx = (actorId: string, accessLevel: clientTools.ClientToolCtx["accessLevel"]): clientTools.ClientToolCtx => ({ actorId, orgId: ACME, accessLevel, source: "dashboard" });
const ada = () => [member("user_stages_ada"), ctx(ADA, "admin")] as const;
const lee = () => [member("user_stages_lee"), ctx(LEE, "elevated")] as const;
const ivy = () => [member("user_stages_ivy"), ctx(IVY, "limited")] as const;
const rex = () => [member("user_stages_rex"), ctx(REX, "elevated")] as const;

const step = (id: string, label: string, type: ProcessNode["type"] = "interview"): ProcessNode => ({ id, kind: "stage", x: 0, y: 0, label, type, team: "own" });
const edge = (from: string, to: string, department?: string): ProcessEdge => ({ id: `${from}-${to}`, from, to, label: "", ...(department ? { department } : {}) });

/** in -> Application review -> split -> (Engineering: Tech | Sales: Pitch) -> Final -> Offer letter */
const GRAPH: ProcessDoc = {
  nodes: [
    { id: "in", kind: "start", x: 0, y: 0, label: "Applied" },
    step("rev", "Application review", "review"),
    { id: "split", kind: "route", x: 0, y: 0, label: "Split" },
    step("tech", "Tech"), step("pitch", "Pitch"), step("final", "Final"),
    { id: "out", kind: "end", x: 0, y: 0, label: "Offer letter" },
  ],
  edges: [edge("in", "rev"), edge("rev", "split"), edge("split", "tech", ENG), edge("split", "pitch", SALES), edge("tech", "final"), edge("pitch", "final"), edge("final", "out")],
};

const draw = () => clientTools.setProcess(...ada(), { graph: GRAPH, expectedUpdatedAt: null });
const NOW = new Date("2026-10-31T12:00:00Z");

/** Every request a token makes, so a test can say what it never asked for. */
function spied() {
  const asked: string[] = [];
  const real = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    asked.push(String(input instanceof Request ? input.url : input));
    return real(input, init);
  });
  return asked;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await clear();
  must(await db().from("orgs").insert({ id: ACME, name: "Acme", slug: "itest-stages-acme", kind: "client", workos_org_id: "org_itest_stages" }));
  must(await db().from("actors").insert([
    { id: ADA, org_id: ACME, slug: "itest-stages-ada", display_name: "Ada Admin", email: "ada@stages.test", access_level: "admin", auth_subject: "user_stages_ada" },
    { id: LEE, org_id: ACME, slug: "itest-stages-lee", display_name: "Lee Lead", email: "lee@stages.test", access_level: "elevated", auth_subject: "user_stages_lee" },
    { id: IVY, org_id: ACME, slug: "itest-stages-ivy", display_name: "Ivy Interviewer", email: "ivy@stages.test", access_level: "limited", auth_subject: "user_stages_ivy" },
    { id: REX, org_id: ACME, slug: "itest-stages-rex", display_name: "Rex Recruiter", email: "rex@stages.test", access_level: "elevated", auth_subject: "user_stages_rex" },
  ]));
  must(await db().from("departments").insert([{ id: ENG, org_id: ACME, name: "Engineering" }, { id: SALES, org_id: ACME, name: "Sales" }]));
  const { data: company } = must(await db().from("companies").insert({ org_id: ACME, name: "Acme" }).select("id").single());
  const job = (id: string, title: string, department_id: string, interview_steps: string[]) => ({ id, org_id: ACME, company_id: company!.id, title, status: "open" as const, interview_steps, department_id });
  must(await db().from("roles").insert([
    job(MATCHED, "Engineer", ENG, ["Tech", "Final"]),
    job(OWN_PLAN, "Odd one", ENG, ["Chat"]),
    job(SELLER, "Seller", SALES, ["Pitch", "Final"]),
  ]));
  must(await db().from("access_roles").insert({ id: ACCESS, org_id: ACME, name: "Agency", can_view_candidates: true, can_edit_pipeline: true, own_candidates_only: true }));
  must(await db().from("job_access").insert({ org_id: ACME, actor_id: REX, role_id: MATCHED, access_role_id: ACCESS }));
  must(await db().from("people").insert([1, 2, 3, 4, 5].map((n) => ({ id: person(n), org_id: ACME, display_name: `Person ${n}` }))));
  must(await db().from("applications").insert([
    { id: application(1), org_id: ACME, person_id: person(1), role_id: MATCHED, stage: "sourced", added_by_actor_id: REX },
    { id: application(2), org_id: ACME, person_id: person(2), role_id: MATCHED, stage: "interviewing" },
    { id: application(3), org_id: ACME, person_id: person(3), role_id: MATCHED, stage: "offer" },
    { id: application(4), org_id: ACME, person_id: person(4), role_id: OWN_PLAN, stage: "screening" },
    { id: application(5), org_id: ACME, person_id: person(5), role_id: SELLER, stage: "interviewing" },
  ]));
  must(await db().from("interviews").insert({
    org_id: ACME, application_id: application(2), step: "Tech", status: "done", interviewer_actor_ids: [IVY],
    starts_at: "2026-10-20T15:00:00Z", ends_at: "2026-10-20T16:00:00Z",
  }));
});

afterAll(async () => {
  vi.restoreAllMocks();
  await clear();
});

const names = async (read: ReturnType<typeof readPipeline>) => Object.fromEntries((await read).entries.map((e) => [e.applicationId, e.stageName?.name ?? null]));

describe("stage names on the Pipeline", () => {
  test("each stage takes the company's name, a job off the process keeps today's, parallel steps are one", async () => {
    await draw();
    const [db, c] = ada();
    expect(await names(readPipeline(db, NOW, c))).toEqual({
      [application(1)]: "Application review",
      [application(2)]: "Final", // Tech held, so the plan's next step
      [application(3)]: "Offer letter",
      [application(4)]: null,
      [application(5)]: "Tech / Pitch",
    });
    expect((await readPipeline(db, NOW, c)).stages?.map((s) => s.name)).toEqual(["Application review", "Tech / Pitch", "Final", "Offer letter"]);
  });

  test("the hiring team reads the names too", async () => {
    await draw();
    const [token, c] = lee();
    expect((await readPipeline(token, NOW, c)).stages).not.toBeNull();
  });

  test("no process keeps today's labels, for everyone", async () => {
    const [token, c] = ada();
    expect(Object.values(await names(readPipeline(token, NOW, c))).every((n) => n === null)).toBe(true);
    expect((await readPipeline(token, NOW, c)).stages).toBeNull();
  });

  test("an external recruiter gets their own candidate's card with today's labels", async () => {
    await draw();
    const [token, c] = rex();
    const read = await readPipeline(token, NOW, c);
    expect(read.entries.map((e) => [e.applicationId, e.stageName])).toEqual([[application(1), null]]);
    expect(read.stages).toBeNull();
  });

  test("a page that does not ask does not read the process at all", async () => {
    await draw();
    const asked = spied();
    await readPipeline(ada()[0], NOW);
    expect(asked.some((u) => u.includes("interview_processes"))).toBe(false);
    // The same spy does see it when a page asks, so "never asked" below means something.
    await readPipeline(...([ada()[0], NOW, ada()[1]] as const));
    expect(asked.some((u) => u.includes("interview_processes"))).toBe(true);
  });
});

describe("an interviewer", () => {
  test("their token cannot read the process, by the policy, past any check of ours", async () => {
    await draw();
    expect((await ivy()[0].from("interview_processes").select("graph")).data).toEqual([]);
  });

  test("never asks: not for the Pipeline's names, the CRM's, the graph or the process itself", async () => {
    await draw();
    const asked = spied();
    const [token, c] = ivy();
    expect(await readDrawnProcess(token, c)).toBeNull();
    expect(await names(readPipeline(token, NOW, c))).toEqual({});
    const { candidates } = await readCandidates(token);
    const table = crmTable(candidates, { view: "all", q: "", sort: "last", dir: "desc", page: 1, department: null });
    expect((await readStageNames(token, c, table.rows)).size).toBe(0);
    expect(await readInterviewRoute(token, { actorId: IVY, orgId: ACME, accessLevel: "limited" }, MATCHED, ["Tech", "Final"])).toBeNull();
    await readInterviews(token, { actorId: IVY, orgId: ACME, accessLevel: "limited" }, NOW);
    expect(asked.filter((u) => u.includes("interview_processes") || u.includes("can_see_prospects"))).toEqual([]);
  });

  test("a forged level does not get them one either: the policy gives nothing, so today's labels", async () => {
    await draw();
    expect(await readDrawnProcess(ivy()[0], ctx(IVY, "elevated"))).toBeNull();
  });
});

describe("stage names on Home and the CRM", () => {
  test("Home's stages come from the process, and a job off it still counts", async () => {
    await draw();
    const [token, c] = ada();
    const read = await readHome(token, c, { days: 7, jobId: null }, NOW);
    expect(read.stages?.map((s) => s.name)).toEqual(["Application review", "Tech / Pitch", "Final", "Offer letter"]);
    expect(read.waiting).toHaveLength(5);
    expect(read.waiting.filter((w) => !w.stage).map((w) => w.applicationId)).toEqual([application(4)]);
  });

  test("the CRM names the rows on the page, on the member's own read", async () => {
    await draw();
    const [token, c] = ada();
    const { candidates } = await readCandidates(token);
    const table = crmTable(candidates, { view: "all", q: "", sort: "name", dir: "asc", page: 1, department: null });
    const rows = withStageNames(table.rows, await readStageNames(token, c, table.rows));
    expect(rows.map((r) => [r.name, r.stage, r.stageName])).toEqual([
      ["Person 1", "sourced", "Application review"],
      ["Person 2", "interviewing", "Final"],
      ["Person 3", "offer", "Offer letter"],
      ["Person 4", "screening", null],
      ["Person 5", "interviewing", "Tech / Pitch"],
    ]);
  });

  test("a rejected candidate keeps the outcome, whatever the process says", async () => {
    await draw();
    must(await db().from("applications").update({ stage: "rejected" }).eq("id", application(1)));
    const [token, c] = ada();
    const { candidates } = await readCandidates(token);
    const table = crmTable(candidates, { view: "rejected", q: "", sort: "name", dir: "asc", page: 1, department: null });
    expect((await readStageNames(token, c, table.rows)).size).toBe(0);
  });

  test("names change nothing stored", async () => {
    await draw();
    const [token, c] = ada();
    await readPipeline(token, NOW, c);
    const { data } = must(await db().from("applications").select("stage").eq("id", application(1)).single());
    expect(data!.stage).toBe("sourced");
  });
});

describe("the routing graph's read", () => {
  const admin = { actorId: ADA, orgId: ACME, accessLevel: "admin" as const };

  test("a job that follows the process gets it; one that does not, or no process, the plain loop", async () => {
    expect(await readInterviewRoute(ada()[0], admin, MATCHED, ["Tech", "Final"])).toBeNull();
    await draw();
    expect(await readInterviewRoute(ada()[0], admin, MATCHED, ["Tech", "Final"])).toMatchObject({ departmentId: ENG, graph: GRAPH });
    expect(await readInterviewRoute(ada()[0], admin, OWN_PLAN, ["Chat"])).toBeNull();
  });

  test("an external recruiter keeps the plain loop", async () => {
    await draw();
    expect(await readInterviewRoute(rex()[0], { actorId: REX, orgId: ACME, accessLevel: "elevated" }, MATCHED, ["Tech", "Final"])).toBeNull();
  });
});

describe("Review and the checklist", () => {
  test("Review shows a gap, and the checklist finishes once it is filled", async () => {
    const [token, c] = ada();
    await draw();
    const coding = await clientTools.addInterviewType(token, c, { name: "Coding" });
    const design = await clientTools.addInterviewType(token, c, { name: "Design" });
    for (const memberId of [ADA, LEE, IVY, REX]) {
      await clientTools.addTeamMember(token, c, { department: ENG, memberId });
      await clientTools.assignInterviewType(token, c, { type: coding.typeId, memberId });
    }
    const before = await readSkillSheet(token, c);
    expect(coverageOf(before.sheet, before.teams)).toMatchObject({ state: "gaps", gaps: ["Design"], interviewers: 4, teams: 2, covered: 1, types: 2 });
    expect((await readChecklist(token, c)).complete).toBe(true); // Every person placed: a gap in the types stops nothing.

    await clientTools.assignInterviewType(token, c, { type: design.typeId, memberId: LEE });
    const after = await readSkillSheet(token, c);
    expect(coverageOf(after.sheet, after.teams)).toMatchObject({ state: "covered", gaps: [], covered: 2 });
    const checklist = await readChecklist(token, c);
    expect(checklist).toMatchObject({ complete: true, done: 5, total: 5 });
    expect(checklist.items.find((i) => i.key === "review")).toMatchObject({ done: true, detail: "All set" });
  });

  test("the checklist takes the tick back when something is undone", async () => {
    const [token, c] = ada();
    const coding = await clientTools.addInterviewType(token, c, { name: "Coding" });
    await draw();
    for (const memberId of [ADA, LEE, IVY, REX]) {
      await clientTools.addTeamMember(token, c, { department: ENG, memberId });
      await clientTools.assignInterviewType(token, c, { type: coding.typeId, memberId });
    }
    expect((await readChecklist(token, c)).complete).toBe(true);
    await clientTools.removeTeamMember(token, c, { department: ENG, memberId: IVY });
    const checklist = await readChecklist(token, c);
    expect(checklist.complete).toBe(false);
    expect(checklist.items.find((i) => i.key === "review")?.done).toBe(false);
  });

  test("the hiring team reads the same coverage", async () => {
    const [token, c] = ada();
    await clientTools.addInterviewType(token, c, { name: "Coding" });
    const read = await readSkillSheet(...lee());
    expect(coverageOf(read.sheet, read.teams).gaps).toEqual(["Coding"]);
    expect(await readDrawnProcess(token, c)).toBeNull();
  });
});
