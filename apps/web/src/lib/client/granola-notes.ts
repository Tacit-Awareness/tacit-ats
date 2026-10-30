import { clientTools } from "@tacit-ats/core";
import { getSupabaseServiceClient, type Db } from "@tacit/db";
import type { AccessLevel } from "./session";

/**
 * A member's own Granola notes in the Interviews reader: the third client-area
 * module allowed a privileged client (src/client-area.test.ts), after bind.ts
 * and bot.ts. A grant is an OAuth secret that tacit-internal grants to no
 * member token on purpose, and using it means rotating it, so a definer
 * function would only hand the secret to the member's token; the service role
 * stays in this file instead, and what leaves it is the notes, never a token
 * or a client.
 *
 * The member's own token decides whose grant, as in bot.ts: granola_connections'
 * policy shows a member their own row and nobody else's, and the ids on that
 * row are the only ones the service role is ever asked about. Nothing here takes
 * an actor or an org as input, so no caller can name someone else's grant. A
 * member with no row gets no privileged read at all. Then core's
 * getInterviewNotes reads the interview on the member's own token and refuses
 * anyone who was not an interviewer on it, before Granola is asked.
 *
 * What comes back is the member's private interview content: not logged, not
 * audited, and rendered only as plain text (interviews/granola.tsx).
 */

export type GranolaReading =
  | { status: "not_connected" }
  /** Granola no longer accepts the grant. */
  | { status: "reconnect" }
  | { status: "unavailable"; message: string }
  | { status: "no_match"; nearby: clientTools.GranolaNearby[] }
  | {
      status: "found";
      matchedBy: clientTools.GranolaMatch;
      notes: string | null;
      transcript: string | null;
      transcriptStatus: "included" | "not_requested" | "unavailable";
      truncated: boolean;
    };

const GENERIC = "Couldn't read Granola just now. Try again in a minute.";

export async function readGranolaNotes(
  member: { db: Db; accessLevel: AccessLevel },
  input: { interviewId: string; noteId?: string; includeTranscript: boolean },
  fetchImpl: typeof fetch = fetch,
): Promise<GranolaReading> {
  const { data: own, error } = await member.db.from("granola_connections").select("org_id, actor_id").maybeSingle();
  if (error) {
    console.error("[client-granola] reading the member's connection failed:", error.message);
    return { status: "unavailable", message: GENERIC };
  }
  if (!own) return { status: "not_connected" };

  let access: clientTools.GranolaAccess | undefined;
  const granola: clientTools.ClientGranola = {
    accessToken: async () => (access = await clientTools.granolaGrantAccess(getSupabaseServiceClient(), own.org_id, own.actor_id, fetchImpl)),
    connectUrl: null,
    fetch: fetchImpl,
  };

  try {
    const notes = await clientTools.getInterviewNotes(
      member.db,
      { actorId: own.actor_id, orgId: own.org_id, accessLevel: member.accessLevel, source: "dashboard" },
      granola,
      { interviewId: input.interviewId, noteId: input.noteId, includeTranscript: input.includeTranscript },
    );
    if (!notes.found) return { status: "no_match", nearby: notes.nearby };
    const { matchedBy, notes: text, transcript, transcriptStatus, truncated } = notes;
    return { status: "found", matchedBy, notes: text, transcript, transcriptStatus, truncated };
  } catch (err) {
    if (access === null) return { status: "not_connected" };
    if (access && "reconnect" in access) return { status: "reconnect" };
    if (err instanceof clientTools.ClientToolError) {
      // Before Granola was asked the sentence is about the interview, and core
      // wrote it for the connector; after, it is Granola's answer, and it reads
      // the same here. A forbidden from Granola itself means the grant went bad.
      if (!access) return { status: "unavailable", message: "These notes aren't available to you." };
      return err.code === "forbidden" ? { status: "reconnect" } : { status: "unavailable", message: err.message };
    }
    // Core keeps Granola's own text out of what it throws; only this reaches a log.
    console.error("[client-granola] reading notes failed:", err instanceof Error ? err.message : "unknown error");
    return { status: "unavailable", message: GENERIC };
  }
}
