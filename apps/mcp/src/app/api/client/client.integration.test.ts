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

async function clear() {
  const ids = [ACME, GLOBEX];
  // org_id references orgs without a cascade: every row in these orgs goes first.
  for (const table of ["audit_log", "application_events", "interviews", "applications", "person_notes", "people", "companies"] as const) {
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
  };
});

afterAll(async () => {
  await clear();
  await new Promise((done) => jwksServer.close(done));
});

vi.spyOn(console, "warn").mockImplementation(() => {});

beforeEach(async () => {
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
    org_id: ACME, application_id: PAT_APP, interviewer_actor_ids: [INTERVIEWER],
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
    expect(moved).toEqual({ outcome: "moved", application_id: PAT_APP, stage: "interviewing" });
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
