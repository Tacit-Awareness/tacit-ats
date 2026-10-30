import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";

import { readCandidate, toolCtx } from "./candidate";
import { readCandidates } from "./crm";

/**
 * The CRM's and the candidate page's reads against the local stack, on
 * members' own tokens: the policies decide which candidates, applications,
 * notes and files come back. The member token is signed with the stack's JWT
 * secret, as in pipeline.integration.test.ts.
 */

const db = () => getSupabaseServiceClient();

const ACME = "c3000000-0000-4000-8000-0000000000a1";
const GLOBEX = "c4000000-0000-4000-8000-0000000000a2";
const ADMIN = "c3a00000-0000-4000-8000-0000000000a1";
const LEAD = "c3a00000-0000-4000-8000-0000000000a2";
const INTERVIEWER = "c3a00000-0000-4000-8000-0000000000a3";
const ENGINEER = "c3b00000-0000-4000-8000-0000000000a1";
const DESIGNER = "c3b00000-0000-4000-8000-0000000000a2";
const GLOBEX_ROLE = "c4b00000-0000-4000-8000-0000000000a1";
const person = (n: number) => `c3c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const app = (n: number) => `c3d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const GLOBEX_PERSON = "c4c00000-0000-4000-8000-0000000000a1";
const GLOBEX_APP = "c4d00000-0000-4000-8000-0000000000a1";
const TAG = "c3e00000-0000-4000-8000-0000000000a1";
const INTERVIEW = "c3f00000-0000-4000-8000-0000000000a1";

const ACME_WORKOS = "org_itest_crm_acme";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME, GLOBEX];
  for (const table of [
    "person_tags", "tags", "person_notes", "person_files", "application_events", "interviews", "applications", "hiring_team", "people", "roles", "companies",
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
const ctxOf = (actorId: string, accessLevel: "admin" | "elevated" | "limited") => toolCtx({ actorId, accessLevel, org: { id: ACME, name: "Acme", slug: "acme", workosOrgId: ACME_WORKOS } });

const NOW = Date.now();
const H = 3_600_000;
const at = (h: number) => new Date(NOW + h * H).toISOString();

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-crm-acme", kind: "client", workos_org_id: ACME_WORKOS },
    { id: GLOBEX, name: "Globex", slug: "itest-crm-globex", kind: "client", workos_org_id: "org_itest_crm_globex" },
  ]));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-crm-admin", display_name: "Ada Admin", email: "ada@crm.test", access_level: "admin", auth_subject: "user_crm_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-crm-lead", display_name: "Lee Lead", email: "lee@crm.test", access_level: "elevated", auth_subject: "user_crm_lee" },
    { id: INTERVIEWER, org_id: ACME, slug: "itest-crm-iv", display_name: "Ivy Interviewer", email: "ivy@crm.test", access_level: "limited", auth_subject: "user_crm_ivy" },
  ]));
  for (const [org, name, roles] of [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer"], [DESIGNER, "Designer"]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Role"]]],
  ] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title]) => ({ id, org_id: org, company_id: company!.id, title, status: "open" }))));
  }
  // Lee manages the engineer search only.
  must(await db().from("hiring_team").insert({ org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" }));

  must(await db().from("people").insert([
    { id: person(1), org_id: ACME, display_name: "Grace Hopper", email: "grace@crm.test", current_title: "Engineer", current_company: "Navy", summary: "Compilers." },
    { id: person(2), org_id: ACME, display_name: "Dieter Rams", email: "dieter@crm.test" },
    { id: person(3), org_id: ACME, display_name: "Pat Prospect", email: "pat@crm.test" },
    { id: GLOBEX_PERSON, org_id: GLOBEX, display_name: "Globex Candidate", email: "g@crm.test" },
  ]));
  must(await db().from("applications").insert([
    // Grace: interviewing for Engineer (owned by Lee), rejected earlier for Designer
    { id: app(1), org_id: ACME, person_id: person(1), role_id: ENGINEER, stage: "interviewing", owner_actor_id: LEAD, last_touch_at: at(-2) },
    { id: app(2), org_id: ACME, person_id: person(1), role_id: DESIGNER, stage: "rejected", last_touch_at: at(-200) },
    // Dieter: hired as a designer
    { id: app(3), org_id: ACME, person_id: person(2), role_id: DESIGNER, stage: "hired", owner_actor_id: ADMIN, last_touch_at: at(-48) },
    { id: GLOBEX_APP, org_id: GLOBEX, person_id: GLOBEX_PERSON, role_id: GLOBEX_ROLE, stage: "screening", owner_actor_id: null, last_touch_at: at(-1) },
  ]));
  must(await db().from("application_events").insert({ org_id: ACME, application_id: app(1), actor_id: ADMIN, kind: "added", to_stage: "sourced", created_at: at(-100) }));
  must(await db().from("interviews").insert({
    id: INTERVIEW, org_id: ACME, application_id: app(1), starts_at: at(24), ends_at: at(25), status: "scheduled", step: "Onsite", interviewer_actor_ids: [INTERVIEWER],
  }));
  must(await db().from("person_notes").insert([
    { org_id: ACME, person_id: person(1), actor_id: ADMIN, text: "Strong on systems.", created_at: at(-10) },
    { org_id: ACME, person_id: person(1), actor_id: INTERVIEWER, text: "Prepping the onsite.", created_at: at(-5) },
  ]));
  must(await db().from("tags").insert({ id: TAG, org_id: ACME, name: "referral" }));
  must(await db().from("person_tags").insert({ org_id: ACME, person_id: person(1), tag_id: TAG }));
  must(await db().from("person_files").insert({ org_id: ACME, person_id: person(1), kind: "resume", filename: "grace.pdf", storage_path: `${ACME}/${person(1)}/f1` }));
});

afterAll(clear);

describe("the CRM's read", () => {
  test("an admin reads every candidate in the company, prospects too, with each job's owner; never another company's", async () => {
    const { candidates, truncated } = await readCandidates(member("user_crm_ada"));
    expect(truncated).toBe(false);
    expect(candidates.map((c) => c.candidateId).sort()).toEqual([person(1), person(2), person(3)].sort());
    const grace = candidates.find((c) => c.candidateId === person(1))!;
    expect(grace).toMatchObject({ name: "Grace Hopper", headline: "Engineer at Navy", email: "grace@crm.test" });
    expect(grace.applications.map((a) => [a.jobTitle, a.stage, a.ownerName]).sort()).toEqual([
      ["Designer", "rejected", null],
      ["Founding Engineer", "interviewing", "Lee Lead"],
    ]);
    expect(candidates.find((c) => c.candidateId === person(3))!.applications).toEqual([]);
  });

  test("a hiring manager on one job reads that job's candidates and applications, plus prospects (in no job); not another job's hire", async () => {
    const { candidates } = await readCandidates(member("user_crm_lee"));
    // people's read policy: can_read_person, or can_add_people and person_in_no_pipeline
    expect(candidates.map((c) => c.candidateId).sort()).toEqual([person(1), person(3)].sort());
    expect(candidates.find((c) => c.candidateId === person(1))!.applications.map((a) => a.applicationId)).toEqual([app(1)]);
  });
});

describe("the candidate page's read", () => {
  test("an admin gets the whole record: jobs with owners, tags, files, and the activity newest first", async () => {
    const read = (await readCandidate(member("user_crm_ada"), ctxOf(ADMIN, "admin"), person(1)))!;
    expect(read.candidate).toMatchObject({ full: true, name: "Grace Hopper", email: "grace@crm.test", summary: "Compilers.", tags: ["referral"] });
    expect(read.candidate.files.map((f) => f.filename)).toEqual(["grace.pdf"]);
    expect(read.candidate.applications.map((a) => a.applicationId).sort()).toEqual([app(1), app(2)].sort());
    expect(read.owners.get(app(1))).toBe("Lee Lead");
    expect(read.owners.get(app(2))).toBeNull();
    const kinds = read.activity.map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["interview.scheduled", "note", "application.added"]));
    const times = read.activity.map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  test("a hiring manager sees their job's application only, and not a candidate who is in none of theirs", async () => {
    const lee = member("user_crm_lee");
    const read = (await readCandidate(lee, ctxOf(LEAD, "elevated"), person(1)))!;
    expect(read.candidate.applications.map((a) => a.applicationId)).toEqual([app(1)]);
    expect(await readCandidate(lee, ctxOf(LEAD, "elevated"), person(2))).toBeNull();
  });

  test("an interviewer gets the card, their own notes and their interviews; nobody else", async () => {
    const ivy = member("user_crm_ivy");
    const read = (await readCandidate(ivy, ctxOf(INTERVIEWER, "limited"), person(1)))!;
    expect(read.candidate).toMatchObject({ full: false, email: null, applications: [], tags: [] });
    expect(read.owners.size).toBe(0);
    expect(read.activity.map((e) => e.kind).sort()).toEqual(["interview.scheduled", "note"]);
    expect(read.activity.find((e) => e.kind === "note")!.text).toBe("Prepping the onsite.");
    expect(await readCandidate(ivy, ctxOf(INTERVIEWER, "limited"), person(2))).toBeNull();
  });

  test("another company's candidate, or a malformed id, is nobody", async () => {
    const ada = member("user_crm_ada");
    expect(await readCandidate(ada, ctxOf(ADMIN, "admin"), GLOBEX_PERSON)).toBeNull();
    expect(await readCandidate(ada, ctxOf(ADMIN, "admin"), "not-a-uuid")).toBeNull();
  });
});
