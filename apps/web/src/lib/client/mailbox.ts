import { clientTools } from "@tacit-ats/core";
import { getSupabaseServiceClient } from "@tacit/db";
import { googleCalendarConfig } from "./google-calendar";

type Env = Record<string, string | undefined>;

/**
 * A member's own Gmail, for sending candidate email as them: the fifth
 * client-area module allowed a privileged client (src/client-area.test.ts).
 * Core's memberMailbox decides which Gmail on the member's own client: their
 * company's Google Workspace (Tacit's service account, CLIENT_GOOGLE_SERVICE_ACCOUNT,
 * delegated by the company's Google admin), else their own OAuth connection.
 * The one thing it cannot read is that connection's refresh token, granted to
 * no member token, so this file reads it with the service role, and only for
 * the org and actor on the row the member's own token returned (core never
 * asks with anything else). What leaves this file is a grant, never a client.
 *
 * Null when the deployment has neither a service account nor a Google app
 * with a service key: email then goes through Resend only.
 */
export function memberMailbox(env: Env = process.env, fetchImpl?: typeof fetch): clientTools.ClientMailbox | null {
  const serviceAccount = clientTools.parseServiceAccount(env.CLIENT_GOOGLE_SERVICE_ACCOUNT);
  const oauth = env.SUPABASE_URL?.trim() && env.SUPABASE_SECRET_KEY?.trim() ? googleCalendarConfig(env) : null;
  if (!serviceAccount && !oauth) return null;
  const sources: clientTools.MailboxSources = {
    serviceAccount,
    google: oauth,
    fetch: fetchImpl,
    refreshToken: async (orgId, actorId) => {
      const { data, error } = await getSupabaseServiceClient()
        .from("mailbox_connections")
        .select("refresh_token")
        .eq("org_id", orgId)
        .eq("actor_id", actorId)
        .eq("provider", "google")
        .maybeSingle();
      if (error) throw new Error(`mailbox_connections: ${error.message}`);
      return data?.refresh_token ?? null;
    },
  };
  return { fetch: fetchImpl, own: (db, ctx) => clientTools.memberMailbox(db, ctx, sources) };
}
