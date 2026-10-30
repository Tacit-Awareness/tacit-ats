import type { clientTools } from "@tacit-ats/core";

// What the Calendar's dialogs ask the server, and what comes back: the one
// contract between schedule/booking.tsx and the route that holds the calendar
// grants (app/(member-calendar)/client/schedule/api/route.ts). Pure, and only
// type imports from core, so a client component can hold it.
//
// A write that is not `confirmed` is a dry run: what forgets the flag gets the
// preview, never a change. The confirmation is read here and only here, as
// `true` and nothing else, so nothing truthy books an interview.

export const SCHEDULE_API = "/client/schedule/api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/i;
const MAX_INTERVIEWERS = 10;
/** Past core's own limits, which say why in a sentence; this only stops what could never be one. */
const TEXT_MAX = 2000;

export type FindRequest = {
  op: "find";
  interviewerIds: string[];
  durationMinutes: number;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  /**
   * Always one: whose free and busy times a member may read hangs on a job they
   * may schedule on, and core asks that only of an application it is given.
   */
  applicationId: string;
};
export type BookRequest = {
  op: "book";
  confirmed: boolean;
  /** Made once per dialog, so a retry of a booking that went through does not book it twice. */
  interviewId: string;
  applicationId: string;
  startsAt: string;
  endsAt: string;
  interviewerIds: string[];
  step: string | null;
  locationOrLink: string | null;
  timezone: string;
  bookDespiteConflicts: boolean;
  /** Tacit's record only: nothing on any calendar. */
  recordOnly: boolean;
};
export type MoveRequest = {
  op: "move";
  confirmed: boolean;
  interviewId: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  bookDespiteConflicts: boolean;
  recordOnly: boolean;
  /** When the member last saw it start. Moved since: refused, not put over someone else's move. */
  was?: string | null;
};
export type CancelRequest = {
  op: "cancel";
  confirmed: boolean;
  interviewId: string;
  timezone: string;
  recordOnly: boolean;
  was?: string | null;
};
export type ScheduleRequest = FindRequest | BookRequest | MoveRequest | CancelRequest;

export type ScheduleErrorCode = "invalid" | "forbidden" | "not_found" | "rate_limited" | "stale" | "failed" | "signed_out";

export type FoundTimes = {
  timezone: string;
  durationMinutes: number;
  slots: clientTools.Slot[];
  /** Names of the interviewers whose calendars were read. */
  checked: string[];
  /** Interviewers whose calendars could not be read, each with why: not assumed free or busy. */
  unknown: { name: string; why: string }[];
};

export type ScheduleAnswer =
  | { ok: true; kind: "times"; found: FoundTimes }
  | { ok: true; kind: "book_preview"; preview: clientTools.SchedulePreview }
  | { ok: true; kind: "change_preview"; op: "move" | "cancel"; preview: clientTools.UpdatePreview }
  /** A confirmed write found someone busy, which the preview had not. Nothing was written. */
  | { ok: true; kind: "conflicts"; conflicts: clientTools.InterviewConflicts }
  | { ok: true; kind: "booked"; interviewId: string; calendar: clientTools.CalendarOutcome }
  | { ok: true; kind: "changed"; op: "move" | "cancel"; calendar: Extract<clientTools.UpdateInterviewResult, { outcome: "updated" | "unchanged" }>["calendar"] }
  /** Already as asked: nothing to do. */
  | { ok: true; kind: "unchanged" }
  /** This dialog's booking again: an earlier try went through, and its answer never came. */
  | { ok: true; kind: "already_booked" }
  | { ok: false; code: ScheduleErrorCode; message: string };

/** When the answer never came: nobody is told a change did, or did not, happen. */
export const COULD_NOT_FINISH = "That did not finish, so it may or may not have gone through. Check the calendar before trying again.";
export const SIGNED_OUT = "Your session has ended. Reload the page and sign in again.";

type Parsed = { ok: true; request: ScheduleRequest } | { ok: false };
const NO: Parsed = { ok: false };

// NUL and half a surrogate pair are text JSON can carry and Postgres cannot store.
const STORABLE = /^(?:[^\0\ud800-\udfff]|[\ud800-\udbff][\udc00-\udfff])*$/;
const isText = (v: unknown, max = TEXT_MAX): v is string => typeof v === "string" && v.length <= max && STORABLE.test(v);
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isInstant = (v: unknown): v is string => typeof v === "string" && INSTANT.test(v.trim()) && !Number.isNaN(Date.parse(v));
const isZone = (v: unknown): v is string => isText(v, 100) && v.trim().length > 0;
const ids = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length >= 1 && v.length <= MAX_INTERVIEWERS && v.every(isId) ? [...new Set(v as string[])] : null;
/** Optional words: absent and blank are both none. */
const words = (v: unknown): { value: string | null } | null => {
  if (v === undefined || v === null) return { value: null };
  if (!isText(v)) return null;
  return { value: v.trim() || null };
};
/** A time the page was showing: absent is none, and anything else must be one. */
const known = (v: unknown): { value: string | null } | null => {
  if (v === undefined || v === null) return { value: null };
  return isInstant(v) ? { value: v } : null;
};

/** What came over the wire, read as a request, or nothing. Anything off the shape is refused, not repaired. */
export function parseScheduleRequest(body: unknown): Parsed {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return NO;
  const b = body as Record<string, unknown>;
  const confirmed = b.confirmed === true;
  const recordOnly = b.recordOnly === true;
  const anyway = b.bookDespiteConflicts === true;
  const timezone = b.timezone;
  if (!isZone(timezone)) return NO;

  switch (b.op) {
    case "find": {
      const interviewerIds = ids(b.interviewerIds);
      if (!interviewerIds || !isInstant(b.windowStart) || !isInstant(b.windowEnd)) return NO;
      if (typeof b.durationMinutes !== "number" || !Number.isInteger(b.durationMinutes)) return NO;
      if (!isId(b.applicationId)) return NO;
      return { ok: true, request: { op: "find", interviewerIds, durationMinutes: b.durationMinutes, windowStart: b.windowStart, windowEnd: b.windowEnd, timezone, applicationId: b.applicationId } };
    }
    case "book": {
      const interviewerIds = ids(b.interviewerIds);
      const step = words(b.step);
      const location = words(b.locationOrLink);
      if (!interviewerIds || !step || !location) return NO;
      if (!isId(b.interviewId) || !isId(b.applicationId) || !isInstant(b.startsAt) || !isInstant(b.endsAt)) return NO;
      return {
        ok: true,
        request: {
          op: "book", confirmed, interviewId: b.interviewId, applicationId: b.applicationId, startsAt: b.startsAt, endsAt: b.endsAt,
          interviewerIds, step: step.value, locationOrLink: location.value, timezone, bookDespiteConflicts: anyway, recordOnly,
        },
      };
    }
    case "move": {
      const was = known(b.was);
      if (!was || !isId(b.interviewId) || !isInstant(b.startsAt) || !isInstant(b.endsAt)) return NO;
      return { ok: true, request: { op: "move", confirmed, interviewId: b.interviewId, startsAt: b.startsAt, endsAt: b.endsAt, timezone, bookDespiteConflicts: anyway, recordOnly, was: was.value } };
    }
    case "cancel": {
      const was = known(b.was);
      if (!was || !isId(b.interviewId)) return NO;
      return { ok: true, request: { op: "cancel", confirmed, interviewId: b.interviewId, timezone, recordOnly, was: was.value } };
    }
    default:
      return NO;
  }
}

/**
 * A request from this site's own pages, by the check Next makes of a server
 * action: its Origin names the host it came to. A cross-site form cannot set
 * JSON's content type without a preflight, and the session cookie is SameSite
 * Lax besides; this says so out loud rather than leaning on either.
 */
export function sameOrigin(headers: Pick<Headers, "get">): boolean {
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host.split(",")[0]!.trim();
  } catch {
    return false;
  }
}
