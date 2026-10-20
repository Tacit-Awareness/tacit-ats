import { describe, expect, test } from "vitest";

import {
  GRANOLA_RESOURCE, GranolaConnectError, exchangeGranolaCode, granolaRedirectUri, granolaSignInUrl, packPending, pkce,
  registerGranolaClient, unpackPending,
} from "./granola";

const idToken = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const pending = { actorId: "a1", state: "st4te", clientId: "client_01ABC", verifier: "v3rifier" };

function granola(status: number, json: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Response.json(json, { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("registerGranolaClient", () => {
  test("registers a public client for the callback and returns its id", async () => {
    const { calls, fetchImpl } = granola(201, { client_id: "client_01ABC" });
    expect(await registerGranolaClient(granolaRedirectUri("https://ats.test"), fetchImpl)).toBe("client_01ABC");
    expect(calls[0]!.url).toBe("https://mcp-auth.granola.ai/oauth2/register");
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body).toMatchObject({
      redirect_uris: ["https://ats.test/client/integrations/granola/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
    });
  });

  test("a refusal is register_failed", async () => {
    await expect(registerGranolaClient("https://ats.test/cb", granola(400, { error: "invalid_redirect_uri" }).fetchImpl)).rejects.toEqual(
      new GranolaConnectError("register_failed"),
    );
  });
});

describe("granolaSignInUrl", () => {
  test("asks for a refresh token for Granola's MCP server, with PKCE and the state", () => {
    const url = new URL(granolaSignInUrl("client_01ABC", "https://ats.test/cb", "st4te", "ch4llenge", "me@co.test"));
    expect(url.origin + url.pathname).toBe("https://mcp-auth.granola.ai/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "client_01ABC",
      redirect_uri: "https://ats.test/cb",
      scope: "openid email profile offline_access",
      state: "st4te",
      code_challenge: "ch4llenge",
      code_challenge_method: "S256",
      resource: GRANOLA_RESOURCE,
      login_hint: "me@co.test",
    });
  });
});

describe("pkce", () => {
  test("the challenge is the verifier's S256", async () => {
    const { verifier, challenge } = await pkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    expect(challenge).toBe(Buffer.from(digest).toString("base64url"));
  });
});

describe("the connect cookie", () => {
  test("round-trips, and anything malformed is null", () => {
    expect(unpackPending(packPending(pending))).toEqual(pending);
    expect(unpackPending(undefined)).toBeNull();
    expect(unpackPending("a.b.c")).toBeNull();
    expect(unpackPending("a..c.d")).toBeNull();
  });
});

describe("exchangeGranolaCode", () => {
  test("sends the code with the verifier and reads the grant", async () => {
    const { calls, fetchImpl } = granola(200, {
      access_token: "at", refresh_token: "rt", expires_in: 3600, id_token: idToken({ email: " Ann@Co.test " }),
    });
    const grant = await exchangeGranolaCode(pending, "https://ats.test/cb", "c0de", fetchImpl, () => Date.UTC(2026, 9, 19));
    expect(grant).toEqual({
      refreshToken: "rt", accessToken: "at", accessTokenExpiresAt: "2026-10-19T01:00:00.000Z", accountEmail: "ann@co.test",
    });
    expect(calls[0]!.url).toBe("https://mcp-auth.granola.ai/oauth2/token");
    expect(Object.fromEntries(calls[0]!.init!.body as URLSearchParams)).toEqual({
      grant_type: "authorization_code", code: "c0de", redirect_uri: "https://ats.test/cb", client_id: "client_01ABC",
      code_verifier: "v3rifier", resource: GRANOLA_RESOURCE,
    });
  });

  test("no email or expiry is still a grant", async () => {
    const grant = await exchangeGranolaCode(pending, "https://ats.test/cb", "c0de", granola(200, { refresh_token: "rt" }).fetchImpl);
    expect(grant).toEqual({ refreshToken: "rt", accessToken: null, accessTokenExpiresAt: null, accountEmail: null });
  });

  test("no refresh token, or a refusal, is refused", async () => {
    await expect(exchangeGranolaCode(pending, "x", "c", granola(200, { access_token: "at" }).fetchImpl)).rejects.toEqual(
      new GranolaConnectError("no_refresh_token"),
    );
    await expect(exchangeGranolaCode(pending, "x", "c", granola(400, { error: "invalid_grant" }).fetchImpl)).rejects.toEqual(
      new GranolaConnectError("exchange_failed"),
    );
  });
});
