import type { Db } from "@tacit/db";
import type { ReviewWrite } from "./interview-review-rules";

// The reviewed check on Interviews, on the member's OWN client. `interview_reviews`
// (tacit-internal's packages/db, 20261030153000) holds one row per member per
// interview they checked off, ids and a timestamp. The policies decide: a member
// inserts and deletes only their own row, and only on an interview they can read.
// Org, actor and time are the database's to set, by column grant. Each member
// has their own check, so a teammate's never shows as yours or clears yours,
// which is why both functions name the actor: the table lets a member read
// everyone's marks on an interview they can read.

/** Interview ids per read, to keep the query string short. */
const IDS_PER_READ = 150;

/** Which of `ids` this member has checked off. */
export async function readReviewed(db: Db, actorId: string, ids: readonly string[]): Promise<Set<string>> {
  const reviewed = new Set<string>();
  for (let i = 0; i < ids.length; i += IDS_PER_READ) {
    const { data, error } = await db.from("interview_reviews").select("interview_id").eq("actor_id", actorId).in("interview_id", ids.slice(i, i + IDS_PER_READ));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) reviewed.add(r.interview_id);
  }
  return reviewed;
}

const UNIQUE_VIOLATION = "23505";
const RLS_REFUSED = "42501";

/** Checks it off or clears it, which is the same answer done twice. False: an interview they cannot read. */
export async function setReviewed(db: Db, actorId: string, { interviewId, reviewed }: ReviewWrite): Promise<boolean> {
  if (!reviewed) {
    const { error } = await db.from("interview_reviews").delete().eq("interview_id", interviewId).eq("actor_id", actorId);
    if (error) throw new Error(error.message);
    return true;
  }
  const { error } = await db.from("interview_reviews").insert({ interview_id: interviewId });
  if (!error || error.code === UNIQUE_VIOLATION) return true;
  if (error.code === RLS_REFUSED) return false;
  throw new Error(error.message);
}
