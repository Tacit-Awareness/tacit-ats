import { safeHref } from "@/lib/client/applicant-queue";
import { parseBook } from "@/lib/client/next-round-rules";
import { readAllInterviews, readSchedule } from "@/lib/client/schedule";
import { readNextRound, schedulableRoles } from "@/lib/client/schedule-choices";
import { departmentTones, isScheduleView, parseYmd, readWindow, toneFor } from "@/lib/client/schedule-layout";
import { matchesSearch, parseSearch } from "@/lib/client/schedule-search";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { ScheduleView, type CalendarEvent } from "./view";

// design/tats's Calendar: the interviews the member can see, by day, week or
// month, or as a month's list. Read with the signed-in member's own
// token (lib/client/schedule.ts), so an interviewer sees their own interviews
// only. Not /client/calendar, which is the Google Calendar connect redirect.
//
// `?dept=` narrows it to one department's interviews (the prototype's team
// menu), by the outermost department's name, filtered in view.tsx.
//
// `?q=` is the search box: instead of a window, the interviews on every date
// the member can see, matched here (lib/client/schedule-search.ts) and shown
// as one table, whichever view it was typed in.
//
// The server never lays out a clock time: it does not know the member's time
// zone. It reads a window wide enough for any zone (readWindow) and hands the
// interviews as instants to view.tsx, a client component that places them in
// the browser's own zone. With no `?date=`, "today" is the browser's today.
//
// Book, move, cancel and Find a time are view.tsx's and booking.tsx's, through
// the route that reaches calendar grants. Here is only who may: `canChange` is
// an interview still ahead on a job the member may schedule on, asked the way a
// write asks, and the write asks again. An interviewer changes nothing.
//
// `?book=` is the Inbox's Next round (lib/client/next-round-rules.ts): an
// application's id, opening Find a time on that candidate and job with their
// plan's next step picked, read here on the member's own token. view.tsx drops
// it from the address once the dialog is up. An interviewer gets the Calendar.
//
// Left out from the prototype: holds. An event the member cannot change opens
// the interview on the Interviews page.

export default async function ClientSchedule({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, actorId, accessLevel, org } = gate.ctx;

  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const asked = one(sp.view);
  const view = isScheduleView(asked) ? asked : "week";
  const anchor = parseYmd(one(sp.date));
  const q = parseSearch(one(sp.q));

  const now = new Date();
  const member = { actorId, orgId: org.id, accessLevel };
  const book = accessLevel === "limited" ? null : parseBook(one(sp.book));
  const [{ items, departments, truncated }, nextRound] = await Promise.all([
    q ? readAllInterviews(db, member, now) : readSchedule(db, member, readWindow(view, anchor, now), now),
    // The step is a convenience: a failed read still opens the dialog on the candidate.
    book
      ? readNextRound(db, member, book).catch((err) => {
          console.error("[client-schedule] reading the next round failed:", err instanceof Error ? err.message : err);
          return { applicationId: book, step: null };
        })
      : null,
  ]);
  const tones = departmentTones(departments);
  // The department filter's choices: the outermost departments the member may read, by name.
  const names = [...new Set([...tones.values()].map((t) => t.name))].sort((a, b) => a.localeCompare(b));
  const asDept = one(sp.dept);
  const dept = names.includes(asDept) ? asDept : null;

  const ahead = (i: (typeof items)[number]) => i.status === "scheduled" && Date.parse(i.startsAt) > now.getTime();
  const schedulable = accessLevel === "limited" ? new Set<string>() : await schedulableRoles(db, items.filter(ahead).map((i) => i.jobId));

  const events: CalendarEvent[] = (q ? items.filter((i) => matchesSearch(i, q)) : items).map((i) => ({
    id: i.interviewId,
    href: `/client/interviews?i=${encodeURIComponent(i.interviewId)}`,
    candidate: i.candidateName ?? "Candidate",
    step: i.step ?? "Interview",
    job: i.jobTitle,
    department: (i.departmentId && tones.get(i.departmentId)?.name) || null,
    interviewers: i.interviewers,
    location: i.locationOrLink,
    locationHref: i.locationOrLink ? safeHref(i.locationOrLink) : null,
    startsAt: i.startsAt,
    endsAt: i.endsAt,
    tone: toneFor(i.departmentId, tones),
    applicationId: i.applicationId,
    interviewerIds: i.interviewerIds,
    eventLink: i.eventLink ? safeHref(i.eventLink) : null,
    canChange: ahead(i) && schedulable.has(i.jobId),
  }));

  return (
    <ScheduleView
      view={view}
      anchor={anchor}
      events={events}
      departments={names}
      dept={dept}
      q={q}
      truncated={truncated}
      canBook={accessLevel !== "limited"}
      nextRound={nextRound}
    />
  );
}
