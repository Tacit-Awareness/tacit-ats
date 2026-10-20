// Connecting a member's Granola (/client/integrations): one button, Granola's
// own sign-in page, back again. Granola's MCP server (mcp.granola.ai) signs
// people in with OAuth 2.1 and takes any client that registers itself
// (dynamic client registration), so there is no client id or secret to set
// up: /connect registers a public client for this connection, sends the
// member to Granola with PKCE, and /callback trades the code for the grant.
// The grant goes straight into the database through client_connect_granola
// on the member's own token (granola_connections, tacit-internal migration
// 20261019200000), which no member token can read back; the client
// connector (apps/mcp) reads the member's notes with it.
//
// Pure apart from the fetch it is given, so the unit tests can drive it.

export const GRANOLA_CALLBACK_PATH = "/client/integrations/granola/callback";
/** The connect cookie: set by /connect, checked and cleared by /callback. */
export const GRANOLA_STATE_COOKIE = "tacit_granola_state";

const AUTH = "https://mcp-auth.granola.ai/oauth2";
/** The resource the grant is for (RFC 8707): Granola's MCP server, where the connector reads notes. */
export const GRANOLA_RESOURCE = "https://mcp.granola.ai/mcp";
/** Who the member is (the page's "connected as") and a refresh token. */
const SCOPES = "openid email profile offline_access";

export const granolaRedirectUri = (origin: string) => `${origin}${GRANOLA_CALLBACK_PATH}`;

export type GranolaConnectErrorCode = "register_failed" | "exchange_failed" | "no_refresh_token";

export class GranolaConnectError extends Error {
  constructor(readonly code: GranolaConnectErrorCode) {
    super(`granola connect: ${code}`);
    this.name = "GranolaConnectError";
  }
}

const random = (bytes: number) => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");

/** PKCE: the verifier stays in the connect cookie, the S256 challenge goes to Granola. */
export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = random(48);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: Buffer.from(digest).toString("base64url") };
}

export const newState = () => random(24);

/** Registers a public client for this connection; Granola answers with its id. */
export async function registerGranolaClient(redirectUri: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(`${AUTH}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Tacit",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: SCOPES,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GranolaConnectError("register_failed");
  }
  const json = (await res.json().catch(() => null)) as { client_id?: unknown } | null;
  if (!res.ok || typeof json?.client_id !== "string" || !json.client_id) throw new GranolaConnectError("register_failed");
  return json.client_id;
}

export function granolaSignInUrl(clientId: string, redirectUri: string, state: string, challenge: string, loginHint?: string): string {
  const url = new URL(`${AUTH}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", GRANOLA_RESOURCE);
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url.toString();
}

/** What /connect leaves in the cookie for /callback: whose connection it is and how to finish it. */
export type GranolaPending = { actorId: string; state: string; clientId: string; verifier: string };

export const packPending = (p: GranolaPending) => [p.actorId, p.state, p.clientId, p.verifier].join(".");

export function unpackPending(raw: string | undefined): GranolaPending | null {
  const parts = raw?.split(".") ?? [];
  if (parts.length !== 4 || parts.some((p) => !p)) return null;
  const [actorId, state, clientId, verifier] = parts as [string, string, string, string];
  return { actorId, state, clientId, verifier };
}

export type GranolaGrant = {
  refreshToken: string;
  accessToken: string | null;
  /** ISO time the access token stops working; null when Granola didn't say. */
  accessTokenExpiresAt: string | null;
  accountEmail: string | null;
};

/** The id_token's email claim. It came straight from Granola's token endpoint over TLS, so it is not re-verified. */
function emailFrom(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: unknown };
    return typeof payload.email === "string" && payload.email.includes("@") ? payload.email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Trades the sign-in's code for the grant, refusing one without a refresh token (it would stop working within the hour). */
export async function exchangeGranolaCode(
  pending: GranolaPending,
  redirectUri: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<GranolaGrant> {
  let res: Response;
  try {
    res = await fetchImpl(`${AUTH}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: pending.clientId,
        code_verifier: pending.verifier, resource: GRANOLA_RESOURCE,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GranolaConnectError("exchange_failed");
  }
  const json = (await res.json().catch(() => null)) as
    | { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; id_token?: unknown }
    | null;
  if (!res.ok || !json) throw new GranolaConnectError("exchange_failed");
  if (typeof json.refresh_token !== "string" || !json.refresh_token) throw new GranolaConnectError("no_refresh_token");
  const accessToken = typeof json.access_token === "string" && json.access_token ? json.access_token : null;
  const expiresIn = typeof json.expires_in === "number" && json.expires_in > 0 ? json.expires_in : null;
  return {
    refreshToken: json.refresh_token,
    accessToken,
    accessTokenExpiresAt: accessToken && expiresIn ? new Date(now() + expiresIn * 1000).toISOString() : null,
    accountEmail: emailFrom(json.id_token),
  };
}
