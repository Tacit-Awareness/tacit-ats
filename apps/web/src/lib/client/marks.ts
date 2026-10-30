import type { Db } from "@tacit/db";
import type { clientTools } from "@tacit-ats/core";
import type { MarkLists } from "../sidebar-marks";
import { readApplicantQueue } from "./applicants";
import { readBotNeedsYou } from "./bot-tasks";
import { readInbox } from "./inbox";

// What the sidebar's marks compare against what you last saw: the ids on the
// Inbox, on Applicant Tickets and in Grokbot Activity's Needs you, the pages'
// own reads on the member's OWN client. Ids only. One that fails answers null
// and the link keeps what it knew: a mark must never take a page down. An
// interviewer has only Activity, and the policy shows them what is theirs.

export async function readMarks(db: Db, member: Omit<clientTools.ClientToolCtx, "source">, now: Date): Promise<MarkLists> {
  const interviewer = member.accessLevel === "limited";
  const [inbox, tickets, activity] = await Promise.allSettled([
    interviewer ? null : readInbox(db, member, now),
    interviewer ? null : readApplicantQueue(db, member),
    readBotNeedsYou(db, now),
  ]);
  for (const r of [inbox, tickets, activity]) {
    if (r.status === "rejected") console.error("sidebar marks:", r.reason instanceof Error ? r.reason.message : "read failed");
  }
  return {
    inbox: inbox.status === "fulfilled" ? (inbox.value?.issues.map((i) => i.key) ?? []) : null,
    tickets: tickets.status === "fulfilled" ? (tickets.value?.map((t) => t.applicationId) ?? []) : null,
    activity: activity.status === "fulfilled" ? activity.value.tasks.map((t) => t.id) : null,
  };
}
