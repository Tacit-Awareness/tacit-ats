import { connector, refreshGoogleAccessToken } from "@tacit/core";
import type { Db } from "@tacit/db";

import { ClientToolError, type ClientToolCtx } from "./context.js";
import { awayOn, fullIn, limitedIn, readInterviewerLimits, type LimitedInterviewer } from "./interviewer-limits.js";

/**
 * Calendar scheduling for the client connector: a member's own Google
 * Calendar (connected on apps/web's /client/calendar, stored in
 * calendar_connections, 20261017120000), and the Google calls Tacit-
 * Awareness's staff connector books with (@tacit/core's connector
 * calendar.ts), here with the member's grant instead of a teammate's.
 *
 * The refresh tokens are a secret no member token can read: they arrive
 * through `ClientCalendar.connections`, which apps/mcp (src/client/calendar.ts)
 * and apps/web's Calendar route (lib/member-calendar/grants.ts) implement with
 * the service role. It is called only with the caller
 * and interviewers the caller has already been allowed to name (members of
 * their company, on a job they may schedule on), or the member whose
 * calendar holds an interview the caller's own token has read and may
 * change. Only busy times are ever read from a calendar, never what is in it.
 */

export type CalendarConnection = { accountEmail: string; refreshToken: string };

export type ClientCalendar = {
  /** The Google OAuth client the members' grants were made to (apps/web's connect flow). */
  google: connector.CalendarDeps;
  /** The connections these members of the org have; absent = not connected. */
  connections: (orgId: string, actorIds: string[]) => Promise<Map<string, CalendarConnection>>;
  /** Where a member connects their calendar (apps/web /client/calendar), for the sentences. Null = not said. */
  connectUrl: string | null;
};

export const DEFAULT_INTERVIEW_MINUTES = 60;
export const FIND_WINDOW_MAX_DAYS = 14;
export const FIND_RESULTS_DEFAULT = 10;
export const FIND_RESULTS_MAX = 25;
const SLOT_STEP_MINUTES = 30;
const DAY_MS = 86_400_000;

export const connectHint = (calendar: ClientCalendar | null): string =>
  calendar?.connectUrl ? `Connect it at ${calendar.connectUrl}.` : "Connect it on the Calendar page of Tacit's member area.";

export const notSetUp = (what: string) =>
  new ClientToolError("forbidden", `Calendar scheduling is not set up on this Tacit deployment. ${what}`);

/** A valid IANA zone, or a refusal. */
export function checkTimezone(timezone: string | undefined): string {
  const tz = timezone?.trim() || connector.DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new ClientToolError("invalid", `"${tz}" is not a time zone. Use an IANA name such as America/New_York or Europe/London.`);
  }
  return tz;
}

// ---------------------------------------------------------------------------
// Wall-clock time in a zone, without a date library
// ---------------------------------------------------------------------------

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function wallClock(ms: number, tz: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    year: Number(get("year")), month: Number(get("month")), day: Number(get("day")),
    hour: Number(get("hour")) % 24, minute: Number(get("minute")), weekday: WEEKDAYS.indexOf(get("weekday")),
  };
}

/** The instant a wall-clock time in `tz` names (the earlier one across a DST overlap). */
export function zonedInstant(year: number, month: number, day: number, hour: number, minute: number, tz: string): number {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (ms: number) => {
    const w = wallClock(ms, tz);
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - ms;
  };
  let guess = asUtc - offsetAt(asUtc);
  guess = asUtc - offsetAt(guess);
  return guess;
}

/** "09:00" -> minutes since midnight. */
function clockMinutes(value: string, label: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) throw new ClientToolError("invalid", `${label} is a 24-hour time like 09:00.`);
  return Number(m[1]) * 60 + Number(m[2]);
}

// ---------------------------------------------------------------------------
// Busy times
// ---------------------------------------------------------------------------

export type Person = { userId: string; name: string };
export type Interval = { start: number; end: number };
export type UnknownReason = "not_connected" | "not_shared" | "connection_expired" | "lookup_failed";

export type Availability = {
  /** Busy intervals of each interviewer whose calendar could be read, and how. */
  checked: Map<string, { via: "their_calendar" | "your_calendar"; busy: Interval[] }>;
  unknown: Map<string, UnknownReason>;
  /** The caller's own access token, when they are connected and it refreshed. */
  callerToken: string | null;
  callerConnection: CalendarConnection | null;
  /** Whether the caller's connection exists but would not refresh. */
  callerExpired: boolean;
  connections: Map<string, CalendarConnection>;
  /** Access tokens that refreshed, by member: the caller's (or the holder's) and each connected interviewer's. */
  tokens: Map<string, string>;
};

export async function accessToken(calendar: ClientCalendar, conn: CalendarConnection): Promise<string | null> {
  try {
    return await refreshGoogleAccessToken({
      clientId: calendar.google.clientId, clientSecret: calendar.google.clientSecret,
      refreshToken: conn.refreshToken, fetchImpl: calendar.google.fetch,
    });
  } catch {
    return null;
  }
}

/**
 * Each interviewer's busy intervals in the window: from their own connected
 * calendar when they have one, else from the caller's connection asking for
 * their address (which Google answers inside one Workspace), else unknown.
 * `via` defaults to the caller; a move uses the holder of the event instead.
 */
export async function availability(
  calendar: ClientCalendar,
  ctx: ClientToolCtx,
  interviewers: Array<{ id: string; email: string | null }>,
  window: { startIso: string; endIso: string },
  via: string = ctx.actorId,
): Promise<Availability> {
  const connections = await calendar.connections(ctx.orgId, [...new Set([via, ...interviewers.map((i) => i.id)])]);
  const callerConnection = connections.get(via) ?? null;
  const callerToken = callerConnection ? await accessToken(calendar, callerConnection) : null;
  const checked: Availability["checked"] = new Map();
  const unknown: Availability["unknown"] = new Map();
  const tokens: Availability["tokens"] = new Map(callerToken ? [[via, callerToken]] : []);

  // One free/busy call per access token: each connected interviewer's own, and the caller's for the rest.
  const byToken = new Map<string, Array<{ id: string; email: string; via: "their_calendar" | "your_calendar"; ownExpired: boolean }>>();
  for (const i of interviewers) {
    const own = connections.get(i.id);
    const ownToken = own ? (i.id === via ? callerToken : await accessToken(calendar, own)) : null;
    if (ownToken) tokens.set(i.id, ownToken);
    if (own && ownToken) {
      byToken.set(ownToken, [...(byToken.get(ownToken) ?? []), { id: i.id, email: own.accountEmail, via: "their_calendar", ownExpired: false }]);
    } else if (callerToken && i.email) {
      // An expired connection of their own falls back to the caller's view of their calendar.
      byToken.set(callerToken, [...(byToken.get(callerToken) ?? []), { id: i.id, email: i.email.toLowerCase(), via: "your_calendar", ownExpired: !!own }]);
    } else {
      unknown.set(i.id, own ? "connection_expired" : "not_connected");
    }
  }
  for (const [token, asked] of byToken) {
    let answer: Map<string, connector.BusyInterval[] | null>;
    try {
      answer = await connector.freeBusy(calendar.google, token, [...new Set(asked.map((a) => a.email))], window);
    } catch (err) {
      console.error("[client-tools calendar] free/busy lookup failed", err);
      for (const a of asked) unknown.set(a.id, "lookup_failed");
      continue;
    }
    for (const a of asked) {
      const busy = answer.get(a.email);
      if (!busy) unknown.set(a.id, a.ownExpired ? "connection_expired" : a.via === "your_calendar" ? "not_shared" : "lookup_failed");
      else checked.set(a.id, { via: a.via, busy: busy.map((b) => ({ start: Date.parse(b.startIso), end: Date.parse(b.endIso) })) });
    }
  }
  return {
    checked, unknown, callerToken, callerConnection, callerExpired: !!callerConnection && !callerToken, connections, tokens,
  };
}

const overlaps = (busy: Interval[], start: number, end: number) => busy.some((b) => b.start < end && b.end > start);

/** Who among the checked interviewers has something on in [start, end). */
export function busyIn(avail: Availability, start: number, end: number): string[] {
  return [...avail.checked].filter(([, c]) => overlaps(c.busy, start, end)).map(([id]) => id);
}

/** The interviewers, each a member of the caller's company, with name and address. */
export async function interviewerDetails(db: Db, ids: string[]): Promise<Array<{ id: string; name: string; email: string | null }>> {
  const { data, error } = await db.from("org_members").select("id, display_name, email").in("id", ids);
  if (error) throw new Error(error.message);
  const byId = new Map((data ?? []).map((m) => [m.id, m]));
  return ids.map((id) => ({ id, name: byId.get(id)?.display_name ?? "(no name)", email: byId.get(id)?.email ?? null }));
}

const UNKNOWN_TEXT: Record<UnknownReason, string> = {
  not_connected: "has not connected a calendar, and yours is not connected either",
  not_shared: "has not connected a calendar, and theirs is not shared with yours",
  connection_expired: "connected a calendar, but the connection has expired",
  lookup_failed: "Google did not answer for their calendar",
};
export const unknownText = (reason: UnknownReason) => UNKNOWN_TEXT[reason];

// ---------------------------------------------------------------------------
// find_interview_times
// ---------------------------------------------------------------------------

export type Slot = { startsAt: string; endsAt: string; local: string };
export type FoundTimes = {
  timezone: string;
  durationMinutes: number;
  slots: Slot[];
  checked: Array<Person & { via: "their_calendar" | "your_calendar" }>;
  unknown: Array<Person & { reason: UnknownReason }>;
  /** Interviewers whose own limits took times out: a day away, or a week already at their cap. */
  limited: LimitedInterviewer[];
};

/**
 * Times in the window, inside working hours in `timezone`, when every
 * interviewer whose calendar could be read is free. Interviewers whose
 * calendar could not be read are listed, not assumed free or busy. A day
 * any interviewer is away, and a week any of them already has their cap of
 * interviews in, has no times, whether or not their calendar could be read;
 * they are listed under `limited` (interviewer-limits.ts). Spread across
 * days: the earliest slot of each day first, then the next.
 */
export async function findInterviewTimes(
  db: Db,
  ctx: ClientToolCtx,
  calendar: ClientCalendar | null,
  input: {
    interviewerIds: string[];
    durationMinutes?: number;
    windowStart: string;
    windowEnd: string;
    timezone?: string;
    workdayStart?: string;
    workdayEnd?: string;
    includeWeekends?: boolean;
    applicationId?: string;
    maxResults?: number;
  },
  now: Date = new Date(),
): Promise<FoundTimes> {
  if (ctx.accessLevel === "limited") {
    throw new ClientToolError("forbidden", "Interviewers do not schedule interviews. Whoever schedules for the job can.");
  }
  const tz = checkTimezone(input.timezone);
  const minutes = input.durationMinutes ?? DEFAULT_INTERVIEW_MINUTES;
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 480) {
    throw new ClientToolError("invalid", "duration_minutes is a whole number from 15 to 480.");
  }
  const max = input.maxResults ?? FIND_RESULTS_DEFAULT;
  if (!Number.isInteger(max) || max < 1 || max > FIND_RESULTS_MAX) {
    throw new ClientToolError("invalid", `max_results is from 1 to ${FIND_RESULTS_MAX}.`);
  }
  const dayStart = clockMinutes(input.workdayStart ?? "09:00", "workday_start");
  const dayEnd = clockMinutes(input.workdayEnd ?? "17:00", "workday_end");
  if (dayEnd - dayStart < minutes) throw new ClientToolError("invalid", "The working day is shorter than the interview.");
  const from = Math.max(Date.parse(instant(input.windowStart, "window_start")), now.getTime());
  const to = Date.parse(instant(input.windowEnd, "window_end"));
  if (to <= from) throw new ClientToolError("invalid", "window_end must be after window_start and in the future.");
  if (to - from > FIND_WINDOW_MAX_DAYS * DAY_MS) {
    throw new ClientToolError("invalid", `The window is at most ${FIND_WINDOW_MAX_DAYS} days. Ask for the first two weeks, then the next.`);
  }
  if (!calendar) throw notSetUp("Nobody's availability can be read.");

  const ids = await checkInterviewers(db, input.interviewerIds);
  if (input.applicationId) await requireCanSchedule(db, input.applicationId);
  const people = await interviewerDetails(db, ids);
  const window = { startIso: new Date(from).toISOString(), endIso: new Date(to).toISOString() };
  const avail = await availability(calendar, ctx, people, window);
  const name = (id: string) => people.find((p) => p.id === id)!.name;
  if (!avail.checked.size) {
    const own = avail.callerExpired
      ? `Your Google connection has expired. ${connectHint(calendar)}`
      : !avail.callerConnection ? `Your calendar is not connected. ${connectHint(calendar)}` : "";
    throw new ClientToolError(
      "invalid",
      `No interviewer's calendar could be read: ${[...avail.unknown].map(([id, r]) => `${name(id)} ${unknownText(r)}`).join("; ")}. ${own}`.trim(),
    );
  }

  const limits = await readInterviewerLimits(db, ids, { from, to });

  // Every candidate start, day by day in the zone.
  const step = SLOT_STEP_MINUTES * 60_000;
  const length = minutes * 60_000;
  const byDay: Interval[][] = [];
  const first = wallClock(from, tz);
  for (let d = 0; d <= FIND_WINDOW_MAX_DAYS + 1; d++) {
    const date = new Date(Date.UTC(first.year, first.month - 1, first.day + d));
    const y = date.getUTCFullYear(), m = date.getUTCMonth() + 1, day = date.getUTCDate();
    const open = zonedInstant(y, m, day, Math.floor(dayStart / 60), dayStart % 60, tz);
    if (open >= to) break;
    if (!input.includeWeekends && [0, 6].includes(wallClock(open, tz).weekday)) continue;
    if (awayOn(limits, isoDate(y, m, day)).length) continue;
    const close = zonedInstant(y, m, day, Math.floor(dayEnd / 60), dayEnd % 60, tz);
    const slots: Interval[] = [];
    // Starts on the half hour of the working day, from the first one not before `from`.
    let s = open + Math.max(0, Math.ceil((from - open) / step)) * step;
    for (; s + length <= Math.min(close, to); s += step) {
      if (!busyIn(avail, s, s + length).length && !fullIn(limits, s).length) slots.push({ start: s, end: s + length });
    }
    if (slots.length) byDay.push(slots);
  }
  const picked: Interval[] = [];
  for (let round = 0; picked.length < max && byDay.some((d) => d.length > round); round++) {
    for (const d of byDay) if (d[round] && picked.length < max) picked.push(d[round]);
  }
  picked.sort((a, b) => a.start - b.start);

  return {
    timezone: tz,
    durationMinutes: minutes,
    slots: picked.map((p) => ({
      startsAt: new Date(p.start).toISOString(), endsAt: new Date(p.end).toISOString(), local: connector.formatLocal(new Date(p.start).toISOString(), tz),
    })),
    checked: [...avail.checked].map(([id, c]) => ({ userId: id, name: name(id), via: c.via })),
    unknown: [...avail.unknown].map(([id, reason]) => ({ userId: id, name: name(id), reason })),
    limited: limitedIn(limits, people.map((p) => ({ userId: p.id, name: p.name })), {
      from, to, firstDay: isoDate(first.year, first.month, first.day),
    }),
  };
}

const isoDate = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// Shared checks (also used by interviews.ts)
// ---------------------------------------------------------------------------

/** An instant the caller must give with its offset: a bare local time is ambiguous across time zones. */
export function instant(value: string, label: string): string {
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(value.trim()) || Number.isNaN(Date.parse(value))) {
    throw new ClientToolError("invalid", `${label} must be an ISO 8601 time with its offset, e.g. 2026-10-20T15:00:00-07:00.`);
  }
  return new Date(value).toISOString();
}

const MAX_INTERVIEWERS = 10;

/** The interviewers, each an active member of the caller's company. */
export async function checkInterviewers(db: Db, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) throw new ClientToolError("invalid", "An interview needs at least one interviewer.");
  if (unique.length > MAX_INTERVIEWERS) throw new ClientToolError("invalid", `At most ${MAX_INTERVIEWERS} interviewers.`);
  const { data, error } = await db.from("org_members").select("id").in("id", unique);
  if (error) throw new Error(error.message);
  const found = new Set((data ?? []).map((m) => m.id));
  if (unique.some((id) => !found.has(id))) {
    throw new ClientToolError("not_found", "Every interviewer must be someone at your company. Call list_team for the user ids.");
  }
  return unique;
}

async function requireCanSchedule(db: Db, applicationId: string): Promise<void> {
  const { data: app, error } = await db.from("applications").select("id, role_id").eq("id", applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!app) throw new ClientToolError("not_found", "No application with that id that you can see. get_pipeline and get_candidate list them.");
  const { data, error: permError } = await db.rpc("can_on_role", { p_role: app.role_id, perm: "can_schedule" });
  if (permError) throw new Error(permError.message);
  if (data !== true) throw new ClientToolError("forbidden", "You can see that candidate but not schedule interviews on this job.");
}
