// The client area: where members of a client org sign in and work. Pure (no
// next/* imports) so proxy.ts and the unit tests can both use it.
//
// Everything a client can reach lives under one path prefix, in its own
// folders (app/client, lib/client). The proxy runs only under this prefix,
// and nothing under these folders may import a privileged database client
// (src/client-area.test.ts walks the imports).

export const CLIENT_PREFIX = "/client";
export const CLIENT_CALLBACK_PATH = "/client/callback";

export function isClientPath(pathname: string): boolean {
  return pathname === CLIENT_PREFIX || pathname.startsWith(`${CLIENT_PREFIX}/`);
}

type Env = Record<string, string | undefined>;

/**
 * Who signs members in: WorkOS AuthKit (the default, until the cutover) or
 * Supabase Auth on this project (`CLIENT_AUTH_PROVIDER=supabase`). One switch
 * for the whole client area; the plan is
 * https://claude.ai/artifact/DTK4YUVXtJhbCJRq52EEmb.
 */
export type ClientAuthProvider = "workos" | "supabase";

export function clientAuthProvider(env: Env = process.env): ClientAuthProvider {
  return env.CLIENT_AUTH_PROVIDER?.trim().toLowerCase() === "supabase" ? "supabase" : "workos";
}

/**
 * Client sign-in is off until every piece it needs is configured: the two a
 * per-user database client is built from, and, for WorkOS, its three values.
 * Off means the whole client area answers 404, which is how this ships dormant.
 */
export function clientSignInConfigured(env: Env = process.env): boolean {
  const database = Boolean(env.SUPABASE_URL?.trim() && env.SUPABASE_PUBLISHABLE_KEY?.trim());
  if (clientAuthProvider(env) === "supabase") return database;
  return Boolean(
    env.WORKOS_CLIENT_ID?.trim() &&
      env.WORKOS_API_KEY?.trim() &&
      // AuthKit seals the session cookie with it and refuses anything shorter.
      (env.WORKOS_COOKIE_PASSWORD?.length ?? 0) >= 32 &&
      database,
  );
}

// Supabase Auth's own pages, outside the client layout (app/(client-auth)).
export const CLIENT_SIGN_IN_PATH = "/client/sign-in";
export const CLIENT_FORGOT_PASSWORD_PATH = "/client/forgot-password";
export const CLIENT_SET_PASSWORD_PATH = "/client/set-password";
export const CLIENT_LINK_EXPIRED_PATH = "/client/link-expired";
/** Where an invitation or recovery email lands: verifies its token_hash. */
export const CLIENT_CONFIRM_PATH = "/client/auth/confirm";
export const CLIENT_CHOOSE_COMPANY_PATH = "/client/choose-company";
/** Re-issues the token, so the access token hook re-reads the member's company. */
export const CLIENT_REFRESH_PATH = "/client/session/refresh";
/** Set for a few seconds by the refresh route, so a token the hook still gives no company can't loop. */
export const REFRESHED_COOKIE = "tats-refreshed";

/** Reachable with no session at all. */
const SUPABASE_PUBLIC_PATHS = new Set([
  CLIENT_SIGN_IN_PATH,
  CLIENT_FORGOT_PASSWORD_PATH,
  CLIENT_LINK_EXPIRED_PATH,
  CLIENT_CONFIRM_PATH,
]);

/** The sign-in screens' route (app/(client-auth)/client/auth/[op]); each op checks its own session. */
const CLIENT_AUTH_ROUTE = "/client/auth/";

export function isPublicClientPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "");
  return SUPABASE_PUBLIC_PATHS.has(path) || path.startsWith(CLIENT_AUTH_ROUTE);
}

/**
 * A same-site path under /client to return to after signing in, or /client.
 * Never a full URL or a protocol-relative one: `next` comes from the query.
 */
export function safeClientNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return CLIENT_PREFIX;
  return isClientPath(next.split(/[?#]/)[0]) ? next : CLIENT_PREFIX;
}

/** Where WorkOS sends the browser back. Registered in the WorkOS dashboard. */
export function clientRedirectUri(origin: string, env: Env = process.env): string {
  return env.NEXT_PUBLIC_WORKOS_REDIRECT_URI?.trim() || `${origin}${CLIENT_CALLBACK_PATH}`;
}
