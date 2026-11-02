import type { Recommendation } from "./interview-groups";

// Filing interview feedback from the Interviews reader: the posted form read
// back, pure and type-only, since the form is a client component. Core's
// `submitFeedback` checks everything again; this refuses what a form should
// never send, so a refusal can keep what was typed and point at the field.
// The limits are core's (FEEDBACK_MAX, RATING_NOTE_MAX), repeated here and held
// together by feedback-rules.test.ts.

export const RECOMMENDATIONS: readonly Recommendation[] = ["strong_yes", "yes", "no", "strong_no"];
export const FEEDBACK_NOTES_MAX = 10_000;
export const RATING_NOTE_MAX = 500;
export const SCALE = [1, 2, 3, 4] as const;

export type FeedbackError =
  | "no_recommendation"
  | "no_notes"
  | "too_long"
  | "bad_rating"
  | "not_interviewer"
  | "cancelled"
  | "not_yet"
  | "scorecard_changed"
  | "rate_limited"
  | "failed";

export const FEEDBACK_ERRORS: Record<FeedbackError, string> = {
  no_recommendation: "Pick a recommendation.",
  no_notes: "Write your notes. Feedback needs them.",
  too_long: "That is too long. Notes are at most 10,000 characters, and a rating's note 500.",
  bad_rating: "A rating is 1 to 4.",
  not_interviewer: "You weren't an interviewer on this one, so you can't file feedback on it.",
  cancelled: "This interview was cancelled. Nothing was saved.",
  not_yet: "This interview hasn't happened yet. Nothing was saved.",
  scorecard_changed: "The job's scorecard changed since this page loaded. Reload and rate it again. Nothing was saved.",
  rate_limited: "You've made 300 changes in the last hour, the limit. Try again later.",
  failed: "Something went wrong, so it may not have saved. Reload to see.",
};

/** What the form holds, and what a refusal hands back to it. Ratings and their notes by attribute id. */
export type FeedbackDraft = {
  recommendation: Recommendation | null;
  rating: number | null;
  notes: string;
  ratings: Record<string, number>;
  ratingNotes: Record<string, string>;
};

export type ScorecardItem = { attributeId: string; name: string; description: string | null };

/** What the form opens on: the job's scorecard and the member's own filing, if any. */
export type FeedbackForm = { interviewId: string; attributes: ScorecardItem[]; draft: FeedbackDraft; filed: boolean };

export type FeedbackInput = {
  interviewId: string;
  recommendation: Recommendation;
  rating: number | null;
  notes: string;
  ratings: { attributeId: string; rating: number; note: string | null }[];
};

export type FeedbackState = { filed: number } | { filed: number; error: FeedbackError; draft: FeedbackDraft };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A textarea posts CRLF and counts it as one for maxLength; Postgres text cannot hold a NUL. */
const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replaceAll("\0", "") : "");

const score = (v: FormDataEntryValue | null): number | null | undefined => {
  const s = text(v).trim();
  if (!s) return null;
  return /^[1-4]$/.test(s) ? Number(s) : undefined;
};

export const isRecommendation = (v: unknown): v is Recommendation => typeof v === "string" && (RECOMMENDATIONS as readonly string[]).includes(v);

/**
 * The posted form: `interviewId`, `recommendation`, `rating`, `notes`, and per
 * scorecard attribute `r:<id>` (1-4 or blank) and `rn:<id>`. Only the ids the
 * page drew (`attr`, posted once each) are read, so a tampered field adds no
 * rating; core checks those ids against the job again. A note on an unrated
 * attribute goes nowhere, as a rating needs a number.
 */
export function parseFeedback(form: FormData): { ok: true; input: FeedbackInput; draft: FeedbackDraft } | { ok: false; error: FeedbackError; draft: FeedbackDraft } | { ok: false; error: null } {
  const interviewId = text(form.get("interviewId"));
  if (!UUID.test(interviewId)) return { ok: false, error: null };

  const posted = text(form.get("recommendation"));
  const recommendation = isRecommendation(posted) ? posted : null;
  const rating = score(form.get("rating"));
  const notes = text(form.get("notes"));
  const ids = [...new Set(form.getAll("attr").map(text).filter((id) => UUID.test(id)))];

  const draft: FeedbackDraft = { recommendation, rating: rating ?? null, notes, ratings: {}, ratingNotes: {} };
  let badRating = rating === undefined;
  let tooLong = notes.trim().length > FEEDBACK_NOTES_MAX;
  const ratings: FeedbackInput["ratings"] = [];
  for (const id of ids) {
    const r = score(form.get(`r:${id}`));
    const note = text(form.get(`rn:${id}`));
    if (note) draft.ratingNotes[id] = note;
    if (note.trim().length > RATING_NOTE_MAX) tooLong = true;
    if (r === undefined) badRating = true;
    else if (r !== null) {
      draft.ratings[id] = r;
      ratings.push({ attributeId: id, rating: r, note: note.trim() || null });
    }
  }

  if (!recommendation) return { ok: false, error: "no_recommendation", draft };
  if (badRating) return { ok: false, error: "bad_rating", draft };
  if (!notes.trim()) return { ok: false, error: "no_notes", draft };
  if (tooLong) return { ok: false, error: "too_long", draft };
  return { ok: true, input: { interviewId, recommendation, rating: rating ?? null, notes: notes.trim(), ratings }, draft };
}

/** Core's refusals as the form's codes. `invalid` is told apart by its sentence, which feedback.test.ts pins. */
export function feedbackRefusal(code: string, message: string): FeedbackError {
  if (code === "forbidden") return "not_interviewer";
  if (code === "rate_limited") return "rate_limited";
  if (code === "not_found") return "scorecard_changed";
  if (/cancelled/i.test(message)) return "cancelled";
  if (/not happened yet/i.test(message)) return "not_yet";
  if (/whole number/i.test(message)) return "bad_rating";
  if (/scorecard/i.test(message)) return "scorecard_changed";
  if (/at most/i.test(message)) return "too_long";
  if (/rating/i.test(message)) return "bad_rating";
  if (/needs notes/i.test(message)) return "no_notes";
  return "failed";
}

/** The member may file on this interview: they sat on it, it was not cancelled, and it has started (core's own rule). */
export const canFile = (i: { mine: boolean; status: string; startsAt: string }, now: number) =>
  i.mine && i.status !== "cancelled" && Date.parse(i.startsAt) <= now;
