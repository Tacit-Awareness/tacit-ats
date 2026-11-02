import { clientTools } from "@tacit-ats/core";
import { getSupabaseServiceClient, type Db } from "@tacit/db";
import { googleCalendarConfig } from "./google-calendar";

type Env = Record<string, string | undefined>;

/**
 * A member's own Gmail, for sending candidate email as them: the fifth
 * client-area module allowed a privileged client (src/client-area.test.ts).
 * The refresh token in mailbox_connections (tacit-internal 20261106120000) is
 * granted to no member token, so it is read here with the service role, and
 * what leaves this file is the member's own grant, handed to core's sendEmail,
 * never a client.
 *
 * The member's own token decides whose grant, as in granola-notes.ts:
 * mailbox_connections' policy shows a member their own row and nobody else's,
 * and the ids on that row are the only ones the service role is asked about.
 * `own` takes the member's client and nothing else, so no caller can name
 * another member's mailbox; a member with no row gets no privileged read.
 *
 * Null when the deployment has no Google app (the same OAuth client as the
 * calendar's) or no service key: email then goes through Resend only.
 */
export function memberMailbox(env: Env = process.env, fetchImpl?: typeof fetch): clientTools.ClientMailbox | null {
  const google = googleCalendarConfig(env);
  if (!google || !env.SUPABASE_URL?.trim() || !env.SUPABASE_SECRET_KEY?.trim()) return null;
  return {
    google: { ...google, fetch: fetchImpl },
    own: async (db: Db) => {
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
    },
  };
}
