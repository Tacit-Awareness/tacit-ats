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

const fold = (area: string) => area.toLowerCase().normalize("NFC");

/**
 * What the tag input adds, a line or a pasted list: repeats dropped as core's
 * cleanFocusAreas drops them, ignoring case and keeping the first. Over a limit
 * nothing is added and `refused` says why, so what was typed stays in the field.
 */
export function addAreas(current: string[], raw: string): { areas: string[]; refused: string | null } {
  const areas = [...current];
  const seen = new Set(current.map(fold));
  for (const line of raw.split(/\r\n?|[\n\u0085\u2028\u2029]/u)) {
    const area = line.trim();
    if (!area || seen.has(fold(area))) continue;
    if ([...area].length > FOCUS_AREA_MAX) return { areas: current, refused: `Each one is ${FOCUS_AREA_MAX} characters at most.` };
    seen.add(fold(area));
    areas.push(area);
  }
  if (areas.length > FOCUS_AREAS_MAX) return { areas: current, refused: `${FOCUS_AREAS_MAX} is the most one person can have.` };
  return { areas, refused: null };
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

export type AwayMember = { actorId: string; name: string; awayUntil: string };

/** Names the Calendar's banner spells out; past that, "and N more". */
const AWAY_NAMED = 4;

/**
 * The Calendar's away banner (design/tats's `cal-away`): "Wei: away through
 * Nov 14 · Sam: away through Nov 20", soonest back first, by first name. Its
 * `key` (for lib/banner-rules.ts's bannerTag) changes with who is away and until when, so a dismissed banner comes
 * back when someone else goes away. Null when nobody is.
 */
export function awayBanner(members: AwayMember[], now: Date): { title: string; key: string[] } | null {
  const away = members
    .filter((m) => m.name.trim() && isAway(m.awayUntil, now))
    .sort((a, b) => a.awayUntil.localeCompare(b.awayUntil) || a.name.localeCompare(b.name));
  if (!away.length) return null;
  const named = away.slice(0, AWAY_NAMED).map((m) => `${m.name.trim().split(/\s+/)[0]}: ${awayLabel(m.awayUntil, now)!.replace(/^Away/, "away")}`);
  const rest = away.length - named.length;
  return { title: named.join(" · ") + (rest ? ` · and ${rest} more` : ""), key: away.map((m) => `${m.actorId}@${m.awayUntil}`).sort() };
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
