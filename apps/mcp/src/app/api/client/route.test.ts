import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload } from "jose";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { BindClientResult, ClientIdentity } from "@tacit/core";

/**
 * The client connector's request handling with the database faked at
 * createUserClient: token verification (against a local key), the org and
 * member resolution, the 401/403 answers and the one tool are real.
 */

const RESOURCE = "https://mcp.tacitawareness.com/api/client";
const ISSUER = "https://clients.authkit.test";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

/** What the fake database answers, and every access token it was handed. */
const fakeDb = {
  actorId: ACTOR as string | null,
  level: "admin" as string | null,
  tokens: [] as string[],
};

vi.mock("@tacit/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tacit/db")>()),
  createUserClient: vi.fn((_url: string, _key: string, getToken: () => Promise<string> | string) => {
    const withToken = async <T>(value: T) => {
      fakeDb.tokens.push(await getToken());
      return value;
    };
    const rows: Record<string, unknown> = {
      orgs: { name: "Acme" },
      org_members: { display_name: "Ada Admin", email: "ada@acme.test" },
    };
    return {
      rpc: (fn: string) =>
        withToken({ data: fn === "current_actor_id" ? fakeDb.actorId : fakeDb.level, error: null }),
      from: (table: string) => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          maybeSingle: () => withToken({ data: rows[table] ?? null, error: null }),
          limit: () =>
            withToken({ data: [{ id: "role-1", title: "Founding Engineer", status: "open" }], error: null }),
        };
        return builder;
      },
    };
  }),
}));

const { handleClientRequest } = await import("../../../client/handler.js");
type Deps = Parameters<typeof handleClientRequest>[1];

let privateKey: CryptoKey;
let keys: ReturnType<typeof createLocalJWKSet>;
const audits: Array<{ tool: string; ok: boolean; actorId: string }> = [];
let bound: BindClientResult;
const bindCalls: ClientIdentity[] = [];

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k", alg: "RS256" }] });
});

const config = (over: Partial<NonNullable<Deps["config"]>> = {}): NonNullable<Deps["config"]> => ({
  issuer: ISSUER,
  resource: RESOURCE,
  workosApiKey: null,
  supabaseUrl: "https://db.test",
  publishableKey: "sb_publishable_x",
  signer: { alg: "HS256", secret: "local" },
  ...over,
});

function deps(over: Partial<Deps> = {}): Deps {
  return {
    config: config(),
    keys,
    bind: async (who) => {
      bindCalls.push(who);
      return bound;
    },
    audit: async (e) => {
      audits.push({ tool: e.tool, ok: e.ok, actorId: e.actorId });
    },
    ...over,
  };
}

const token = (claims: JWTPayload = {}, audience = RESOURCE) =>
  new SignJWT({ sub: "user_ada", org_id: "org_acme", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k" })
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

async function rpc(method: string, params: Record<string, unknown> = {}, bearer?: string | null): Promise<Request> {
  const auth: Record<string, string> = bearer === null ? {} : { authorization: `Bearer ${bearer ?? (await token())}` };
  return new Request(RESOURCE, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...auth },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function result(res: Response) {
  const body = await res.text();
  const line = body.split("\n").find((l) => l.startsWith("data: "));
  const payload = JSON.parse((line ?? body).replace(/^data: /, ""));
  expect(payload.error, "JSON-RPC error").toBeUndefined();
  return payload.result;
}

const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

vi.spyOn(console, "warn").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  audits.length = 0;
  bindCalls.length = 0;
  fakeDb.actorId = ACTOR;
  fakeDb.level = "admin";
  fakeDb.tokens.length = 0;
  bound = { status: "ok", actorId: ACTOR, orgId: ORG, firstSignIn: false };
});

describe("signing in", () => {
  test("unconfigured: 503", async () => {
    expect((await handleClientRequest(await rpc("tools/list"), deps({ config: null }))).status).toBe(503);
  });

  test("no token: a 401 whose challenge points at this resource's own metadata", async () => {
    const res = await handleClientRequest(await rpc("tools/list", {}, null), deps());
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://mcp.tacitawareness.com/.well-known/oauth-protected-resource/api/client"',
    );
  });

  test("a token for the staff connector is not a token for this one", async () => {
    const staff = await token({}, "https://mcp.tacitawareness.com/api/connector");
    const res = await handleClientRequest(await rpc("tools/list", {}, staff), deps());
    expect(res.status).toBe(401);
    expect(bindCalls).toEqual([]);
  });

  test("the org on the token is the org bound and the org the database token names", async () => {
    const res = await handleClientRequest(await rpc("tools/call", { name: "whoami", arguments: {} }), deps());
    expect(res.status).toBe(200);
    expect(bindCalls[0]).toMatchObject({ workosUserId: "user_ada", workosOrgId: "org_acme" });
    const minted = decode(fakeDb.tokens[0]);
    expect(minted).toMatchObject({ role: "authenticated", sub: "user_ada", org_id: "org_acme" });
  });

  test("no org on the token and no WorkOS key: refused, nothing bound", async () => {
    const res = await handleClientRequest(await rpc("tools/list", {}, await token({ org_id: undefined })), deps());
    expect(res.status).toBe(403);
    expect((await res.json()).error_description).toMatch(/not for a company on Tacit/);
    expect(bindCalls).toEqual([]);
  });

  test("no org on the token: the user's one active membership is used, two are refused", async () => {
    const workos = (orgs: string[]) =>
      vi.fn(async (_url: string | URL | Request) => Response.json({ data: orgs.map((o) => ({ organization_id: o, status: "active" })) }));
    const noOrg = await token({ org_id: undefined });

    const one = workos(["org_acme"]);
    const ok = await handleClientRequest(await rpc("tools/list", {}, noOrg), deps({ config: config({ workosApiKey: "sk" }), workosFetch: one }));
    expect(ok.status).toBe(200);
    expect(String(one.mock.calls[0][0])).toContain("organization_memberships?user_id=user_ada");
    expect(bindCalls[0].workosOrgId).toBe("org_acme");

    const two = await handleClientRequest(
      await rpc("tools/list", {}, noOrg),
      deps({ config: config({ workosApiKey: "sk" }), workosFetch: workos(["org_acme", "org_globex"]) }),
    );
    expect(two.status).toBe(403);
    expect((await two.json()).error_description).toMatch(/more than one company/);
  });

  test("a first sign-in without an email on the token asks WorkOS for the verified one", async () => {
    let calls = 0;
    const realBind = async (who: ClientIdentity): Promise<BindClientResult> => {
      bindCalls.push(who);
      calls += 1;
      return who.email ? bound : { status: "forbidden", reason: "email_unverified" };
    };
    const workosFetch = vi.fn(async () => Response.json({ email: "ada@acme.test", email_verified: true }));
    const res = await handleClientRequest(
      await rpc("tools/list"),
      deps({ bind: realBind, config: config({ workosApiKey: "sk" }), workosFetch }),
    );
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    expect(bindCalls[1]).toMatchObject({ email: "ada@acme.test", emailVerified: true });
  });

  test("someone never invited gets a 403 that says so", async () => {
    bound = { status: "forbidden", reason: "not_invited" };
    const res = await handleClientRequest(await rpc("tools/list"), deps());
    expect(res.status).toBe(403);
    expect((await res.json()).error_description).toMatch(/not been invited/);
  });

  test("the database resolving the token to anyone but the bound actor is a refusal", async () => {
    fakeDb.actorId = "99999999-9999-4999-8999-999999999999";
    const res = await handleClientRequest(await rpc("tools/list"), deps());
    expect(res.status).toBe(403);
    expect((await res.json()).error_description).toMatch(/could not open your workspace/);
  });
});

describe("whoami", () => {
  test("is the only tool, read-only", async () => {
    const { tools } = await result(await handleClientRequest(await rpc("tools/list"), deps()));
    expect(tools.map((t: { name: string }) => t.name)).toEqual(["whoami"]);
    expect(tools[0].annotations).toMatchObject({ readOnlyHint: true });
  });

  test("answers with the company, the member and the jobs their token can read, and is audited", async () => {
    fakeDb.level = "elevated";
    const out = await result(await handleClientRequest(await rpc("tools/call", { name: "whoami", arguments: {} }), deps()));
    expect(out.structuredContent).toEqual({
      company: "Acme",
      you: { user_id: ACTOR, name: "Ada Admin", email: "ada@acme.test", access: "hiring team" },
      jobs: [{ job_id: "role-1", title: "Founding Engineer", status: "open" }],
    });
    expect(audits).toEqual([{ tool: "whoami", ok: true, actorId: ACTOR }]);
  });
});
