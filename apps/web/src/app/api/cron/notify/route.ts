// GET /api/cron/notify -- every two minutes. One tick of @tacit/core's
// notification hub for each client company with a verified bot
// (agent_destinations, set on /client/integrations): the same tick
// tacit-internal's apps/internal runs for Tacit's own bot, here once per
// company with that company's bot as the only channel and its members' own
// calendar grants. Each tick:
//
//   - reads what changed on the calendars holding the company's upcoming
//     interviews, so one moved or deleted in Google Calendar follows here;
//   - starts an exact five-minute reminder timer (src/workflows/
//     interview-reminder.ts, a Vercel Workflow run) for each interview
//     starting in the next 15 minutes; the tick's own reminder is the backstop;
//   - asks each interviewer how it went once an interview has ended (the
//     check-in), and tells the bot when one it opened a thread about was cancelled;
//   - delivers to the bot: signed JSON, the contract in core's notify/agent-webhook.ts.
//
// Then, for every company, with or without a bot: candidates' replies to email
// members sent from their own Gmail (lib/inbound/gmail-replies.ts), kept for the
// Inbox and passed to the company's bot when it has one.
//
// One company's failure does not stop the others. CRON_SECRET authenticates
// Vercel's cron. NOTIFY_REMINDER_TIMERS=off turns the timers off.
import { runNotifications } from "@tacit/core";
import { start } from "workflow/api";

import { googleCalendarConfig } from "@/lib/client/google-calendar";
import { readGmailReplies } from "@/lib/inbound/gmail-replies";
import { pingCompanyBot } from "@/lib/notify/candidate-replied";
import { companiesWithBots, companyCalendar, companyHub, notifierDb } from "@/lib/notify/notifier";
import { interviewReminderTimer } from "@/workflows/interview-reminder";

export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/** Never throws out of the handler: a 5xx invites the platform's retries. */
export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return new Response(null, { status: 401 });
  const db = notifierDb();
  let companies;
  try {
    companies = await companiesWithBots(db);
  } catch (err) {
    console.error("[cron] notify: could not read the companies' bots", err);
    return Response.json({ status: "failed" });
  }
  const timersOn = process.env.NOTIFY_REMINDER_TIMERS !== "off";
  const results: Array<{ orgId: string; status: "ok" | "failed"; [key: string]: unknown }> = [];
  for (const destination of companies) {
    const orgId = destination.orgId;
    const calendar = companyCalendar(db, orgId);
    try {
      const result = await runNotifications(db, {
        ...companyHub(destination),
        testbenchSource: null,
        interviewSource: { calendar },
        agentInterviewSource: { calendar },
        calendarSync: calendar ? { calendar } : null,
        reminderTimers: timersOn
          ? {
              start: async ({ interviewId, startsAt, wakeAt }) =>
                (await start(interviewReminderTimer, [orgId, interviewId, startsAt, wakeAt])).runId,
            }
          : null,
      });
      results.push({ orgId, status: "ok", ...result });
    } catch (err) {
      console.error(`[cron] notify failed for org ${orgId}`, err);
      results.push({ orgId, status: "failed" });
    }
  }
  const google = googleCalendarConfig();
  const origin = new URL(request.url).origin;
  let gmailReplies;
  try {
    gmailReplies = google
      ? await readGmailReplies(db, { google, ping: (orgId, reply) => pingCompanyBot(db, orgId, reply, origin) })
      : null;
  } catch (err) {
    console.error("[cron] gmail replies failed", err instanceof Error ? err.message.slice(0, 200) : "failed");
    gmailReplies = { status: "failed" as const };
  }
  return Response.json({ status: "ok", companies: results.length, results, gmailReplies });
}
