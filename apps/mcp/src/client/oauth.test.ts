import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, test, vi } from "vitest";

import {
  challenge, resourceMetadata, resourceMetadataUrl, verifyAccessToken,
} from "./oauth";

const config = { issuer: "https://ref.supabase.co/auth/v1", resource: "https://mcp.tacitawareness.com/api/connector" };

describe("metadata", () => {
  test("the metadata names the authorization server, and the challenge points at it", () => {
    expect(resourceMetadata(config)).toEqual({
      resource: "https://mcp.tacitawareness.com/api/connector",
      authorization_servers: ["https://ref.supabase.co/auth/v1"],
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

describe("verifyAccessToken with Supabase Auth's OAuth server", () => {
  const supabase = {
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
    expect(claims.token).toBe(token);
    expect(claims.dbClaims).toEqual({
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
    expect(claims.dbClaims).not.toHaveProperty("org_id");
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
