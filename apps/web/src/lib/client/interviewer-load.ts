// The Interviewers page's arithmetic, pure: who counts as an interviewer, how
// many interviews each has this week, next week and in the last 30 days, the
// jobs they are on, and the department sections they fall into. The reads are
// lib/client/interviewers.ts.
//
// Weeks are calendar weeks, Monday to Sunday, in UTC: an org has no time zone
// yet, so an interview late on a Sunday in the Americas counts in the week
// after.

const DAY = 86_400_000;

/** Jobs whose hiring team no longer interviews anyone. */
const FINISHED_JOB = new Set(["filled", "closed"]);

export type LoadInterview = { startsAt: string; interviewerIds: string[]; roleId: string };

export type Load = { thisWeek: number; nextWeek: number; last30: number };

export type TeamSeat = { roleId: string; actorId: string; teamRole: string };

export type JobRef = { id: string; title: string; status: string; departmentId: string | null };

export type DepartmentRef = { id: string; name: string; parentId: string | null };

export type Feedback = { onTime: number; late: number; notFiled: number; notVisible: number };

export type Interviewer = {
  actorId: string;
  name: string;
  load: Load;
  jobs: Array<{ id: string; title: string }>;
  /** Department paths of their jobs, "Engineering > Platform", sorted. */
  departments: string[];
  /** Null when the member may not read interviewer activity, or it has nothing on them. */
  feedback: Feedback | null;
};

export type InterviewerGroup = { label: string | null; interviewers: Interviewer[] };

/** The Monday 00:00 UTC starting this week, the next one, and the Monday after that. */
export function weekBounds(now: Date): { thisWeek: number; nextWeek: number; end: number } {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sinceMonday = (new Date(day).getUTCDay() + 6) % 7;
  const thisWeek = day - sinceMonday * DAY;
  return { thisWeek, nextWeek: thisWeek + 7 * DAY, end: thisWeek + 14 * DAY };
}

/** The earliest start an interview needs for any column: 30 days back, or this Monday if earlier. */
export function readWindow(now: Date): { from: string; to: string } {
  const { thisWeek, end } = weekBounds(now);
  return { from: new Date(Math.min(thisWeek, now.getTime() - 30 * DAY)).toISOString(), to: new Date(end).toISOString() };
}

/**
 * Each interviewer's count by when the interview starts: this calendar week
 * (including the days already gone), next week, and the 30 days before now.
 * An interview this week that already happened counts in both.
 */
export function countLoad(interviews: LoadInterview[], now: Date): Map<string, Load> {
  const { thisWeek, nextWeek, end } = weekBounds(now);
  const nowMs = now.getTime();
  const out = new Map<string, Load>();
  for (const i of interviews) {
    const t = Date.parse(i.startsAt);
    for (const id of new Set(i.interviewerIds)) {
      const load = out.get(id) ?? { thisWeek: 0, nextWeek: 0, last30: 0 };
      if (t >= thisWeek && t < nextWeek) load.thisWeek += 1;
      else if (t >= nextWeek && t < end) load.nextWeek += 1;
      if (t >= nowMs - 30 * DAY && t < nowMs) load.last30 += 1;
      out.set(id, load);
    }
  }
  return out;
}

/** Outermost first: "Engineering > Platform". A broken or looping parent chain stops where it breaks. */
export function departmentPaths(rows: DepartmentRef[]): Map<string, string> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, string>();
  for (const row of rows) {
    const names = [row.name];
    const seen = new Set([row.id]);
    for (let p = row.parentId; p && !seen.has(p); p = byId.get(p)?.parentId ?? null) {
      seen.add(p);
      const parent = byId.get(p);
      if (!parent) break;
      names.unshift(parent.name);
    }
    out.set(row.id, names.join(" > "));
  }
  return out;
}

/**
 * One row per member who interviews: an interviewer on the hiring team of a
 * job still hiring, anyone with an interview in the window, and anyone the
 * feedback report has. Their jobs are the live ones whose hiring team they
 * are on (any seat) plus the jobs of the interviews counted.
 */
export function assembleInterviewers(input: {
  interviews: LoadInterview[];
  seats: TeamSeat[];
  jobs: JobRef[];
  departments: DepartmentRef[];
  names: Map<string, string>;
  feedback: Map<string, Feedback> | null;
  now: Date;
}): Interviewer[] {
  const jobs = new Map(input.jobs.map((j) => [j.id, j]));
  const live = (roleId: string) => {
    const job = jobs.get(roleId);
    return job !== undefined && !FINISHED_JOB.has(job.status);
  };
  const paths = departmentPaths(input.departments);
  const load = countLoad(input.interviews, input.now);

  const ids = new Set<string>();
  for (const s of input.seats) if (s.teamRole === "interviewer" && live(s.roleId)) ids.add(s.actorId);
  for (const id of load.keys()) ids.add(id);
  for (const id of input.feedback?.keys() ?? []) ids.add(id);

  const jobsOf = new Map<string, Set<string>>();
  const add = (actorId: string, roleId: string) => {
    if (!ids.has(actorId) || !jobs.has(roleId)) return;
    jobsOf.set(actorId, (jobsOf.get(actorId) ?? new Set()).add(roleId));
  };
  for (const s of input.seats) if (live(s.roleId)) add(s.actorId, s.roleId);
  for (const i of input.interviews) for (const id of i.interviewerIds) add(id, i.roleId);

  return [...ids]
    .map((actorId) => {
      const mine = [...(jobsOf.get(actorId) ?? [])].map((id) => jobs.get(id)!).sort((a, b) => a.title.localeCompare(b.title));
      const departments = [...new Set(mine.flatMap((j) => (j.departmentId && paths.has(j.departmentId) ? [paths.get(j.departmentId)!] : [])))].sort();
      return {
        actorId,
        name: input.names.get(actorId) || "Unknown",
        load: load.get(actorId) ?? { thisWeek: 0, nextWeek: 0, last30: 0 },
        jobs: mine.map((j) => ({ id: j.id, title: j.title })),
        departments,
        feedback: input.feedback?.get(actorId) ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.actorId.localeCompare(b.actorId));
}

export const SEVERAL_DEPARTMENTS = "Several departments";
export const NO_DEPARTMENT = "No department";

/**
 * Sections by department, alphabetical, then whoever's jobs span several,
 * then whoever's jobs have none. When nobody has a department there is
 * nothing to group by, and the list is one unlabelled section.
 */
export function groupByDepartment(interviewers: Interviewer[]): InterviewerGroup[] {
  if (!interviewers.some((i) => i.departments.length > 0)) return interviewers.length ? [{ label: null, interviewers }] : [];
  const by = new Map<string, Interviewer[]>();
  for (const i of interviewers) {
    const label = i.departments.length === 1 ? i.departments[0]! : i.departments.length > 1 ? SEVERAL_DEPARTMENTS : NO_DEPARTMENT;
    by.set(label, [...(by.get(label) ?? []), i]);
  }
  const rank = (label: string) => (label === SEVERAL_DEPARTMENTS ? 1 : label === NO_DEPARTMENT ? 2 : 0);
  return [...by.keys()]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((label) => ({ label, interviewers: by.get(label)! }));
}
