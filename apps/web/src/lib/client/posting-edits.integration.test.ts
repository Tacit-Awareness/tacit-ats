import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";
import type { clientTools } from "@tacit-ats/core";

import { draftFromPost, draftPayload, newRoleDraft } from "./posting-draft";
import { parseDraft, type PostingDraft } from "./posting-edit-rules";
import { createRole, savePosting } from "./posting-edits";
import { readPosting, readPostingEditing } from "./postings";

/**
 * The posting editor against the local stack, on members' own tokens with the
 * page's audit source: what lands in `roles` and `job_posts`, what the audit
 * rows keep, and who the policies and clientTools let through. The member
 * token is signed with the stack's JWT secret, as in postings.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "f7000000-0000-4000-8000-0000000000f1";
const GLOBEX = "f7100000-0000-4000-8000-0000000000f2";
const ADMIN = "f7a00000-0000-4000-8000-0000000000f1";
const LEAD = "f7a00000-0000-4000-8000-0000000000f2";
const INTERVIEWER = "f7a00000-0000-4000-8000-0000000000f3";
const GLOBEX_ADMIN = "f7a10000-0000-4000-8000-0000000000f1";
const ENG = "f7e00000-0000-4000-8000-0000000000f1";
const OLD_DEPT = "f7e00000-0000-4000-8000-0000000000f2";
const ENGINEER = "f7b00000-0000-4000-8000-0000000000f1";
const SRE = "f7b00000-0000-4000-8000-0000000000f2";
const NO_POST = "f7b00000-0000-4000-8000-0000000000f3";
const GLOBEX_ROLE = "f7b10000-0000-4000-8000-0000000000f1";
const ENGINEER_POST = "f7f00000-0000-4000-8000-0000000000f1";
const SRE_POST = "f7f00000-0000-4000-8000-0000000000f2";
const GLOBEX_POST = "f7f10000-0000-4000-8000-0000000000f1";
const PERSON = "f7c00000-0000-4000-8000-0000000000f1";
const APPLICATION = "f7d00000-0000-4000-8000-0000000000f1";

const ACME_WORKOS = "org_itest_editor_acme";
const GLOBEX_WORKOS = "org_itest_editor_globex";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  await db().from("audit_log").delete().in("actor_id", [ADMIN, LEAD, INTERVIEWER, GLOBEX_ADMIN]);
  for (const table of ["openings", "job_offices", "interviews", "applications", "job_posts", "hiring_team", "people", "roles", "departments", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const member = (subject: string, workosOrgId = ACME_WORKOS) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};
const ctx = (actorId: string, accessLevel: clientTools.AccessLevel, orgId = ACME): clientTools.ClientToolCtx => ({
  actorId, orgId, accessLevel, source: "dashboard",
});
const admin = () => [member("user_ed_ada"), ctx(ADMIN, "admin")] as const;
const lead = () => [member("user_ed_lee"), ctx(LEAD, "elevated")] as const;
const interviewer = () => [member("user_ed_ivan"), ctx(INTERVIEWER, "limited")] as const;

const auditRows = async (actor: string) =>
  must(await db().from("audit_log").select("source, action, entity, entity_id, before, after").eq("actor_id", actor).order("created_at")).data!;

/** What the page sends for a post, through the same rules as the action. */
async function edited(jobId: string, change: (d: ReturnType<typeof draftFromPost>) => void = () => {}): Promise<PostingDraft> {
  const [client, context] = admin();
  const read = (await readPosting(client, context, jobId))!;
  const editing = (await readPostingEditing(client, context, read.job))!;
  const draft = draftFromPost({ job: read.job, departmentId: read.job.departmentId, steps: editing.steps, post: read.posts[0] ?? null });
  change(draft);
  const parsed = parseDraft(draftPayload(draft));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.draft;
}

const postRow = async (id: string) =>
  must(await db().from("job_posts").select("title, location, description, status, questions, updated_at").eq("id", id).single()).data!;

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-editor-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-editor-globex", kind: "client", workos_org_id: GLOBEX_WORKOS },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-ed-admin", display_name: "Ada Admin", email: "ada@ed.test", access_level: "admin", auth_subject: "user_ed_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-ed-lead", display_name: "Lee Lead", email: "lee@ed.test", access_level: "elevated", auth_subject: "user_ed_lee" },
    { id: INTERVIEWER, org_id: ACME, slug: "itest-ed-ivan", display_name: "Ivan Interviewer", email: "ivan@ed.test", access_level: "limited", auth_subject: "user_ed_ivan" },
    { id: GLOBEX_ADMIN, org_id: GLOBEX, slug: "itest-ed-gina", display_name: "Gina", email: "gina@ed.test", access_level: "admin", auth_subject: "user_ed_gina" },
  ]));
  must(await db().from("departments").insert([
    { id: ENG, org_id: ACME, name: "Engineering" },
    { id: OLD_DEPT, org_id: ACME, name: "Old", archived_at: new Date().toISOString() },
  ]));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer", "open"], [SRE, "SRE", "paused"], [NO_POST, "Ops Lead", "open"]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role", "open"]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title, status]) => ({ id, org_id: org, company_id: company!.id, title, status }))));
  }
  must(await db().from("roles").update({ interview_steps: ["Screen", "Onsite"] }).eq("id", ENGINEER));
  // Lee manages the engineer search only; Ivan only interviews on it.
  must(await db().from("hiring_team").insert([
    { org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" },
    { org_id: ACME, role_id: ENGINEER, actor_id: INTERVIEWER, team_role: "interviewer" },
  ]));
  const form = [
    { id: "name", type: "name", label: "Full name", required: true },
    { id: "email", type: "email", label: "Email", required: true },
  ];
  must(await db().from("job_posts").insert([
    {
      id: ENGINEER_POST, org_id: ACME, role_id: ENGINEER, title: "Founding Engineer", description: "Written by the connector.\n\nA second paragraph.",
      questions: [...form, { id: "q_sponsor01", type: "yes_no", label: "Visa?", required: true }],
    },
    { id: SRE_POST, org_id: ACME, role_id: SRE, title: "SRE", description: null, questions: form },
    { id: GLOBEX_POST, org_id: GLOBEX, role_id: GLOBEX_ROLE, title: "Globex Role", description: "Theirs", questions: form },
  ]));
  must(await db().from("people").insert({ id: PERSON, org_id: ACME, display_name: "Applicant", email: "a@ed.test" }));
  must(await db().from("applications").insert({ id: APPLICATION, org_id: ACME, person_id: PERSON, role_id: ENGINEER, stage: "interviewing", source: "job_board" }));
  must(await db().from("interviews").insert({
    org_id: ACME, application_id: APPLICATION, starts_at: new Date(Date.now() + 86_400_000).toISOString(),
    ends_at: new Date(Date.now() + 90_000_000).toISOString(), status: "scheduled", step: "Onsite", interviewer_actor_ids: [INTERVIEWER],
  }));
});

afterAll(clear);

describe("adding a role", () => {
  const draft = () => {
    const d = newRoleDraft(ENG);
    d.title = "Staff Engineer";
    d.location = "Paris";
    d.blocks = [
      { kind: "text", text: "Build the thing." },
      { kind: "list", heading: "What you'll do", lines: ["Ship", "Run"] },
    ];
    d.steps = ["Screen", "Onsite"];
    const parsed = parseDraft(draftPayload(d));
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.draft;
  };

  test("an admin's Post the job: a job, a live post and its plan, audited as the dashboard", async () => {
    const result = await createRole(...admin(), draft(), { publish: true });
    if (!result.ok) throw new Error(result.error);
    const role = must(await db().from("roles").select("org_id, title, status, location, department_id, interview_steps").eq("id", result.jobId).single()).data!;
    expect(role).toEqual({ org_id: ACME, title: "Staff Engineer", status: "open", location: "Paris", department_id: ENG, interview_steps: ["Screen", "Onsite"] });
    const post = await postRow(result.postId);
    expect(post).toMatchObject({ title: "Staff Engineer", status: "live", description: "Build the thing.\n\nWhat you'll do\n- Ship\n- Run" });
    expect((post.questions as Array<{ id: string; type: string; required: boolean }>).map((q) => q.type)).toEqual([
      "name", "email", "phone", "linkedin", "resume", "yes_no", "yes_no", "short_text",
    ]);

    const rows = await auditRows(ADMIN);
    expect(rows.map((r) => [r.source, r.action])).toEqual([
      ["dashboard", "role.create"], ["dashboard", "job_post.create"], ["dashboard", "role.interview_plan"], ["dashboard", "job_post.status"],
    ]);
    expect(JSON.stringify(rows)).not.toContain("Build the thing");
  });

  test("Save draft leaves nothing public", async () => {
    const result = await createRole(...admin(), draft(), { publish: false });
    if (!result.ok) throw new Error(result.error);
    expect((await postRow(result.postId)).status).toBe("draft");
  });

  test("only an admin makes a job, and nothing is left behind", async () => {
    const before = must(await db().from("roles").select("id").eq("org_id", ACME)).data!.length;
    expect(await createRole(...lead(), draft(), { publish: true })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await createRole(...interviewer(), draft(), { publish: true })).toMatchObject({ ok: false, error: "forbidden" });
    expect(must(await db().from("roles").select("id").eq("org_id", ACME)).data!.length).toBe(before);
  });

  test("an archived department is refused before the job exists", async () => {
    const before = must(await db().from("roles").select("id").eq("org_id", ACME)).data!.length;
    expect(await createRole(...admin(), { ...draft(), departmentId: OLD_DEPT }, { publish: true })).toMatchObject({ ok: false, error: "invalid_department" });
    expect(must(await db().from("roles").select("id").eq("org_id", ACME)).data!.length).toBe(before);
  });

  test("another company's department is not found", async () => {
    const result = await createRole(member("user_ed_gina", GLOBEX_WORKOS), ctx(GLOBEX_ADMIN, "admin", GLOBEX), { ...draft(), departmentId: ENG }, { publish: false });
    expect(result).toMatchObject({ ok: false, error: "not_found" });
  });
});

describe("the editor's reads", () => {
  test("a job's manager gets the steps and the departments, the archived one only if the job is in it", async () => {
    const [client, context] = admin();
    const read = (await readPosting(client, context, ENGINEER))!;
    expect(await readPostingEditing(client, context, read.job)).toEqual({ steps: ["Screen", "Onsite"], departments: [{ id: ENG, path: "Engineering" }] });
    const inOld = await readPostingEditing(client, context, { ...read.job, departmentId: OLD_DEPT });
    expect(inOld!.departments.map((d) => d.id).sort()).toEqual([ENG, OLD_DEPT].sort());
  });

  test("a hiring manager on one job edits that one only; an interviewer edits none", async () => {
    const [client, context] = lead();
    expect(await readPostingEditing(client, context, { id: ENGINEER, departmentId: null })).not.toBeNull();
    expect(await readPostingEditing(client, context, { id: SRE, departmentId: null })).toBeNull();
    const [ivan, ivanCtx] = interviewer();
    expect(await readPostingEditing(ivan, ivanCtx, { id: ENGINEER, departmentId: null })).toBeNull();
  });
});

describe("saving a post", () => {
  const save = (who: ReturnType<typeof admin>, draft: PostingDraft, patch: Partial<Parameters<typeof savePosting>[2]> = {}) =>
    savePosting(who[0], who[1], { jobId: ENGINEER, postId: ENGINEER_POST, draft, seenUpdatedAt: null, overwrite: false, status: null, ...patch });

  test("what the connector wrote survives the editor opening and saving it", async () => {
    const draft = await edited(ENGINEER);
    expect(draft.description).toBe("Written by the connector.\n\nA second paragraph.");
    await auditRows(ADMIN);
    expect(await save(admin(), draft)).toMatchObject({ ok: true, notice: "saved" });
    expect(await auditRows(ADMIN), "a save that changes nothing leaves no audit row").toEqual([]);
  });

  test("text, a question's edit under its own id, Required, a new question and the steps all land", async () => {
    const draft = await edited(ENGINEER, (d) => {
      d.title = "Founding Engineer, Infra";
      d.location = "Remote";
      d.departmentId = ENG;
      d.blocks = [{ kind: "text", text: "New words." }, { kind: "list", heading: "Fit", lines: ["You care"] }];
      d.steps = ["Screen", "Onsite", "Offer call"];
      d.questions = d.questions.map((q) => (q.type === "yes_no" ? { ...q, label: "Need a visa?", required: false } : q));
      d.questions.push({ key: "new-1", type: "select", label: "Team", required: true, options: ["Infra", "Product"] });
    });
    expect(await save(admin(), draft)).toMatchObject({ ok: true });
    const post = await postRow(ENGINEER_POST);
    expect(post).toMatchObject({ title: "Founding Engineer, Infra", location: "Remote", description: "New words.\n\nFit\n- You care" });
    const questions = post.questions as Array<{ id: string; type: string; label: string; required: boolean; options?: string[] }>;
    expect(questions[2]).toEqual({ id: "q_sponsor01", type: "yes_no", label: "Need a visa?", required: false });
    expect(questions[3]).toMatchObject({ type: "select", label: "Team", required: true, options: ["Infra", "Product"] });
    expect(questions[3].id).toMatch(/^q_[a-z0-9]+$/);
    const role = must(await db().from("roles").select("department_id, interview_steps").eq("id", ENGINEER).single()).data!;
    expect(role).toEqual({ department_id: ENG, interview_steps: ["Screen", "Onsite", "Offer call"] });

    const rows = await auditRows(ADMIN);
    expect(rows.map((r) => [r.source, r.action])).toEqual([
      ["dashboard", "job_post.update"], ["dashboard", "role.update"], ["dashboard", "role.interview_plan"],
    ]);
    expect(JSON.stringify(rows), "the description stays out of the audit row").not.toContain("New words");
  });

  test("a step taken away with an interview on it is counted; the interview keeps its name", async () => {
    const draft = await edited(ENGINEER, (d) => {
      d.steps = ["Screen"];
    });
    expect(await save(admin(), draft)).toMatchObject({ ok: true, keptOnInterviews: 1 });
    expect(must(await db().from("interviews").select("step").eq("application_id", APPLICATION)).data).toEqual([{ step: "Onsite" }]);
  });

  test("publishing, closing and reopening, each with the save before it", async () => {
    const draft = await edited(ENGINEER, (d) => {
      d.title = "Published title";
    });
    expect(await save(admin(), draft, { status: "live" })).toMatchObject({ ok: true, notice: "published" });
    expect(await postRow(ENGINEER_POST)).toMatchObject({ title: "Published title", status: "live" });
    expect(await save(admin(), draft, { status: "closed" })).toMatchObject({ ok: true, notice: "closed" });
    expect((await postRow(ENGINEER_POST)).status).toBe("closed");
    expect(await save(admin(), draft, { status: "live" })).toMatchObject({ ok: true, notice: "published" });
    expect((await postRow(ENGINEER_POST)).status).toBe("live");
  });

  test("a job not open cannot take a live post, but the edits are kept", async () => {
    const [client, context] = admin();
    const draft = await edited(SRE, (d) => {
      d.location = "Berlin";
    });
    const result = await savePosting(client, context, { jobId: SRE, postId: SRE_POST, draft, seenUpdatedAt: null, overwrite: false, status: "live" });
    expect(result).toMatchObject({ ok: false, error: "job_not_open" });
    expect(await postRow(SRE_POST)).toMatchObject({ location: "Berlin", status: "draft" });
  });

  test("two editors: the second is told, and saves over it only by choosing to", async () => {
    const seen = (await postRow(ENGINEER_POST)).updated_at;
    const mine = await edited(ENGINEER, (d) => {
      d.title = "Mine";
    });
    const theirs = await edited(ENGINEER, (d) => {
      d.title = "Theirs";
    });
    expect(await save(admin(), theirs, { seenUpdatedAt: seen })).toMatchObject({ ok: true });
    expect(await save(admin(), mine, { seenUpdatedAt: seen, status: "live" })).toMatchObject({ ok: false, error: "changed" });
    expect(await postRow(ENGINEER_POST)).toMatchObject({ title: "Theirs", status: "draft" });
    expect(await save(admin(), mine, { seenUpdatedAt: seen, overwrite: true })).toMatchObject({ ok: true });
    expect((await postRow(ENGINEER_POST)).title).toBe("Mine");
  });

  test("a job's first post, then a save on it", async () => {
    const [client, context] = admin();
    const draft = await edited(NO_POST, (d) => {
      d.blocks = [{ kind: "text", text: "First words." }];
    });
    expect(draft.title).toBe("Ops Lead");
    const made = await savePosting(client, context, { jobId: NO_POST, postId: null, draft, seenUpdatedAt: null, overwrite: false, status: null });
    if (!made.ok) throw new Error(made.error);
    expect(await postRow(made.postId)).toMatchObject({ status: "draft", description: "First words." });
  });

  test("a job's hiring manager may; an interviewer and someone on another job may not", async () => {
    const draft = await edited(ENGINEER, (d) => {
      d.title = "Lee's title";
    });
    expect(await save(lead(), draft)).toMatchObject({ ok: true });
    expect((await postRow(ENGINEER_POST)).title).toBe("Lee's title");

    const refused = { ...draft, title: "Not this" };
    expect(await save(interviewer(), refused)).toMatchObject({ ok: false, error: "forbidden" });
    const [client, context] = lead();
    expect(await savePosting(client, context, { jobId: SRE, postId: SRE_POST, draft: refused, seenUpdatedAt: null, overwrite: false, status: null })).toMatchObject({ ok: false, error: "not_found" });
    expect(await postRow(SRE_POST)).toMatchObject({ title: "SRE" });
  });

  test("another company's post is nobody's", async () => {
    const draft = await edited(ENGINEER);
    const [client, context] = admin();
    expect(await savePosting(client, context, { jobId: GLOBEX_ROLE, postId: GLOBEX_POST, draft, seenUpdatedAt: null, overwrite: false, status: "live" })).toMatchObject({ ok: false, error: "not_found" });
    // A real job's id with another company's post cannot reach it either.
    expect(await savePosting(client, context, { jobId: ENGINEER, postId: GLOBEX_POST, draft, seenUpdatedAt: null, overwrite: false, status: "live" })).toMatchObject({ ok: false, error: "not_found" });
    expect(await postRow(GLOBEX_POST)).toMatchObject({ title: "Globex Role", status: "draft", description: "Theirs" });
  });

  test("a read-only connector does not stop the page", async () => {
    must(await db().from("orgs").update({ connector_access: "read_only" }).eq("id", ACME));
    const draft = await edited(ENGINEER, (d) => {
      d.title = "Still works";
    });
    expect(await save(admin(), draft)).toMatchObject({ ok: true });
  });
});
