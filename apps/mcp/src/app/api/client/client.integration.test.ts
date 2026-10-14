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
  await db().from("companies").delete().in("org_id", ids);
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
  const { auditClientCall } = await import("../../../client/audit.js");
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
  for (const [org, name, titles] of [[ACME, "Acme", ["Founding Engineer", "Designer"]], [GLOBEX, "Globex", ["Globex Secret Role"]]] as const) {
    const { data: company } = must(await db().from("companies").insert({ org_id: org, name }).select("id").single());
    must(await db().from("roles").insert(titles.map((title) => ({ org_id: org, company_id: company!.id, title }))));
  }
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

async function whoami(claims: JWTPayload) {
  const res = await call(claims);
  expect(res.status).toBe(200);
  const body = await res.text();
  const line = body.split("\n").find((l) => l.startsWith("data: "));
  const payload = JSON.parse((line ?? body).replace(/^data: /, ""));
  expect(payload.result.isError, JSON.stringify(payload.result)).toBeFalsy();
  return payload.result.structuredContent as {
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

  test("an interviewer on no interview sees no jobs: the policies decide, not the tool", async () => {
    const me = await whoami({ sub: "user_ivan", org_id: "org_itest_acme" });
    expect(me.you.access).toBe("interviewer");
    expect(me.jobs).toEqual([]);
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
