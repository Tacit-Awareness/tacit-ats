import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { type EditOutcome, logCandidateTouch, setCandidateNextAction } from "./candidate-edits";
import { DRAFT_LATE_MS, inboxIssues, type InboxDraft, type InboxOutstanding, type Issue } from "./inbox-issues";
import { readPipeline } from "./pipeline";

// The Inbox's reads and writes, on the member's OWN client (never a
// privileged one), so the queue holds only what their token can read: the
// Pipeline board's read (live applications on open jobs: overdue next
// actions, core's stalled, the "Your call" column), core's interviewerActivity
// (admins and whoever manages a job; refused for anyone else, who sees no
// feedback issues), core's listMyApprovals, and their own candidate_emails
// drafts (the policy shows a draft to its author alone). lib/client/
// inbox-issues.ts turns these into the queue. Not for an interviewer
// (`limited`), who is refused: the page points them home.

/** Drafts read, newest first; the list says when it stops here. */
const DRAFTS_MAX = 100;
/**
 * How far back missing feedback counts. interviewerActivity scans oldest
 * first up to its caps (5,000 interviews, 200 can_see_feedback checks for a
 * non-admin, the second with no flag), so with no window the newest missing
 * feedback, the part still worth chasing, is what falls off.
 */
const FEEDBACK_WINDOW_DAYS = 90;
const DAY = 86_400_000;
/** Entries in the reader's activity story. */
const STORY_MAX = 12;

export type InboxRead = {
  issues: Issue[];
  /** interviewerActivity stopped at its cap, so some feedback may be missing. */
  truncated: boolean;
  /** The drafts read reached DRAFTS_MAX, so older ones may not be listed. */
  draftsCapped: boolean;
};

type DraftRow = {
  id: string;
  person_id: string;
  to_email: string;
  subject: string;
  body: string;
  updated_at: string;
  people: { display_name: string | null } | null;
  applications: { roles: { title: string } | null } | null;
};

async function readDrafts(db: Db, actorId: string, now: Date): Promise<InboxDraft[]> {
  const { data, error } = await db
    .from("candidate_emails")
    .select("id, person_id, to_email, subject, body, updated_at, people(display_name), applications(roles(title))")
    .eq("status", "draft")
    .eq("author_actor_id", actorId)
    .lt("updated_at", new Date(now.getTime() - DRAFT_LATE_MS).toISOString())
    .order("updated_at", { ascending: false })
    .limit(DRAFTS_MAX)
    .overrideTypes<DraftRow[], { merge: false }>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((d) => ({
    draftId: d.id,
    personId: d.person_id,
    personName: d.people?.display_name ?? d.to_email,
    jobTitle: d.applications?.roles?.title ?? null,
    toEmail: d.to_email,
    subject: d.subject,
    body: d.body,
    updatedAt: d.updated_at,
  }));
}

export async function readInbox(db: Db, member: Omit<clientTools.ClientToolCtx, "source">, now: Date): Promise<InboxRead> {
  if (member.accessLevel === "limited") throw new clientTools.ClientToolError("forbidden", "An interviewer's work is on their home page.");
  // The reports never write an audit row, so the source is never read.
  const ctx: clientTools.ClientToolCtx = { ...member, source: "claude" };
  const [pipeline, activity, approvals, drafts] = await Promise.all([
    readPipeline(db, now),
    clientTools.interviewerActivity(db, ctx, { since: new Date(now.getTime() - FEEDBACK_WINDOW_DAYS * DAY).toISOString().slice(0, 10) }).catch((err: unknown) => {
      // Someone who manages no job: whether anyone filed is not theirs to see.
      if (err instanceof clientTools.ClientToolError && err.code === "forbidden") return null;
      throw err;
    }),
    clientTools.listMyApprovals(db, ctx),
    readDrafts(db, member.actorId, now),
  ]);

  const names = new Map((activity?.interviewers ?? []).map((i) => [i.userId, i.name]));
  const outstanding: InboxOutstanding[] = (activity?.outstanding ?? []).map((o) => ({
    interviewId: o.interviewId,
    applicationId: o.applicationId,
    interviewerName: names.get(o.interviewerId) ?? null,
    endsAt: o.endsAt,
  }));

  return {
    issues: inboxIssues(
      {
        cards: pipeline.entries,
        outstanding,
        // The offer's terms stay out: they are confidential, and the queue only says one is waiting.
        approvals: approvals.map((a) => ({
          requestId: a.requestId,
          kind: a.kind,
          jobId: a.jobId,
          jobTitle: a.jobTitle,
          applicationId: a.applicationId,
          candidateId: a.candidateId,
          candidateName: a.candidateName,
          requestedBy: a.requestedBy,
          requestedAt: a.requestedAt,
          waitingStep: a.waitingStep,
          steps: a.steps,
        })),
        drafts,
      },
      now.getTime(),
    ),
    truncated: activity?.truncated ?? false,
    draftsCapped: drafts.length >= DRAFTS_MAX,
  };
}

/** What the reader adds for the issue open: the candidate's story, and whether the member may edit the job. */
export async function readIssue(db: Db, member: Omit<clientTools.ClientToolCtx, "source">, issue: Issue) {
  const ctx: clientTools.ClientToolCtx = { ...member, source: "claude" };
  const [story, canEdit] = await Promise.all([
    issue.candidate
      ? clientTools.getActivity(db, ctx, { candidateId: issue.candidate.id, limit: STORY_MAX }).then(
          (a) => a.entries,
          (err: unknown) => {
            if (err instanceof clientTools.ClientToolError && err.code === "not_found") return [];
            throw err;
          },
        )
      : [],
    issue.applicationId && issue.job.id
      ? db.rpc("can_on_role", { p_role: issue.job.id, perm: "can_edit_pipeline" }).then((r) => {
          if (r.error) throw new Error(r.error.message);
          return r.data === true;
        })
      : false,
  ]);
  return { story, canEdit };
}

/** "Mark it done": clears the next action, only while it is still the overdue one the page showed. */
export async function clearOverdueAction(db: Db, ctx: clientTools.ClientToolCtx, input: { applicationId: string; nextAction: string | null }, now: Date): Promise<EditOutcome> {
  const { applicationId } = input;
  const { data, error } = await db.from("applications").select("role_id, next_action, next_action_due").eq("id", applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ok: false, error: "not_found" };
  const overdue = data.next_action_due !== null && data.next_action_due < now.toISOString().slice(0, 10);
  if (!overdue || data.next_action !== input.nextAction) return { ok: true, changed: false, roleId: data.role_id };
  return setCandidateNextAction(db, ctx, { applicationId, nextAction: null, due: null });
}

/** "Log a touch": the candidate page's, with no note. */
export const touchApplication = (db: Db, actorId: string, applicationId: string) => logCandidateTouch(db, actorId, { applicationId, note: null });
