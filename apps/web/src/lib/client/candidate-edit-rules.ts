import { APPLICATION_STAGES, NEXT_ACTION_MAX, parseDueDate, type ApplicationStage } from "@tacit/core";
import { clientTools } from "@tacit-ats/core";
import { NOTE_MAX } from "./note-max";
import { OFFER_NOTES_MAX, OFFER_SALARY_MAX, OFFER_TERM_MAX, type OfferMove } from "./offer-rules";

// The candidate page's edit rules, pure: which reason a close needs, where
// "next stage" goes, and the posted fields read back into typed input. The
// writes themselves are lib/client/candidate-edits.ts.

export { NOTE_MAX };

/** The longest note on a candidate: clientTools.addNote's own limit, not a touch's. */
export const CANDIDATE_NOTE_MAX = clientTools.NOTE_MAX;

/** Whether the page offers a note: not on someone erased, whom addNote refuses too. */
export const noteable = (name: string | null): boolean => name !== clientTools.ANONYMIZED_NAME;

/** The rejection_reasons kind a move to this stage needs, or null when it needs none. */
export function closeReasonKind(stage: string): "rejected" | "withdrew" | null {
  return stage === "rejected" ? "rejected" : stage === "withdrawn" ? "withdrew" : null;
}

/** Every stage a plain move may go to: all but the two closes, which need a reason. */
export const MOVABLE_STAGES: readonly ApplicationStage[] = APPLICATION_STAGES.filter((s) => closeReasonKind(s) === null);

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

export type OfferInput = {
  applicationId: string;
  /** Null drafts a new offer. */
  offerId: string | null;
  terms: Required<clientTools.OfferTerms>;
};
export type OfferParse = { ok: true; input: OfferInput } | { ok: false; error: "offer_gone" | "offer_salary" | "offer_currency" | "offer_date" | "offer_long" };

const offerText = (raw: unknown): string => (typeof raw === "string" ? raw.replaceAll("\0", "").replace(/\r\n?/g, "\n").trim() : "");

/**
 * The offer form, read back whole: an empty field clears what was there. These
 * are someone's terms, so anything the form would not have sent is refused and
 * never cut or guessed: a salary is plain digits, commas allowed.
 */
export function parseOffer(f: Fields): OfferParse {
  const applicationId = idOf(f, "applicationId");
  const rawId = f.get("offerId");
  const offerId = idOf(f, "offerId");
  if (!applicationId || (rawId && !offerId)) return { ok: false, error: "offer_gone" };

  const pay = offerText(f.get("salary")).replaceAll(",", "");
  if (pay && (!/^\d+$/.test(pay) || Number(pay) > OFFER_SALARY_MAX)) return { ok: false, error: "offer_salary" };
  const currency = offerText(f.get("currency")).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: "offer_currency" };

  const [startDate, expiresOn] = [offerText(f.get("startDate")), offerText(f.get("expiresOn"))];
  if ((startDate && !parseDueDate(startDate)) || (expiresOn && !parseDueDate(expiresOn))) return { ok: false, error: "offer_date" };

  const [bonus, equity, notes] = [offerText(f.get("bonus")), offerText(f.get("equity")), offerText(f.get("notes"))];
  if (bonus.length > OFFER_TERM_MAX || equity.length > OFFER_TERM_MAX || notes.length > OFFER_NOTES_MAX) return { ok: false, error: "offer_long" };

  return {
    ok: true,
    input: {
      applicationId,
      offerId,
      terms: {
        salary: pay ? Number(pay) : null,
        currency,
        bonus: bonus || null,
        equity: equity || null,
        startDate: startDate || null,
        expiresOn: expiresOn || null,
        notes: notes || null,
      },
    },
  };
}

export type OfferMoveInput = { offerId: string; from: "draft" | "extended"; status: OfferMove };

const OFFER_MOVES: Record<OfferMoveInput["from"], readonly OfferMove[]> = {
  draft: ["extended", "withdrawn"],
  extended: ["accepted", "declined", "withdrawn"],
};

/** A status change, from the status the page showed; a pair the page never offers is no move. */
export function parseOfferMove(f: Fields): OfferMoveInput | null {
  const offerId = idOf(f, "offerId");
  const from = f.get("from");
  const status = f.get("status");
  if (!offerId || (from !== "draft" && from !== "extended")) return null;
  const move = OFFER_MOVES[from].find((m) => m === status);
  return move ? { offerId, from, status: move } : null;
}

/** The candidate a form came from, for the redirect back. */
export const candidateOf = (f: Fields): string | null => idOf(f, "candidateId");

export type LabelInput = { candidateId: string; tagId: string; on: boolean };

/** A label going on or coming off, from the menu. `on` is the state wanted, never "toggle", so a repeat changes nothing. */
export function parseLabel(f: Fields): LabelInput | null {
  const candidateId = candidateOf(f);
  const tagId = idOf(f, "tagId");
  const on = f.get("on");
  return candidateId && tagId && (on === "1" || on === "0") ? { candidateId, tagId, on: on === "1" } : null;
}
