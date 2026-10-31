import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createUserClient, getSupabaseServiceClient, mintClientMemberToken } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";

import { addCandidateNote } from "./candidate-edits";

/**
 * Notes on the candidate page at the edges, against the local stack on
 * members' own tokens: each kind of member, an erased or merged candidate, a
 * person someone else holds, what is recorded, and many writes at once.
 */

const db = () => getSupabaseServiceClient();

const ACME = "e7000000-0000-4000-8000-0000000000d1";
const ADMIN = "e7a00000-0000-4000-8000-0000000000d1";
const LEAD = "e7a00000-0000-4000-8000-0000000000d2";
const IVY = "e7a00000-0000-4000-8000-0000000000d3";
const REX = "e7a00000-0000-4000-8000-0000000000d4";
const ENGINEER = "e7b00000-0000-4000-8000-0000000000d1";
const SECRET = "e7b00000-0000-4000-8000-0000000000d2";
const RECRUITER_ROLE = "e7f00000-0000-4000-8000-0000000000d1";
const person = (n: number) => `e7c00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const app = (n: number) => `e7d00000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const WORKOS = "org_itest_cnote_acme";

function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

async function clear() {
  const ids = [ACME];
  await db().from("audit_log").delete().in("actor_id", [ADMIN, LEAD, IVY, REX]);
  for (const table of ["person_notes", "application_events", "interviews", "applications", "hiring_team", "job_access", "access_roles", "people", "roles", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

const ctx = (actorId: string, accessLevel: clientTools.ClientToolCtx["accessLevel"]): clientTools.ClientToolCtx => ({ actorId, orgId: ACME, accessLevel, source: "dashboard" });
const member = (subject: string) => {
  const signer = { alg: "HS256" as const, secret: process.env.SUPABASE_JWT_SECRET! };
  return createUserClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, () => mintClientMemberToken(signer, { subject, workosOrgId: WORKOS }));
};
const ada = () => [member("user_cnote_ada"), ctx(ADMIN, "admin")] as const;
const lee = () => [member("user_cnote_lee"), ctx(LEAD, "elevated")] as const;
const ivy = () => [member("user_cnote_ivy"), ctx(IVY, "limited")] as const;
const rex = () => [member("user_cnote_rex"), ctx(REX, "elevated")] as const;

const notes = async (personId: string) =>
  must(await db().from("person_notes").select("actor_id, text, source").eq("person_id", personId).order("created_at")).data!;
const claims = async (actorId: string) =>
  must(await db().from("audit_log").select("action, after").eq("actor_id", actorId).order("created_at")).data!;

beforeEach(async () => {
  await clear();
  must(await db().from("orgs").insert({ id: ACME, name: "Acme", slug: "itest-cnote-acme", kind: "client", workos_org_id: WORKOS }));
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-cnote-admin", display_name: "Ada Admin", email: "ada@cnote.test", access_level: "admin", auth_subject: "user_cnote_ada" },
    { id: LEAD, org_id: ACME, slug: "itest-cnote-lead", display_name: "Lee Lead", email: "lee@cnote.test", access_level: "elevated", auth_subject: "user_cnote_lee" },
    { id: IVY, org_id: ACME, slug: "itest-cnote-iv", display_name: "Ivy Interviewer", email: "ivy@cnote.test", access_level: "limited", auth_subject: "user_cnote_ivy" },
    { id: REX, org_id: ACME, slug: "itest-cnote-rex", display_name: "Rex Recruiter", email: "rex@cnote.test", access_level: "elevated", auth_subject: "user_cnote_rex" },
  ]));
  const { data: company } = must(await db().from("companies").insert({ org_id: ACME, name: "Acme" }).select("id").single());
  must(await db().from("roles").insert([
    { id: ENGINEER, org_id: ACME, company_id: company!.id, title: "Founding Engineer", status: "open", confidential: false },
    { id: SECRET, org_id: ACME, company_id: company!.id, title: "Next CEO", status: "open", confidential: true },
  ]));
  must(await db().from("hiring_team").insert({ org_id: ACME, role_id: ENGINEER, actor_id: LEAD, team_role: "hiring_manager" }));
  // Rex is an agency recruiter on Engineer: he sees only who he added.
  must(await db().from("access_roles").insert({ id: RECRUITER_ROLE, org_id: ACME, name: "Agency", can_view_candidates: true, can_edit_pipeline: true, own_candidates_only: true }));
  must(await db().from("job_access").insert({ org_id: ACME, actor_id: REX, role_id: ENGINEER, access_role_id: RECRUITER_ROLE }));
  must(await db().from("people").insert([
    { id: person(1), org_id: ACME, display_name: "Grace Hopper", email: "grace@cnote.test" },
    { id: person(2), org_id: ACME, display_name: "Alan Turing", email: "alan@cnote.test" },
    { id: person(3), org_id: ACME, display_name: "Secret Hire", email: "s@cnote.test" },
    { id: person(4), org_id: ACME, display_name: "Duplicate Grace", email: "grace2@cnote.test" },
    { id: person(5), org_id: ACME, display_name: "Prospect Pat", email: "pat@cnote.test" },
  ]));
  must(await db().from("applications").insert([
    { id: app(1), org_id: ACME, person_id: person(1), role_id: ENGINEER, stage: "screening", added_by_actor_id: REX },
    { id: app(2), org_id: ACME, person_id: person(2), role_id: ENGINEER, stage: "screening", added_by_actor_id: LEAD },
    { id: app(3), org_id: ACME, person_id: person(3), role_id: SECRET, stage: "screening" },
    { id: app(4), org_id: ACME, person_id: person(4), role_id: ENGINEER, stage: "screening" },
  ]));
  must(await db().from("interviews").insert({
    org_id: ACME, application_id: app(1), starts_at: new Date(Date.now() + 86_400_000).toISOString(),
    ends_at: new Date(Date.now() + 90_000_000).toISOString(), status: "scheduled", step: "Onsite", interviewer_actor_ids: [IVY],
  }));
});

afterAll(clear);

const TEXT = "Strong on systems.";
const GONE = { ok: false, error: "note_gone" };

describe("who may note whom", () => {
  test("an agency recruiter notes the candidates they added, and nobody else", async () => {
    expect(await addCandidateNote(...rex(), { candidateId: person(1), text: TEXT })).toEqual({ ok: true });
    expect(await addCandidateNote(...rex(), { candidateId: person(2), text: TEXT })).toEqual(GONE);
    expect(await addCandidateNote(...rex(), { candidateId: person(5), text: TEXT })).toEqual(GONE);
    expect(await notes(person(2))).toEqual([]);
  });

  test("a confidential job's candidate is nobody's but its team's and the admins'", async () => {
    expect(await addCandidateNote(...lee(), { candidateId: person(3), text: TEXT })).toEqual(GONE);
    expect(await addCandidateNote(...ivy(), { candidateId: person(3), text: TEXT })).toEqual(GONE);
    expect(await notes(person(3))).toEqual([]);
  });

  test("a prospect in no job: an elevated member who may see them can note them", async () => {
    expect(await addCandidateNote(...lee(), { candidateId: person(5), text: TEXT })).toEqual({ ok: true });
  });

  test("a refusal leaves no claim on the member's hourly limit", async () => {
    await addCandidateNote(...ivy(), { candidateId: person(2), text: TEXT });
    expect(await claims(IVY)).toEqual([]);
  });
});

describe("a candidate who changed behind an open page", () => {
  test("nobody can note a candidate after they were erased", async () => {
    must(await member("user_cnote_ada").rpc("client_anonymize_candidate", { p_person: person(1), p_confirm: "ANONYMIZE Grace Hopper" }));
    expect(await notes(person(1))).toEqual([]);
    expect(await addCandidateNote(...ada(), { candidateId: person(1), text: "Lives at 12 Elm St" })).toEqual(GONE);
    expect(await addCandidateNote(...ivy(), { candidateId: person(1), text: "Lives at 12 Elm St" })).toEqual(GONE);
    expect(await notes(person(1))).toEqual([]);
    expect(await claims(IVY)).toEqual([]);
  });

  test("a merged-away duplicate is gone; the note does not land on a hidden row", async () => {
    must(await member("user_cnote_ada").rpc("client_merge_candidates", { p_keep: person(1), p_merge: person(4) }));
    expect(await addCandidateNote(...ada(), { candidateId: person(4), text: TEXT })).toEqual(GONE);
    expect(await notes(person(4))).toEqual([]);
  });

  test("an interviewer dropped from the interview is refused", async () => {
    must(await db().from("interviews").update({ interviewer_actor_ids: [] }).eq("application_id", app(1)));
    expect(await addCandidateNote(...ivy(), { candidateId: person(1), text: TEXT })).toEqual(GONE);
  });
});

describe("what is written", () => {
  test("the note records that it came from the web app", async () => {
    await addCandidateNote(...ada(), { candidateId: person(1), text: TEXT });
    expect(await notes(person(1))).toEqual([{ actor_id: ADMIN, text: TEXT, source: "dashboard" }]);
  });

  test("text that looks like markup or a query, and every kind of unicode, comes back exact", async () => {
    const text = `<script>alert(1)</script> ' OR 1=1; -- \\ 👩🏽‍💻 שלום ${"𝒳".repeat(2000)}`;
    expect(await addCandidateNote(...ada(), { candidateId: person(1), text })).toEqual({ ok: true });
    const feed = await clientTools.getActivity(...ada(), { candidateId: person(1), limit: 50 });
    expect(feed.entries.find((e) => e.kind === "note")?.text).toBe(text);
  });

  test("a NUL, which Postgres cannot hold, does not fail the note or strand a claim", async () => {
    expect(await addCandidateNote(...ada(), { candidateId: person(1), text: "a\u0000b" })).toEqual({ ok: true });
    expect((await notes(person(1))).map((n) => n.text)).toEqual(["ab"]);
    expect((await claims(ADMIN)).every((c) => c.after !== null)).toBe(true);
  });
});

describe("many at once", () => {
  test("twenty notes at once all land, each with its own audit row", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => addCandidateNote(...ada(), { candidateId: person(1), text: `n${i}` })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await notes(person(1))).toHaveLength(20);
    expect(await claims(ADMIN)).toHaveLength(20);
  });

  test("at the hourly limit, parallel notes stop exactly at it", async () => {
    must(await db().from("audit_log").insert(Array.from({ length: 295 }, () => ({ actor_id: ADMIN, source: "dashboard", action: "note.add", entity: "person" }))));
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => addCandidateNote(...ada(), { candidateId: person(1), text: `n${i}` })));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.filter((r) => !r.ok && r.error === "rate_limited")).toHaveLength(7);
    expect(await notes(person(1))).toHaveLength(5);
  });

  test("the feed holds the newest fifty, a new note first", async () => {
    const base = Date.now() - 3_600_000;
    must(await db().from("person_notes").insert(Array.from({ length: 80 }, (_, i) => ({ org_id: ACME, person_id: person(1), actor_id: ADMIN, text: `old ${i}`, created_at: new Date(base + i * 1000).toISOString() }))));
    await addCandidateNote(...ada(), { candidateId: person(1), text: "newest" });
    const feed = await clientTools.getActivity(...ada(), { candidateId: person(1), limit: clientTools.LIST_MAX });
    expect(feed.entries).toHaveLength(50);
    expect(feed.entries[0]).toMatchObject({ kind: "note", text: "newest" });
  });
});

describe("who reads a note", () => {
  test("the hiring team reads an interviewer's note, an interviewer only their own", async () => {
    await addCandidateNote(...ada(), { candidateId: person(1), text: "from Ada" });
    await addCandidateNote(...ivy(), { candidateId: person(1), text: "from Ivy" });
    const texts = async (c: ReturnType<typeof lee>) => (await clientTools.getActivity(...c, { candidateId: person(1), limit: 50 })).entries.filter((e) => e.kind === "note").map((e) => e.text).sort();
    expect(await texts(lee())).toEqual(["from Ada", "from Ivy"]);
    expect(await texts(ivy())).toEqual(["from Ivy"]);
  });
});
