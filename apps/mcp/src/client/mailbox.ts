import type { clientTools } from "@tacit-ats/core";
import { getSupabaseServiceClient, type Db } from "@tacit/db";

/**
 * A member's own Gmail (mailbox_connections, tacit-internal migration
 * 20261106120000), so send_email goes out from their own address: the refresh
 * token is granted to no member token, so reading it needs the service role.
 * The sixth module under src/client allowed a privileged client
 * (src/client-connector.test.ts), and like the others it exports only its
 * function, never the client.
 *
 * It takes the member's OWN client and nothing else: their token reads their
 * own row of mailbox_connections and nobody else's, and the ids on that row are
 * the only ones the service role is asked about, so no caller can name another
 * member's mailbox. apps/web's lib/client/mailbox.ts is the same for the web app.
 */
export async function ownMailbox(db: Db): Promise<clientTools.MailboxGrant | null> {
  const { data: mine, error } = await db.from("mailbox_connections").select("org_id, actor_id").maybeSingle();
  if (error) throw new Error(`mailbox_connections: ${error.message}`);
  if (!mine) return null;
  const { data, error: grantError } = await getSupabaseServiceClient()
    .from("mailbox_connections")
    .select("account_email, refresh_token, scopes")
    .eq("org_id", mine.org_id)
    .eq("actor_id", mine.actor_id)
    .eq("provider", "google")
    .maybeSingle();
  if (grantError) throw new Error(`mailbox_connections: ${grantError.message}`);
  return data ? { accountEmail: data.account_email, refreshToken: data.refresh_token, scopes: data.scopes } : null;
}
