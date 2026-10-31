import { clientTools } from "@tacit-ats/core";
import type { ClientContext } from "./session";
import { toolCtx } from "./tool-ctx";

// ⌘K's candidates: the connector's own search_candidates on the member's OWN
// client, so the policies and core decide who comes back: an interviewer
// (`limited`) only the people they interview, an external recruiter their own
// adds, nobody from another company. The answer carries an id, a name and one
// line, never an email or a stage.

export const SEARCH_MIN = 2;
export const SEARCH_MAX = 100;
export const SEARCH_LIMIT = 8;

export type SearchHit = { candidateId: string; name: string; line: string | null };

/** What's worth asking about: a query core would clean down to nothing would list everyone, by name. Null is no search. */
export function searchQuery(raw: string | null | undefined): string | null {
  const q = Array.from((raw ?? "").trim()).slice(0, SEARCH_MAX).join("");
  return Array.from(q).length >= SEARCH_MIN && /[\p{L}\p{N}]/u.test(q) ? q : null;
}

export const toHit = (c: clientTools.CandidateHit): SearchHit => ({
  candidateId: c.candidateId,
  name: c.name?.trim() || "Unnamed",
  line: [c.headline, c.applications[0]?.jobTitle].filter(Boolean).join(" · ") || null,
});

export async function searchForMenu(member: Pick<ClientContext, "db" | "actorId" | "accessLevel" | "org">, query: string): Promise<SearchHit[]> {
  return (await clientTools.searchCandidates(member.db, toolCtx(member), { query, limit: SEARCH_LIMIT })).map(toHit);
}
