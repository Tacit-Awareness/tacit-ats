import type { Db } from "@tacit/db";

import type { Person } from "./calendar.js";

/**
 * What find-a-time leaves out for an interviewer's own limits, from their
 * interviewer profile (interviewer-profiles.ts): every day they are away,
 * through away_until inclusive, and every week they already have their weekly
 * cap of interviews in. A day is the date in the zone the times are found in;
 * a week is Monday to Sunday in UTC, the Interviewers page's week (apps/web
 * lib/client/interviewer-load.ts), since an org has no time zone yet.
 *
 * Both reads are on the caller's own token, so the policies decide what counts.
 * A profile comes back to an admin or the company's own hiring team, and to an
 * external recruiter only for themselves: a teammate's date away is not theirs
 * to read, so for them it is not applied and nothing says why. Whoever reads
 * a row may see what it says, on the Interviewers page too, so the answer names
 * the reason. The interviews counted are the ones the caller can read, as on
 * that page: a hiring manager counts their own jobs'.
 */

export type LimitProfile = { weeklyCap: number | null; awayUntil: string | null };

export type InterviewerLimits = {
  profiles: Map<string, LimitProfile>;
  /** Interviews already on, by interviewer, by the week's Monday (YYYY-MM-DD). */
  booked: Map<string, Map<string, number>>;
};

export type FullWeek = { weekOf: string; booked: number; cap: number };

/** An interviewer whose limits took times out of the window. */
export type LimitedInterviewer = Person & {
  /** The last day they are away, when it falls in the window. */
  awayThrough: string | null;
  /** The weeks in the window they already have their cap of interviews in. */
  fullWeeks: FullWeek[];
};

const DAY_MS = 86_400_000;
/** More rows than ten interviewers at a cap of 40 over three weeks could need. */
const BOOKED_MAX = 2000;

/** The Monday 00:00 UTC of the week `ms` falls in. */
export function weekStart(ms: number): number {
  const day = Math.floor(ms / DAY_MS) * DAY_MS;
  return day - ((new Date(day).getUTCDay() + 6) % 7) * DAY_MS;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The Mondays of the weeks [from, to) touches. */
export function weeksOf(from: number, to: number): string[] {
  const out: string[] = [];
  for (let w = weekStart(from); w < to; w += 7 * DAY_MS) out.push(isoDay(w));
  return out;
}

/** The profiles the caller may read of these interviewers, and their interviews in the weeks the window touches. */
export async function readInterviewerLimits(db: Db, ids: string[], window: { from: number; to: number }): Promise<InterviewerLimits> {
  const [profiles, interviews] = await Promise.all([
    db.from("interviewer_profiles").select("actor_id, weekly_interview_cap, away_until").in("actor_id", ids),
    db
      .from("interviews")
      .select("starts_at, interviewer_actor_ids, applications!inner(merged_into_id)")
      .overlaps("interviewer_actor_ids", ids)
      .neq("status", "cancelled")
      .is("applications.merged_into_id", null)
      .gte("starts_at", new Date(weekStart(window.from)).toISOString())
      .lt("starts_at", new Date(weekStart(window.to - 1) + 7 * DAY_MS).toISOString())
      .order("starts_at")
      .limit(BOOKED_MAX),
  ]);
  for (const r of [profiles, interviews]) if (r.error) throw new Error(r.error.message);

  const wanted = new Set(ids);
  const booked: InterviewerLimits["booked"] = new Map();
  for (const i of interviews.data ?? []) {
    const week = isoDay(weekStart(Date.parse(i.starts_at)));
    for (const id of new Set(i.interviewer_actor_ids ?? [])) {
      if (!wanted.has(id)) continue;
      const weeks = booked.get(id) ?? new Map<string, number>();
      weeks.set(week, (weeks.get(week) ?? 0) + 1);
      booked.set(id, weeks);
    }
  }
  return {
    profiles: new Map((profiles.data ?? []).map((p) => [p.actor_id, { weeklyCap: p.weekly_interview_cap, awayUntil: p.away_until }])),
    booked,
  };
}

/** Who is away on this day (YYYY-MM-DD). */
export function awayOn(limits: InterviewerLimits, day: string): string[] {
  return [...limits.profiles].filter(([, p]) => p.awayUntil !== null && p.awayUntil >= day).map(([id]) => id);
}

/** Who already has their cap of interviews in the week `ms` falls in. */
export function fullIn(limits: InterviewerLimits, ms: number): string[] {
  const week = isoDay(weekStart(ms));
  return [...limits.profiles]
    .filter(([id, p]) => p.weeklyCap !== null && (limits.booked.get(id)?.get(week) ?? 0) >= p.weeklyCap)
    .map(([id]) => id);
}

/** The interviewers whose limits fall in the window: away on its first day or later, or full in a week it touches. */
export function limitedIn(limits: InterviewerLimits, people: Person[], window: { from: number; to: number; firstDay: string }): LimitedInterviewer[] {
  const weeks = weeksOf(window.from, window.to);
  const out: LimitedInterviewer[] = [];
  for (const person of people) {
    const p = limits.profiles.get(person.userId);
    if (!p) continue;
    const awayThrough = p.awayUntil !== null && p.awayUntil >= window.firstDay ? p.awayUntil : null;
    const cap = p.weeklyCap;
    const fullWeeks = cap === null
      ? []
      : weeks
        .map((weekOf) => ({ weekOf, booked: limits.booked.get(person.userId)?.get(weekOf) ?? 0, cap }))
        .filter((w) => w.booked >= cap);
    if (awayThrough || fullWeeks.length) out.push({ ...person, awayThrough, fullWeeks });
  }
  return out;
}

const dayWords = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

/** "away through Nov 14; has 3 of 3 interviews the week of Nov 9", after their name. */
export function limitText(l: Pick<LimitedInterviewer, "awayThrough" | "fullWeeks">): string {
  const parts: string[] = [];
  if (l.awayThrough) parts.push(`away through ${dayWords(l.awayThrough)}`);
  for (const w of l.fullWeeks) {
    parts.push(w.cap === 0
      ? `takes no interviews the week of ${dayWords(w.weekOf)}`
      : `has ${w.booked} of ${w.cap} interviews the week of ${dayWords(w.weekOf)}`);
  }
  return parts.join("; ");
}
