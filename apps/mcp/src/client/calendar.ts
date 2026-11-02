import { getSupabaseServiceClient } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";

/**
 * Members' calendar grants (calendar_connections, tacit-internal migration
 * 20261017120000, and since 2026-11-02 their company's Google Workspace,
 * google_workspace_connections): a refresh token, and whether a member has
 * signed in, are granted to no member token, so reading them needs the service
 * role. One of the modules under src/client allowed a privileged client
 * (src/client-connector.test.ts), and like the others it exports only its
 * function, never the client. Core's readCalendarConnections holds the rule
 * of who the Workspace covers.
 *
 * The rule that keeps this narrow is the caller's: core's clientTools
 * calendar.ts asks only for the caller, the interviewers the caller has
 * already been allowed to name (members of their company, checked on the
 * member's own token), or the member whose calendar holds an interview the
 * caller's own token has read and may change. Always within the member's own
 * org, which the handler passes from the bound member, never from input.
 */
export async function calendarConnections(
  orgId: string,
  actorIds: string[],
  opts: { workspace: boolean } = { workspace: false },
): Promise<Map<string, clientTools.CalendarConnection>> {
  if (!actorIds.length) return new Map();
  return clientTools.readCalendarConnections(getSupabaseServiceClient(), orgId, actorIds, opts);
}
