import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

import type { Session, Store, Tokens } from "./store.js";

/**
 * Sign-in, the same way Claude signs in to the connector: the server's
 * protected resource metadata names Supabase Auth (on tacit-ats) as its authorization
 * server, tats registers itself there as a public client (dynamic client
 * registration), and the member signs in in their browser, which hands an
 * authorization code back to a loopback listener (PKCE, RFC 8252). The
 * resulting access token has the connector as its audience, so the server
 * verifies it exactly as it verifies Claude's.
 */

export class AuthRequired extends Error {}

export type AuthDeps = {
  fetch: typeof fetch;
  store: Store;
  now: () => number;
};

export type LoginDeps = AuthDeps & {
  /** Opens the URL in the member's browser; false when it could not. */
  openBrowser: (url: string) => Promise<boolean>;
  log: (line: string) => void;
  /** The loopback port the redirect URI names. */
  port: number;
  /** How long to wait for the browser, in milliseconds. */
  timeoutMs?: number;
};

type ServerMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
};

/** RFC 9728: the well-known segment goes between the host and the resource's path. */
export function resourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${url.origin}/.well-known/oauth-protected-resource${path}`;
}

async function getJson<T>(doFetch: typeof fetch, url: string): Promise<T | null> {
  const res = await doFetch(url, { headers: { accept: "application/json" } }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

async function discover(doFetch: typeof fetch, server: string): Promise<{ resource: string; as: ServerMetadata }> {
  const prm =
    (await getJson<{ resource?: string; authorization_servers?: string[] }>(doFetch, resourceMetadataUrl(server))) ??
    (await getJson<{ resource?: string; authorization_servers?: string[] }>(doFetch, `${new URL(server).origin}/.well-known/oauth-protected-resource`));
  const issuer = prm?.authorization_servers?.[0];
  if (!issuer) throw new Error(`${server} does not say where to sign in. Is the URL right?`);
  const base = issuer.replace(/\/+$/, "");
  const as =
    (await getJson<ServerMetadata>(doFetch, `${base}/.well-known/oauth-authorization-server`)) ??
    (await getJson<ServerMetadata>(doFetch, `${base}/.well-known/openid-configuration`));
  if (!as?.authorization_endpoint || !as.token_endpoint) throw new Error(`Could not read the sign-in server's settings at ${issuer}.`);
  return { resource: prm?.resource ?? server, as: { ...as, issuer: as.issuer ?? issuer } };
}

async function register(doFetch: typeof fetch, as: ServerMetadata, redirectUri: string): Promise<string> {
  if (!as.registration_endpoint) throw new Error("The sign-in server does not accept new clients (no dynamic client registration).");
  const res = await doFetch(as.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: "tats (Tacit CLI)",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const body = (await res.json().catch(() => null)) as { client_id?: string } | null;
  if (!res.ok || !body?.client_id) throw new Error(`Registering tats with the sign-in server failed (${res.status}).`);
  return body.client_id;
}

const base64url = (buf: Buffer) => buf.toString("base64url");

/** Only the scopes that buy an id and a refresh token, and only those the server lists. */
function scopes(as: ServerMetadata): string | null {
  const wanted = ["openid", "profile", "email", "offline_access"];
  const listed = as.scopes_supported?.filter((s) => wanted.includes(s)) ?? [];
  return listed.length ? listed.join(" ") : null;
}

function tokensFrom(body: Record<string, unknown>, now: number, previous?: Tokens): Tokens {
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : null;
  return {
    access_token: String(body.access_token),
    // A refresh that does not rotate keeps the one it was given.
    refresh_token: typeof body.refresh_token === "string" ? body.refresh_token : previous?.refresh_token,
    expires_at: expiresIn !== null ? now + expiresIn * 1000 : jwtExpiry(String(body.access_token)),
  };
}

function jwtExpiry(token: string): number | undefined {
  try {
    const exp = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()).exp;
    return typeof exp === "number" ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

async function tokenRequest(doFetch: typeof fetch, endpoint: string, form: Record<string, string>) {
  const res = await doFetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return res.ok && body && typeof body.access_token === "string" ? body : null;
}

const PAGE = (title: string, line: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:16px system-ui;margin:4em auto;max-width:32em"><h1>${title}</h1><p>${line}</p></body>`;

/** Waits for the browser's redirect to http://localhost:<port>/callback and answers it. */
function awaitCallback(port: number, state: string, timeoutMs: number): { ready: Promise<void>; code: Promise<string>; close: () => void } {
  const servers: Server[] = [];
  let settle!: { resolve: (code: string) => void; reject: (err: Error) => void };
  const code = new Promise<string>((resolve, reject) => (settle = { resolve, reject }));
  const handler = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get("error");
    const got = url.searchParams.get("code");
    const ok = !error && got && url.searchParams.get("state") === state;
    res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8", connection: "close" });
    res.end(ok ? PAGE("Signed in to Tacit", "You can close this tab and go back to the terminal.") : PAGE("Sign-in failed", "Go back to the terminal and run tats login again."));
    if (ok) settle.resolve(got);
    else settle.reject(new Error(error ? `Sign-in was refused: ${url.searchParams.get("error_description") ?? error}` : "The sign-in answer did not match this login."));
  };
  // localhost resolves to either family depending on the browser, so listen on both.
  const listen = (host: string) =>
    new Promise<void>((resolve, reject) => {
      const server = createServer(handler);
      server.once("error", reject);
      server.listen(port, host, () => {
        servers.push(server);
        resolve();
      });
    });
  const ready = Promise.allSettled([listen("127.0.0.1"), listen("::1")]).then((results) => {
    if (!servers.length) {
      const reason = (results[0] as PromiseRejectedResult).reason as NodeJS.ErrnoException;
      throw new Error(reason?.code === "EADDRINUSE" ? `Port ${port} is in use. Set TATS_CALLBACK_PORT to another port and try again.` : String(reason));
    }
  });
  const timer = setTimeout(() => settle.reject(new Error("Timed out waiting for the browser sign-in.")), timeoutMs);
  const close = () => {
    clearTimeout(timer);
    for (const s of servers) {
      s.close();
      s.closeAllConnections();
    }
  };
  return { ready, code, close };
}

/** The whole browser sign-in. Returns the saved session. */
export async function login(server: string, deps: LoginDeps): Promise<Session> {
  const { resource, as } = await discover(deps.fetch, server);
  const redirectUri = `http://localhost:${deps.port}/callback`;
  const known = await deps.store.registration(server);
  const clientId =
    known && known.issuer === as.issuer && known.redirect_uri === redirectUri ? known.client_id : await register(deps.fetch, as, redirectUri);

  const verifier = base64url(randomBytes(32));
  const state = base64url(randomBytes(16));
  const authorize = new URL(as.authorization_endpoint);
  const params: Record<string, string> = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: base64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    state,
    resource,
  };
  const scope = scopes(as);
  if (scope) params.scope = scope;
  for (const [k, v] of Object.entries(params)) authorize.searchParams.set(k, v);

  const callback = awaitCallback(deps.port, state, deps.timeoutMs ?? 5 * 60_000);
  try {
    await callback.ready;
    const opened = await deps.openBrowser(authorize.toString());
    deps.log(opened ? "Opened your browser to sign in to Tacit. If it did not open, visit:" : "Open this link to sign in to Tacit:");
    deps.log(authorize.toString());
    const code = await callback.code;
    const now = deps.now();
    const body = await tokenRequest(deps.fetch, as.token_endpoint, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    });
    if (!body) throw new Error("The sign-in server did not give tats a token. Try tats login again.");
    const session: Session = {
      issuer: as.issuer,
      resource,
      token_endpoint: as.token_endpoint,
      client_id: clientId,
      redirect_uri: redirectUri,
      tokens: tokensFrom(body, now),
    };
    await deps.store.saveSession(server, session);
    return session;
  } finally {
    callback.close();
  }
}

const SKEW_MS = 60_000;

/**
 * A usable access token: the stored one while it has a minute left, else a
 * refreshed one. `force` refreshes even then (the server refused it).
 * Throws AuthRequired when only a new login will do.
 */
export async function accessToken(server: string, deps: AuthDeps, force = false): Promise<string> {
  const session = await deps.store.session(server);
  if (!session) throw new AuthRequired("Not signed in. Run: tats login");
  const { tokens } = session;
  const fresh = tokens.expires_at === undefined || tokens.expires_at - SKEW_MS > deps.now();
  if (fresh && !force) return tokens.access_token;
  const refreshed = await refresh(server, session, deps);
  if (!refreshed) throw new AuthRequired("Your Tacit sign-in has expired. Run: tats login");
  return refreshed;
}

async function refresh(server: string, session: Session, deps: AuthDeps): Promise<string | null> {
  if (!session.tokens.refresh_token) return null;
  const now = deps.now();
  const body = await tokenRequest(deps.fetch, session.token_endpoint, {
    grant_type: "refresh_token",
    refresh_token: session.tokens.refresh_token,
    client_id: session.client_id,
    resource: session.resource,
  }).catch(() => null);
  if (!body) return null;
  const tokens = tokensFrom(body, now, session.tokens);
  await deps.store.saveSession(server, { ...session, tokens });
  return tokens.access_token;
}
