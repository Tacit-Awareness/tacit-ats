import { APPLICATION_STAGES, NEXT_ACTION_MAX, parseDueDate, type ApplicationStage } from "@tacit/core";
import { clientTools } from "@tacit-ats/core";

// The candidate page's edit rules, pure: which reason a close needs, where
// "next stage" goes, and the posted fields read back into typed input. The
// writes themselves are lib/client/candidate-edits.ts.

/**
 * The longest touch or close note: core's pipeline NOTE_MAX, which @tacit/core
 * does not export yet. logTouch cuts a note to it anyway; moveStage stores a
 * close note as given, so it is cut here.
 */
export const NOTE_MAX = 2000;

/** The longest note on a candidate: clientTools.addNote's own limit, not a touch's. */
export const CANDIDATE_NOTE_MAX = clientTools.NOTE_MAX;

/** Whether the page offers a note: not on someone erased, whom addNote refuses too. */
export const noteable = (name: string | null): boolean => name !== clientTools.ANONYMIZED_NAME;

/** The rejection_reasons kind a move to this stage needs, or null when it needs none. */
export function closeReasonKind(stage: string): "rejected" | "withdrew" | null {
  return stage === "rejected" ? "rejected" : stage === "withdrawn" ? "withdrew" : null;
}

const LIVE: readonly ApplicationStage[] = ["sourced", "contacted", "screening", "interviewing", "offer", "hired"];

/** The stage after this one on the way to hired; null at hired and for a closed application. */
export function nextStage(stage: string): ApplicationStage | null {
  const i = LIVE.indexOf(stage as ApplicationStage);
  return i === -1 || i === LIVE.length - 1 ? null : LIVE[i + 1]!;
}

const isStage = (v: unknown): v is ApplicationStage => typeof v === "string" && (APPLICATION_STAGES as readonly string[]).includes(v);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Fields = { get(key: string): unknown };

export const idOf = (f: Fields, key: string): string | null => {
  const v = f.get(key);
  return typeof v === "string" && UUID.test(v) ? v : null;
};

export const textOf = (f: Fields, key: string, max: number): string | null => {
  const v = f.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null;
};

export type MoveInput = {
  applicationId: string;
  stage: ApplicationStage;
  expectedStage: ApplicationStage;
  reasonId: string | null;
  note: string | null;
};

/** A move form: the target stage, the stage the page showed, and for a close its reason and note. */
export function parseMove(f: Fields): MoveInput | null {
  const applicationId = idOf(f, "applicationId");
  const stage = f.get("stage");
  const expectedStage = f.get("expectedStage");
  if (!applicationId || !isStage(stage) || !isStage(expectedStage)) return null;
  const closing = closeReasonKind(stage) !== null;
  return {
    applicationId,
    stage,
    expectedStage,
    reasonId: closing ? idOf(f, "reasonId") : null,
    note: closing ? textOf(f, "note", NOTE_MAX) : null,
  };
}

export type NextActionInput = { applicationId: string; nextAction: string | null; due: string | null };

/**
 * A next action form. "Clear" (or an empty action) clears both; a date that
 * is not YYYY-MM-DD is refused rather than dropped, and a date with nothing
 * to do by it is too.
 */
export function parseNextAction(f: Fields): { ok: true; input: NextActionInput } | { ok: false; error: "not_found" | "invalid_due" } {
  const applicationId = idOf(f, "applicationId");
  if (!applicationId) return { ok: false, error: "not_found" };
  if (f.get("clear") === "1") return { ok: true, input: { applicationId, nextAction: null, due: null } };
  const nextAction = textOf(f, "nextAction", NEXT_ACTION_MAX);
  const rawDue = textOf(f, "due", 32);
  const due = parseDueDate(rawDue);
  if (rawDue && (!due || !nextAction)) return { ok: false, error: "invalid_due" };
  return { ok: true, input: { applicationId, nextAction, due: nextAction ? due : null } };
}

/** An owner form: an empty choice is "no owner". */
export function parseOwner(f: Fields): { applicationId: string; ownerActorId: string | null } | null {
  const applicationId = idOf(f, "applicationId");
  if (!applicationId) return null;
  const raw = f.get("ownerActorId");
  const ownerActorId = idOf(f, "ownerActorId");
  // Anything but empty or an id is not a choice the form offered.
  if (raw !== "" && raw !== null && !ownerActorId) return null;
  return { applicationId, ownerActorId };
}

/** A touch form, with an optional note of what happened. */
export function parseTouch(f: Fields): { applicationId: string; note: string | null } | null {
  const applicationId = idOf(f, "applicationId");
  return applicationId ? { applicationId, note: textOf(f, "note", NOTE_MAX) } : null;
}

export type NoteParse = { ok: true; text: string } | { ok: false; error: "note_empty" | "note_long"; text: string };

/**
 * A note form. A browser posts a textarea's line ends as CRLF but counts them
 * as one character for maxLength, so they are read back as LF first, and a
 * full box is not refused. A NUL goes too: Postgres text cannot hold one, and
 * nobody typed it. Too long is refused, never cut: these are someone's words,
 * and the form puts them back.
 */
export function parseNote(f: Fields): NoteParse {
  const raw = f.get("text");
  const text = typeof raw === "string" ? raw.replaceAll("\0", "").replace(/\r\n?/g, "\n").trim() : "";
  if (!text) return { ok: false, error: "note_empty", text };
  return text.length > CANDIDATE_NOTE_MAX ? { ok: false, error: "note_long", text } : { ok: true, text };
}

/** The candidate a form came from, for the redirect back. */
export const candidateOf = (f: Fields): string | null => idOf(f, "candidateId");
