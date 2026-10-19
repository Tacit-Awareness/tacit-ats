import { getSupabaseServiceClient } from "@tacit/db";

/**
 * Members' Granola API keys (granola_connections, Tacit-Awareness migration
 * 20261019150000): the key is granted to no member token, so reading it
 * needs the service role. The fifth module under src/client allowed a
 * privileged client (src/client-connector.test.ts), and like the others it
 * exports only its function, never the client.
 *
 * Core's clientTools granola.ts asks only for the caller's own key, after
 * the member's own token has read the interview they were an interviewer on,
 * and always within the member's own org, which the handler passes from the
 * bound member, never from input.
 */
export async function granolaKey(orgId: string, actorId: string): Promise<string | null> {
  const { data, error } = await getSupabaseServiceClient()
    .from("granola_connections")
    .select("api_key")
    .eq("org_id", orgId)
    .eq("actor_id", actorId)
    .maybeSingle();
  if (error) throw new Error(`granola_connections: ${error.message}`);
  return data?.api_key ?? null;
}
