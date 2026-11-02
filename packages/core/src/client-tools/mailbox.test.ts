import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, test, vi } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import type { ClientToolCtx } from "./context.js";
import {
  GMAIL_READ_SCOPE, GMAIL_SEND_SCOPE, delegatedAccessToken, delegationFrom, keyDelegation, keylessDelegation, memberMailbox, parseServiceAccount,
} from "./mailbox.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA = { clientEmail: "tacit@proj.iam.gserviceaccount.com", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), clientId: "1234567890" };
const ctx = (accessLevel: ClientToolCtx["accessLevel"] = "admin"): ClientToolCtx => ({ actorId: "actor-1", orgId: "org-1", accessLevel, source: "dashboard" });

/** Google's token endpoint: answers the JWT grant and the refresh grant, and keeps what it was sent. */
function google() {
  const bodies: URLSearchParams[] = [];
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body));
    bodies.push(body);
    return new Response(JSON.stringify({ access_token: body.get("grant_type") === "refresh_token" ? "oauth-token" : "delegated-token" }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, bodies };
}

describe("parseServiceAccount", () => {
  test("reads a JSON key, and nothing else", () => {
    expect(parseServiceAccount(JSON.stringify({ client_email: "a@b", private_key: "k", client_id: "1" }))).toEqual({ clientEmail: "a@b", privateKey: "k", clientId: "1", tokenUri: undefined });
    for (const bad of [undefined, "", "not json", JSON.stringify({ client_email: "a@b" })]) expect(parseServiceAccount(bad)).toBeNull();
  });
});

describe("delegatedAccessToken", () => {
  test("signs a JWT as the service account for the member, with the scopes asked", async () => {
    const g = google();
    expect(await delegatedAccessToken(keyDelegation(SA), "ada@acme.test", [GMAIL_SEND_SCOPE], g.fetch, () => 1_700_000_000_000)).toBe("delegated-token");
    const body = g.bodies[0];
    expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [h, c, sig] = body.get("assertion")!.split(".");
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toEqual({
      iss: SA.clientEmail, sub: "ada@acme.test", scope: GMAIL_SEND_SCOPE, aud: "https://oauth2.googleapis.com/token", iat: 1_700_000_000, exp: 1_700_003_600,
    });
    expect(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  });

  test("a refusal throws", async () => {
    const fetch = (async () => new Response(JSON.stringify({ error: "unauthorized_client" }), { status: 401 })) as unknown as typeof globalThis.fetch;
    await expect(delegatedAccessToken(keyDelegation(SA), "ada@acme.test", [GMAIL_SEND_SCOPE], fetch)).rejects.toThrow(/unauthorized_client/);
  });
});

describe("keylessDelegation", () => {
  test("exchanges the deployment's OIDC token at STS, then has IAM sign the claims as the service account", async () => {
    const calls: Array<{ url: string; auth: string | null; body: string }> = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body: String(init?.body) });
      return String(url).startsWith("https://sts.")
        ? new Response(JSON.stringify({ access_token: "federated" }))
        : new Response(JSON.stringify({ signedJwt: "h.c.s" }));
    }) as unknown as typeof globalThis.fetch;
    const signer = keylessDelegation({
      clientEmail: "tacit@proj.iam.gserviceaccount.com", clientId: "1", subjectToken: async () => "vercel-oidc",
      workloadProvider: "//iam.googleapis.com/projects/9/locations/global/workloadIdentityPools/vercel/providers/vercel", fetch,
    });
    expect(await signer.sign({ sub: "ada@acme.test" })).toBe("h.c.s");
    expect(JSON.parse(calls[0].body)).toMatchObject({
      subject_token: "vercel-oidc", audience: "//iam.googleapis.com/projects/9/locations/global/workloadIdentityPools/vercel/providers/vercel",
    });
    expect(calls[1]).toMatchObject({
      url: "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/tacit%40proj.iam.gserviceaccount.com:signJwt",
      auth: "Bearer federated",
    });
    expect(JSON.parse(JSON.parse(calls[1].body).payload)).toEqual({ sub: "ada@acme.test" });
  });

  test("a refusal at either step throws", async () => {
    const refuse = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as unknown as typeof globalThis.fetch;
    const signer = keylessDelegation({ clientEmail: "a@b", clientId: "1", subjectToken: async () => "t", workloadProvider: "//x", fetch: refuse });
    await expect(signer.sign({})).rejects.toThrow(/sts exchange failed/);
  });
});

describe("delegationFrom", () => {
  const KEYLESS = {
    GCP_SERVICE_ACCOUNT_EMAIL: "tacit@p.iam.gserviceaccount.com", GCP_SERVICE_ACCOUNT_CLIENT_ID: "42", GCP_PROJECT_NUMBER: "9",
    GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel", GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel",
  };
  test("keyless when every Workload Identity value is set, else a key, else none", () => {
    expect(delegationFrom(KEYLESS, async () => "t")).toMatchObject({ clientEmail: KEYLESS.GCP_SERVICE_ACCOUNT_EMAIL, clientId: "42" });
    expect(delegationFrom({ ...KEYLESS, GCP_PROJECT_NUMBER: "" }, async () => "t")).toBeNull();
    expect(delegationFrom({ CLIENT_GOOGLE_SERVICE_ACCOUNT: JSON.stringify({ client_email: "k@b", private_key: "x", client_id: "7" }) }, async () => "t")).toMatchObject({ clientId: "7" });
  });
});

describe("memberMailbox", () => {
  const sources = (g = google(), refreshToken = vi.fn(async () => "rt")) => ({
    delegation: keyDelegation(SA), google: { clientId: "cid", clientSecret: "cs" }, refreshToken, fetch: g.fetch,
  });

  test("the company's Workspace covers a member at its domain, sending and reading, as them", async () => {
    const g = google();
    const fake = new FakeSupabase([{ data: { domain: "acme.test" } }, { data: { email: "Ada@Acme.test" } }, { data: null }]);
    const grant = await memberMailbox(fake.asDb(), ctx(), sources(g));
    expect(grant).toMatchObject({ accountEmail: "ada@acme.test", via: "workspace", scopes: `${GMAIL_SEND_SCOPE} ${GMAIL_READ_SCOPE}` });
    expect(await grant!.accessToken()).toBe("delegated-token");
    expect(JSON.parse(Buffer.from(g.bodies[0].get("assertion")!.split(".")[1], "base64url").toString()).sub).toBe("ada@acme.test");
  });

  test("a member who turned their sync off still sends, but is not read", async () => {
    const fake = new FakeSupabase([{ data: { domain: "acme.test" } }, { data: { email: "ada@acme.test" } }, { data: { actor_id: "actor-1" } }]);
    expect((await memberMailbox(fake.asDb(), ctx(), sources()))?.scopes).toBe(GMAIL_SEND_SCOPE);
  });

  test("an address at another domain falls back to their own connection", async () => {
    const g = google();
    const refreshToken = vi.fn(async () => "rt");
    const fake = new FakeSupabase([
      { data: { domain: "acme.test" } }, { data: { email: "ada@gmail.com" } }, { data: null },
      { data: { org_id: "org-1", actor_id: "actor-1", account_email: "ada@gmail.com", scopes: GMAIL_SEND_SCOPE } },
    ]);
    const grant = await memberMailbox(fake.asDb(), ctx(), sources(g, refreshToken));
    expect(grant).toMatchObject({ accountEmail: "ada@gmail.com", via: "oauth" });
    expect(await grant!.accessToken()).toBe("oauth-token");
    expect(refreshToken).toHaveBeenCalledWith("org-1", "actor-1");
  });

  test("an interviewer is never covered by the Workspace, and asks nothing of it", async () => {
    const fake = new FakeSupabase([{ data: null }]);
    expect(await memberMailbox(fake.asDb(), ctx("limited"), sources())).toBeNull();
    expect(fake.calls.map((c) => c.table)).toEqual(["mailbox_connections"]);
  });

  test("no Workspace and no connection that may send: none", async () => {
    const fake = new FakeSupabase([{ data: null }, { data: { email: "ada@acme.test" } }, { data: null }, { data: { org_id: "o", actor_id: "a", account_email: "x@y", scopes: "openid" } }]);
    expect(await memberMailbox(fake.asDb(), ctx(), sources())).toBeNull();
  });
});
