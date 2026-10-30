import type { Db } from "@tacit/db";

import { activeMember } from "./admin.js";
import { withAudit } from "./audit.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";

/**
 * How a member wants to be used as an interviewer (interviewer_profiles,
 * tacit-internal 20261030210000): their own row at any access level, an admin
 * any row in their org, as the policies say. No row or a null means they have
 * not said. The rules here turn what the table's trigger would refuse into a
 * sentence and a field, and tidy what a person pastes; the table still decides.
 *
 * The form sends the whole profile, so it carries the `updated_at` the page
 * showed: a save made since is reported and not overwritten, as a stage move is.
 * The audit row names the fields that changed and never their values: a
 * teammate's "rather not" or date away is not everyone's to read.
 */

export const INTERVIEW_PREFERENCES = ["loves", "either", "avoids"] as const;
export type InterviewPreference = (typeof INTERVIEW_PREFERENCES)[number];

export const INTERVIEW_CHANNELS = ["slack", "imessage", "email"] as const;
export type InterviewChannel = (typeof INTERVIEW_CHANNELS)[number];

export const WEEKLY_CAP_MAX = 40;
export const FOCUS_AREAS_MAX = 20;
export const FOCUS_AREA_MAX = 60;

export type InterviewerProfile = {
  preference: InterviewPreference | null;
  /** Most interviews a week. Null: no limit set. 0: none. */
  weeklyCap: number | null;
  focusAreas: string[];
  channel: InterviewChannel | null;
  /** The last day they are away, inclusive, YYYY-MM-DD. Past or null: not away. */
  awayUntil: string | null;
};

/** A profile as a form or a caller sent it, before cleanProfile has read it. */
export type InterviewerProfileInput = {
  preference: string | null;
  weeklyCap: number | null;
  focusAreas: string[];
  channel: string | null;
  awayUntil: string | null;
};

/** A saved profile, with the version a later save has to name. */
export type StoredInterviewerProfile = InterviewerProfile & { updatedAt: string };

export const PROFILE_COLUMNS = "actor_id, interview_preference, weekly_interview_cap, focus_areas, preferred_channel, away_until, updated_at";

export type ProfileRow = {
  actor_id: string;
  interview_preference: string | null;
  weekly_interview_cap: number | null;
  focus_areas: string[];
  preferred_channel: string | null;
  away_until: string | null;
  updated_at: string;
};

// The table's trigger, code point for code point (interviewer_profiles_validate):
// EDGE is what cannot start or end an item, INLINE what cannot be in one.
const CONTROL = "\\u0000-\\u001f\\u007f-\\u009f";
const EDGE = `[${CONTROL} \\u00a0\\u00ad\\u1680\\u2000-\\u200f\\u2028-\\u202f\\u205f-\\u206f\\u3000\\ufeff]`;
const OUTER = new RegExp(`^${EDGE}+|${EDGE}+$`, "gu");
const INLINE = new RegExp(`[${CONTROL}\\u2028-\\u202e\\u2066-\\u2069]`, "u");

const FOCUS_INVALID = `Keep what they know to ${FOCUS_AREAS_MAX} areas, one per line, each ${FOCUS_AREA_MAX} characters at most.`;

const oneOf = <T extends string>(allowed: readonly T[], value: string | null, message: string, field: string): T | null => {
  if (value === null) return null;
  if (!allowed.includes(value as T)) throw new ClientToolError("invalid", message, field);
  return value as T;
};

/** A date the table holds: a real day, year 1 to 9999. */
function isDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s.startsWith("0000")) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/**
 * Trims each area of what cannot show, drops the blank ones and any repeat
 * (ignoring case and composition, keeping the first as written), then refuses
 * what the table would.
 */
export function cleanFocusAreas(areas: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of areas) {
    const area = raw.replace(OUTER, "");
    const folded = area.toLowerCase().normalize("NFC");
    if (!area || seen.has(folded)) continue;
    seen.add(folded);
    out.push(area);
  }
  if (out.length > FOCUS_AREAS_MAX || out.some((a) => [...a].length > FOCUS_AREA_MAX || INLINE.test(a))) {
    throw new ClientToolError("invalid", FOCUS_INVALID, "focusAreas");
  }
  return out;
}

export function cleanProfile(input: InterviewerProfileInput): InterviewerProfile {
  const { weeklyCap, awayUntil } = input;
  if (weeklyCap !== null && (!Number.isInteger(weeklyCap) || weeklyCap < 0 || weeklyCap > WEEKLY_CAP_MAX)) {
    throw new ClientToolError("invalid", `Interviews a week is a whole number from 0 to ${WEEKLY_CAP_MAX}, or empty for no limit.`, "weeklyCap");
  }
  if (awayUntil !== null && !isDate(awayUntil)) throw new ClientToolError("invalid", "Pick the last day they are away, or leave it empty.", "awayUntil");
  return {
    preference: oneOf(INTERVIEW_PREFERENCES, input.preference, "Pick likes it, either way or rather not.", "preference"),
    weeklyCap,
    focusAreas: cleanFocusAreas(input.focusAreas),
    channel: oneOf(INTERVIEW_CHANNELS, input.channel, "Pick Slack, iMessage or email.", "channel"),
    awayUntil,
  };
}

export const profileFromRow = (r: ProfileRow): StoredInterviewerProfile => ({
  preference: (r.interview_preference as InterviewPreference | null) ?? null,
  weeklyCap: r.weekly_interview_cap,
  focusAreas: r.focus_areas ?? [],
  channel: (r.preferred_channel as InterviewChannel | null) ?? null,
  awayUntil: r.away_until,
  updatedAt: r.updated_at,
});

const COLUMN_OF: Record<keyof InterviewerProfile, string> = {
  preference: "interview_preference",
  weeklyCap: "weekly_interview_cap",
  focusAreas: "focus_areas",
  channel: "preferred_channel",
  awayUntil: "away_until",
};

/** The columns whose values differ. A reordered list is a change: the order is theirs. */
function changedColumns(before: InterviewerProfile, after: InterviewerProfile): string[] {
  return (Object.keys(COLUMN_OF) as Array<keyof InterviewerProfile>)
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => COLUMN_OF[k]);
}

const NOTHING_SAID: InterviewerProfile = { preference: null, weeklyCap: null, focusAreas: [], channel: null, awayUntil: null };

export type SetProfileResult = { outcome: "changed" | "unchanged" | "stale" };

export async function setInterviewerProfile(
  db: Db,
  ctx: ClientToolCtx,
  input: {
    memberId: string;
    /** The `updated_at` the page showed; null when it showed no profile. */
    expectedUpdatedAt: string | null;
    profile: InterviewerProfileInput;
  },
): Promise<SetProfileResult> {
  const { memberId } = input;
  const own = memberId === ctx.actorId;
  if (!own && ctx.accessLevel !== "admin") throw new ClientToolError("forbidden", "Only an admin can change someone else's interviewer profile.");
  const profile = cleanProfile(input.profile);
  if (!own) await activeMember(db, memberId);

  const { data: row, error: readError } = await db.from("interviewer_profiles").select(PROFILE_COLUMNS).eq("actor_id", memberId).maybeSingle();
  if (readError) throw new Error(readError.message);
  const current = row ? profileFromRow(row) : null;
  const fields = changedColumns(current ?? NOTHING_SAID, profile);
  if (!fields.length) return { outcome: "unchanged" };
  if ((current?.updatedAt ?? null) !== input.expectedUpdatedAt) return { outcome: "stale" };

  const values = {
    interview_preference: profile.preference,
    weekly_interview_cap: profile.weeklyCap,
    focus_areas: profile.focusAreas,
    preferred_channel: profile.channel,
    away_until: profile.awayUntil,
  };
  return withAudit<SetProfileResult>(db, ctx, { action: "interviewer_profile.update", entity: "actor" }, async () => {
    const write = current
      ? await db.from("interviewer_profiles").update(values).eq("actor_id", memberId).eq("updated_at", current.updatedAt).select("actor_id")
      : await db.from("interviewer_profiles").insert({ actor_id: memberId, ...values }).select("actor_id");
    const { data, error } = write;
    if (error) {
      // Two first saves at once: the second one finds the row.
      if (error.code === "23505") return { result: { outcome: "stale" }, entityId: null, changed: false };
      if (error.code === "23503") throw new ClientToolError("not_found", "No one at your company with that user id.");
      if (error.code === "42501") throw new ClientToolError("forbidden", "Only an admin can change someone else's interviewer profile.");
      // What this file's rules passed and the table's did not: its idea of a repeat, say.
      if (error.code === "22023" || error.code === "23514") throw new ClientToolError("invalid", FOCUS_INVALID, "focusAreas");
      throw new Error(error.message);
    }
    if (!data?.length) return { result: { outcome: "stale" }, entityId: null, changed: false };
    return { result: { outcome: "changed" }, entityId: memberId, after: { fields }, changed: true };
  });
}
