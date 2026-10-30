import type { Db } from "@tacit/db";
import type { clientTools } from "@tacit-ats/core";
import type { MarkLists } from "../sidebar-marks";
import { readApplicantQueue } from "./applicants";
import { readInbox } from "./inbox";

// What the sidebar's marks compare against what you last saw: the ids on the
// Inbox and on Applicant Tickets, the pages' own reads on the member's OWN
// client. Ids only. One that fails answers null and the link keeps what it
// knew: a mark must never take a page down. An interviewer has neither page.

export async function readMarks(db: Db, member: Omit<clientTools.ClientToolCtx, "source">, now: Date): Promise<MarkLists> {
  if (member.accessLevel === "limited") return { inbox: [], tickets: [] };
  const [inbox, tickets] = await Promise.allSettled([readInbox(db, member, now), readApplicantQueue(db, member)]);
  for (const r of [inbox, tickets]) {
    if (r.status === "rejected") console.error("sidebar marks:", r.reason instanceof Error ? r.reason.message : "read failed");
  }
  return {
    inbox: inbox.status === "fulfilled" ? inbox.value.issues.map((i) => i.key) : null,
    tickets: tickets.status === "fulfilled" ? tickets.value.map((t) => t.applicationId) : null,
  };
}
