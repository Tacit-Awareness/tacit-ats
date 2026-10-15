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
 * Client sign-in is off until every piece it needs is configured: the three
 * WorkOS values and the two a per-user database client is built from. Off
 * means the whole client area answers 404, which is how this ships dormant.
 */
export function clientSignInConfigured(env: Env = process.env): boolean {
  return Boolean(
    env.WORKOS_CLIENT_ID?.trim() &&
      env.WORKOS_API_KEY?.trim() &&
      // AuthKit seals the session cookie with it and refuses anything shorter.
      (env.WORKOS_COOKIE_PASSWORD?.length ?? 0) >= 32 &&
      env.SUPABASE_URL?.trim() &&
      env.SUPABASE_PUBLISHABLE_KEY?.trim(),
  );
}

/** Where WorkOS sends the browser back. Registered in the WorkOS dashboard. */
export function clientRedirectUri(origin: string, env: Env = process.env): string {
  return env.NEXT_PUBLIC_WORKOS_REDIRECT_URI?.trim() || `${origin}${CLIENT_CALLBACK_PATH}`;
}
