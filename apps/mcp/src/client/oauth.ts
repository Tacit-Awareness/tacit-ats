import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * The client connector is an OAuth resource server. WorkOS AuthKit (the
 * environment holding the client organizations) is the authorization server:
 * it runs the sign-in, registers clients dynamically and issues the access
 * tokens this file verifies. Nothing here issues or stores a token. Forked
 * from tacit-internal's apps/mcp/src/connector/auth.ts (the staff
 * connector), keeping only what a resource server needs.
 */

export type ResourceServer = {
  /** WorkOS AuthKit's (the default) or Supabase Auth's OAuth server (config.ts). */
  provider?: "workos" | "supabase";
  /** The token issuer: the AuthKit domain, or `<SUPABASE_URL>/auth/v1`. */
  issuer: string;
  /** This server's public URL, e.g. https://ats-mcp.tacitawareness.com/api/client: the token audience. */
  resource: string;
};

/** RFC 9728: the well-known segment goes between the host and the resource's path. */
export function resourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${url.origin}/.well-known/oauth-protected-resource${path}`;
}

export function resourceMetadata(config: ResourceServer) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
  };
}

/**
 * The 401 that starts a client's OAuth flow: the header points it at the
 * resource metadata, which names the authorization server.
 */
export function challenge(config: Pick<ResourceServer, "resource">, error?: { code: string; description: string }): Response {
  const params = [
    ...(error ? [`error="${error.code}"`, `error_description="${error.description}"`] : []),
    `resource_metadata="${resourceMetadataUrl(config.resource)}"`,
  ];
  return new Response(null, { status: 401, headers: { "www-authenticate": `Bearer ${params.join(", ")}` } });
}

export type AccessClaims = {
  subject: string;
  email: string | null;
  /**
   * The company the sign-in was for: WorkOS's organization when AuthKit put
   * one in the token, or with Supabase our own orgs.id, from the access token
   * hook (supabase/migrations/20261113000000_connector_oauth.sql).
   */
  orgId: string | null;
  /** Supabase only: the token as issued, which the database takes as it is, and its claims for direct Postgres. */
  supabase?: { token: string; claims: { role: "authenticated"; aud: string | string[]; iss: string; sub: string; org_id?: string } };
};

const jwksByIssuer = new Map<string, JWTVerifyGetKey>();

function remoteJwks(issuer: string, provider: ResourceServer["provider"] = "workos"): JWTVerifyGetKey {
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    // AuthKit publishes its keys at /oauth2/jwks, Supabase Auth at /.well-known/jwks.json.
    jwks = createRemoteJWKSet(new URL(provider === "supabase" ? `${issuer}/.well-known/jwks.json` : `${issuer}/oauth2/jwks`));
    jwksByIssuer.set(issuer, jwks);
  }
  return jwks;
}

/**
 * Signature (against the issuer's JWKS), issuer, audience and expiry. Throws
 * on any failure. `keys` is injectable so tests verify against a local key.
 */
export async function verifyAccessToken(
  token: string,
  config: ResourceServer,
  keys: JWTVerifyGetKey = remoteJwks(config.issuer, config.provider),
): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, keys, {
    issuer: config.issuer,
    // With Supabase this is what binds a token to this connector: the access
    // token hook sets aud to ["authenticated", <resource>] only for a session
    // whose consent asked for this resource. A portal sign-in, or another
    // connector's token, carries just "authenticated" and fails here.
    audience: config.resource,
    requiredClaims: ["sub", "exp"],
  });
  if (config.provider === "supabase") {
    // An OAuth token, not a website session: only OAuth tokens carry a client_id.
    if (typeof payload.client_id !== "string" || !payload.client_id) throw new Error("not an OAuth access token");
    if (payload.role !== "authenticated") throw new Error("not a member's token");
    const orgId = typeof payload.org_id === "string" && payload.org_id ? payload.org_id : null;
    return {
      subject: payload.sub as string,
      // Not trusted for binding: client/bind.ts reads the verified address from Supabase Auth itself.
      email: null,
      orgId,
      supabase: {
        token,
        claims: { role: "authenticated", aud: payload.aud as string | string[], iss: payload.iss as string, sub: payload.sub as string, ...(orgId ? { org_id: orgId } : {}) },
      },
    };
  }
  // An email claim is only present when the AuthKit JWT template adds it.
  const email = typeof payload.email === "string" && payload.email_verified !== false ? payload.email : null;
  const orgId = typeof payload.org_id === "string" && payload.org_id ? payload.org_id : null;
  return { subject: payload.sub as string, email, orgId };
}

/** A WorkOS user's email, only if WorkOS has verified it. */
export async function fetchVerifiedEmail(
  subject: string,
  apiKey: string,
  doFetch: typeof fetch = fetch,
): Promise<string | null> {
  const res = await doFetch(`https://api.workos.com/user_management/users/${encodeURIComponent(subject)}`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  const user = (await res.json().catch(() => null)) as { email?: unknown; email_verified?: unknown } | null;
  return typeof user?.email === "string" && user.email_verified === true ? user.email : null;
}
