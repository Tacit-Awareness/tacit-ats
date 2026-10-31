import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { onboardingAccess, readChecklist } from "./onboarding";
import { applyProcess, previewApply, readProcess, saveProcess, type ApplyAnswer } from "./process";
import { defaultGraph, type ProcessDoc, type ProcessEdge, type ProcessNode } from "./process-graph";

/**
 * The Interview process step against the local stack on members' own tokens: who
 * reads and who writes, a stale save, and Apply, which only ever writes through
 * setInterviewPlan, so a confidential job refuses it.
 */

const db = () => getSupabaseServiceClient();

const ACME = "eb000000-0000-4000-8000-0000000000a1";
const GLOBEX = "eb000000-0000-4000-8000-0000000000a2";
const ADA = "eba00000-0000-4000-8000-0000000000a1"; // admin
const LEE = "eba00000-0000-4000-8000-0000000000a2"; // hiring team
const IVY = "eba00000-0000-4000-8000-0000000000a3"; // interviewer
const REX = "eba00000-0000-4000-8000-0000000000a4"; // external recruiter
const GUS = "eba00000-0000-4000-8000-0000000000a5"; // another company's admin
const CANDIDATE = "eba00000-0000-4000-8000-0000000000a6";
const ENG = "ebd00000-0000-4000-8000-0000000000a1";
const SALES = "ebd00000-0000-4000-8000-0000000000a2";
const PLATFORM = "ebd00000-0000-4000-8000-0000000000a3"; // inside Engineering
const ENGINEER = "ebe00000-0000-4000-8000-0000000000a1"; // Engineering
const KERNEL = "ebe00000-0000-4000-8000-0000000000a2"; // Platform, already on a plan with an interview
const SELLER = "ebe00000-0000-4000-8000-0000000000a3"; // Sales
const LOOSE = "ebe00000-0000-4000-8000-0000000000a4"; // no department
const CLOSED = "ebe00000-0000-4000-8000-0000000000a5"; // closed
const SECRET = "ebe00000-0000-4000-8000-0000000000a6"; // confidential, Ada on it, so hers
const HIDDEN = "ebe00000-0000-4000-8000-0000000000a7"; // confidential, Ada not on it: her token does not read it
const ACCESS = "ebf00000-0000-4000-8000-0000000000a1";
const VIEWER = "ebf00000-0000-4000-8000-0000000000a2";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  must(await db().from("audit_log").delete().in("org_id", ids));
  for (const table of ["interview_processes", "interviews", "applications", "job_access", "access_roles", "roles", "departments", "people", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const member = (subject: string, workosOrgId = "org_itest_proc_acme") => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};
const ctx = (actorId: string, accessLevel: clientTools.ClientToolCtx["accessLevel"], orgId = ACME): clientTools.ClientToolCtx => ({ actorId, orgId, accessLevel, source: "dashboard" });
const ada = () => [member("user_proc_ada"), ctx(ADA, "admin")] as const;
const lee = () => [member("user_proc_lee"), ctx(LEE, "elevated")] as const;
const ivy = () => [member("user_proc_ivy"), ctx(IVY, "limited")] as const;
const rex = () => [member("user_proc_rex"), ctx(REX, "elevated")] as const;
const gus = () => [member("user_proc_gus", "org_itest_proc_globex"), ctx(GUS, "admin", GLOBEX)] as const;

const stage = (id: string, label = id): ProcessNode => ({ id, kind: "stage", x: 0, y: 0, label, type: "interview", team: "own" });
const edge = (from: string, to: string, department?: string): ProcessEdge => ({ id: `${from}-${to}`, from, to, label: "", ...(department ? { department } : {}) });

/** in -> screen -> split -> (Engineering: Tech | Sales: Pitch | everyone else: Chat) -> Final -> out */
const GRAPH: ProcessDoc = {
  nodes: [
    { id: "in", kind: "start", x: 0, y: 0, label: "Applied" },
    { ...stage("screen", "Application review"), type: "review" },
    { id: "split", kind: "route", x: 0, y: 0, label: "Split" },
    stage("tech", "Technical"), stage("pitch", "Pitch"), stage("chat", "Chat"), stage("final", "Final"),
    { id: "out", kind: "end", x: 0, y: 0, label: "Offer" },
  ],
  edges: [
    edge("in", "screen"), edge("screen", "split"), edge("split", "tech", ENG), edge("split", "pitch", SALES), edge("split", "chat"),
    edge("tech", "final"), edge("pitch", "final"), edge("chat", "final"), edge("final", "out"),
  ],
};

const audit = async (action: string) =>
  must(await db().from("audit_log").select("action, entity, entity_id, source, actor_id, before, after").eq("org_id", ACME).eq("action", action).not("after", "is", null).order("created_at")).data ?? [];
const steps = async (id: string) => must(await db().from("roles").select("interview_steps").eq("id", id).single()).data!.interview_steps;
const saved = async () => {
  const answer = await saveProcess(...ada(), { graph: GRAPH, expectedUpdatedAt: null });
  if (!answer.ok) throw new Error("fixture: the save was refused");
  return answer.updatedAt;
};
const okJobs = (answer: ApplyAnswer) => {
  if (!answer.ok) throw new Error(`refused: ${answer.error}`);
  return new Map(answer.jobs.map((j) => [j.jobId, j]));
};

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-proc-acme", kind: "client", workos_org_id: "org_itest_proc_acme" },
    { id: GLOBEX, name: "Globex", slug: "itest-proc-globex", kind: "client", workos_org_id: "org_itest_proc_globex" },
  ]));
  must(await db().from("actors").insert([
    { id: ADA, org_id: ACME, slug: "itest-proc-ada", display_name: "Ada Admin", email: "ada@proc.test", access_level: "admin", auth_subject: "user_proc_ada" },
    { id: LEE, org_id: ACME, slug: "itest-proc-lee", display_name: "Lee Lead", email: "lee@proc.test", access_level: "elevated", auth_subject: "user_proc_lee" },
    { id: IVY, org_id: ACME, slug: "itest-proc-ivy", display_name: "Ivy Interviewer", email: "ivy@proc.test", access_level: "limited", auth_subject: "user_proc_ivy" },
    { id: REX, org_id: ACME, slug: "itest-proc-rex", display_name: "Rex Recruiter", email: "rex@proc.test", access_level: "elevated", auth_subject: "user_proc_rex" },
    { id: GUS, org_id: GLOBEX, slug: "itest-proc-gus", display_name: "Gus Globex", email: "gus@proc.test", access_level: "admin", auth_subject: "user_proc_gus" },
  ]));
  must(await db().from("departments").insert([
    { id: ENG, org_id: ACME, name: "Engineering" },
    { id: SALES, org_id: ACME, name: "Sales" },
    { id: PLATFORM, org_id: ACME, name: "Platform", parent_id: ENG },
  ]));
  const { data: company } = must(await db().from("companies").insert({ org_id: ACME, name: "Acme" }).select("id").single());
  const job = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, org_id: ACME, company_id: company!.id, title, status: "open" as const, interview_steps: [], department_id: null, confidential: false, ...extra });
  must(await db().from("roles").insert([
    job(ENGINEER, "Engineer", { department_id: ENG }),
    job(KERNEL, "Kernel hacker", { department_id: PLATFORM, interview_steps: ["Tech screen", "Final"] }),
    job(SELLER, "Seller", { department_id: SALES, interview_steps: ["Pitch", "Final"] }),
    job(LOOSE, "Anything"),
    job(CLOSED, "Old job", { status: "closed", department_id: ENG, interview_steps: ["Kept"] }),
    job(SECRET, "Secret job", { department_id: ENG, confidential: true, interview_steps: ["Kept"] }),
    job(HIDDEN, "Hidden job", { department_id: ENG, confidential: true, interview_steps: ["Kept"] }),
  ]));
  must(await db().from("access_roles").insert([
    { id: ACCESS, org_id: ACME, name: "Agency", can_view_candidates: true, can_edit_pipeline: true, own_candidates_only: true },
    { id: VIEWER, org_id: ACME, name: "Viewer", can_view_candidates: true, can_edit_pipeline: false, own_candidates_only: false },
  ]));
  must(await db().from("job_access").insert([
    { org_id: ACME, actor_id: REX, role_id: ENGINEER, access_role_id: ACCESS },
    { org_id: ACME, actor_id: ADA, role_id: SECRET, access_role_id: VIEWER },
  ]));
  const { data: person } = must(await db().from("people").insert({ id: CANDIDATE, org_id: ACME, display_name: "Cara Candidate" }).select("id").single());
  const { data: application } = must(await db().from("applications").insert({ org_id: ACME, person_id: person!.id, role_id: KERNEL, stage: "interviewing" }).select("id").single());
  must(await db().from("interviews").insert({
    org_id: ACME, application_id: application!.id, step: "Tech screen", status: "scheduled", interviewer_actor_ids: [ADA],
    starts_at: "2099-01-01T15:00:00Z", ends_at: "2099-01-01T16:00:00Z",
  }));
});

afterAll(clear);

describe("who reads it", () => {
  test("nothing saved reads as the neutral start, marked as such, and writes nothing", async () => {
    const read = await readProcess(...ada());
    expect(read).toMatchObject({ drawn: false, updatedAt: null });
    expect(read.graph).toEqual(defaultGraph());
    expect(must(await db().from("interview_processes").select("org_id").eq("org_id", ACME)).data).toEqual([]);
  });

  test("the hiring team reads what an admin saved, with the departments and members to draw it", async () => {
    await saved();
    const read = await readProcess(...lee());
    expect(read).toMatchObject({ drawn: true, graph: GRAPH });
    expect(read.lookup.departments.map((d) => d.name).sort()).toEqual(["Engineering", "Platform", "Sales"]);
    expect(read.lookup.members.map((m) => m.name)).toContain("Lee Lead");
  });

  test("an archived department is still in the lookup, so it can be drawn as a gap", async () => {
    must(await db().from("departments").update({ archived_at: new Date().toISOString() }).eq("id", SALES));
    const read = await readProcess(...ada());
    expect(read.lookup.departments.find((d) => d.id === SALES)).toMatchObject({ archived: true });
  });

  test("an interviewer and an external recruiter get nothing new", async () => {
    await saved();
    expect(await onboardingAccess(...([ivy()[0], "limited"] as const))).toBe("none");
    expect(await onboardingAccess(...([rex()[0], "elevated"] as const))).toBe("none");
    await expect(readProcess(...ivy())).rejects.toMatchObject({ code: "forbidden" });
    await expect(readProcess(...rex())).rejects.toMatchObject({ code: "forbidden" });
  });

  test("another company never reads it", async () => {
    await saved();
    expect(await readProcess(...gus())).toMatchObject({ drawn: false, updatedAt: null });
  });
});

describe("saving", () => {
  test("only an admin saves", async () => {
    for (const who of [lee(), ivy(), rex()]) expect(await saveProcess(...who, { graph: GRAPH, expectedUpdatedAt: null })).toEqual({ ok: false, error: "forbidden" });
    expect(must(await db().from("interview_processes").select("org_id").eq("org_id", ACME)).data).toEqual([]);
  });

  test("the hiring team cannot write the table directly either", async () => {
    await saved();
    const { data } = await lee()[0].from("interview_processes").update({ graph: { nodes: [], edges: [] } }).eq("org_id", ACME).select("org_id");
    expect(data ?? []).toEqual([]);
    expect((await readProcess(...ada())).graph).toEqual(GRAPH);
  });

  test("saving changes no job", async () => {
    await saved();
    expect(await steps(ENGINEER)).toEqual([]);
    expect(await steps(KERNEL)).toEqual(["Tech screen", "Final"]);
    expect(await audit("role.interview_plan")).toEqual([]);
  });

  test("the audit row is counts, never the graph", async () => {
    await saved();
    const [row] = await audit("interview_process.update");
    expect(row).toMatchObject({ entity: "interview_process", source: "dashboard", actor_id: ADA, before: null, after: { nodes: 8, edges: 9 } });
    expect(JSON.stringify(row)).not.toContain("Technical");
  });

  test("a save over someone else's is refused, says what is there now, and can then go over it", async () => {
    const seen = await saved();
    const other = await saveProcess(...ada(), { graph: { ...GRAPH, nodes: GRAPH.nodes.map((n) => (n.id === "final" ? { ...n, label: "Theirs" } : n)) }, expectedUpdatedAt: seen });
    expect(other).toMatchObject({ ok: true, changed: true });
    const latest = other.ok ? other.updatedAt : "";

    const mine = { ...GRAPH, nodes: GRAPH.nodes.map((n) => (n.id === "final" ? { ...n, label: "Mine" } : n)) };
    expect(await saveProcess(...ada(), { graph: mine, expectedUpdatedAt: seen })).toEqual({ ok: false, stale: true, latest });
    expect((await readProcess(...ada())).graph.nodes.find((n) => n.id === "final")?.label).toBe("Theirs");

    expect(await saveProcess(...ada(), { graph: mine, expectedUpdatedAt: latest })).toMatchObject({ ok: true, changed: true });
    expect((await readProcess(...ada())).graph.nodes.find((n) => n.id === "final")?.label).toBe("Mine");
  });

  test("two first saves at once: one lands, the other hears it", async () => {
    const answers = await Promise.all([saveProcess(...ada(), { graph: GRAPH, expectedUpdatedAt: null }), saveProcess(...ada(), { graph: defaultGraph(), expectedUpdatedAt: null })]);
    expect(answers.filter((a) => a.ok)).toHaveLength(1);
    expect(answers.filter((a) => !a.ok && "stale" in a)).toHaveLength(1);
  });

  test("saving the same again changes nothing and leaves no audit row", async () => {
    const seen = await saved();
    expect(await saveProcess(...ada(), { graph: GRAPH, expectedUpdatedAt: seen })).toEqual({ ok: true, updatedAt: seen, changed: false });
    expect(await audit("interview_process.update")).toHaveLength(1);
  });

  test("a drawing with problems is kept: nothing live reads it", async () => {
    const broken = { nodes: GRAPH.nodes, edges: GRAPH.edges.filter((e) => e.from !== "final") };
    expect(await saveProcess(...ada(), { graph: broken, expectedUpdatedAt: null })).toMatchObject({ ok: true });
  });

  test("what cannot be read is refused, with nothing dropped quietly", async () => {
    expect(await saveProcess(...ada(), { graph: { nodes: [{ id: "x" }], edges: [] }, expectedUpdatedAt: null })).toEqual({ ok: false, error: "invalid" });
    expect(await saveProcess(...ada(), { graph: { nodes: [{ ...stage("a"), label: "x\u0000y" }], edges: [] }, expectedUpdatedAt: null })).toEqual({ ok: false, error: "invalid" });
  });

  test("the checklist ticks once a saved process has an interview, and unticks without one", async () => {
    const before = await readChecklist(...ada());
    expect(before.items.find((i) => i.key === "process")).toMatchObject({ done: false, detail: "Not drawn yet" });
    const seen = await saved();
    const after = await readChecklist(...ada());
    expect(after.items.find((i) => i.key === "process")).toMatchObject({ done: true, detail: "5 steps, 4 interviews" });
    const noInterviews = { ...GRAPH, nodes: GRAPH.nodes.map((n) => (n.kind === "stage" ? { ...n, type: "review" as const } : n)) };
    await saveProcess(...ada(), { graph: noInterviews, expectedUpdatedAt: seen });
    expect((await readChecklist(...ada())).items.find((i) => i.key === "process")).toMatchObject({ done: false, detail: "5 steps, 0 interviews" });
  });
});

describe("the preview", () => {
  test("says what each job would become and writes nothing", async () => {
    const jobs = okJobs(await previewApply(...ada(), await saved()));
    expect(jobs.get(ENGINEER)).toMatchObject({ state: "change", team: "Engineering", current: [], next: ["Technical", "Final"] });
    expect(jobs.get(SELLER)).toMatchObject({ state: "same", next: ["Pitch", "Final"] });
    expect(jobs.get(LOOSE)).toMatchObject({ state: "change", team: null, next: ["Chat", "Final"] });
    expect(await steps(ENGINEER)).toEqual([]);
    expect(await audit("role.interview_plan")).toEqual([]);
    expect(must(await db().from("audit_log").select("id").eq("org_id", ACME).eq("action", "role.interview_plan")).data).toEqual([]);
    expect(must(await db().from("audit_log").select("id").eq("org_id", ACME).eq("action", "interview_process.apply")).data).toEqual([]);
  });

  test("a nested department takes its parent's branch", async () => {
    expect(okJobs(await previewApply(...ada(), await saved())).get(KERNEL)).toMatchObject({ next: ["Technical", "Final"] });
  });

  test("warns about a rename, with the interviews that keep the old name, before anything is written", async () => {
    const job = okJobs(await previewApply(...ada(), await saved())).get(KERNEL)!;
    expect(job.change?.renamed).toEqual([{ from: "Tech screen", to: "Technical" }]);
    expect(job.keptOnInterviews).toEqual([{ step: "Tech screen", interviews: 1, scheduled: 1 }]);
  });

  test("leaves out finished jobs and a confidential job the admin holds nothing on", async () => {
    const jobs = okJobs(await previewApply(...ada(), await saved()));
    expect(jobs.has(CLOSED)).toBe(false);
    expect(jobs.has(HIDDEN)).toBe(false);
  });

  test("a confidential job the admin is on is theirs to change", async () => {
    expect(okJobs(await previewApply(...ada(), await saved())).get(SECRET)).toMatchObject({ title: "Secret job", state: "change", reason: null });
  });

  test("a job with no way through or no interviews is skipped", async () => {
    const noDefault = { nodes: GRAPH.nodes, edges: GRAPH.edges.filter((e) => e.to !== "chat" && e.from !== "chat") };
    const seen = await saveProcess(...ada(), { graph: noDefault, expectedUpdatedAt: null });
    const jobs = okJobs(await previewApply(...ada(), seen.ok ? seen.updatedAt : ""));
    expect(jobs.get(LOOSE)).toMatchObject({ state: "skipped", reason: "no_path" });

    const onlyReviews = { nodes: [GRAPH.nodes[0], GRAPH.nodes[1], GRAPH.nodes[7]], edges: [edge("in", "screen"), edge("screen", "out")] };
    const again = await saveProcess(...ada(), { graph: onlyReviews, expectedUpdatedAt: seen.ok ? seen.updatedAt : "" });
    expect(okJobs(await previewApply(...ada(), again.ok ? again.updatedAt : "")).get(KERNEL)).toMatchObject({ state: "skipped", reason: "no_interviews" });
  });

  test("refuses a graph with problems, a stale page, and anyone but an admin", async () => {
    const seen = await saved();
    expect(await previewApply(...ada(), "2001-01-01T00:00:00Z")).toEqual({ ok: false, error: "stale" });
    expect(await previewApply(...lee(), seen)).toEqual({ ok: false, error: "forbidden" });
    const broken = await saveProcess(...ada(), { graph: { nodes: GRAPH.nodes, edges: GRAPH.edges.filter((e) => e.from !== "final") }, expectedUpdatedAt: seen });
    expect(await previewApply(...ada(), broken.ok ? broken.updatedAt : "")).toEqual({ ok: false, error: "invalid" });
  });
});

describe("applying", () => {
  test("changes only the jobs asked for, on steps worked out from what is saved", async () => {
    const seen = await saved();
    const answer = await applyProcess(...ada(), { expectedUpdatedAt: seen, jobIds: [ENGINEER, KERNEL] });
    expect(answer).toMatchObject({ ok: true, mode: "applied", updated: 2 });
    expect(await steps(ENGINEER)).toEqual(["Technical", "Final"]);
    expect(await steps(KERNEL)).toEqual(["Technical", "Final"]);
    expect(await steps(LOOSE)).toEqual([]);
    expect(await steps(CLOSED)).toEqual(["Kept"]);
  });

  test("never rewrites an interview: a renamed step's keeps its old name", async () => {
    const seen = await saved();
    const jobs = okJobs(await applyProcess(...ada(), { expectedUpdatedAt: seen, jobIds: [KERNEL] }));
    expect(jobs.get(KERNEL)?.keptOnInterviews).toEqual([{ step: "Tech screen", interviews: 1, scheduled: 1 }]);
    expect(must(await db().from("interviews").select("step").eq("org_id", ACME)).data).toEqual([{ step: "Tech screen" }]);
  });

  test("a confidential job the admin is not on is refused by core, listed as skipped, and untouched, and the others still go", async () => {
    const seen = await saved();
    const result = await clientTools.applyProcessToJobs(...ada(), { expectedUpdatedAt: seen, plans: [{ jobId: HIDDEN, steps: ["Technical"] }, { jobId: ENGINEER, steps: ["Technical"] }] });
    expect(result).toMatchObject({ outcome: "applied", updated: 1, unchanged: 0, skipped: 1 });
    expect(result.outcome === "applied" && result.jobs[0]).toEqual({ jobId: HIDDEN, outcome: "skipped", reason: "not_found" });
    expect(await steps(HIDDEN)).toEqual(["Kept"]);
    expect(await steps(ENGINEER)).toEqual(["Technical"]);
  });

  test("a job the policies refuse outright is skipped as refused", async () => {
    const seen = await saved();
    // Stepped down after her page loaded: she is on the job as a viewer, and the tool asks can_on_role on her token.
    must(await db().from("actors").update({ access_level: "elevated" }).eq("id", ADA));
    const result = await clientTools.applyProcessToJobs(...ada(), { expectedUpdatedAt: seen, plans: [{ jobId: SECRET, steps: ["Technical"] }] });
    expect(result).toMatchObject({ outcome: "applied", updated: 0, skipped: 1 });
    expect(result.outcome === "applied" && result.jobs[0]).toEqual({ jobId: SECRET, outcome: "skipped", reason: "refused" });
    expect(await steps(SECRET)).toEqual(["Kept"]);
  });

  test("a confidential job the admin cannot see is skipped by id and untouched, whatever the page sends", async () => {
    const seen = await saved();
    const answer = await applyProcess(...ada(), { expectedUpdatedAt: seen, jobIds: [HIDDEN] });
    expect(okJobs(answer).get(HIDDEN)).toMatchObject({ state: "skipped", reason: "not_found", title: "A job you can't see now" });
    expect(await steps(HIDDEN)).toEqual(["Kept"]);
  });

  test("a job that turns confidential under the dialog is skipped: core refuses it too", async () => {
    const seen = await saved();
    must(await db().from("roles").update({ confidential: true }).eq("id", ENGINEER));
    const result = await clientTools.applyProcessToJobs(...ada(), { expectedUpdatedAt: seen, plans: [{ jobId: ENGINEER, steps: ["Technical"] }, { jobId: LOOSE, steps: ["Chat"] }] });
    expect(result).toMatchObject({ outcome: "applied", updated: 1, skipped: 1 });
    expect(result.outcome === "applied" && result.jobs.map((j) => (j.outcome === "skipped" ? j.reason : j.outcome))).toEqual(["not_found", "updated"]);
    expect(await steps(ENGINEER)).toEqual([]);
  });

  test("a closed job is not applied to, even if the page names it", async () => {
    const seen = await saved();
    await applyProcess(...ada(), { expectedUpdatedAt: seen, jobIds: [CLOSED] });
    expect(await steps(CLOSED)).toEqual(["Kept"]);
  });

  test("audits counts, never the graph, and each job's plan as ever", async () => {
    const seen = await saved();
    await clientTools.applyProcessToJobs(...ada(), { expectedUpdatedAt: seen, plans: [{ jobId: ENGINEER, steps: ["Technical", "Final"] }, { jobId: HIDDEN, steps: ["Technical"] }] });
    const [row] = await audit("interview_process.apply");
    expect(row).toMatchObject({ entity: "interview_process", entity_id: ACME, source: "dashboard", actor_id: ADA, before: null, after: { jobs: 2, updated: 1, unchanged: 0, skipped: 1 } });
    expect(JSON.stringify(row)).not.toContain("Technical");
    expect(await audit("role.interview_plan")).toMatchObject([{ entity_id: ENGINEER, after: { interview_steps: ["Technical", "Final"] } }]);
  });

  test("applying again changes nothing and leaves no audit row", async () => {
    const seen = await saved();
    await applyProcess(...ada(), { expectedUpdatedAt: seen, jobIds: [ENGINEER] });
    expect(okJobs(await previewApply(...ada(), seen)).get(ENGINEER)).toMatchObject({ state: "same" });
    expect(await applyProcess(...ada(), { expectedUpdatedAt: seen, jobIds: [ENGINEER] })).toMatchObject({ ok: true, updated: 0 });
    expect(await audit("interview_process.apply")).toHaveLength(1);
  });

  test("a stale page writes nothing", async () => {
    const seen = await saved();
    await saveProcess(...ada(), { graph: { ...GRAPH, nodes: GRAPH.nodes.map((n) => (n.id === "final" ? { ...n, label: "Theirs" } : n)) }, expectedUpdatedAt: seen });
    expect(await applyProcess(...ada(), { expectedUpdatedAt: seen, jobIds: [ENGINEER] })).toEqual({ ok: false, error: "stale" });
    expect(await steps(ENGINEER)).toEqual([]);
  });

  test("a graph with problems writes nothing", async () => {
    const answer = await saveProcess(...ada(), { graph: { nodes: GRAPH.nodes, edges: GRAPH.edges.filter((e) => e.from !== "final") }, expectedUpdatedAt: null });
    expect(await applyProcess(...ada(), { expectedUpdatedAt: answer.ok ? answer.updatedAt : "", jobIds: [ENGINEER] })).toEqual({ ok: false, error: "invalid" });
    expect(await steps(ENGINEER)).toEqual([]);
  });

  test("only an admin applies, by the page's way or by core's", async () => {
    const seen = await saved();
    expect(await applyProcess(...lee(), { expectedUpdatedAt: seen, jobIds: [ENGINEER] })).toEqual({ ok: false, error: "forbidden" });
    await expect(clientTools.applyProcessToJobs(...lee(), { expectedUpdatedAt: seen, plans: [{ jobId: ENGINEER, steps: ["X"] }] })).rejects.toMatchObject({ code: "forbidden" });
    await expect(clientTools.applyProcessToJobs(...rex(), { expectedUpdatedAt: seen, plans: [{ jobId: ENGINEER, steps: ["X"] }] })).rejects.toMatchObject({ code: "forbidden" });
    expect(await steps(ENGINEER)).toEqual([]);
  });

  test("another company's admin reaches nothing here", async () => {
    const seen = await saved();
    expect(await clientTools.applyProcessToJobs(...gus(), { expectedUpdatedAt: seen, plans: [{ jobId: ENGINEER, steps: ["X"] }] })).toEqual({ outcome: "stale" });
    expect(await steps(ENGINEER)).toEqual([]);
  });

  test("past the hourly limit the rest are skipped rather than tried", async () => {
    const seen = await saved();
    // The save is one, Apply's own claim two, the first job three.
    must(await db().from("audit_log").insert(Array.from({ length: 297 }, () => ({ org_id: ACME, actor_id: ADA, action: "fixture.write", entity: "fixture", source: "dashboard" as const, after: {} }))));
    const result = await clientTools.applyProcessToJobs(...ada(), { expectedUpdatedAt: seen, plans: [ENGINEER, KERNEL, LOOSE].map((jobId) => ({ jobId, steps: ["A"] })) });
    expect(result).toMatchObject({ outcome: "applied", updated: 1, skipped: 2 });
    expect(result.outcome === "applied" && result.jobs.map((j) => (j.outcome === "skipped" ? j.reason : j.outcome))).toEqual(["updated", "rate_limited", "rate_limited"]);
    expect(await steps(KERNEL)).toEqual(["Tech screen", "Final"]);
  });

  test("at the limit already, Apply says so and writes nothing", async () => {
    const seen = await saved();
    must(await db().from("audit_log").insert(Array.from({ length: 299 }, () => ({ org_id: ACME, actor_id: ADA, action: "fixture.write", entity: "fixture", source: "dashboard" as const, after: {} }))));
    expect(await applyProcess(...ada(), { expectedUpdatedAt: seen, jobIds: [ENGINEER] })).toEqual({ ok: false, error: "rate_limited" });
    expect(await steps(ENGINEER)).toEqual([]);
  });
});
