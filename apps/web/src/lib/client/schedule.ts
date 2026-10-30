import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import type { Member } from "./interviews";

// The Calendar's read, on the member's OWN client (never a privileged one),
// the way the Interviews page reads (lib/client/interviews.ts): `interviews`
// directly, which the policy gives an interviewer their own and everyone else
// the ones whose application they can read; the applications behind them for
// candidate and job; and core's listMyInterviews (my_interviews()) for the
// ones the member sits on without reading the application, which is all of
// them for an interviewer (`limited`). Cancelled interviews are left out.
//
// The job's department colours the event: `roles.department_id`, readable on
// every job the member can see (an interviewer's too, through can_see_role).
// Department names are for admins and the hiring team; an interviewer reads none.

/** Interviews one view reads at most: a month of a busy company's calendar. */
const WINDOW_MAX = 1000;
/** Interviews a search looks through at most, newest first. */
const SEARCH_SCAN_MAX = 3000;
/** PostgREST's `max_rows`: a request brings back no more than this, whatever its `.limit` asks. */
const PAGE = 1000;
/** Ids per `.in()` read, to keep the query string short. */
const IDS_PER_READ = 150;

export type ScheduleItem = {
  interviewId: string;
  candidateName: string | null;
  jobId: string;
  jobTitle: string;
  departmentId: string | null;
  startsAt: string;
  endsAt: string;
  step: string | null;
  interviewers: string[];
  locationOrLink: string | null;
};

export type Schedule = {
  items: ScheduleItem[];
  /** The org's departments, when the member may read them; empty for an interviewer. */
  departments: clientTools.Department[];
  /** There were more than the read's cap: a window's latest, or a search's oldest, were left off. */
  truncated: boolean;
};

type InterviewRow = {
  id: string;
  application_id: string | null;
  starts_at: string;
  ends_at: string;
  step: string | null;
  interviewer_actor_ids: string[];
  location_or_link: string | null;
};

const toolCtx = (m: Member): clientTools.ClientToolCtx => ({ ...m, source: "claude" });

async function inChunks<T>(ids: string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IDS_PER_READ) out.push(...(await read(ids.slice(i, i + IDS_PER_READ))));
  return out;
}

/**
 * Up to `max` + 1 of the interviews the member can read, but cancelled ones:
 * one past the cap, a page at a time, so the caller can tell there were more.
 * The id breaks ties, so the order is total; an interview booked while the
 * pages are read still moves the rest along by one, so a row can come back on
 * the next page, and the first copy is the one kept.
 */
async function scanInterviews(db: Db, { window, ascending, max }: { window: { from: string; to: string } | null; ascending: boolean; max: number }): Promise<InterviewRow[]> {
  const rows = new Map<string, InterviewRow>();
  for (let from = 0; from <= max; from += PAGE) {
    let query = db.from("interviews").select("id, application_id, starts_at, ends_at, step, interviewer_actor_ids, location_or_link").neq("status", "cancelled");
    if (window) query = query.lt("starts_at", window.to).gt("ends_at", window.from);
    const { data, error } = await query
      .order("starts_at", { ascending })
      .order("id", { ascending })
      .range(from, Math.min(from + PAGE - 1, max));
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as InterviewRow[]) if (!rows.has(row.id)) rows.set(row.id, row);
    if ((data ?? []).length < PAGE) break;
  }
  return [...rows.values()];
}

/** Every interview the member can see that overlaps [from, to), but cancelled ones, soonest first. */
export async function readSchedule(db: Db, member: Member, window: { from: string; to: string }, now: Date): Promise<Schedule> {
  return assemble(db, member, await scanInterviews(db, { window, ascending: true, max: WINDOW_MAX }), WINDOW_MAX, now);
}

/**
 * Every interview the member can see, on any date, but cancelled ones, for the
 * search to look through: newest first, so a company past the cap loses its
 * oldest. Nothing the member typed reaches the query: lib/client/schedule-search.ts
 * matches on what comes back, which is what the policies let them read.
 */
export async function readAllInterviews(db: Db, member: Member, now: Date): Promise<Schedule> {
  return assemble(db, member, await scanInterviews(db, { window: null, ascending: false, max: SEARCH_SCAN_MAX }), SEARCH_SCAN_MAX, now);
}

/** Interview rows into the Calendar's items: who, for which job, in which department, with whom. */
async function assemble(db: Db, member: Member, rows: InterviewRow[], max: number, now: Date): Promise<Schedule> {
  const [mine, departments] = await Promise.all([
    clientTools.listMyInterviews(db, toolCtx(member), { when: "all" }, now),
    // Archived ones too: a job can still sit in one.
    member.accessLevel === "limited" ? Promise.resolve([]) : clientTools.listDepartments(db, toolCtx(member), { includeArchived: true }),
  ]);
  const interviews = rows.slice(0, max);

  // Who and for which job: the application where the member may read it, else their own my_interviews() row.
  const apps = new Map<string, { candidateName: string | null; jobId: string; jobTitle: string }>();
  for (const m of mine) apps.set(m.applicationId, { candidateName: m.candidateName, jobId: m.jobId, jobTitle: m.jobTitle });
  const unknown = [...new Set(interviews.flatMap((i) => (i.application_id && !apps.has(i.application_id) ? [i.application_id] : [])))];
  if (member.accessLevel !== "limited") {
    const read = await inChunks(unknown, async (chunk) => {
      const { data, error: appError } = await db.from("applications").select("id, role_id, people(display_name), roles(title)").in("id", chunk);
      if (appError) throw new Error(appError.message);
      return data ?? [];
    });
    for (const a of read) apps.set(a.id, { candidateName: a.people?.display_name ?? null, jobId: a.role_id, jobTitle: a.roles?.title ?? "" });
  }

  const shown = interviews.filter((i) => i.application_id && apps.has(i.application_id));
  const jobIds = [...new Set(shown.map((i) => apps.get(i.application_id!)!.jobId))];
  const actorIds = [...new Set(shown.flatMap((i) => i.interviewer_actor_ids))];
  const [jobs, people] = await Promise.all([
    inChunks(jobIds, async (chunk) => {
      const { data, error: jobError } = await db.from("roles").select("id, department_id").in("id", chunk);
      if (jobError) throw new Error(jobError.message);
      return data ?? [];
    }),
    inChunks(actorIds, async (chunk) => {
      const { data, error: nameError } = await db.from("org_members").select("id, display_name").in("id", chunk);
      if (nameError) throw new Error(nameError.message);
      return data ?? [];
    }),
  ]);
  const departmentOf = new Map(jobs.map((j) => [j.id, j.department_id]));
  const names = new Map(people.flatMap((p) => (p.id && p.display_name ? [[p.id, p.display_name] as const] : [])));

  return {
    items: shown.map((i) => {
      const app = apps.get(i.application_id!)!;
      return {
        interviewId: i.id,
        ...app,
        departmentId: departmentOf.get(app.jobId) ?? null,
        startsAt: i.starts_at,
        endsAt: i.ends_at,
        step: i.step,
        // Interviewers no longer at the company drop out, as on the Interviews page.
        interviewers: i.interviewer_actor_ids.flatMap((id) => (names.get(id) ? [names.get(id)!] : [])),
        locationOrLink: i.location_or_link,
      };
    }),
    departments,
    truncated: rows.length > max,
  };
}
