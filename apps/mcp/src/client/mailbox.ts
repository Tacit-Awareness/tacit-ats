import { getSupabaseServiceClient } from "@tacit/db";

/**
 * A member's own Gmail connection's refresh token (mailbox_connections,
 * tacit-internal migration 20261106120000), granted to no member token, so
 * reading it needs the service role. The sixth module under src/client allowed
 * a privileged client (src/client-connector.test.ts), and like the others it
 * exports only its function, never the client.
 *
 * Core's memberMailbox, which decides on the member's own client whether
 * send_email goes through their company's Google Workspace or their own
 * connection, calls this only with the org and actor on the row the member's
 * own token returned, so no caller can name another member's grant. apps/web's
 * lib/client/mailbox.ts is the same for the web app.
 */
export async function mailboxRefreshToken(orgId: string, actorId: string): Promise<string | null> {
  const { data, error } = await getSupabaseServiceClient()
    .from("mailbox_connections")
    .select("refresh_token")
    .eq("org_id", orgId)
    .eq("actor_id", actorId)
    .eq("provider", "google")
    .maybeSingle();
  if (error) throw new Error(`mailbox_connections: ${error.message}`);
  return data?.refresh_token ?? null;
}
