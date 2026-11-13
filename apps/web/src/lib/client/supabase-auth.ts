import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * The member's own Supabase Auth session, read from (and, where Next allows,
 * written to) this request's cookies. Publishable key only: this is the
 * signed-in user, never the service role, so the client area may import it.
 *
 * A server component cannot set cookies, so a refresh there is dropped and
 * the proxy (or a route / action) writes it on the next request instead.
 */
export async function supabaseAuthClient(): Promise<SupabaseClient> {
  const jar = await cookies();
  return createServerClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_PUBLISHABLE_KEY ?? "", {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (all) => {
        try {
          for (const { name, value, options } of all) jar.set(name, value, options);
        } catch {
          // A server component: the proxy has already refreshed this request.
        }
      },
    },
  });
}

/** Verified claims of the signed-in user, or null. Checks the JWT, not just the cookie. */
export type SupabaseClaims = { sub: string; email?: string; org_id?: string };

export async function signedInClaims(auth: SupabaseClient): Promise<SupabaseClaims | null> {
  const { data, error } = await auth.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return data.claims as unknown as SupabaseClaims;
}
