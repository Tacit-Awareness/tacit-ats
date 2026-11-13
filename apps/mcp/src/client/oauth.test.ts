import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, test, vi } from "vitest";

import {
  challenge, fetchVerifiedEmail, resourceMetadata, resourceMetadataUrl, verifyAccessToken,
} from "./oauth";

const config = { issuer: "https://tacit.authkit.app", resource: "https://mcp.tacitawareness.com/api/connector" };

describe("metadata", () => {
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

describe("verifyAccessToken with Supabase Auth's OAuth server", () => {
  const supabase = {
    provider: "supabase" as const,
    issuer: "https://ref.supabase.co/auth/v1",
    resource: "https://ats-mcp.tacitawareness.com/api/client",
  };
  let keys: ReturnType<typeof createLocalJWKSet>;
  let sign: (claims: Record<string, unknown>) => Promise<string>;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "s1", alg: "ES256" }] });
    sign = (claims) =>
      new SignJWT({ role: "authenticated", ...claims })
        .setProtectedHeader({ alg: "ES256", kid: "s1" })
        .setIssuer(supabase.issuer)
        .setSubject("5a000000-0000-4000-8000-000000000001")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);
  });

  const forThisConnector = { aud: ["authenticated", "https://ats-mcp.tacitawareness.com/api/client"], client_id: "c1", org_id: "a0000000-0000-4000-8000-00000000000a" };

  test("a token the hook bound to this connector passes, as it was issued", async () => {
    const token = await sign(forThisConnector);
    const claims = await verifyAccessToken(token, supabase, keys);
    expect(claims.subject).toBe("5a000000-0000-4000-8000-000000000001");
    expect(claims.orgId).toBe("a0000000-0000-4000-8000-00000000000a");
    expect(claims.email).toBeNull();
    expect(claims.supabase?.token).toBe(token);
    expect(claims.supabase?.claims).toEqual({
      role: "authenticated",
      aud: ["authenticated", "https://ats-mcp.tacitawareness.com/api/client"],
      iss: supabase.issuer,
      sub: "5a000000-0000-4000-8000-000000000001",
      org_id: "a0000000-0000-4000-8000-00000000000a",
    });
  });

  test("no company on the token: passes, with no org_id in the claims (the member check refuses it)", async () => {
    const claims = await verifyAccessToken(await sign({ ...forThisConnector, org_id: undefined }), supabase, keys);
    expect(claims.orgId).toBeNull();
    expect(claims.supabase?.claims).not.toHaveProperty("org_id");
  });

  test("a website session token (aud authenticated, no client_id) is refused", async () => {
    await expect(verifyAccessToken(await sign({ aud: "authenticated" }), supabase, keys)).rejects.toThrow();
  });

  test("an OAuth token whose session was never bound (aud authenticated) is refused", async () => {
    await expect(verifyAccessToken(await sign({ aud: "authenticated", client_id: "c1" }), supabase, keys)).rejects.toThrow();
  });

  test("another connector's token is refused", async () => {
    const other = { ...forThisConnector, aud: ["authenticated", "https://testbench.tacitawareness.com/api/v1/mcp"] };
    await expect(verifyAccessToken(await sign(other), supabase, keys)).rejects.toThrow();
  });

  test("a token bound here but with no client_id is refused", async () => {
    await expect(verifyAccessToken(await sign({ ...forThisConnector, client_id: undefined }), supabase, keys)).rejects.toThrow(/OAuth/);
  });

  test("a token for another role is refused", async () => {
    await expect(verifyAccessToken(await sign({ ...forThisConnector, role: "service_role" }), supabase, keys)).rejects.toThrow();
  });

  test("the metadata names Supabase Auth as the authorization server", () => {
    expect(resourceMetadata(supabase).authorization_servers).toEqual(["https://ref.supabase.co/auth/v1"]);
  });
});
