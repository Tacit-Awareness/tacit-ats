import type { clientTools } from "@tacit-ats/core";

// The interviewer profile on the Interviewers page, the pure half: what its
// form says and what a row shows. A file of its own, with type imports only,
// because profile-editor.tsx is a client component and a value import of
// @tacit-ats/core ships all of it to the browser. The write is clientTools'
// setInterviewerProfile, which reads the same limits; interviewer-profile.test.ts
// holds the two together.

export type StoredProfile = clientTools.StoredInterviewerProfile;

export const WEEKLY_CAP_MAX = 40;
export const FOCUS_AREAS_MAX = 20;
export const FOCUS_AREA_MAX = 60;

/** design/tats's likesLabel, in the words the table's comment names. */
export const PREFERENCE_LABELS: Record<clientTools.InterviewPreference, string> = {
  loves: "Likes it",
  either: "Either way",
  avoids: "Rather not",
};

export const CHANNEL_LABELS: Record<clientTools.InterviewChannel, string> = {
  slack: "Slack",
  imessage: "iMessage",
  email: "Email",
};

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
};

/**
 * The form as clientTools.setInterviewerProfile takes it: an empty field is
 * "has not said", never a value. What is in a field is not judged here; the
 * tool answers for the whole profile, with the field to point at.
 */
export function profileFromForm(form: FormData): clientTools.InterviewerProfileInput {
  const cap = str(form, "weeklyCap");
  return {
    preference: str(form, "preference") || null,
    // A field the number box let through, 1e1 or 2.5, reads as refused: NaN is not a whole number.
    weeklyCap: cap === "" ? null : /^\d{1,3}$/.test(cap) ? Number(cap) : Number.NaN,
    // One per line, the only separator an area cannot hold: "Go, Rust" is one area if they wrote it so.
    focusAreas: str(form, "focusAreas").split(/\r\n?|[\n\u0085\u2028\u2029]/u),
    channel: str(form, "channel") || null,
    awayUntil: str(form, "awayUntil") || null,
  };
}

/** The last day is inclusive, and today is UTC's: an org has no time zone yet, as with the weeks. */
export const isAway = (awayUntil: string | null, now: Date): boolean => awayUntil !== null && awayUntil >= now.toISOString().slice(0, 10);

/** "Away through Nov 14", with the year when it is not this one. Null when they are not away. */
export function awayLabel(awayUntil: string | null, now: Date): string | null {
  if (!isAway(awayUntil, now)) return null;
  const year = awayUntil!.slice(0, 4);
  const date = new Date(`${awayUntil}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(year === now.toISOString().slice(0, 4) ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
  return `Away through ${date}`;
}

/** The most pips a bar draws; past that, each pip stands for more than one interview. */
const MAX_PIPS = 10;

export type LoadMeter = {
  /** How many pips the bar draws. */
  pips: number;
  lit: number;
  /** "2" or, with a limit, "2 of 3". */
  label: string;
  /** More interviews this week than their limit allows. */
  over: boolean;
  title: string;
};

const scaled = (n: number, of: number) => (of <= MAX_PIPS ? n : n > 0 ? Math.max(1, Math.round((n / of) * MAX_PIPS)) : 0);

/**
 * design/tats's `.lbar`. With a limit the bar is the limit, as in the
 * prototype: "2 of 3". Without one there is nothing of theirs to measure
 * against, so it is the team's busiest week. A limit of 0 is a real limit, and
 * draws no pips.
 */
export function loadMeter(n: number, cap: number | null, busiest: number): LoadMeter {
  if (cap === null) {
    const of = Math.max(busiest, 1);
    return { pips: Math.min(of, MAX_PIPS), lit: scaled(n, of), label: String(n), over: false, title: `${n} this week; the busiest on the team has ${busiest}` };
  }
  const over = n > cap;
  return {
    pips: Math.min(cap, MAX_PIPS),
    lit: scaled(Math.min(n, cap), cap),
    label: `${n} of ${cap}`,
    over,
    title: over ? `${n} this week, over their limit of ${cap}` : `${n} this week; their limit is ${cap}`,
  };
}
