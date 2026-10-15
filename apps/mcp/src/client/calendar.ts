import { getSupabaseServiceClient } from "@tacit/db";
import type { clientTools } from "@tacit-ats/core";

/**
 * Members' connected calendars (calendar_connections, Tacit-Awareness
 * migration 20261017120000): the refresh token is granted to no member
 * token, so reading it needs the service role. The fourth module under
 * src/client allowed a privileged client (src/client-connector.test.ts), and
 * like the other three it exports only its function, never the client.
 *
 * The rule that keeps this narrow is the caller's: core's clientTools
 * calendar.ts asks only for the caller, the interviewers the caller has
 * already been allowed to name (members of their company, checked on the
 * member's own token), or the member whose calendar holds an interview the
 * caller's own token has read and may change. Always within the member's own
 * org, which the handler passes from the bound member, never from input.
 */
export async function calendarConnections(orgId: string, actorIds: string[]): Promise<Map<string, clientTools.CalendarConnection>> {
  const ids = [...new Set(actorIds)];
  if (!ids.length) return new Map();
  const { data, error } = await getSupabaseServiceClient()
    .from("calendar_connections")
    .select("actor_id, account_email, refresh_token")
    .eq("org_id", orgId)
    .eq("provider", "google")
    .in("actor_id", ids);
  if (error) throw new Error(`calendar_connections: ${error.message}`);
  return new Map((data ?? []).map((c) => [c.actor_id, { accountEmail: c.account_email, refreshToken: c.refresh_token }]));
}
