import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * The client connector is an OAuth resource server. Supabase Auth's OAuth 2.1
 * server on this project (tacit-ats) is the authorization server: it registers
 * clients dynamically, sends the member to apps/web's consent page, and issues
 * the access tokens this file verifies. Nothing here issues or stores a token.
 */

export type ResourceServer = {
  /** The token issuer: `<SUPABASE_URL>/auth/v1`. */
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
  /** The Supabase Auth user. */
  subject: string;
  /**
   * The company the sign-in was for (orgs.id), from the access token hook
   * (supabase/migrations/20261113000000_connector_oauth.sql); null when the
   * session has none.
   */
  orgId: string | null;
  /** The token as issued: the database takes it as it is. */
  token: string;
  /** Its claims, for the direct Postgres transactions (@tacit-ats/member-db). */
  dbClaims: { role: "authenticated"; aud: string | string[]; iss: string; sub: string; org_id?: string };
};

const jwksByIssuer = new Map<string, JWTVerifyGetKey>();

function remoteJwks(issuer: string): JWTVerifyGetKey {
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    jwksByIssuer.set(issuer, jwks);
  }
  return jwks;
}

/**
 * Signature (against the project's JWKS), issuer, audience, expiry, an OAuth
 * client and the member role. Throws on any failure. `keys` is injectable so
 * tests verify against a local key.
 */
export async function verifyAccessToken(
  token: string,
  config: ResourceServer,
  keys: JWTVerifyGetKey = remoteJwks(config.issuer),
): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, keys, {
    issuer: config.issuer,
    // What binds a token to this connector: the access token hook sets aud to
    // ["authenticated", <resource>] only for a session whose consent asked for
    // this resource. A website sign-in, or another connector's token, carries
    // just "authenticated" and fails here.
    audience: config.resource,
    requiredClaims: ["sub", "exp"],
  });
  // An OAuth token, not a website session: only OAuth tokens carry a client_id.
  if (typeof payload.client_id !== "string" || !payload.client_id) throw new Error("not an OAuth access token");
  if (payload.role !== "authenticated") throw new Error("not a member's token");
  const orgId = typeof payload.org_id === "string" && payload.org_id ? payload.org_id : null;
  const sub = payload.sub as string;
  return {
    subject: sub,
    orgId,
    token,
    dbClaims: { role: "authenticated", aud: payload.aud as string | string[], iss: payload.iss as string, sub, ...(orgId ? { org_id: orgId } : {}) },
  };
}
