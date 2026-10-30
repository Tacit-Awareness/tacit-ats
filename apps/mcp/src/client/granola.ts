import { clientTools } from "@tacit-ats/core";
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
 * bound member, never from input. Reading, refreshing and writing the rotated
 * refresh token back are core's granolaGrantAccess, shared with apps/web's
 * Interviews reader so both surfaces treat one grant the same way.
 */
export async function granolaAccessToken(
  orgId: string,
  actorId: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<clientTools.GranolaAccess> {
  return clientTools.granolaGrantAccess(getSupabaseServiceClient(), orgId, actorId, fetchImpl, now);
}
