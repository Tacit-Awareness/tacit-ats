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
  /** The AuthKit domain: the token issuer. */
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
  /** The WorkOS organization the sign-in was for, when AuthKit put one in the token. */
  orgId: string | null;
};

const jwksByIssuer = new Map<string, JWTVerifyGetKey>();

function remoteJwks(issuer: string): JWTVerifyGetKey {
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/oauth2/jwks`));
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
  keys: JWTVerifyGetKey = remoteJwks(config.issuer),
): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, keys, {
    issuer: config.issuer,
    audience: config.resource,
    requiredClaims: ["sub", "exp"],
  });
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
