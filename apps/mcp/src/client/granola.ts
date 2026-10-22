import type { clientTools } from "@tacit-ats/core";
import { getSupabaseServiceClient } from "@tacit/db";

/**
 * Members' Granola grants (granola_connections, tacit-internal migrations
 * 20261019150000 and 20261019200000): an OAuth grant for Granola's MCP
 * server, granted to no member token, so reading it needs the service role.
 * The fifth module under src/client allowed a privileged client
 * (src/client-connector.test.ts), and like the others it exports only its
 * function, never the client.
 *
 * Core's clientTools granola.ts asks only for the caller's own token, after
 * the member's own token has read the interview they were an interviewer on,
 * and always within the member's own org, which the handler passes from the
 * bound member, never from input.
 *
 * The cached access token is used until a minute before it expires; then the
 * refresh token buys a new one. Granola may rotate the refresh token on each
 * refresh, so the new one is written back, conditional on the one read: when
 * two calls refresh at once, the second's write finds nothing to change and
 * it still uses the access token it got. A refresh Granola refuses
 * (invalid_grant: revoked, or signed out) is `reconnect`, and the row stays
 * until the member connects again or disconnects.
 */

const TOKEN_URL = "https://mcp-auth.granola.ai/oauth2/token";
const RESOURCE = "https://mcp.granola.ai/mcp";
const EARLY_MS = 60_000;

export async function granolaAccessToken(
  orgId: string,
  actorId: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<clientTools.GranolaAccess> {
  const db = getSupabaseServiceClient();
  const { data, error } = await db
    .from("granola_connections")
    .select("oauth_client_id, refresh_token, access_token, access_token_expires_at")
    .eq("org_id", orgId)
    .eq("actor_id", actorId)
    .maybeSingle();
  if (error) throw new Error(`granola_connections: ${error.message}`);
  if (!data) return null;
  const expires = data.access_token_expires_at ? Date.parse(data.access_token_expires_at) : 0;
  if (data.access_token && expires - EARLY_MS > now()) return { token: data.access_token };

  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token", refresh_token: data.refresh_token, client_id: data.oauth_client_id, resource: RESOURCE,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => null)) as
    | { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; error?: unknown }
    | null;
  if (res.status === 400 || res.status === 401) {
    if (json?.error === "invalid_grant" || json?.error === "invalid_client" || res.status === 401) return { reconnect: true };
  }
  if (!res.ok || typeof json?.access_token !== "string" || !json.access_token) {
    throw new Error(`granola refresh: ${res.status}`);
  }
  const expiresIn = typeof json.expires_in === "number" && json.expires_in > 0 ? json.expires_in : 3600;
  const { error: saveError } = await db
    .from("granola_connections")
    .update({
      access_token: json.access_token,
      access_token_expires_at: new Date(now() + expiresIn * 1000).toISOString(),
      refresh_token: typeof json.refresh_token === "string" && json.refresh_token ? json.refresh_token : data.refresh_token,
    })
    .eq("org_id", orgId)
    .eq("actor_id", actorId)
    .eq("refresh_token", data.refresh_token);
  if (saveError) console.error("[client-granola] saving the refreshed token failed:", saveError.message);
  return { token: json.access_token };
}
