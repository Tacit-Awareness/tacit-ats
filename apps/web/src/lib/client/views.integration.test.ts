import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { readMarks } from "./marks";
import { readPersonTags, readViews } from "./views";

/**
 * Saved views' reads and the sidebar's marks against the local stack, on
 * members' own tokens: the policies decide which tags and applications come
 * back, and nothing that goes to the browser carries a name.
 */

const db = () => getSupabaseServiceClient();

const ACME = "d1000000-0000-4000-8000-0000000000f1";
const GLOBEX = "d2000000-0000-4000-8000-0000000000f2";
const ADMIN = "d1a00000-0000-4000-8000-0000000000f1";
const LEAD = "d1a00000-0000-4000-8000-0000000000f2";
const SITTER = "d1a00000-0000-4000-8000-0000000000f3";
const RECRUITER = "d1a00000-0000-4000-8000-0000000000f4";
const JOB = "d1b00000-0000-4000-8000-0000000000f1";
const OTHER_JOB = "d1b00000-0000-4000-8000-0000000000f2";
const DEPT = "d1e00000-0000-4000-8000-0000000000f1";
const TAG = "d1f00000-0000-4000-8000-0000000000f1";
const GLOBEX_JOB = "d2b00000-0000-4000-8000-0000000000f1";
const GLOBEX_TAG = "d2f00000-0000-4000-8000-0000000000f1";
const person = (n: number) => `d1c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const app = (n: number) => `d1d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const GLOBEX_PERSON = "d2c00000-0000-4000-8000-0000000000f1";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of ["person_tags", "tags", "application_events", "applications", "job_access", "hiring_team", "people", "roles", "departments", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const member = (subject: string, workosOrgId: string) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId }));
};
const adminDb = () => member("user_vw_ada", "org_itest_views_acme");
const leadDb = () => member("user_vw_lee", "org_itest_views_acme");
const recruiterDb = () => member("user_vw_rae", "org_itest_views_acme");
const asAdmin = { actorId: ADMIN, orgId: ACME, accessLevel: "admin" as const };
const asRecruiter = { actorId: RECRUITER, orgId: ACME, accessLevel: "elevated" as const };
const asLead = { actorId: LEAD, orgId: ACME, accessLevel: "elevated" as const };

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-views-acme", kind: "client", workos_org_id: "org_itest_views_acme" },
    { id: GLOBEX, name: "Globex", slug: "itest-views-globex", kind: "client", workos_org_id: "org_itest_views_globex" },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-vw-admin", display_name: "Ada Admin", email: "ada@vw.test", access_level: "admin", auth_subject: "user_vw_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-vw-lead", display_name: "Lee Lead", email: "lee@vw.test", access_level: "elevated", auth_subject: "user_vw_lee" },
    { id: SITTER, org_id: ACME, slug: "itest-vw-sitter", display_name: "Sam Sitter", email: "sam@vw.test", access_level: "limited", auth_subject: "user_vw_sam" },
    { id: RECRUITER, org_id: ACME, slug: "itest-vw-recruiter", display_name: "Rae Recruiter", email: "rae@vw.test", access_level: "elevated", auth_subject: "user_vw_rae" },
  ]));
  must(await db().from("departments").insert({ id: DEPT, org_id: ACME, name: "Infra" }));
  const { data: acme } = must(await db().from("companies").insert({ org_id: ACME, name: "Acme" }).select("id").single());
  const { data: globex } = must(await db().from("companies").insert({ org_id: GLOBEX, name: "Globex" }).select("id").single());
  must(await db().from("roles").insert([
    { id: JOB, org_id: ACME, company_id: acme!.id, title: "Founding Engineer", status: "open", department_id: DEPT },
    { id: OTHER_JOB, org_id: ACME, company_id: acme!.id, title: "Designer", status: "open" },
    { id: GLOBEX_JOB, org_id: GLOBEX, company_id: globex!.id, title: "Globex Role", status: "open" },
  ]));
  must(await db().from("hiring_team").insert({ org_id: ACME, role_id: JOB, actor_id: LEAD, team_role: "hiring_manager" }));
  must(await db().from("people").insert([
    { id: person(1), org_id: ACME, display_name: "Riley Referred" },
    { id: person(2), org_id: ACME, display_name: "Casey Careers" },
    { id: person(3), org_id: ACME, display_name: "Dana Designer" },
    { id: GLOBEX_PERSON, org_id: GLOBEX, display_name: "Gil Globex" },
  ]));
  must(await db().from("applications").insert([
    { id: app(1), org_id: ACME, person_id: person(1), role_id: JOB, stage: "screening", source: "referral", added_by_actor_id: RECRUITER },
    { id: app(2), org_id: ACME, person_id: person(2), role_id: JOB, stage: "sourced", source: "job_board" },
    { id: app(3), org_id: ACME, person_id: person(3), role_id: OTHER_JOB, stage: "sourced", source: "job_board" },
    { id: "d2d00000-0000-4000-8000-0000000000f1", org_id: GLOBEX, person_id: GLOBEX_PERSON, role_id: GLOBEX_JOB, stage: "sourced", source: "referral" },
  ]));
  must(await db().from("tags").insert([
    { id: TAG, org_id: ACME, name: "Competing offer" },
    { id: GLOBEX_TAG, org_id: GLOBEX, name: "Globex label" },
  ]));
  const { data: external } = must(await db().from("access_roles").select("id").eq("org_id", ACME).eq("name", "External Recruiter").single());
  must(await db().from("job_access").insert({ org_id: ACME, actor_id: RECRUITER, role_id: JOB, access_role_id: external!.id }));
  must(await db().from("person_tags").insert([
    { org_id: ACME, person_id: person(1), tag_id: TAG },
    { org_id: ACME, person_id: person(3), tag_id: TAG },
    { org_id: GLOBEX, person_id: GLOBEX_PERSON, tag_id: GLOBEX_TAG },
  ]));
});

afterAll(clear);

describe("readViews", () => {
  test("an admin gets every row, the org's tags and the departments with their jobs", async () => {
    const read = await readViews(adminDb(), new Date());
    expect(read.rows).toHaveLength(3);
    expect(read.rows.find((r) => r.source === "referral")).toEqual({ roleId: JOB, column: "screening", source: "referral", tagIds: [TAG] });
    expect(read.tags).toEqual([{ id: TAG, name: "Competing offer" }]);
    expect(read.departments).toEqual([{ id: DEPT, path: "Infra", roleIds: [JOB] }]);
    expect(read.capped).toBe(false);
  });

  test("an archived label is not on offer, though a view on it still filters", async () => {
    must(await db().from("tags").update({ archived_at: new Date().toISOString() }).eq("id", TAG));
    expect((await readViews(adminDb(), new Date())).tags).toEqual([]);
    expect(await readPersonTags(adminDb(), [person(1)], TAG)).toEqual(new Map([[person(1), [TAG]]]));
  });

  test("an external recruiter counts only the people they added, and their marks are those", async () => {
    const read = await readViews(recruiterDb(), new Date());
    expect(read.rows).toEqual([{ roleId: JOB, column: "screening", source: "referral", tagIds: [TAG] }]);
    expect(await readPersonTags(recruiterDb(), [person(2), person(3)])).toEqual(new Map());
    const marks = await readMarks(recruiterDb(), asRecruiter, new Date());
    expect(marks.tickets).toEqual([]);
    expect(marks.inbox).toEqual(expect.any(Array));
  });

  test("a hiring manager's rows are their own job's: the count never shows more than they can read", async () => {
    const read = await readViews(leadDb(), new Date());
    expect(read.rows).toHaveLength(2);
    expect(read.rows.every((r) => r.roleId === JOB)).toBe(true);
  });

  test("no name goes to the browser", async () => {
    const read = await readViews(adminDb(), new Date());
    expect(JSON.stringify(read.rows)).not.toMatch(/Riley|Casey|Dana/);
  });
});

describe("readPersonTags", () => {
  test("another org's tag on another org's person is not there, and one tag narrows the read", async () => {
    const all = await readPersonTags(adminDb(), [person(1), person(2), GLOBEX_PERSON]);
    expect(all).toEqual(new Map([[person(1), [TAG]]]));
    expect(await readPersonTags(adminDb(), [person(1)], GLOBEX_TAG)).toEqual(new Map());
    expect(await readPersonTags(adminDb(), [])).toEqual(new Map());
  });
});

describe("readMarks", () => {
  test("the ids on the Inbox and on New Applicants, of what the member can read", async () => {
    const admin = await readMarks(adminDb(), asAdmin, new Date());
    expect([...(admin.tickets ?? [])].sort()).toEqual([app(2), app(3)]);
    expect(admin.inbox).toEqual(expect.any(Array));
    const lead = await readMarks(leadDb(), asLead, new Date());
    expect(lead.tickets).toEqual([app(2)]);
  });

  test("an interviewer has neither page", async () => {
    expect(await readMarks(member("user_vw_sam", "org_itest_views_acme"), { actorId: SITTER, orgId: ACME, accessLevel: "limited" }, new Date())).toEqual({ inbox: [], tickets: [] });
  });
});
