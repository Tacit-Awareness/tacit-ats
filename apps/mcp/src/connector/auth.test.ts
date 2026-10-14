import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, test, vi } from "vitest";

import {
  challenge, connectorConfig, fetchVerifiedEmail, resourceMetadata, resourceMetadataUrl, verifyAccessToken,
} from "./auth.js";

const env = {
  WORKOS_AUTHKIT_DOMAIN: "tacit.authkit.app/",
  CONNECTOR_RESOURCE_URL: "https://mcp.tacitawareness.com/api/connector/",
};
const config = connectorConfig(env)!;

describe("config and metadata", () => {
  test("normalizes the issuer and resource, and is null until both are set", () => {
    expect(config).toMatchObject({
      issuer: "https://tacit.authkit.app",
      resource: "https://mcp.tacitawareness.com/api/connector",
      emailDomain: "tacitawareness.com",
      workosApiKey: null,
      resendApiKey: null,
    });
    expect(connectorConfig({ WORKOS_AUTHKIT_DOMAIN: "x.authkit.app" })).toBeNull();
    expect(connectorConfig({})).toBeNull();
  });

  test("the metadata names WorkOS as the authorization server, and the challenge points at it", () => {
    expect(resourceMetadata(config)).toEqual({
      resource: "https://mcp.tacitawareness.com/api/connector",
      authorization_servers: ["https://tacit.authkit.app"],
      bearer_methods_supported: ["header"],
    });
    expect(resourceMetadataUrl(config.resource)).toBe(
      "https://mcp.tacitawareness.com/.well-known/oauth-protected-resource/api/connector",
    );
    const res = challenge(config, { code: "invalid_token", description: "expired" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer error="invalid_token", error_description="expired", ' +
        'resource_metadata="https://mcp.tacitawareness.com/.well-known/oauth-protected-resource/api/connector"',
    );
  });
});

describe("verifyAccessToken", () => {
  let keys: ReturnType<typeof createLocalJWKSet>;
  let sign: (claims: Record<string, unknown>, opts?: { issuer?: string; audience?: string; exp?: string }) => Promise<string>;
  let signWithOtherKey: () => Promise<string>;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const other = await generateKeyPair("RS256");
    keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" }] });
    const build = (claims: Record<string, unknown>, opts: { issuer?: string; audience?: string; exp?: string } = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(opts.issuer ?? config.issuer)
        .setAudience(opts.audience ?? config.resource)
        .setExpirationTime(opts.exp ?? "5m");
    sign = (claims, opts) => build(claims, opts).sign(privateKey);
    signWithOtherKey = () => build({ sub: "user_1" }).sign(other.privateKey);
  });

  test("accepts a token signed by the issuer for this server", async () => {
    expect(await verifyAccessToken(await sign({ sub: "user_1" }), config, keys)).toEqual({ subject: "user_1", email: null, orgId: null });
    expect(await verifyAccessToken(await sign({ sub: "user_1", email: "a@b.co" }), config, keys)).toEqual({
      subject: "user_1", email: "a@b.co", orgId: null,
    });
    // The organization the sign-in was for, when AuthKit puts one in the token.
    expect((await verifyAccessToken(await sign({ sub: "user_1", org_id: "org_1" }), config, keys)).orgId).toBe("org_1");
    // An email the provider says is unverified is not an email.
    expect(
      (await verifyAccessToken(await sign({ sub: "user_1", email: "a@b.co", email_verified: false }), config, keys)).email,
    ).toBeNull();
  });

  test("rejects a wrong audience, wrong issuer, expired token, wrong key, missing sub, and garbage", async () => {
    await expect(verifyAccessToken(await sign({ sub: "u" }, { audience: "https://other.example" }), config, keys)).rejects.toThrow();
    await expect(verifyAccessToken(await sign({ sub: "u" }, { issuer: "https://evil.example" }), config, keys)).rejects.toThrow();
    await expect(verifyAccessToken(await sign({ sub: "u" }, { exp: "-1m" }), config, keys)).rejects.toThrow();
    await expect(verifyAccessToken(await signWithOtherKey(), config, keys)).rejects.toThrow();
    await expect(verifyAccessToken(await sign({}), config, keys)).rejects.toThrow();
    await expect(verifyAccessToken("tk_abc123_ssshhh", config, keys)).rejects.toThrow();
  });
});

describe("fetchVerifiedEmail", () => {
  const respond = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  test("returns the email only when WorkOS has verified it", async () => {
    const ok = respond(200, { email: "ryan@tacitawareness.com", email_verified: true });
    expect(await fetchVerifiedEmail("user_1", "sk_test", ok as never)).toBe("ryan@tacitawareness.com");
    expect(ok).toHaveBeenCalledWith("https://api.workos.com/user_management/users/user_1", {
      headers: { authorization: "Bearer sk_test" },
    });
    expect(await fetchVerifiedEmail("u", "k", respond(200, { email: "a@b.co", email_verified: false }) as never)).toBeNull();
    expect(await fetchVerifiedEmail("u", "k", respond(404, {}) as never)).toBeNull();
  });
});
