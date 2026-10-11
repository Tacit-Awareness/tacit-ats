import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * The connector is an OAuth resource server. WorkOS AuthKit is the
 * authorization server: it runs the sign-in, registers clients dynamically
 * and issues the access tokens this file verifies. Nothing here issues or
 * stores a token.
 */

export type ConnectorConfig = {
  /** The AuthKit domain, e.g. https://tacit.authkit.app: the token issuer. */
  issuer: string;
  /** This server's public URL, e.g. https://mcp.tacitawareness.com/api/connector: the token audience. */
  resource: string;
  /** Only addresses on this domain may sign in. */
  emailDomain: string;
  /** Looks up a user's verified email on first sign-in, when the token carries none. */
  workosApiKey: string | null;
  resendApiKey: string | null;
  /** Tacit Testbench's origin, for reading assessment results. Null = those tools refuse. */
  testbenchUrl: string | null;
  /** For find_adjacent's two model calls. Null = that tool refuses. */
  anthropicApiKey: string | null;
  /** The internal app's origin, for the link on a nudge. Null = nudges carry no link. */
  internalOrigin: string | null;
  /** Reviews an offer, rejection or intro when the client has no owner, or its owner wrote it. */
  fallbackReviewerEmail: string | null;
  /** The Google OAuth client apps/internal's /connect grants are made to. Null = the scheduling tools refuse. */
  googleOauth: { clientId: string; clientSecret: string } | null;
};

export const DEFAULT_EMAIL_DOMAIN = "tacitawareness.com";

const trimSlash = (s: string) => s.replace(/\/+$/, "");

/** Null when the connector is not configured on this deployment. */
export function connectorConfig(env: Record<string, string | undefined> = process.env): ConnectorConfig | null {
  const issuer = env.WORKOS_AUTHKIT_DOMAIN?.trim();
  const resource = env.CONNECTOR_RESOURCE_URL?.trim();
  if (!issuer || !resource) return null;
  return {
    issuer: trimSlash(issuer.startsWith("http") ? issuer : `https://${issuer}`),
    resource: trimSlash(resource),
    emailDomain: env.TACIT_EMAIL_DOMAIN?.trim() || DEFAULT_EMAIL_DOMAIN,
    workosApiKey: env.WORKOS_API_KEY?.trim() || null,
    resendApiKey: env.RESEND_API_KEY?.trim() || null,
    testbenchUrl: env.TESTBENCH_URL?.trim() ? trimSlash(env.TESTBENCH_URL.trim()) : null,
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    internalOrigin: env.INTERNAL_ORIGIN?.trim() ? trimSlash(env.INTERNAL_ORIGIN.trim()) : null,
    fallbackReviewerEmail: env.REVIEW_FALLBACK_EMAIL?.trim().toLowerCase() || null,
    googleOauth: env.GOOGLE_OAUTH_CLIENT_ID?.trim() && env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
      ? { clientId: env.GOOGLE_OAUTH_CLIENT_ID.trim(), clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET.trim() }
      : null,
  };
}

/** RFC 9728: the well-known segment goes between the host and the resource's path. */
export function resourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${url.origin}/.well-known/oauth-protected-resource${path}`;
}

export function resourceMetadata(config: ConnectorConfig) {
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
export function challenge(config: ConnectorConfig, error?: { code: string; description: string }): Response {
  const params = [
    ...(error ? [`error="${error.code}"`, `error_description="${error.description}"`] : []),
    `resource_metadata="${resourceMetadataUrl(config.resource)}"`,
  ];
  return new Response(null, { status: 401, headers: { "www-authenticate": `Bearer ${params.join(", ")}` } });
}

export type AccessClaims = { subject: string; email: string | null };

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
  config: Pick<ConnectorConfig, "issuer" | "resource">,
  keys: JWTVerifyGetKey = remoteJwks(config.issuer),
): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, keys, {
    issuer: config.issuer,
    audience: config.resource,
    requiredClaims: ["sub", "exp"],
  });
  // An email claim is only present when the AuthKit JWT template adds it.
  const email = typeof payload.email === "string" && payload.email_verified !== false ? payload.email : null;
  return { subject: payload.sub as string, email };
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
