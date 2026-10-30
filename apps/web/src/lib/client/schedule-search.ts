// The Calendar's search, pure. `?q=` is matched in the server's memory against
// the interviews the member's own token could read, so it can only find what
// they could already see, and nothing they type reaches a query.

/** What a search reads of an interview: what its row shows but the dates. */
export type Searchable = { candidateName: string | null; jobTitle: string; step: string | null; interviewers: string[] };

const SEARCH_MAX_CHARS = 100;

/** The URL's `?q=`, trimmed and bounded as the CRM's; empty is no search. */
export function parseSearch(raw: string): string | null {
  return raw.trim().slice(0, SEARCH_MAX_CHARS).trim() || null;
}

/** Lower case with the accents off, so "jose" finds José. */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The candidate, an interviewer, the job or the step containing every word of the search. */
export function matchesSearch(i: Searchable, q: string): boolean {
  const hay = fold([i.candidateName, i.jobTitle, i.step, ...i.interviewers].filter(Boolean).join(" "));
  return fold(q).split(/\s+/).filter(Boolean).every((word) => hay.includes(word));
}

/** design/tats's interviews table: what is still ahead soonest first, then what is over, newest first. */
export function searchOrder<T extends { id: string; startsAt: string; endsAt: string }>(events: readonly T[], now: number): T[] {
  const ended = (e: T) => Date.parse(e.endsAt) <= now;
  return [...events].sort((a, b) => {
    if (ended(a) !== ended(b)) return ended(a) ? 1 : -1;
    const byStart = ended(a) ? Date.parse(b.startsAt) - Date.parse(a.startsAt) : Date.parse(a.startsAt) - Date.parse(b.startsAt);
    return byStart || a.id.localeCompare(b.id);
  });
}
