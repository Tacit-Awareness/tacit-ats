import {
  agentWebhookAdapter, listAgentDestinations,
  type AgentDestination, type HubDeps, type ReminderPollDeps,
} from "@tacit/core";
import { getSupabaseServiceClient, type Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";

import { googleCalendarConfig } from "../client/google-calendar";
import { tacitDelegation } from "../google-delegation";

/** Google's OAuth client plus where a holder's token comes from (core's connector CalendarDeps). */
type CalendarDeps = NonNullable<ReminderPollDeps["calendar"]>;

/**
 * Interview notifications for each client company, to its own bot: the same
 * machinery tacit-internal runs for Tacit's bot (@tacit/core's notify/: the
 * exact five-minute reminder, the check-in after, a cancellation notice, the
 * Google Calendar sync), run once per company that has a verified bot.
 *
 * Outside the client area on purpose: this runs for every company at once,
 * with no member signed in, so it reads with the service role. It is never
 * imported from app/client or lib/client (src/client-area.test.ts), and every
 * query underneath names the company it is for (core's `orgId`).
 */

/** The service role, for the notifier only. */
export function notifierDb(): Db {
  return getSupabaseServiceClient();
}

/** The companies to notify for: an enabled bot whose URL answered its challenge. */
export async function companiesWithBots(db: Db): Promise<AgentDestination[]> {
  return (await listAgentDestinations(db)).filter((d) => d.verifiedAt !== null);
}

/**
 * A company's interviews are on its members' own calendars: each holder's
 * grant through the company's Google Workspace when it covers them, else their
 * own connection (calendar_connections) with tacit-ats's Google app; core's
 * readCalendarConnections decides, as it does for booking. Null when the
 * deployment has no Google app, and then no event is read.
 */
export function companyCalendar(db: Db, orgId: string): CalendarDeps | null {
  const config = googleCalendarConfig();
  if (!config) return null;
  const delegation = tacitDelegation();
  const google = { clientId: config.clientId, clientSecret: config.clientSecret };
  return {
    ...google,
    tokenFor: async (actorId) => {
      const conn = (await clientTools.readCalendarConnections(db, orgId, [actorId], { workspace: !!delegation })).get(actorId);
      if (!conn) throw new Error("no calendar connected");
      const token = await clientTools.calendarAccessToken({ google, delegation }, conn);
      if (!token) throw new Error(clientTools.throughWorkspace(conn) ? "the company's Google Workspace refused the calendar" : "the calendar connection has expired");
      return token;
    },
  };
}

/** The hub for one company: its bot is the only channel, for the three interview events. */
export function companyHub(destination: AgentDestination): HubDeps {
  const bot = [agentWebhookAdapter({ channel: destination.channel, url: destination.url, key: destination.secret })];
  return {
    orgId: destination.orgId,
    adapters: [],
    typeAdapters: { "interview.reminder_t5m": bot, "interview.finished": bot, "interview.cancelled": bot },
    directedDefaults: {
      "interview.reminder_t5m": destination.channel,
      "interview.finished": destination.channel,
      "interview.cancelled": destination.channel,
    },
    testbenchUrl: null,
  };
}
