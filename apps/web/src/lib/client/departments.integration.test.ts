import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { readCandidates } from "./crm";
import { inJobs } from "./crm-views";
import { departmentScope } from "./department-tree";
import { readDepartments } from "./departments";
import { readHome } from "./home";
import { readPipeline } from "./pipeline";

/**
 * The department filter against the local stack, on members' own tokens, as
 * pipeline.integration.test.ts: nested departments, what an admin and a
 * hiring manager on one job can filter by, Home, the Pipeline and the CRM
 * narrowed to a department and the ones inside it, and another company's
 * departments never appearing.
 */

const db = () => getSupabaseServiceClient();

const ACME = "de900000-0000-4000-8000-0000000000f1";
const GLOBEX = "de900000-0000-4000-8000-0000000000f2";
const ADMIN = "de9a0000-0000-4000-8000-0000000000f1";
const LEAD = "de9a0000-0000-4000-8000-0000000000f2";
const IV = "de9a0000-0000-4000-8000-0000000000f3";
const GLOBEX_ADMIN = "de9a0000-0000-4000-8000-0000000000f4";
// Engineering > Platform > Infra; Product; Archived (archived) > Growth.
const ENG = "de9e0000-0000-4000-8000-0000000000f1";
const PLATFORM = "de9e0000-0000-4000-8000-0000000000f2";
const INFRA = "de9e0000-0000-4000-8000-0000000000f3";
const PRODUCT = "de9e0000-0000-4000-8000-0000000000f4";
const ARCHIVED = "de9e0000-0000-4000-8000-0000000000f5";
const GROWTH = "de9e0000-0000-4000-8000-0000000000f6";
const GLOBEX_DEPT = "de9e0000-0000-4000-8000-0000000000f7";
// Jobs: an SRE in Infra, a researcher in Engineering itself, a designer in
// Product, a closed platform job, a growth job; Globex's in its own.
const SRE = "de9b0000-0000-4000-8000-0000000000f1";
const RESEARCHER = "de9b0000-0000-4000-8000-0000000000f2";
const DESIGNER = "de9b0000-0000-4000-8000-0000000000f3";
const CLOSED = "de9b0000-0000-4000-8000-0000000000f4";
const GROWER = "de9b0000-0000-4000-8000-0000000000f5";
const GLOBEX_ROLE = "de9b0000-0000-4000-8000-0000000000f6";
const app = (n: number) => `de9d0000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const person = (n: number) => `de9c0000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const GLOBEX_APP = "de9d0000-0000-4000-8000-0000000000f1";
const GLOBEX_PERSON = "de9c0000-0000-4000-8000-0000000000f1";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of ["application_events", "interviews", "applications", "hiring_team", "people", "roles", "departments", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const member = (subject: string, workosOrgId = "org_itest_dept_acme") => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};
const as = (actorId: string, accessLevel: "admin" | "elevated") => ({ actorId, orgId: ACME, accessLevel });

const NOW = Date.now();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-dept-acme", kind: "client", workos_org_id: "org_itest_dept_acme" },
    { id: GLOBEX, name: "Globex", slug: "itest-dept-globex", kind: "client", workos_org_id: "org_itest_dept_globex" },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-dp-admin", display_name: "Ada Admin", email: "ada@dp.test", access_level: "admin", auth_subject: "user_dp_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-dp-lead", display_name: "Lee Lead", email: "lee@dp.test", access_level: "elevated", auth_subject: "user_dp_lee" },
    { id: IV, org_id: ACME, slug: "itest-dp-iv", display_name: "Ivy Interviewer", email: "ivy@dp.test", access_level: "limited", auth_subject: "user_dp_ivy" },
    { id: GLOBEX_ADMIN, org_id: GLOBEX, slug: "itest-dp-gx", display_name: "Gus Globex", email: "gus@dp.test", access_level: "admin", auth_subject: "user_dp_gus" },
  ]));
  must(await db().from("departments").insert([
    { id: ENG, org_id: ACME, name: "Engineering" },
    { id: PRODUCT, org_id: ACME, name: "Product" },
    { id: ARCHIVED, org_id: ACME, name: "Archived", archived_at: daysAgo(1) },
    { id: GLOBEX_DEPT, org_id: GLOBEX, name: "Globex Engineering" },
  ]));
  must(await db().from("departments").insert([
    { id: PLATFORM, org_id: ACME, name: "Platform", parent_id: ENG },
    { id: GROWTH, org_id: ACME, name: "Growth", parent_id: ARCHIVED },
  ]));
  must(await db().from("departments").insert({ id: INFRA, org_id: ACME, name: "Infra", parent_id: PLATFORM }));

  for (const [org, name, roles] of [
    [ACME, "Acme", [[SRE, "SRE", "open", INFRA], [RESEARCHER, "Researcher", "open", ENG], [DESIGNER, "Designer", "open", PRODUCT], [CLOSED, "Platform Lead", "closed", PLATFORM], [GROWER, "Growth Marketer", "open", GROWTH]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role", "open", GLOBEX_DEPT]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title, status, department_id]) => ({ id, org_id: org, company_id: company!.id, title, status, department_id }))));
  }
  // Lee manages the SRE search only.
  must(await db().from("hiring_team").insert({ org_id: ACME, role_id: SRE, actor_id: LEAD, team_role: "hiring_manager" }));

  const apps = [
    // n, job, stage, added days ago
    [1, SRE, "sourced", 2],
    [2, SRE, "screening", 3],
    [3, RESEARCHER, "interviewing", 1],
    [4, DESIGNER, "screening", 2],
    [5, CLOSED, "rejected", 4],
    [6, GROWER, "sourced", 1],
  ] as const;
  must(await db().from("people").insert([
    ...apps.map(([n]) => ({ id: person(n), org_id: ACME, display_name: `Candidate ${n}`, email: `c${n}@dp.test` })),
    { id: GLOBEX_PERSON, org_id: GLOBEX, display_name: "Globex Candidate", email: "g@dp.test" },
  ]));
  must(await db().from("applications").insert([
    ...apps.map(([n, role, stage, d]) => ({ id: app(n), org_id: ACME, person_id: person(n), role_id: role, stage, created_at: daysAgo(d) })),
    { id: GLOBEX_APP, org_id: GLOBEX, person_id: GLOBEX_PERSON, role_id: GLOBEX_ROLE, stage: "screening", created_at: daysAgo(1) },
  ]));
  must(await db().from("application_events").insert([
    // 2 sat in sourced for a day; the closed job's 5 sat in screening for 3.
    { org_id: ACME, application_id: app(2), kind: "stage_changed", from_stage: "sourced", to_stage: "screening", created_at: daysAgo(2) },
    { org_id: ACME, application_id: app(5), kind: "stage_changed", from_stage: "screening", to_stage: "rejected", created_at: daysAgo(1) },
    // the designer's 4 sat in sourced for a day: Product's, never Engineering's.
    { org_id: ACME, application_id: app(4), kind: "stage_changed", from_stage: "sourced", to_stage: "screening", created_at: daysAgo(1) },
  ]));
});

afterAll(clear);

const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe("the department filter", () => {
  test("an admin: the org's live departments, nested, matching every department below; never another company's", async () => {
    const read = await readDepartments(member("user_dp_ada"));
    expect(read.departments.map((d) => d.id).sort()).toEqual([ENG, PLATFORM, INFRA, PRODUCT, ARCHIVED, GROWTH].sort());
    expect(read.jobs.map((j) => j.jobId).sort()).toEqual([SRE, RESEARCHER, DESIGNER, CLOSED, GROWER].sort());

    const eng = departmentScope(read, ENG);
    expect(eng.options.map((o) => o.path)).toEqual(["Archived › Growth", "Engineering", "Engineering › Platform", "Engineering › Platform › Infra", "Product"]);
    expect([...eng.jobIds!].sort()).toEqual([SRE, RESEARCHER, CLOSED].sort());
    expect([...departmentScope(read, PLATFORM).jobIds!].sort()).toEqual([SRE, CLOSED].sort());
    expect([...departmentScope(read, INFRA).jobIds!]).toEqual([SRE]);
    // An archived department is not offered; another company's is no filter at all.
    expect(departmentScope(read, ARCHIVED).departmentId).toBeNull();
    expect(departmentScope(read, GLOBEX_DEPT)).toMatchObject({ departmentId: null, jobIds: null });
  });

  test("Home narrows every card it can to the department and the ones inside it", async () => {
    const read = await readHome(member("user_dp_ada"), as(ADMIN, "admin"), { days: 7, jobId: null, departmentId: ENG }, new Date(NOW));
    expect(read.departmentId).toBe(ENG);
    expect(read.departments.map((d) => d.id)).toContain(INFRA);
    // the job tabs: the department's open jobs
    expect(ids(read.jobs)).toEqual([SRE, RESEARCHER].sort());
    expect(read.waiting.map((w) => w.applicationId).sort()).toEqual([app(1), app(2), app(3)].sort());
    // the closed platform job's application counts too, the designer's does not
    expect(read.applications.current).toBe(4);
    // stays merged over the department's jobs: 2's day in sourced, 5's three in screening
    expect(read.stays.find((s) => s.stage === "sourced")).toEqual({ stage: "sourced", avgDays: 1, stays: 1 });
    expect(read.stays.find((s) => s.stage === "screening")).toEqual({ stage: "screening", avgDays: 3, stays: 1 });

    // a job outside the department is dropped; one inside it narrows further
    const outside = await readHome(member("user_dp_ada"), as(ADMIN, "admin"), { days: 7, jobId: DESIGNER, departmentId: PLATFORM }, new Date(NOW));
    expect(outside.jobId).toBeNull();
    expect(ids(outside.jobs)).toEqual([SRE]);
    expect(outside.applications.current).toBe(3);
    const inside = await readHome(member("user_dp_ada"), as(ADMIN, "admin"), { days: 7, jobId: RESEARCHER, departmentId: ENG }, new Date(NOW));
    expect(inside.jobId).toBe(RESEARCHER);
    expect(inside.waiting.map((w) => w.applicationId)).toEqual([app(3)]);

    // no department: every job, as before
    const all = await readHome(member("user_dp_ada"), as(ADMIN, "admin"), { days: 7, jobId: null }, new Date(NOW));
    expect(all.departmentId).toBeNull();
    expect(all.applications.current).toBe(6);
  });

  test("a hiring manager on one job sees the departments, but only their job is ever counted", async () => {
    const lee = member("user_dp_lee");
    const read = await readDepartments(lee);
    expect(read.departments).toHaveLength(6);
    expect(read.jobs.map((j) => j.jobId)).toEqual([SRE]);
    expect([...departmentScope(read, ENG).jobIds!]).toEqual([SRE]);
    expect([...departmentScope(read, PRODUCT).jobIds!]).toEqual([]);

    const eng = await readHome(lee, as(LEAD, "elevated"), { days: 7, jobId: null, departmentId: ENG }, new Date(NOW));
    expect(ids(eng.jobs)).toEqual([SRE]);
    expect(eng.applications.current).toBe(2);
    const product = await readHome(lee, as(LEAD, "elevated"), { days: 7, jobId: null, departmentId: PRODUCT }, new Date(NOW));
    expect(product.jobs).toEqual([]);
    expect(product.waiting).toEqual([]);
    expect(product.applications.current).toBe(0);
    expect(product.stays.every((s) => s.stays === 0)).toBe(true);
  });

  test("the Pipeline and the CRM narrow to the department's jobs", async () => {
    const ada = member("user_dp_ada");
    const [pipeline, structure, crm] = await Promise.all([readPipeline(ada, new Date(NOW)), readDepartments(ada), readCandidates(ada)]);
    const platform = departmentScope(structure, PLATFORM);
    expect(pipeline.jobs.filter((j) => platform.jobIds!.has(j.id)).map((j) => j.id)).toEqual([SRE]);
    expect(pipeline.entries.filter((e) => platform.jobIds!.has(e.roleId)).map((e) => e.applicationId).sort()).toEqual([app(1), app(2)].sort());
    // the CRM keeps the closed job's candidate too
    expect(inJobs(crm.candidates, platform.jobIds!).map((c) => c.candidateId).sort()).toEqual([person(1), person(2), person(5)].sort());
    for (const c of crm.candidates) expect(c.candidateId).not.toBe(GLOBEX_PERSON);
  });

  test("an interviewer reads no departments, so gets no filter", async () => {
    const read = await readDepartments(member("user_dp_ivy"));
    expect(read).toEqual({ departments: [], jobs: [] });
    expect(departmentScope(read, ENG).options).toEqual([]);
  });

  test("another company's admin sees only their own departments and jobs", async () => {
    const read = await readDepartments(member("user_dp_gus", "org_itest_dept_globex"));
    expect(read.departments.map((d) => d.id)).toEqual([GLOBEX_DEPT]);
    expect(read.jobs.map((j) => j.jobId)).toEqual([GLOBEX_ROLE]);
    // Acme's department id means nothing there
    expect(departmentScope(read, ENG).departmentId).toBeNull();
  });
});
