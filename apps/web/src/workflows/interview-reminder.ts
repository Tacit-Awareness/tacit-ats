// A client interview's exact five-minute reminder: a durable Vercel Workflow
// run, started by the notify cron for one interview start. It sleeps until
// five minutes before, then @tacit/core's remindAtTimer reads the interview
// and its Google event again and delivers to the company's bot only if the
// interview is still scheduled at that start. A run left from before a move
// wakes, finds another start, and sends nothing. tacit-internal's
// apps/internal has the same timer for Tacit's own interviews.
import { remindAtTimer, type TimerWakeResult } from "@tacit/core";
import { sleep } from "workflow";

import { companiesWithBots, companyCalendar, companyHub, notifierDb } from "../lib/notify/notifier";

export async function interviewReminderTimer(orgId: string, interviewId: string, startsAt: string, wakeAt: string) {
  "use workflow";
  await sleep(new Date(wakeAt));
  return await remindNow(orgId, interviewId, startsAt);
}

/** A step, so a failed read or send is retried; every send underneath is claimed once (core's hub). */
async function remindNow(orgId: string, interviewId: string, startsAt: string): Promise<TimerWakeResult | { outcome: "no_bot" }> {
  "use step";
  const db = notifierDb();
  // The company's bot as it is now: turned off or removed since the timer started means no reminder.
  const destination = (await companiesWithBots(db)).find((d) => d.orgId === orgId);
  if (!destination) return { outcome: "no_bot" };
  const result = await remindAtTimer(db, { interviewId, startsAt }, { ...companyHub(destination), calendar: companyCalendar(db, orgId) });
  console.log(`[reminder timer] org ${orgId} interview ${interviewId} at ${startsAt}: ${result.outcome}`);
  return result;
}
