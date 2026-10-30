import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";
import type { clientTools } from "@tacit-ats/core";

import { groupPostings } from "./posting-groups";
import { readPosting, readPostings } from "./postings";

/**
 * Job Postings against the local stack, on members' own tokens: the policies
 * decide which jobs, departments and posts come back and how many applied,
 * and the page's grouping runs on what they return. The member token is
 * signed with the stack's JWT secret, as in pipeline.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "f5000000-0000-4000-8000-0000000000f1";
const GLOBEX = "f5100000-0000-4000-8000-0000000000f2";
const ADMIN = "f5a00000-0000-4000-8000-0000000000f1";
const LEAD = "f5a00000-0000-4000-8000-0000000000f2";
const INTERVIEWER = "f5a00000-0000-4000-8000-0000000000f3";
const ENG = "f5e00000-0000-4000-8000-0000000000f1";
const PLATFORM = "f5e00000-0000-4000-8000-0000000000f2";
const SALES = "f5e00000-0000-4000-8000-0000000000f3";
const ENGINEER = "f5b00000-0000-4000-8000-0000000000f1";
const SRE = "f5b00000-0000-4000-8000-0000000000f2";
const OPS = "f5b00000-0000-4000-8000-0000000000f3";
const GLOBEX_ROLE = "f5b10000-0000-4000-8000-0000000000f1";
const ENGINEER_POST = "f5f00000-0000-4000-8000-0000000000f1";
const ENGINEER_OLD_POST = "f5f00000-0000-4000-8000-0000000000f2";
const SRE_POST = "f5f00000-0000-4000-8000-0000000000f3";
const GLOBEX_POST = "f5f10000-0000-4000-8000-0000000000f1";
const app = (n: number) => `f5d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const person = (n: number) => `f5c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

const ACME_WORKOS = "org_itest_postings_acme";
const GLOBEX_WORKOS = "org_itest_postings_globex";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of [
    "application_answers", "application_events", "interviews", "applications", "job_posts", "hiring_team", "people", "roles", "departments", "companies",
  ] as const) {
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
  actorId, orgId, accessLevel, source: "claude",
});

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-postings-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-postings-globex", kind: "client", workos_org_id: GLOBEX_WORKOS },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-po-admin", display_name: "Ada Admin", email: "ada@po.test", access_level: "admin", auth_subject: "user_po_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-po-lead", display_name: "Lee Lead", email: "lee@po.test", access_level: "elevated", auth_subject: "user_po_lee" },
    { id: INTERVIEWER, org_id: ACME, slug: "itest-po-ivan", display_name: "Ivan Interviewer", email: "ivan@po.test", access_level: "limited", auth_subject: "user_po_ivan" },
  ]));
  // Engineering > Platform; Sales has no job.
  must(await db().from("departments").insert([
    { id: ENG, org_id: ACME, name: "Engineering" },
    { id: SALES, org_id: ACME, name: "Sales" },
  ]));
  must(await db().from("departments").insert({ id: PLATFORM, org_id: ACME, name: "Platform", parent_id: ENG }));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer", "open", ENG], [SRE, "SRE", "paused", PLATFORM], [OPS, "Ops Lead", "open", null]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role", "open", null]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title, status, department_id]) => ({ id, org_id: org, company_id: company!.id, title, status, department_id }))));
  }
  // Lee manages the engineer search only; Ivan is on its team and interviews applicant 1 (below).
  must(await db().from("hiring_team").insert([
    { org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" },
    { org_id: ACME, role_id: ENGINEER, actor_id: INTERVIEWER, team_role: "interviewer" },
  ]));

  // Posts start as drafts; the trigger moves them on. One insert takes every column on every row.
  const form = [
    { id: "name", type: "name", label: "Full name", required: true },
    { id: "email", type: "email", label: "Email", required: true },
  ];
  must(await db().from("job_posts").insert([
    {
      id: ENGINEER_POST, org_id: ACME, role_id: ENGINEER, title: "Founding Engineer", description: "Build the thing.\nAnd run it.",
      questions: [
        ...form,
        { id: "q_sponsor01", type: "yes_no", label: "Will you need visa sponsorship?", required: true },
      ],
    },
    { id: ENGINEER_OLD_POST, org_id: ACME, role_id: ENGINEER, title: "Engineer (old)", description: null, questions: form },
    { id: SRE_POST, org_id: ACME, role_id: SRE, title: "SRE", description: null, questions: form },
    { id: GLOBEX_POST, org_id: GLOBEX, role_id: GLOBEX_ROLE, title: "Globex Role", description: null, questions: form },
  ]));
  must(await db().from("job_posts").update({ status: "live" }).in("id", [ENGINEER_POST, ENGINEER_OLD_POST, SRE_POST, GLOBEX_POST]));
  must(await db().from("job_posts").update({ status: "closed" }).eq("id", ENGINEER_OLD_POST));

  // Two applied to the engineer post, one to the old one.
  const apps = [[1, ENGINEER_POST], [2, ENGINEER_POST], [3, ENGINEER_OLD_POST]] as const;
  must(await db().from("people").insert(apps.map(([n]) => ({ id: person(n), org_id: ACME, display_name: `Applicant ${n}`, email: `a${n}@po.test` }))));
  must(await db().from("applications").insert(
    apps.map(([n]) => ({ id: app(n), org_id: ACME, person_id: person(n), role_id: ENGINEER, stage: "sourced", source: "job_board" })),
  ));
  must(await db().from("application_answers").insert(
    apps.map(([n, post]) => ({ org_id: ACME, application_id: app(n), job_post_id: post, answers: [] })),
  ));
  // An interviewer sees a job through an interview they sit on.
  must(await db().from("interviews").insert({
    org_id: ACME, application_id: app(1), starts_at: new Date(Date.now() + 86_400_000).toISOString(),
    ends_at: new Date(Date.now() + 90_000_000).toISOString(), status: "scheduled", step: "Screen", interviewer_actor_ids: [INTERVIEWER],
  }));
});

afterAll(clear);

describe("Job Postings", () => {
  test("an admin sees every job by department, Other last, with each post's state and who applied", async () => {
    const read = await readPostings(member("user_po_ada"), ctx(ADMIN, "admin"));
    expect(read.jobs.map((j) => j.id).sort()).toEqual([ENGINEER, SRE, OPS].sort());
    const groups = groupPostings(read, { grouped: true });
    expect(groups.map((g) => [g.name, g.postings.map((p) => p.job.id)])).toEqual([
      ["Engineering", [ENGINEER]],
      ["Engineering > Platform", [SRE]],
      ["Other", [OPS]],
    ]);
    const engineer = groups[0]!.postings[0]!;
    expect(engineer).toMatchObject({ posts: 2, applied: 3 });
    expect(engineer.post).toMatchObject({ postId: ENGINEER_POST, status: "live", accepting: true, applications: 2 });
    expect(engineer.job.inPipeline).toBe(3);
    // live, but its job is paused: not taking applications
    expect(groups[1]!.postings[0]!.post).toMatchObject({ postId: SRE_POST, status: "live", accepting: false });
    expect(groups[2]!.postings[0]).toMatchObject({ post: null, posts: 0, applied: 0 });

    const detail = await readPosting(member("user_po_ada"), ctx(ADMIN, "admin"), ENGINEER);
    expect(detail!.job).toMatchObject({ title: "Founding Engineer", department: "Engineering" });
    expect(detail!.posts.map((p) => p.postId).sort()).toEqual([ENGINEER_POST, ENGINEER_OLD_POST].sort());
    const live = detail!.posts.find((p) => p.postId === ENGINEER_POST)!;
    expect(live.description).toBe("Build the thing.\nAnd run it.");
    expect(live.questions.map((q) => [q.label, q.type, q.required])).toEqual([
      ["Full name", "name", true],
      ["Email", "email", true],
      ["Will you need visa sponsorship?", "yes_no", true],
    ]);
    expect((await readPosting(member("user_po_ada"), ctx(ADMIN, "admin"), SRE))!.job.department).toBe("Engineering > Platform");
  });

  test("a hiring manager sees only the job they are on", async () => {
    const read = await readPostings(member("user_po_lee"), ctx(LEAD, "elevated"));
    expect(read.jobs.map((j) => j.id)).toEqual([ENGINEER]);
    expect(read.posts.map((p) => p.jobId).every((j) => j === ENGINEER)).toBe(true);
    const groups = groupPostings(read, { grouped: true });
    expect(groups.map((g) => g.name)).toEqual(["Engineering"]);
    expect(groups[0]!.postings[0]).toMatchObject({ applied: 3, posts: 2 });
    expect(await readPosting(member("user_po_lee"), ctx(LEAD, "elevated"), SRE)).toBeNull();
  });

  test("an interviewer sees the jobs they interview for, ungrouped, with no counts", async () => {
    const read = await readPostings(member("user_po_ivan"), ctx(INTERVIEWER, "limited"));
    expect(read.departments).toEqual([]);
    expect(read.jobs).toEqual([
      { id: ENGINEER, title: "Founding Engineer", status: "open", location: null, departmentId: null, inPipeline: null },
    ]);
    const groups = groupPostings(read, { grouped: false });
    expect(groups.map((g) => [g.name, g.postings.map((p) => p.job.id)])).toEqual([[null, [ENGINEER]]]);
    expect(groups[0]!.postings[0]!.applied).toBeNull();
    expect(read.posts.every((p) => p.applications === null)).toBe(true);
    const detail = await readPosting(member("user_po_ivan"), ctx(INTERVIEWER, "limited"), ENGINEER);
    expect(detail!.job.department).toBeNull();
    expect(await readPosting(member("user_po_ivan"), ctx(INTERVIEWER, "limited"), OPS)).toBeNull();
  });

  test("another company never appears", async () => {
    const read = await readPostings(member("user_po_ada"), ctx(ADMIN, "admin"));
    expect(read.jobs.map((j) => j.id)).not.toContain(GLOBEX_ROLE);
    expect(read.posts.map((p) => p.postId)).not.toContain(GLOBEX_POST);
    expect(await readPosting(member("user_po_ada"), ctx(ADMIN, "admin"), GLOBEX_ROLE)).toBeNull();
    expect(await readPosting(member("user_po_ada"), ctx(ADMIN, "admin"), "not-a-uuid")).toBeNull();
  });
});
