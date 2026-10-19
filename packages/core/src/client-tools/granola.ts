import type { Db } from "@tacit/db";

import { ClientToolError, type ClientToolCtx } from "./context.js";

/**
 * An interviewer's own Granola notes on an interview, for the client
 * connector. A member connects Granola on apps/web's /client/integrations by
 * pasting a Granola API key (granola_connections, 20261019150000); no member
 * token can read the key back, so it arrives through `ClientGranola.key`,
 * which apps/mcp implements with the service role (src/client/granola.ts)
 * and core asks only for the caller.
 *
 * Only the caller's own notes, and only on an interview the caller's own
 * token reads them on as an interviewer: the interview row is read on the
 * member's client first, so RLS decides before Granola is asked. What comes
 * back from Granola (titles, summaries, the member's private notes, the
 * transcript) is interview content: private to the hiring team, fenced by
 * the server, and never in an audit row.
 *
 * Finding the note: Granola lists notes by creation time, with no attendee
 * or event filter, so the notes created around the interview are listed and
 * each one's detail is checked, in this order of confidence:
 *   event   its calendar event is the one Tacit booked (interviews.google_event_id)
 *   email   the candidate's email is among its attendees or invitees (when
 *           the caller may read the candidate's email: not an interviewer)
 *   time    its calendar event was scheduled within 10 minutes of the
 *           interview's start, or, with no event, it was created during it
 * No match lists the nearby notes, so the caller can pick one by note_id.
 */

const API = "https://public-api.granola.ai";
/** Notes are created around when a meeting starts: look this far either side of the interview. */
const LOOK_AROUND_MS = 3 * 60 * 60 * 1000;
const SAME_START_MS = 10 * 60 * 1000;
/** How many nearby notes to open looking for the match. */
const CANDIDATES_MAX = 8;
export const GRANOLA_TEXT_MAX = 20_000;
export const GRANOLA_TRANSCRIPT_MAX = 60_000;
const NOTE_ID = /^not_[a-zA-Z0-9]{14}$/;

export type ClientGranola = {
  /** The member's Granola API key; null = not connected. Asked only for the caller. */
  key: (orgId: string, actorId: string) => Promise<string | null>;
  /** Where a member connects Granola (apps/web /client/integrations), for the sentences. Null = not said. */
  connectUrl: string | null;
  fetch?: typeof fetch;
};

export type GranolaMatch = "event" | "email" | "time" | "chosen";

export type GranolaNearby = { noteId: string; title: string | null; createdAt: string };

export type InterviewNotes =
  | {
      found: true;
      interviewId: string;
      candidateId: string;
      matchedBy: GranolaMatch;
      noteId: string;
      title: string | null;
      webUrl: string | null;
      createdAt: string;
      summary: string | null;
      /** The member's own notes typed into Granola (Granola returns them only to the note's owner). */
      myNotes: string | null;
      transcript: string | null;
      transcriptStatus: "included" | "not_requested" | "too_large" | "none";
      truncated: boolean;
    }
  | { found: false; interviewId: string; candidateId: string; nearby: GranolaNearby[] };

type RawUser = { name?: string | null; email?: string | null };
type RawNote = {
  id: string;
  title?: string | null;
  created_at: string;
  web_url?: string | null;
  calendar_event?: {
    calendar_event_id?: string | null;
    scheduled_start_time?: string | null;
    invitees?: Array<{ email?: string | null }> | null;
  } | null;
  attendees?: RawUser[] | null;
  summary_text?: string | null;
  summary_markdown?: string | null;
  private_notes_markdown?: string | null;
  private_notes_text?: string | null;
  transcript?: Array<{
    speaker?: { attribution?: string | null; name?: string | null; diarization_label?: string | null } | null;
    text?: string | null;
  }> | null;
};

class GranolaHttpError extends Error {
  constructor(readonly status: number) {
    super(`Granola answered ${status}`);
  }
}

async function granola<T>(deps: ClientGranola, key: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(path, API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await (deps.fetch ?? fetch)(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new GranolaHttpError(res.status);
  return (await res.json()) as T;
}

function connectHint(deps: ClientGranola | null): string {
  return deps?.connectUrl ? `Connect it at ${deps.connectUrl}.` : "Connect it on the Integrations page of Tacit's member area.";
}

const clip = (text: string | null | undefined, max: number): { text: string | null; cut: boolean } => {
  const t = text?.trim() || null;
  if (!t || t.length <= max) return { text: t, cut: false };
  return { text: `${t.slice(0, max)}\n[…cut at ${max} characters]`, cut: true };
};

function transcriptText(raw: NonNullable<RawNote["transcript"]>): string {
  return raw
    .map((s) => {
      const who = s.speaker?.name || (s.speaker?.attribution === "me" ? "Me" : s.speaker?.attribution === "them" ? "Them" : s.speaker?.diarization_label || "Unknown");
      return `${who}: ${(s.text ?? "").trim()}`;
    })
    .filter((line) => !line.endsWith(": "))
    .join("\n");
}

function matchOf(note: RawNote, interview: { startsAt: number; endsAt: number; eventId: string | null; email: string | null }): GranolaMatch | null {
  const ev = note.calendar_event;
  if (interview.eventId && ev?.calendar_event_id && ev.calendar_event_id === interview.eventId) return "event";
  if (interview.email) {
    const emails = [...(note.attendees ?? []), ...(ev?.invitees ?? [])].map((p) => p.email?.trim().toLowerCase());
    if (emails.includes(interview.email)) return "email";
  }
  const scheduled = ev?.scheduled_start_time ? Date.parse(ev.scheduled_start_time) : NaN;
  if (!Number.isNaN(scheduled)) return Math.abs(scheduled - interview.startsAt) <= SAME_START_MS ? "time" : null;
  const created = Date.parse(note.created_at);
  return created >= interview.startsAt - SAME_START_MS && created <= interview.endsAt ? "time" : null;
}

const RANK: Record<GranolaMatch, number> = { chosen: 4, event: 3, email: 2, time: 1 };

export async function getInterviewNotes(
  db: Db,
  ctx: ClientToolCtx,
  deps: ClientGranola | null,
  input: { interviewId: string; noteId?: string; includeTranscript?: boolean },
): Promise<InterviewNotes> {
  if (!deps) throw new ClientToolError("forbidden", "Granola is not set up on this Tacit deployment.");
  if (input.noteId !== undefined && !NOTE_ID.test(input.noteId)) {
    throw new ClientToolError("invalid", "note_id is a Granola note id like not_1a2b3c4d5e6f7g, from an earlier result.");
  }

  // The interview, on the member's own token: RLS decides whether it is there at all.
  const { data, error } = await db
    .from("interviews")
    .select("id, application_id, starts_at, ends_at, status, interviewer_actor_ids, google_event_id")
    .eq("id", input.interviewId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const interview = data as
    | { id: string; application_id: string; starts_at: string; ends_at: string; status: string; interviewer_actor_ids: string[]; google_event_id: string | null }
    | null;
  if (!interview || !interview.interviewer_actor_ids.includes(ctx.actorId)) {
    throw new ClientToolError("forbidden", "You were not an interviewer on that interview, so there are no notes of yours on it. list_my_interviews has yours.");
  }
  if (interview.status === "cancelled") throw new ClientToolError("invalid", "That interview was cancelled.");
  const startsAt = Date.parse(interview.starts_at);
  const endsAt = Date.parse(interview.ends_at);
  if (startsAt > Date.now()) throw new ClientToolError("invalid", "That interview has not happened yet.");

  const { data: app, error: appError } = await db.from("applications").select("person_id").eq("id", interview.application_id).maybeSingle();
  if (appError) throw new Error(appError.message);
  // An interviewer reads the candidate through my_interviews(), never the application.
  let candidateId = app?.person_id ?? null;
  if (!candidateId) {
    const { data: mine, error: mineError } = await db.rpc("my_interviews");
    if (mineError) throw new Error(mineError.message);
    candidateId = (mine ?? []).find((i) => i.interview_id === interview.id)?.person_id ?? null;
  }
  if (!candidateId) throw new ClientToolError("not_found", "No interview there that you can see. list_my_interviews has the ids.");
  // Null for whoever may not read the candidate's email (an interviewer): then no email match.
  const { data: person, error: personError } = await db.from("people").select("email").eq("id", candidateId).maybeSingle();
  if (personError) throw new Error(personError.message);

  const key = await deps.key(ctx.orgId, ctx.actorId);
  if (!key) throw new ClientToolError("forbidden", `Your Granola is not connected. ${connectHint(deps)}`);

  try {
    let matchedId: string | null = input.noteId ?? null;
    let matchedBy: GranolaMatch = "chosen";
    let nearby: GranolaNearby[] = [];

    if (!matchedId) {
      const listed = await granola<{ notes: RawNote[] }>(deps, key, "/v1/notes", {
        created_after: new Date(startsAt - LOOK_AROUND_MS).toISOString(),
        created_before: new Date(endsAt + LOOK_AROUND_MS).toISOString(),
        page_size: "30",
      });
      const notes = (listed.notes ?? []).sort(
        (a, b) => Math.abs(Date.parse(a.created_at) - startsAt) - Math.abs(Date.parse(b.created_at) - startsAt),
      );
      nearby = notes.map((n) => ({ noteId: n.id, title: n.title ?? null, createdAt: n.created_at }));
      const facts = {
        startsAt, endsAt, email: person?.email?.trim().toLowerCase() || null,
        // Tacit books the Google event under the interview's id without dashes (calendar.ts).
        eventId: interview.google_event_id,
      };
      let best: { id: string; by: GranolaMatch } | null = null;
      for (const n of notes.slice(0, CANDIDATES_MAX)) {
        const detail = await granola<RawNote>(deps, key, `/v1/notes/${n.id}`);
        const by = matchOf(detail, facts);
        if (by && (!best || RANK[by] > RANK[best.by])) best = { id: n.id, by };
        if (best?.by === "event") break;
      }
      if (!best) return { found: false, interviewId: interview.id, candidateId, nearby };
      matchedId = best.id;
      matchedBy = best.by;
    }

    let note: RawNote;
    let transcriptStatus: "included" | "not_requested" | "too_large" | "none" = "not_requested";
    try {
      note = await granola<RawNote>(deps, key, `/v1/notes/${matchedId}`, input.includeTranscript ? { include: "transcript" } : {});
      if (input.includeTranscript) transcriptStatus = note.transcript?.length ? "included" : "none";
    } catch (err) {
      if (!(input.includeTranscript && err instanceof GranolaHttpError && err.status === 413)) throw err;
      note = await granola<RawNote>(deps, key, `/v1/notes/${matchedId}`);
      transcriptStatus = "too_large";
    }

    const summary = clip(note.summary_markdown ?? note.summary_text, GRANOLA_TEXT_MAX);
    const myNotes = clip(note.private_notes_markdown ?? note.private_notes_text, GRANOLA_TEXT_MAX);
    const transcript = clip(transcriptStatus === "included" && note.transcript ? transcriptText(note.transcript) : null, GRANOLA_TRANSCRIPT_MAX);
    return {
      found: true, interviewId: interview.id, candidateId, matchedBy, noteId: note.id, title: note.title ?? null,
      webUrl: note.web_url ?? null, createdAt: note.created_at,
      summary: summary.text, myNotes: myNotes.text, transcript: transcript.text, transcriptStatus,
      truncated: summary.cut || myNotes.cut || transcript.cut,
    };
  } catch (err) {
    if (err instanceof GranolaHttpError) {
      if (err.status === 401 || err.status === 403) {
        throw new ClientToolError("forbidden", `Granola no longer accepts your API key. ${connectHint(deps)}`);
      }
      if (err.status === 404) throw new ClientToolError("not_found", "Granola has no note with that id that your key can read.");
      if (err.status === 429) throw new ClientToolError("rate_limited", "Granola is rate limiting requests. Try again in a minute.");
      throw new ClientToolError("invalid", "Granola didn't answer. Try again in a minute.");
    }
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "TypeError")) {
      throw new ClientToolError("invalid", "Couldn't reach Granola. Try again in a minute.");
    }
    throw err;
  }
}
