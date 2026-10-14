import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SignJWT, exportJWK, generateKeyPair, type JWTPayload } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { getSupabaseServiceClient } from "@tacit/db";

/**
 * The client connector end to end against the local stack. Only WorkOS is
 * stood in for: a local HTTP server serves the JWKS its tokens are checked
 * against. Token verification, member binding, the minted member token,
 * PostgREST, the policies and the audit row are all real. The member token is
 * signed with the stack's shared JWT secret here; production signs it with the
 * project's imported key, which the stack does not have.
 */

const RESOURCE = "https://mcp.tacitawareness.com/api/client";
const db = () => getSupabaseServiceClient();

const ACME = "c1000000-0000-4000-8000-00000000000a";
const GLOBEX = "c2000000-0000-4000-8000-00000000000b";
const ADMIN = "c1a00000-0000-4000-8000-000000000001";
const INTERVIEWER = "c1a00000-0000-4000-8000-000000000002";
const INVITED = "c1a00000-0000-4000-8000-000000000003";
const ENGINEER = "c1b00000-0000-4000-8000-000000000001";
const DESIGNER = "c1b00000-0000-4000-8000-000000000002";
const GLOBEX_ROLE = "c2b00000-0000-4000-8000-000000000001";
const PAT = "c1c00000-0000-4000-8000-000000000001";
const SECRET_PERSON = "c2c00000-0000-4000-8000-000000000001";
const PAT_APP = "c1d00000-0000-4000-8000-000000000001";
const UPCOMING = "c1e00000-0000-4000-8000-000000000001";

/** Setup writes throw: a fixture that silently failed would make every refusal test pass for the wrong reason. */
function must<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(`fixture: ${result.error.message}`);
  return result;
}

let jwksServer: Server;
let issuer: string;
let privateKey: CryptoKey;
let handleClientRequest: typeof import("../../../client/handler.js").handleClientRequest;
let deps: Parameters<typeof handleClientRequest>[1];
/** What the stand-in for WorkOS was asked to do. */
const workos = { sent: [] as Array<{ email: string; organizationId: string; inviterUserId?: string }>, revoked: [] as string[] };

async function clear() {
  const ids = [ACME, GLOBEX];
  // org_id references orgs without a cascade: every row in these orgs goes first.
  for (const table of ["audit_log", "interview_feedback", "application_events", "interviews", "applications", "person_notes", "people", "companies"] as const) {
    must(await db().from(table).delete().in("org_id", ids));
  }
  await db().from("actors").delete().in("org_id", ids);
  await db().from("orgs").delete().in("id", ids);
}

beforeAll(async () => {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error("integration-setup did not export SUPABASE_JWT_SECRET (JWT_SECRET from `supabase status`)");

  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k", alg: "RS256", use: "sig" };
  jwksServer = createServer((req, res) => {
    if (req.url === "/oauth2/jwks") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [jwk] }));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => jwksServer.listen(0, "127.0.0.1", done));
  issuer = `http://127.0.0.1:${(jwksServer.address() as AddressInfo).port}`;

  ({ handleClientRequest } = await import("../../../client/handler.js"));
  const { bindMember } = await import("../../../client/bind.js");
  const { auditClientCall, clientBreadthExceeded } = await import("../../../client/audit.js");
  deps = {
    config: {
      issuer,
      resource: RESOURCE,
      workosApiKey: null,
      supabaseUrl: process.env.SUPABASE_URL!,
      publishableKey: process.env.SUPABASE_ANON_KEY!,
      signer: { alg: "HS256", secret },
    },
    bind: bindMember,
    audit: auditClientCall,
    breadth: clientBreadthExceeded,
    invitations: {
      createOrganization: async () => {
        throw new Error("not here");
      },
      sendInvitation: async (input) => {
        workos.sent.push(input);
        return { id: `inv_${workos.sent.length}` };
      },
      revokeInvitations: async ({ email }) => {
        workos.revoked.push(email);
      },
    },
  };
});

afterAll(async () => {
  await clear();
  await new Promise((done) => jwksServer.close(done));
});

vi.spyOn(console, "warn").mockImplementation(() => {});

beforeEach(async () => {
  workos.sent.length = 0;
  workos.revoked.length = 0;
  await clear();
  must(await db().from("orgs").insert([
    { id: ACME, name: "Acme", slug: "itest-client-acme", kind: "client", workos_org_id: "org_itest_acme" },
    { id: GLOBEX, name: "Globex", slug: "itest-client-globex", kind: "client", workos_org_id: "org_itest_globex" },
  ]));
  // Every row names every column: a bulk insert sends the union of the rows'
  // keys and fills a missing one with null, not the column's default.
  must(await db().from("actors").insert([
    { id: ADMIN, org_id: ACME, slug: "itest-acme-admin", display_name: "Ada Admin", email: "ada@acme.test", access_level: "admin", auth_subject: "user_ada" },
    { id: INTERVIEWER, org_id: ACME, slug: "itest-acme-int", display_name: "Ivan Interviewer", email: "ivan@acme.test", access_level: "limited", auth_subject: "user_ivan" },
    // Invited, not signed in yet.
    { id: INVITED, org_id: ACME, slug: "itest-acme-new", display_name: "Nia New", email: "nia@acme.test", access_level: "elevated", auth_subject: null },
  ]));
  const jobs = [
    [ACME, "Acme", [[ENGINEER, "Founding Engineer"], [DESIGNER, "Designer"]]],
    [GLOBEX, "Globex", [[GLOBEX_ROLE, "Globex Secret Role"]]],
  ] as const;
  for (const [org, name, roles] of jobs) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(roles.map(([id, title]) => ({ id, org_id: org, company_id: company!.id, title, status: "open" }))));
  }
  must(await db().from("people").insert([
    { id: PAT, org_id: ACME, display_name: "Pat Candidate", email: "pat@cand.test", current_title: "Staff Engineer", current_company: "Initech" },
    { id: SECRET_PERSON, org_id: GLOBEX, display_name: "Pat Globex", email: "pat@globex-cand.test", current_title: null, current_company: null },
  ]));
  must(await db().from("applications").insert([
    { id: PAT_APP, org_id: ACME, person_id: PAT, role_id: ENGINEER, stage: "screening" },
    { id: "c2d00000-0000-4000-8000-000000000001", org_id: GLOBEX, person_id: SECRET_PERSON, role_id: GLOBEX_ROLE, stage: "screening" },
  ]));
  const soon = Date.now() + 86_400_000;
  must(await db().from("interviews").insert({
    id: UPCOMING, org_id: ACME, application_id: PAT_APP, interviewer_actor_ids: [INTERVIEWER],
    starts_at: new Date(soon).toISOString(), ends_at: new Date(soon + 3_600_000).toISOString(),
  }));
});

const token = (claims: JWTPayload, audience = RESOURCE) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

async function call(claims: JWTPayload, name = "whoami", args: Record<string, unknown> = {}) {
  const request = new Request(RESOURCE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${await token(claims)}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  return handleClientRequest(request, deps);
}

/** A tool call's MCP result: `structuredContent` on success, `isError` and a sentence otherwise. */
async function tool(claims: JWTPayload, name: string, args: Record<string, unknown> = {}) {
  const res = await call(claims, name, args);
  expect(res.status).toBe(200);
  const body = await res.text();
  const line = body.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse((line ?? body).replace(/^data: /, "")).result as {
    isError?: boolean;
    content: Array<{ text: string }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    structuredContent: any;
  };
}

async function ok(claims: JWTPayload, name: string, args: Record<string, unknown> = {}) {
  const out = await tool(claims, name, args);
  expect(out.isError, out.content[0]?.text).toBeFalsy();
  return out.structuredContent;
}

const ADA = { sub: "user_ada", org_id: "org_itest_acme" };
const IVAN = { sub: "user_ivan", org_id: "org_itest_acme" };

async function whoami(claims: JWTPayload) {
  return (await ok(claims, "whoami")) as {
    company: string;
    you: { user_id: string; name: string; access: string };
    jobs: Array<{ title: string }>;
  };
}

describe("the client connector against real Postgres", () => {
  test("an admin sees their company and its jobs, and none of another company's", async () => {
    const me = await whoami({ sub: "user_ada", org_id: "org_itest_acme" });
    expect(me.company).toBe("Acme");
    expect(me.you).toMatchObject({ user_id: ADMIN, name: "Ada Admin", access: "admin" });
    expect(me.jobs.map((j) => j.title).sort()).toEqual(["Designer", "Founding Engineer"]);
  });

  test("an interviewer sees only the job they interview for: the policies decide, not the tool", async () => {
    const me = await whoami(IVAN);
    expect(me.you.access).toBe("interviewer");
    expect(me.jobs.map((j) => j.title)).toEqual(["Founding Engineer"]);
  });

  test("an invited member's first sign-in binds them, with the level they were invited at", async () => {
    const me = await whoami({ sub: "user_nia", org_id: "org_itest_acme", email: "nia@acme.test" });
    expect(me.you).toMatchObject({ name: "Nia New", access: "hiring team" });
    const { data } = await db().from("actors").select("auth_subject").eq("slug", "itest-acme-new").single();
    expect(data!.auth_subject).toBe("user_nia");
  });

  test("someone signed in to WorkOS but never invited is refused, and nothing is created", async () => {
    const res = await call({ sub: "user_eve", org_id: "org_itest_acme", email: "eve@acme.test" });
    expect(res.status).toBe(403);
    const { count } = await db().from("actors").select("*", { count: "exact", head: true }).eq("org_id", ACME);
    expect(count).toBe(3);
  });

  test("a member's token naming another company opens nothing there", async () => {
    // Ada is Acme's admin; a token for Ada claiming Globex has no actor in Globex to bind.
    const res = await call({ sub: "user_ada", org_id: "org_itest_globex", email: "ada@acme.test" });
    expect(res.status).toBe(403);
  });

  test("an organization with no Tacit workspace is refused", async () => {
    expect((await call({ sub: "user_ada", org_id: "org_nobody" })).status).toBe(403);
  });

  test("every call leaves an audit row as client:<tool>", async () => {
    await whoami({ sub: "user_ada", org_id: "org_itest_acme" });
    const { data } = await db().from("mcp_calls").select("tool, ok").eq("actor_id", ADMIN);
    expect(data).toEqual([{ tool: "client:whoami", ok: true }]);
  });
});

describe("the pipeline tools against real Postgres", () => {
  test("an admin lists their jobs with counts and searches only their company's candidates", async () => {
    const { jobs } = await ok(ADA, "list_jobs");
    expect(jobs.map((j: { title: string; candidates: number }) => [j.title, j.candidates]).sort())
      .toEqual([["Designer", 0], ["Founding Engineer", 1]]);
    const { candidates } = await ok(ADA, "search_candidates", { query: "Pat" });
    expect(candidates.map((c: { candidate_id: string }) => c.candidate_id)).toEqual([PAT]);
    expect(candidates[0].name).toContain("Pat Candidate");
    expect(candidates[0].jobs).toEqual([{ application_id: PAT_APP, job_id: ENGINEER, job: "Founding Engineer", stage: "screening" }]);

    const pipeline = await ok(ADA, "get_pipeline", { job_id: ENGINEER });
    expect(pipeline.candidates.map((c: { application_id: string }) => c.application_id)).toEqual([PAT_APP]);
  });

  test("another company's candidate and job read as not found", async () => {
    const candidate = await tool(ADA, "get_candidate", { candidate_id: SECRET_PERSON });
    expect(candidate.isError).toBe(true);
    expect(candidate.content[0].text).toMatch(/No candidate with that id/);
    const pipeline = await tool(ADA, "get_pipeline", { job_id: GLOBEX_ROLE });
    expect(pipeline.content[0].text).toMatch(/No job with that id/);
  });

  test("an interviewer finds the person they interview, as a card, and no pipeline", async () => {
    const { candidates } = await ok(IVAN, "search_candidates", {});
    expect(candidates.map((c: { candidate_id: string }) => c.candidate_id)).toEqual([PAT]);
    expect(candidates[0].jobs).toEqual([]);
    const card = await ok(IVAN, "get_candidate", { candidate_id: PAT });
    expect(card).toMatchObject({ full_profile: false, email: null, jobs: [] });
    expect((await tool(IVAN, "get_pipeline", { job_id: ENGINEER })).content[0].text).toMatch(/Interviewers do not see/);
  });

  test("a stage move is made as the member, recorded in the pipeline and in audit_log", async () => {
    const moved = await ok(ADA, "update_stage", { application_id: PAT_APP, stage: "interviewing", expected_stage: "screening" });
    expect(moved).toEqual({ outcome: "moved", application_id: PAT_APP, stage: "interviewing", rejection_reason: null });
    const { data: events } = await db().from("application_events").select("actor_id, from_stage, to_stage").eq("application_id", PAT_APP);
    expect(events).toEqual([{ actor_id: ADMIN, from_stage: "screening", to_stage: "interviewing" }]);
    const { data: audit } = await db().from("audit_log").select("org_id, actor_id, source, action, entity_id, before, after").eq("actor_id", ADMIN);
    expect(audit).toEqual([{
      org_id: ACME, actor_id: ADMIN, source: "claude", action: "application.stage_change", entity_id: PAT_APP,
      before: { stage: "screening" }, after: { stage: "interviewing" },
    }]);

    const stale = await ok(ADA, "update_stage", { application_id: PAT_APP, stage: "offer", expected_stage: "screening" });
    expect(stale.outcome).toBe("changed_since");
  });

  test("an interviewer cannot move anyone, and nothing changes", async () => {
    const out = await tool(IVAN, "update_stage", { application_id: PAT_APP, stage: "hired" });
    expect(out.isError).toBe(true);
    // Whether they can read the application at all is the policies' call; either way the answer is a refusal.
    expect(out.content[0].text).toMatch(/not change their place|No application with that id/);
    const { data } = await db().from("applications").select("stage").eq("id", PAT_APP).single();
    expect(data!.stage).toBe("screening");
  });

  test("an added candidate lands in the member's company, and adding them again changes nothing", async () => {
    const first = await ok(ADA, "add_candidate", { job_id: DESIGNER, name: "Dee Signer", email: "dee@cand.test" });
    expect(first).toMatchObject({ outcome: "added", new_candidate: true, stage: "sourced" });
    const { data: person } = await db().from("people").select("org_id").eq("id", first.candidate_id).single();
    expect(person!.org_id).toBe(ACME);
    const again = await ok(ADA, "add_candidate", { job_id: DESIGNER, name: "Dee Signer", email: "dee@cand.test" });
    expect(again).toMatchObject({ outcome: "already_in_pipeline", candidate_id: first.candidate_id });
    // The no-op gave its claim back.
    const { count } = await db().from("audit_log").select("*", { count: "exact", head: true }).eq("actor_id", ADMIN);
    expect(count).toBe(1);
  });

  test("an interviewer can note the person they interview and no one else", async () => {
    const note = await ok(IVAN, "add_note", { candidate_id: PAT, text: "Clear on tradeoffs" });
    const { data } = await db().from("person_notes").select("actor_id, org_id, text").eq("id", note.note_id).single();
    expect(data).toEqual({ actor_id: INTERVIEWER, org_id: ACME, text: "Clear on tradeoffs" });
    expect((await tool(IVAN, "add_note", { candidate_id: SECRET_PERSON, text: "x" })).isError).toBe(true);
  });

  test("the 301st write in an hour is refused before it happens", async () => {
    must(await db().from("audit_log").insert(
      Array.from({ length: 300 }, () => ({ actor_id: ADMIN, source: "claude", action: "note.add", entity: "person" })),
    ));
    const out = await tool(ADA, "set_next_action", { application_id: PAT_APP, next_action: "Send the take-home" });
    expect(out.content[0].text).toMatch(/300 changes in the last hour/);
    const { data } = await db().from("applications").select("next_action").eq("id", PAT_APP).single();
    expect(data!.next_action).toBeNull();
  });
});

describe("the admin tools against real Postgres", () => {
  test("an admin creates a job in their company, audited; an interviewer cannot", async () => {
    const job = await ok(ADA, "create_job", { title: "Data Engineer", location: "Remote" });
    const { data: role } = await db().from("roles").select("org_id, title, status, location, company_id").eq("id", job.job_id).single();
    expect(role).toMatchObject({ org_id: ACME, title: "Data Engineer", status: "open", location: "Remote" });
    const { data: company } = await db().from("companies").select("org_id").eq("id", role!.company_id).single();
    expect(company!.org_id).toBe(ACME);
    const { data: audit } = await db().from("audit_log").select("action, entity_id").eq("actor_id", ADMIN);
    expect(audit).toEqual([{ action: "role.create", entity_id: job.job_id }]);

    const refused = await tool(IVAN, "create_job", { title: "Shadow job" });
    expect(refused.content[0].text).toMatch(/Only an admin/);
    const { count } = await db().from("roles").select("*", { count: "exact", head: true }).eq("title", "Shadow job");
    expect(count).toBe(0);
  });

  test("closing a job changes only its status", async () => {
    expect(await ok(ADA, "update_job", { job_id: DESIGNER, status: "closed", title: "Designer" }))
      .toEqual({ outcome: "updated", job_id: DESIGNER, changed: ["status"] });
    const { data } = await db().from("roles").select("status, title").eq("id", DESIGNER).single();
    expect(data).toEqual({ status: "closed", title: "Designer" });
  });

  test("a hiring manager added to a job gets access to it, and loses it when removed", async () => {
    expect((await ok(IVAN, "list_jobs")).jobs.map((j: { title: string }) => j.title)).toEqual(["Founding Engineer"]);

    await ok(ADA, "add_to_hiring_team", { job_id: DESIGNER, user_id: INTERVIEWER, team_role: "hiring_manager" });
    const team = await ok(ADA, "get_hiring_team", { job_id: DESIGNER });
    expect(team.team).toEqual([
      { user_id: INTERVIEWER, name: "Ivan Interviewer", team_roles: ["hiring_manager"], job_access: "Hiring Manager", set_by_hand: false },
    ]);
    const { data: ivan } = await db().from("actors").select("access_level").eq("id", INTERVIEWER).single();
    expect(ivan!.access_level).toBe("elevated");
    expect((await ok(IVAN, "list_jobs")).jobs.map((j: { title: string }) => j.title).sort()).toEqual(["Designer", "Founding Engineer"]);
    expect((await ok(ADA, "add_to_hiring_team", { job_id: DESIGNER, user_id: INTERVIEWER, team_role: "hiring_manager" })).outcome)
      .toBe("already_on_team");

    expect(await ok(ADA, "remove_from_hiring_team", { job_id: DESIGNER, user_id: INTERVIEWER }))
      .toMatchObject({ outcome: "removed", removed: ["hiring_manager"] });
    const { count } = await db().from("job_access").select("*", { count: "exact", head: true }).eq("actor_id", INTERVIEWER);
    expect(count).toBe(0);
  });

  test("someone from another company cannot be put on a team", async () => {
    const out = await tool(ADA, "add_to_hiring_team", { job_id: DESIGNER, user_id: "c2a00000-0000-4000-8000-000000000009", team_role: "recruiter" });
    expect(out.content[0].text).toMatch(/No one at your company/);
  });

  test("access changes keep at least one admin", async () => {
    const lone = await tool(ADA, "set_member_access", { user_id: ADMIN, access: "hiring team" });
    expect(lone.content[0].text).toMatch(/no admin left/);

    expect(await ok(ADA, "set_member_access", { user_id: INTERVIEWER, access: "admin" }))
      .toMatchObject({ outcome: "changed", previous: "interviewer", access: "admin" });
    expect((await ok(ADA, "set_member_access", { user_id: ADMIN, access: "hiring team" })).outcome).toBe("changed");
    // Ada is no longer an admin: her token resolves to hiring team on the very next call.
    expect((await tool(ADA, "set_member_access", { user_id: INTERVIEWER, access: "interviewer" })).content[0].text)
      .toMatch(/Only an admin/);
  });

  test("an invitation is the actor plus WorkOS's email, and withdrawing it takes both back", async () => {
    const invite = await ok(ADA, "invite_member", { email: "Zed@Acme.test", name: "Zed", access: "hiring team" });
    expect(invite).toMatchObject({ outcome: "invited", email: "zed@acme.test" });
    expect(workos.sent).toEqual([{ email: "zed@acme.test", organizationId: "org_itest_acme", inviterUserId: "user_ada" }]);

    const { invites } = await ok(ADA, "list_invites");
    expect(invites.map((i: { email: string; access: string }) => [i.email, i.access]).sort())
      .toEqual([["nia@acme.test", "hiring team"], ["zed@acme.test", "hiring team"]]);

    expect((await ok(ADA, "withdraw_invite", { user_id: invite.user_id })).outcome).toBe("withdrawn");
    expect(workos.revoked).toEqual(["zed@acme.test"]);
    const { count } = await db().from("actors").select("*", { count: "exact", head: true }).eq("id", invite.user_id);
    expect(count).toBe(0);
  });
});

describe("interviews and feedback against real Postgres", () => {
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

  test("an interviewer lists their interview with the candidate and job, though they cannot read the application", async () => {
    const { interviews } = await ok(IVAN, "list_my_interviews");
    expect(interviews).toHaveLength(1);
    expect(interviews[0]).toMatchObject({
      interview_id: UPCOMING, application_id: PAT_APP, candidate_id: PAT, job: "Founding Engineer", your_feedback_filed: false,
    });
    expect(interviews[0].candidate).toContain("Pat Candidate");
    expect((await ok(IVAN, "list_my_interviews", { when: "past" })).interviews).toEqual([]);
  });

  test("feedback waits for the interview, then lands as the interviewer's own, with the notes kept out of the audit row", async () => {
    expect((await tool(IVAN, "submit_feedback", { interview_id: UPCOMING, recommendation: "yes", notes: "early" })).content[0].text)
      .toMatch(/not happened yet/);

    const past = await ok(ADA, "schedule_interview", {
      application_id: PAT_APP, starts_at: hoursFromNow(-3), ends_at: hoursFromNow(-2), interviewer_user_ids: [INTERVIEWER], step: "Onsite",
    });
    const { interviews } = await ok(IVAN, "list_my_interviews", { when: "past" });
    expect(interviews.map((i: { interview_id: string }) => i.interview_id)).toEqual([past.interview_id]);

    const filed = await ok(IVAN, "submit_feedback", {
      interview_id: past.interview_id, recommendation: "strong_yes", rating: 4, notes: "PRIVATE-MARKER great systems sense",
    });
    expect(filed.replaced).toBe(false);
    const { data: row } = await db().from("interview_feedback").select("org_id, interviewer_actor_id, notes").eq("id", filed.feedback_id).single();
    expect(row).toEqual({ org_id: ACME, interviewer_actor_id: INTERVIEWER, notes: "PRIVATE-MARKER great systems sense" });
    const { data: audit } = await db().from("audit_log").select("action, before, after").eq("actor_id", INTERVIEWER);
    expect(audit!.map((a) => a.action)).toEqual(["feedback.submit"]);
    expect(JSON.stringify(audit)).not.toContain("PRIVATE-MARKER");

    const read = await ok(ADA, "get_feedback", { application_id: PAT_APP });
    expect(read.private).toBe(true);
    expect(read.feedback).toHaveLength(1);
    expect(read.feedback[0]).toMatchObject({ interviewer_id: INTERVIEWER, interviewer: "Ivan Interviewer", recommendation: "strong_yes", rating: 4 });
    expect(read.feedback[0].notes).toContain("<<<UNTRUSTED_DATA>>>");
    expect(read.feedback[0].notes).toContain("PRIVATE-MARKER");
    expect((await ok(IVAN, "list_my_interviews", { when: "past" })).interviews[0].your_feedback_filed).toBe(true);
  });

  test("an interviewer can neither schedule nor file feedback on someone else's interview", async () => {
    const scheduled = await tool(IVAN, "schedule_interview", {
      application_id: PAT_APP, starts_at: hoursFromNow(24), ends_at: hoursFromNow(25), interviewer_user_ids: [INTERVIEWER],
    });
    expect(scheduled.isError).toBe(true);
    const adaOnly = await ok(ADA, "schedule_interview", {
      application_id: PAT_APP, starts_at: hoursFromNow(-5), ends_at: hoursFromNow(-4), interviewer_user_ids: [ADMIN],
    });
    expect((await tool(IVAN, "submit_feedback", { interview_id: adaOnly.interview_id, recommendation: "no", notes: "x" })).content[0].text)
      .toMatch(/not an interviewer/);
  });

  test("cancelling an interview changes only its status", async () => {
    expect(await ok(ADA, "update_interview", { interview_id: UPCOMING, status: "cancelled" }))
      .toEqual({ outcome: "updated", interview_id: UPCOMING, changed: ["status"] });
    const { data } = await db().from("interviews").select("status").eq("id", UPCOMING).single();
    expect(data!.status).toBe("cancelled");
  });

  test("a time without an offset is refused, not guessed", async () => {
    const out = await tool(ADA, "schedule_interview", {
      application_id: PAT_APP, starts_at: "2026-11-01T10:00:00", ends_at: "2026-11-01T11:00:00", interviewer_user_ids: [ADMIN],
    });
    expect(out.content[0].text).toMatch(/with its offset/);
  });
});

describe("rejection reasons and offers against real Postgres", () => {
  const reasonId = async (kind: string, name: string) => {
    const { reasons } = await ok(ADA, "list_rejection_reasons");
    return reasons.find((r: { kind: string; name: string }) => r.kind === kind && r.name === name).rejection_reason_id as string;
  };

  test("a company is seeded with reasons, which an interviewer does not get", async () => {
    const { reasons } = await ok(ADA, "list_rejection_reasons");
    expect(reasons.filter((r: { kind: string }) => r.kind === "rejected")).toHaveLength(8);
    expect(reasons.filter((r: { kind: string }) => r.kind === "withdrew")).toHaveLength(6);
    expect((await tool(IVAN, "list_rejection_reasons")).content[0].text).toMatch(/Interviewers do not close/);
  });

  test("rejecting needs a reason of the right kind, and keeps it with the application", async () => {
    expect((await tool(ADA, "update_stage", { application_id: PAT_APP, stage: "rejected" })).content[0].text)
      .toMatch(/needs a rejection_reason_id/);
    const timing = await reasonId("withdrew", "Timing");
    expect((await tool(ADA, "update_stage", { application_id: PAT_APP, stage: "rejected", rejection_reason_id: timing })).content[0].text)
      .toMatch(/candidate who withdrew/);

    const skills = await reasonId("rejected", "Skills or experience");
    const moved = await ok(ADA, "update_stage", {
      application_id: PAT_APP, stage: "rejected", rejection_reason_id: skills, rejection_note: "Needs more systems depth",
    });
    expect(moved).toMatchObject({ outcome: "moved", stage: "rejected", rejection_reason: "Skills or experience" });
    const { data: app } = await db().from("applications").select("rejection_reason_id, rejection_note").eq("id", PAT_APP).single();
    expect(app).toEqual({ rejection_reason_id: skills, rejection_note: "Needs more systems depth" });
    const { data: events } = await db().from("application_events").select("to_stage, detail").eq("application_id", PAT_APP);
    expect(events).toEqual([{ to_stage: "rejected", detail: "Skills or experience" }]);
    const { data: audit } = await db().from("audit_log").select("after").eq("actor_id", ADMIN).eq("action", "application.stage_change").single();
    expect(audit!.after).toEqual({ stage: "rejected", rejection_reason: "Skills or experience" });

    const card = await ok(ADA, "get_candidate", { candidate_id: PAT });
    expect(card.jobs[0]).toMatchObject({ stage: "rejected", rejection_reason: "Skills or experience" });
    expect(card.jobs[0].rejection_note).toContain("Needs more systems depth");

    // Reopening clears it.
    await ok(ADA, "update_stage", { application_id: PAT_APP, stage: "screening" });
    const { data: reopened } = await db().from("applications").select("rejection_reason_id, rejection_note").eq("id", PAT_APP).single();
    expect(reopened).toEqual({ rejection_reason_id: null, rejection_note: null });
  });

  test("an offer is drafted, extended, frozen and accepted, and closed for good", async () => {
    const drafted = await ok(ADA, "create_offer", {
      application_id: PAT_APP, salary: 185000, currency: "usd", equity: "0.4%", start_date: "2026-12-01", notes: "Board approved the band",
    });
    expect(drafted.status).toBe("draft");
    expect((await tool(ADA, "create_offer", { application_id: PAT_APP, salary: 1 })).content[0].text).toMatch(/already has an open offer \(.+, draft\)/);

    expect((await tool(ADA, "update_offer", { offer_id: drafted.offer_id, status: "accepted" })).content[0].text)
      .toMatch(/can only become extended or withdrawn/);
    const extended = await ok(ADA, "update_offer", { offer_id: drafted.offer_id, salary: 190000, status: "extended" });
    expect(extended).toMatchObject({ outcome: "updated", status: "extended" });
    expect((await tool(ADA, "update_offer", { offer_id: drafted.offer_id, salary: 200000 })).content[0].text)
      .toMatch(/Withdraw it and draft a new one/);
    expect((await ok(ADA, "update_offer", { offer_id: drafted.offer_id, status: "accepted" })).status).toBe("accepted");
    expect((await tool(ADA, "update_offer", { offer_id: drafted.offer_id, notes: "late change" })).content[0].text).toMatch(/closed/);

    const { offers } = await ok(ADA, "get_offers", { application_id: PAT_APP });
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ status: "accepted", salary: 190000, currency: "USD", equity: "0.4%", start_date: "2026-12-01", created_by: "Ada Admin" });
    expect(offers[0].extended_at).toBeTruthy();
    expect(offers[0].resolved_at).toBeTruthy();
    // Accepting moved nothing.
    const { data: app } = await db().from("applications").select("stage").eq("id", PAT_APP).single();
    expect(app!.stage).toBe("screening");
    expect((await ok(ADA, "get_candidate", { candidate_id: PAT })).jobs[0].offer).toEqual({ offer_id: drafted.offer_id, status: "accepted" });

    // The notes never reach the audit row.
    const { data: audit } = await db().from("audit_log").select("action, after").eq("actor_id", ADMIN).like("action", "offer.%");
    expect(audit!.map((a) => a.action).sort()).toEqual(["offer.create", "offer.update", "offer.update"]);
    expect(JSON.stringify(audit)).not.toContain("Board approved");

    // A new offer once the last one closed.
    expect((await ok(ADA, "create_offer", { application_id: PAT_APP, salary: 1 })).status).toBe("draft");
  });

  test("an interviewer neither reads nor makes offers", async () => {
    await ok(ADA, "create_offer", { application_id: PAT_APP, salary: 150000 });
    expect((await tool(IVAN, "get_offers", { application_id: PAT_APP })).isError).toBe(true);
    expect((await tool(IVAN, "create_offer", { application_id: PAT_APP })).isError).toBe(true);
    const { data } = await db().from("offers").select("id").eq("application_id", PAT_APP);
    expect(data).toHaveLength(1);
    expect((await ok(IVAN, "get_candidate", { candidate_id: PAT })).jobs).toEqual([]);
  });
});

describe("interview plans against real Postgres", () => {
  const PLAN = ["Recruiter screen", "Technical", "Onsite"];
  const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  const schedule = (step: string, days = 2) =>
    tool(ADA, "schedule_interview", {
      application_id: PAT_APP, starts_at: at(days), ends_at: at(days + 0.04), interviewer_user_ids: [ADMIN], step,
    });

  test("an admin sets a plan, which is the job's interview_steps, audited", async () => {
    const out = await ok(ADA, "set_interview_plan", { job_id: ENGINEER, steps: [" Recruiter screen", "Technical", "Onsite"] });
    expect(out).toMatchObject({ outcome: "updated", steps: PLAN, removed: [], interviews_keeping_removed_steps: [] });
    // The same jsonb list of names the staff connector reads.
    const { data: job } = await db().from("roles").select("interview_steps").eq("id", ENGINEER).single();
    expect(job!.interview_steps).toEqual(PLAN);
    const { data: audit } = await db().from("audit_log").select("action, entity, entity_id, before, after")
      .eq("actor_id", ADMIN).eq("action", "role.interview_plan").single();
    expect(audit).toEqual({ action: "role.interview_plan", entity: "role", entity_id: ENGINEER, before: { interview_steps: [] }, after: { interview_steps: PLAN } });

    expect((await ok(ADA, "set_interview_plan", { job_id: ENGINEER, steps: PLAN })).outcome).toBe("unchanged");
    expect((await tool(ADA, "set_interview_plan", { job_id: ENGINEER, steps: ["Onsite", "onsite"] })).content[0].text).toMatch(/twice/);
    const { count } = await db().from("audit_log").select("*", { count: "exact", head: true }).eq("action", "role.interview_plan");
    expect(count).toBe(1);
  });

  test("scheduling keeps to the plan once there is one, in the plan's spelling", async () => {
    // No plan: any step.
    expect((await schedule("Coffee chat")).isError).toBeFalsy();
    await ok(ADA, "set_interview_plan", { job_id: ENGINEER, steps: PLAN });

    expect((await schedule("Take-home")).content[0].text).toMatch(/The steps are: Recruiter screen, Technical, Onsite/);
    const scheduled = await ok(ADA, "schedule_interview", {
      application_id: PAT_APP, starts_at: at(3), ends_at: at(3.04), interviewer_user_ids: [ADMIN], step: "technical",
    });
    const { data: row } = await db().from("interviews").select("step").eq("id", scheduled.interview_id).single();
    expect(row!.step).toBe("Technical");
    expect((await schedule("Technical", 4)).content[0].text).toMatch(/already has a scheduled "Technical" interview/);
    const { count } = await db().from("interviews").select("*", { count: "exact", head: true }).eq("application_id", PAT_APP);
    expect(count).toBe(3);
  });

  test("a candidate's progress per step, and what is off the plan", async () => {
    await ok(ADA, "set_interview_plan", { job_id: ENGINEER, steps: PLAN });
    await ok(ADA, "schedule_interview", {
      application_id: PAT_APP, starts_at: at(3), ends_at: at(3.04), interviewer_user_ids: [ADMIN], step: "Technical",
    });
    const plan = await ok(ADA, "get_interview_plan", { job_id: ENGINEER, application_id: PAT_APP });
    expect(plan.steps).toEqual(PLAN.map((step, n) => ({ position: n + 1, step })));
    const c = plan.candidate;
    expect(c.sees_all_interviews).toBe(true);
    expect(c.steps.map((s: { state: string }) => s.state)).toEqual(["not_scheduled", "scheduled", "not_scheduled"]);
    expect(c.steps[1].interviews[0].interviewers).toEqual([{ user_id: ADMIN, name: "Ada Admin", feedback: "not_filed" }]);
    // The fixture's interview has no step.
    expect(c.off_plan.map((i: { interview_id: string }) => i.interview_id)).toEqual([UPCOMING]);
    expect(c.next_step).toBe("Recruiter screen");

    // Without an application, only the steps.
    expect((await ok(ADA, "get_interview_plan", { job_id: ENGINEER })).candidate).toBeUndefined();
    expect((await tool(ADA, "get_interview_plan", { job_id: DESIGNER, application_id: PAT_APP })).content[0].text).toMatch(/another job/);
  });

  test("removing a step leaves the interviews on it alone, and says so", async () => {
    await ok(ADA, "set_interview_plan", { job_id: ENGINEER, steps: PLAN });
    const onsite = await ok(ADA, "schedule_interview", {
      application_id: PAT_APP, starts_at: at(5), ends_at: at(5.04), interviewer_user_ids: [ADMIN], step: "Onsite",
    });
    const out = await tool(ADA, "set_interview_plan", { job_id: ENGINEER, steps: ["Recruiter screen", "Technical", "Final round"] });
    expect(out.structuredContent).toMatchObject({
      outcome: "updated", removed: ["Onsite"], interviews_keeping_removed_steps: [{ step: "Onsite", interviews: 1, scheduled: 1 }],
    });
    expect(out.content[0].text).toMatch(/1 interview still names a removed step \(Onsite\)/);
    const { data: row } = await db().from("interviews").select("step, status").eq("id", onsite.interview_id).single();
    expect(row).toEqual({ step: "Onsite", status: "scheduled" });
    const plan = await ok(ADA, "get_interview_plan", { job_id: ENGINEER, application_id: PAT_APP });
    expect(plan.candidate.off_plan.map((i: { interview_id: string }) => i.interview_id).sort())
      .toEqual([UPCOMING, onsite.interview_id].sort());
  });

  test("an interviewer reads the plan and only their own interview, and cannot change it", async () => {
    await ok(ADA, "set_interview_plan", { job_id: ENGINEER, steps: PLAN });
    await ok(ADA, "schedule_interview", {
      application_id: PAT_APP, starts_at: at(3), ends_at: at(3.04), interviewer_user_ids: [ADMIN], step: "Technical",
    });
    const plan = await ok(IVAN, "get_interview_plan", { job_id: ENGINEER, application_id: PAT_APP });
    expect(plan.steps.map((s: { step: string }) => s.step)).toEqual(PLAN);
    expect(plan.candidate.sees_all_interviews).toBe(false);
    // Ada's Technical interview is not his to see.
    expect(plan.candidate.steps.map((s: { state: string }) => s.state)).toEqual(["not_visible", "not_visible", "not_visible"]);
    expect(plan.candidate.off_plan).toEqual([
      expect.objectContaining({ interview_id: UPCOMING, interviewers: [{ user_id: INTERVIEWER, name: "Ivan Interviewer", feedback: "not_filed" }] }),
    ]);
    expect(plan.candidate.next_step).toBeNull();

    expect((await tool(IVAN, "set_interview_plan", { job_id: ENGINEER, steps: ["Vibes"] })).isError).toBe(true);
    expect((await tool(IVAN, "get_interview_plan", { job_id: DESIGNER })).content[0].text).toMatch(/No job with that id/);
    const { data: job } = await db().from("roles").select("interview_steps").eq("id", ENGINEER).single();
    expect(job!.interview_steps).toEqual(PLAN);
  });

  test("another company's job reads as not found and is not changed", async () => {
    expect((await tool(ADA, "get_interview_plan", { job_id: GLOBEX_ROLE })).content[0].text).toMatch(/No job with that id/);
    expect((await tool(ADA, "set_interview_plan", { job_id: GLOBEX_ROLE, steps: ["Screen"] })).isError).toBe(true);
    const { data: job } = await db().from("roles").select("interview_steps").eq("id", GLOBEX_ROLE).single();
    expect(job!.interview_steps).toEqual([]);
  });
});
