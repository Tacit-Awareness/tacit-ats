import type { Db } from "@tacit/db";

import { ClientToolError, type ClientToolCtx } from "./context.js";

/**
 * An interviewer's own Granola notes on an interview, for the client
 * connector. A member connects Granola on apps/web's /client/integrations
 * with one button: they sign in to Granola, and the OAuth grant for
 * Granola's MCP server (mcp.granola.ai) is stored in granola_connections
 * (20261019200000). No member token can read it, so the access token arrives
 * through `ClientGranola.accessToken`, which apps/mcp implements with the
 * service role (src/client/granola.ts), refreshing it when it has expired,
 * and which core asks only for the caller.
 *
 * Only the caller's own notes, and only on an interview the caller's own
 * token reads them on as an interviewer: the interview row is read on the
 * member's client first, so RLS decides before Granola is asked. What comes
 * back from Granola (titles, notes, summaries, the transcript) is interview
 * content: private to the hiring team, fenced by the server, and never in an
 * audit row.
 *
 * Granola's MCP tools answer in text meant for a model (XML-ish tags, not a
 * fixed schema; checked against a real account on 2026-10-19), so the
 * matching here reads that text rather than fields. Only meetings whose note
 * the caller captured are listed (involvement.captured_by_me):
 *   event   the event id Tacit booked (interviews.google_event_id) appears
 *           in a meeting Granola lists around the interview
 *   email   the candidate's email appears in one of them (when the caller
 *           may read the candidate's email: not an interviewer)
 *   time    exactly one meeting is listed during the interview itself
 * No match lists the meetings nearby, so the caller can pick one by note_id.
 */

export const GRANOLA_MCP_URL = "https://mcp.granola.ai/mcp";
/** Nearby meetings: this far either side of the interview. */
const LOOK_AROUND_MS = 3 * 60 * 60 * 1000;
/** "During the interview": from this long before it starts to this long after it ends. */
const SAME_TIME_MS = 10 * 60 * 1000;
const NEARBY_MAX = 10;
const EXCERPT_MAX = 400;
export const GRANOLA_TEXT_MAX = 40_000;
export const GRANOLA_TRANSCRIPT_MAX = 60_000;
/** Granola's meeting ids are uuids; anything id-shaped is let through to Granola, which decides. */
const NOTE_ID = /^[A-Za-z0-9_-]{6,64}$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** The caller's Granola access: a token, null when not connected, or `reconnect` when Granola no longer accepts the grant. */
export type GranolaAccess = { token: string } | { reconnect: true } | null;

export type ClientGranola = {
  /** The member's current Granola access token, refreshed if it had expired. Asked only for the caller. */
  accessToken: (orgId: string, actorId: string) => Promise<GranolaAccess>;
  /** Where a member connects Granola (apps/web /client/integrations), for the sentences. Null = not said. */
  connectUrl: string | null;
  fetch?: typeof fetch;
};

export type GranolaMatch = "event" | "email" | "time" | "chosen";

export type GranolaNearby = { noteId: string; excerpt: string };

export type InterviewNotes =
  | {
      found: true;
      interviewId: string;
      candidateId: string;
      matchedBy: GranolaMatch;
      noteId: string;
      /** Granola's own text for the meeting: its title, attendees, the member's private notes and the AI summary. */
      notes: string | null;
      transcript: string | null;
      transcriptStatus: "included" | "not_requested" | "unavailable";
      truncated: boolean;
    }
  | { found: false; interviewId: string; candidateId: string; nearby: GranolaNearby[] };

class GranolaHttpError extends Error {
  constructor(readonly status: number) {
    super(`Granola answered ${status}`);
  }
}

/** A tool Granola answered with isError: its own sentence, kept out of logs. */
class GranolaToolError extends Error {}

type JsonRpcResponse = { id?: number; result?: unknown; error?: { message?: string } };

/** The JSON-RPC answer with this id, from a JSON body or a Streamable HTTP event stream. */
async function rpcAnswer(res: Response, id: number): Promise<JsonRpcResponse> {
  const body = await res.text();
  const messages: JsonRpcResponse[] = [];
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (data) messages.push(JSON.parse(data) as JsonRpcResponse);
    }
  } else if (body.trim()) {
    const parsed = JSON.parse(body) as JsonRpcResponse | JsonRpcResponse[];
    messages.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }
  const answer = messages.find((m) => m.id === id);
  if (!answer) throw new GranolaHttpError(502);
  return answer;
}

/**
 * A minimal MCP client for Granola's server: initialize once, then call tools.
 * Each call returns the text of the tool's content.
 */
export function granolaMcp(token: string, fetchImpl: typeof fetch = fetch) {
  let session: string | null = null;
  let nextId = 1;
  let ready: Promise<void> | null = null;

  async function post(message: object): Promise<Response> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    };
    if (session) headers["mcp-session-id"] = session;
    const res = await fetchImpl(GRANOLA_MCP_URL, { method: "POST", headers, body: JSON.stringify(message), signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new GranolaHttpError(res.status);
    session = res.headers.get("mcp-session-id") ?? session;
    return res;
  }

  async function request(method: string, params: object): Promise<unknown> {
    const id = nextId++;
    const answer = await rpcAnswer(await post({ jsonrpc: "2.0", id, method, params }), id);
    if (answer.error) throw new GranolaHttpError(502);
    return answer.result;
  }

  function init(): Promise<void> {
    ready ??= (async () => {
      await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Tacit", version: "1" } });
      await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    })();
    return ready;
  }

  return {
    async call(name: string, args: Record<string, unknown>): Promise<string> {
      await init();
      const result = (await request("tools/call", { name, arguments: args })) as {
        content?: Array<{ type?: string; text?: string }>;
        isError?: boolean;
      } | null;
      const text = (result?.content ?? []).filter((c) => c.type === "text" && c.text).map((c) => c.text).join("\n\n").trim();
      if (result?.isError) throw new GranolaToolError(text || "Granola refused the request.");
      return text;
    },
  };
}

function connectHint(deps: ClientGranola | null): string {
  return deps?.connectUrl ? `Connect it at ${deps.connectUrl}.` : "Connect it on the Integrations page of Tacit's member area.";
}

const clip = (text: string | null | undefined, max: number): { text: string | null; cut: boolean } => {
  const t = text?.trim() || null;
  if (!t || t.length <= max) return { text: t, cut: false };
  return { text: `${t.slice(0, max)}\n[…cut at ${max} characters]`, cut: true };
};

/** Granola's list as one chunk of text per meeting, each starting at the meeting's id. */
export function meetingsIn(raw: string): Array<{ id: string; text: string }> {
  // A meeting's folders carry folder uuids; they are not meetings.
  const listText = raw.replace(/<folders\b[\s\S]*?<\/folders>/gi, "");
  const hits = [...listText.matchAll(UUID)];
  const seen = new Set<string>();
  const meetings: Array<{ id: string; text: string }> = [];
  hits.forEach((hit, i) => {
    const id = hit[0].toLowerCase();
    if (seen.has(id)) return;
    seen.add(id);
    // From the line the id is on to the line the next meeting's id is on.
    const start = listText.lastIndexOf("\n", hit.index) + 1;
    const next = hits.slice(i + 1).find((h) => h[0].toLowerCase() !== id);
    const end = next ? listText.lastIndexOf("\n", next.index) + 1 || next.index : listText.length;
    meetings.push({ id, text: listText.slice(start, Math.max(end, start)).trim() });
  });
  return meetings;
}

// Only meetings whose note the caller captured: without the filter Granola
// also lists colleagues' Team Space notes.
const listMeetings = (mcp: ReturnType<typeof granolaMcp>, from: number, to: number) =>
  mcp.call("list_meetings", {
    time_range: "custom", custom_start: new Date(from).toISOString(), custom_end: new Date(to).toISOString(),
    involvement: { captured_by_me: true },
  });

export async function getInterviewNotes(
  db: Db,
  ctx: ClientToolCtx,
  deps: ClientGranola | null,
  input: { interviewId: string; noteId?: string; includeTranscript?: boolean },
): Promise<InterviewNotes> {
  if (!deps) throw new ClientToolError("forbidden", "Granola is not set up on this Tacit deployment.");
  if (input.noteId !== undefined && !NOTE_ID.test(input.noteId)) {
    throw new ClientToolError("invalid", "note_id is a Granola meeting id from an earlier result.");
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

  const access = await deps.accessToken(ctx.orgId, ctx.actorId);
  if (!access) throw new ClientToolError("forbidden", `Your Granola is not connected. ${connectHint(deps)}`);
  if ("reconnect" in access) throw new ClientToolError("forbidden", `Granola no longer accepts Tacit's access. ${connectHint(deps)}`);
  const mcp = granolaMcp(access.token, deps.fetch);

  try {
    let matchedId: string | null = input.noteId ?? null;
    let matchedBy: GranolaMatch = "chosen";

    if (!matchedId) {
      const nearby = meetingsIn(await listMeetings(mcp, startsAt - LOOK_AROUND_MS, endsAt + LOOK_AROUND_MS));
      const email = person?.email?.trim().toLowerCase() || null;
      const eventId = interview.google_event_id?.toLowerCase() || null;
      const byEvent = eventId ? nearby.filter((m) => m.text.toLowerCase().includes(eventId)) : [];
      const byEmail = email ? nearby.filter((m) => m.text.toLowerCase().includes(email)) : [];
      if (byEvent.length === 1) [matchedId, matchedBy] = [byEvent[0]!.id, "event"];
      else if (byEmail.length === 1) [matchedId, matchedBy] = [byEmail[0]!.id, "email"];
      else {
        const during = nearby.length ? meetingsIn(await listMeetings(mcp, startsAt - SAME_TIME_MS, endsAt + SAME_TIME_MS)) : [];
        if (during.length === 1) [matchedId, matchedBy] = [during[0]!.id, "time"];
      }
      if (!matchedId) {
        return {
          found: false, interviewId: interview.id, candidateId,
          nearby: nearby.slice(0, NEARBY_MAX).map((m) => ({ noteId: m.id, excerpt: clip(m.text, EXCERPT_MAX).text ?? "" })),
        };
      }
    }

    const notes = clip(await mcp.call("get_meetings", { meeting_ids: [matchedId] }), GRANOLA_TEXT_MAX);
    let transcriptStatus: "included" | "not_requested" | "unavailable" = "not_requested";
    let transcript: { text: string | null; cut: boolean } = { text: null, cut: false };
    if (input.includeTranscript) {
      try {
        transcript = clip(await mcp.call("get_meeting_transcript", { meeting_id: matchedId, max_chars: GRANOLA_TRANSCRIPT_MAX }), GRANOLA_TRANSCRIPT_MAX);
        transcriptStatus = transcript.text ? "included" : "unavailable";
      } catch (err) {
        // Transcripts need a paid Granola plan; the notes still come back.
        if (!(err instanceof GranolaToolError)) throw err;
        transcriptStatus = "unavailable";
      }
    }
    return {
      found: true, interviewId: interview.id, candidateId, matchedBy, noteId: matchedId,
      notes: notes.text, transcript: transcript.text, transcriptStatus, truncated: notes.cut || transcript.cut,
    };
  } catch (err) {
    if (err instanceof GranolaToolError) {
      if (matchedNotFound(err.message)) throw new ClientToolError("not_found", "Granola has no meeting with that id that you can read.");
      throw new ClientToolError("invalid", "Granola couldn't answer that. Try again in a minute.");
    }
    if (err instanceof GranolaHttpError) {
      if (err.status === 401 || err.status === 403) {
        throw new ClientToolError("forbidden", `Granola no longer accepts Tacit's access. ${connectHint(deps)}`);
      }
      if (err.status === 429) throw new ClientToolError("rate_limited", "Granola is rate limiting requests. Try again in a minute.");
      throw new ClientToolError("invalid", "Granola didn't answer. Try again in a minute.");
    }
    if (err instanceof SyntaxError) throw new ClientToolError("invalid", "Granola's answer couldn't be read. Try again in a minute.");
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "TypeError")) {
      throw new ClientToolError("invalid", "Couldn't reach Granola. Try again in a minute.");
    }
    throw err;
  }
}

const matchedNotFound = (message: string) => /not found|no meeting|does not exist|doesn't exist/i.test(message);
