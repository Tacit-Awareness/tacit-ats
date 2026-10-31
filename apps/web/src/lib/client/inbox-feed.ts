import type { Db } from "@tacit/db";
import { buildDigest, DIGEST_REASONS, markId, rangeStart, type Digest, type DigestInput, type DigestRange, type DigestReason, type DigestSubject, type ReadMark } from "./inbox-digest";

// The Inbox digest's reads and its read marks, on the member's OWN client (never
// a privileged one), so the policies are the job scoping: `applications!inner`
// keeps only what their token can read, on `interviews` too, whose policy also
// gives an interviewer their own. Feedback is whatever can_see_feedback returns
// for them, so a verdict shows only where they may read it. These column lists
// are the privacy rule: no event `detail` (a rejection's reason), no feedback
// `notes` or `rating`, no interview link. lib/client/inbox-digest.ts words it.

/** Rows a table is read for, newest first: PostgREST's row limit. `capped` says when one stopped here. */
const SCAN_MAX = 1000;
/** Ids in one `in` filter, as the Inbox reads: past this the URL gets too long. */
const IDS_A_READ = 150;

const UNIQUE_MARK = "actor_id,issue_key,reason,issue_at";
const REFUSED = "42501";

const SUBJECT = "applications!inner(id, person_id, people(display_name), roles(title))";

type SubjectRow = {
  id: string;
  person_id: string;
  people: { display_name: string | null } | null;
  roles: { title: string } | null;
};
type EventRow = { id: string; actor_id: string | null; to_stage: string | null; created_at: string; applications: SubjectRow };
type InterviewRow = { id: string; interviewer_actor_ids: string[]; starts_at: string; created_at: string; applications: SubjectRow };
type FeedbackRow = { id: string; interview_id: string; interviewer_actor_id: string; recommendation: string; submitted_at: string; interviews: { applications: SubjectRow } };

const chunks = <T,>(all: T[]): T[][] => Array.from({ length: Math.ceil(all.length / IDS_A_READ) }, (_, i) => all.slice(i * IDS_A_READ, (i + 1) * IDS_A_READ));

const subject = (a: SubjectRow): DigestSubject => ({
  applicationId: a.id,
  personId: a.person_id,
  personName: a.people?.display_name ?? null,
  jobTitle: a.roles?.title ?? null,
});

async function memberNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  const parts = await Promise.all(chunks([...new Set(ids)]).map((part) => db.from("org_members").select("id, display_name").in("id", part)));
  const names = new Map<string, string>();
  for (const { data, error } of parts) {
    if (error) throw new Error(error.message);
    for (const m of data ?? []) if (m.id && m.display_name) names.set(m.id, m.display_name);
  }
  return names;
}

/** Which of these keys the member has read. By key, so the read is as long as the digest and not every mark they ever made. */
async function readMarks(db: Db, keys: string[]): Promise<Set<string>> {
  const parts = await Promise.all(
    chunks([...new Set(keys)]).map((part) => db.from("inbox_dismissals").select("issue_key, reason, issue_at").in("issue_key", part).in("reason", [...DIGEST_REASONS])),
  );
  const read = new Set<string>();
  for (const { data, error } of parts) {
    if (error) throw new Error(error.message);
    for (const r of data ?? []) read.add(markId({ key: r.issue_key, reason: r.reason as DigestReason, at: r.issue_at }));
  }
  return read;
}

export type DigestRead = Digest & { /** A table reached SCAN_MAX in this range, so older rows aren't listed or counted. */ capped: boolean };

/** `needs` is the Needs you count, which the digest's sentence includes. */
export async function readDigest(db: Db, range: DigestRange, now: Date, needs: number): Promise<DigestRead> {
  const from = rangeStart(range, now.getTime());
  const [events, interviews, feedback] = await Promise.all([
    db
      .from("application_events")
      .select(`id, actor_id, to_stage, created_at, ${SUBJECT}`)
      .eq("kind", "stage_changed")
      .is("applications.merged_into_id", null)
      .gte("created_at", from)
      .order("created_at", { ascending: false })
      .limit(SCAN_MAX)
      .overrideTypes<EventRow[], { merge: false }>(),
    db
      .from("interviews")
      .select(`id, interviewer_actor_ids, starts_at, created_at, ${SUBJECT}`)
      .neq("status", "cancelled")
      .is("applications.merged_into_id", null)
      .gte("created_at", from)
      .order("created_at", { ascending: false })
      .limit(SCAN_MAX)
      .overrideTypes<InterviewRow[], { merge: false }>(),
    db
      .from("interview_feedback")
      .select(`id, interview_id, interviewer_actor_id, recommendation, submitted_at, interviews!inner(${SUBJECT})`)
      .neq("interviews.status", "cancelled")
      .is("interviews.applications.merged_into_id", null)
      .gte("submitted_at", from)
      .order("submitted_at", { ascending: false })
      .limit(SCAN_MAX)
      .overrideTypes<FeedbackRow[], { merge: false }>(),
  ]);
  for (const r of [events, interviews, feedback]) if (r.error) throw new Error(r.error.message);
  const eventRows = events.data ?? [];
  const interviewRows = interviews.data ?? [];
  const feedbackRows = feedback.data ?? [];

  const names = await memberNames(db, [
    ...eventRows.flatMap((e) => (e.actor_id ? [e.actor_id] : [])),
    ...interviewRows.flatMap((i) => i.interviewer_actor_ids),
    ...feedbackRows.map((f) => f.interviewer_actor_id),
  ]);
  const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);

  const input: DigestInput = {
    events: eventRows.map((e) => ({ ...subject(e.applications), id: e.id, actorName: name(e.actor_id), toStage: e.to_stage, at: e.created_at })),
    bookings: interviewRows.map((i) => ({
      ...subject(i.applications),
      id: i.id,
      interviewerNames: i.interviewer_actor_ids.flatMap((id) => names.get(id) ?? []),
      startsAt: i.starts_at,
      at: i.created_at,
    })),
    feedback: feedbackRows.map((f) => ({
      ...subject(f.interviews.applications),
      id: f.id,
      interviewId: f.interview_id,
      interviewerName: name(f.interviewer_actor_id),
      recommendation: f.recommendation,
      at: f.submitted_at,
    })),
  };
  const keys = [...input.events.map((e) => `evt-${e.id}`), ...input.bookings.map((b) => `iv-${b.id}`), ...input.feedback.map((f) => `iv-${f.interviewId}`)];
  const digest = buildDigest(input, await readMarks(db, keys), range, now.getTime(), needs);
  return { ...digest, capped: [eventRows, interviewRows, feedbackRows].some((r) => r.length >= SCAN_MAX) };
}

export type MarkOutcome = { ok: true } | { ok: false; error: "refused" };

/**
 * The member's own rows, ids and timestamps only: `org_id`, `actor_id` and
 * `dismissed_at` are the database's. One already there is the same mark, a
 * second press, so a conflict does nothing. Never audited: nothing changes for
 * anyone else.
 */
export async function markRead(db: Db, marks: ReadMark[]): Promise<MarkOutcome> {
  if (!marks.length) return { ok: true };
  const rows = marks.map((m) => ({ issue_key: m.key, reason: m.reason, issue_at: m.at }));
  const { error } = await db.from("inbox_dismissals").upsert(rows, { onConflict: UNIQUE_MARK, ignoreDuplicates: true });
  if (error?.code === REFUSED) return { ok: false, error: "refused" };
  if (error) throw new Error(error.message);
  return { ok: true };
}
