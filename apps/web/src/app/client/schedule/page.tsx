import { safeHref } from "@/lib/client/applicant-queue";
import { readSchedule } from "@/lib/client/schedule";
import { departmentTones, isScheduleView, parseYmd, readWindow, toneFor } from "@/lib/client/schedule-layout";
import { resolveClient } from "@/lib/client/session";
import { Refusal } from "../refusal";
import { ScheduleView, type CalendarEvent } from "./view";

// design/tats's Calendar: the interviews the member can see, by day, week or
// as a month's list, read-only. Read with the signed-in member's own token
// (lib/client/schedule.ts), so an interviewer sees their own interviews only.
// Not /client/calendar, which is the Google Calendar connect redirect.
//
// `?dept=` narrows it to one department's interviews (the prototype's team
// menu), by the outermost department's name, filtered in view.tsx.
//
// The server never lays out a clock time: it does not know the member's time
// zone. It reads a window wide enough for any zone (readWindow) and hands the
// interviews as instants to view.tsx, a client component that places them in
// the browser's own zone. With no `?date=`, "today" is the browser's today.
//
// Left out from the prototype: drag to create or move, "Find a time", holds,
// and the popover's move and cancel. An event opens the interview on the
// Interviews page.

export default async function ClientSchedule({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await resolveClient();
  if (gate.status !== "ok") return <Refusal reason={gate.reason} />;
  const { db, actorId, accessLevel, org } = gate.ctx;

  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const asked = one(sp.view);
  const view = isScheduleView(asked) ? asked : "week";
  const anchor = parseYmd(one(sp.date));

  const now = new Date();
  const { items, departments, truncated } = await readSchedule(db, { actorId, orgId: org.id, accessLevel }, readWindow(view, anchor, now), now);
  const tones = departmentTones(departments);
  // The department filter's choices: the outermost departments the member may read, by name.
  const names = [...new Set([...tones.values()].map((t) => t.name))].sort((a, b) => a.localeCompare(b));
  const asDept = one(sp.dept);
  const dept = names.includes(asDept) ? asDept : null;

  const events: CalendarEvent[] = items.map((i) => ({
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
  }));

  return (
    <ScheduleView
      view={view}
      anchor={anchor}
      events={events}
      departments={names}
      dept={dept}
      truncated={truncated}
    />
  );
}
