import { getSupabaseServiceClient } from "@tacit/db";
import type { clientTools } from "@tacit-ats/core";
import { googleCalendarConfig } from "../client/google-calendar";

/**
 * Members' connected calendars, for the Calendar's book, move, cancel and Find
 * a time: apps/mcp's client/calendar.ts for the web app. The refresh token in
 * calendar_connections is granted to no member token, so reading it needs the
 * service role.
 *
 * Outside the client area on purpose, like lib/notify: nothing under app/client
 * or lib/client may reach a privileged client (client-area.test.ts), so this is
 * imported only by the route at app/(member-calendar)/client/schedule/api, and
 * client-area.test.ts holds that too. The route resolves the signed-in member
 * first and everything else runs on their own token; this hands core a function
 * and never a client.
 *
 * The rule that keeps it narrow is core's, the same as the connector's: it asks
 * only for the caller, the interviewers the member's own token has been allowed
 * to name, or the holder of an interview it has read and may change, always in
 * the member's own org, which the route passes from the bound member.
 *
 * Null when the deployment has no Google app or no service key. Core then
 * records bookings in Tacit only and says so, and refuses to read availability.
 */
export function memberCalendar(origin: string, env: Record<string, string | undefined> = process.env): clientTools.ClientCalendar | null {
  const google = googleCalendarConfig(env);
  if (!google || !env.SUPABASE_URL?.trim() || !env.SUPABASE_SECRET_KEY?.trim()) return null;
  return {
    google,
    connectUrl: `${origin}/client/integrations`,
    connections: async (orgId, actorIds) => {
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
    },
  };
}
