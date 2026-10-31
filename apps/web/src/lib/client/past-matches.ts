import type { Db } from "@tacit/db";
import { CLOSED } from "./past-applications";

// The Pipeline's "N past candidates in CRM also match" (design/tats's `.also`):
// how many people with a closed application a name filter would find, on the
// member's OWN client, so the policies decide which people and applications
// count. A count and nothing else: no name leaves the database here, and the
// link goes to the CRM, which reads them the usual way. Read from `people`, so
// someone with two closed applications is one candidate. A person in a live
// pipeline who also closed elsewhere counts too: the two lists are different
// records, as the prototype's.

/**
 * What a member typed, as an `ilike` pattern that means those characters: `%`,
 * `_` and `\` are LIKE's own. PostgREST also reads `*` as `%` and has no way to
 * escape it, so `*` becomes the one-character wildcard, the nearest to itself.
 */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&").replace(/\*/g, "_")}%`;

/** The name filter's columns, in `or()`'s syntax, quoted because a search can hold a comma, a bracket or a quote. */
export function nameFilter(q: string): string {
  const value = `"${likePattern(q).replace(/[\\"]/g, "\\$&")}"`;
  return ["display_name", "current_title", "current_company"].map((c) => `${c}.ilike.${value}`).join(",");
}

export type PastScope = {
  /** The job picked, when there is one. */
  jobId: string | null;
  /** The department picked and those inside it; null is every department. */
  departmentIds: string[] | null;
};

export async function countPastMatches(db: Db, q: string, scope: PastScope): Promise<number> {
  let read = db
    .from("people")
    .select("id, applications!inner(id, roles!inner(department_id))", { count: "exact", head: true })
    .is("merged_into_id", null)
    .is("anonymized_at", null)
    .in("applications.stage", [...CLOSED])
    .is("applications.merged_into_id", null)
    .or(nameFilter(q));
  if (scope.jobId) read = read.eq("applications.role_id", scope.jobId);
  if (scope.departmentIds) read = read.in("applications.roles.department_id", scope.departmentIds);
  const { count, error } = await read;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export const pastMatchWords = (n: number, q: string) => `${n.toLocaleString("en-US")} past ${n === 1 ? "candidate in CRM also matches" : "candidates in CRM also match"} “${q}”`;
