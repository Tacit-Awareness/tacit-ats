import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import type { MoveInput } from "./candidate-edit-rules";
import { type CloseReason, type EditOutcome, logCandidateTouch, moveCandidate, setCandidateNextAction } from "./candidate-edits";
import { doneItems, type Dismissal, type DoneItem, type DoneSubject } from "./inbox-done";
import { DRAFT_LATE_MS, currentDrafts, inboxIssues, instanceId, isIssueReason, standingIssues, type InboxDraft, type InboxInput, type InboxOutstanding, type Issue, type IssueInstance, type LaterEmail } from "./inbox-issues";
import { readPipeline } from "./pipeline";

// The Inbox's reads and writes, on the member's OWN client (never a
// privileged one), so the queue holds only what their token can read: the
// Pipeline board's read (live applications on open jobs: overdue next
// actions, core's stalled, the "Your call" column), core's interviewerActivity
// (admins and whoever manages a job; refused for anyone else, who sees no
// feedback issues), core's listMyApprovals, and their own candidate_emails
// drafts (the policy shows a draft to its author alone). lib/client/
// inbox-issues.ts turns these into the queue, keeping only drafts that have sat
// for DRAFT_LATE_MS and that no newer email on the application has replaced. Not for an interviewer
// (`limited`), who is refused: the page points them home. The writes are
// clientTools' audited ones with source `dashboard`: a decision on an approval,
// and the stage move the candidate page makes. A dismissal is the member's own
// row in inbox_dismissals, ids and timestamps only, so nothing here is audited
// and nothing about the issue is kept: the Done tab reads it back through the
// member's own reads, and what they can no longer read drops off it.

/** Drafts read, newest first; the list says when it stops here. */
const DRAFTS_MAX = 100;
/** How many of a member's drafts are looked at for those 100: a request brings back 1,000 at most. */
const DRAFT_SCAN_MAX = 1000;
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
/** Rows on the Done tab, newest first; the list says when it stops here. */
const DONE_MAX = 200;
/** Ids in one `in` filter, as the Pipeline board reads: past this the URL gets too long. */
const IDS_A_READ = 150;
/** PostgREST's row limit, which ends a read with no error. */
const ROWS_A_READ = 1000;

const UNIQUE_VIOLATION = "23505";
const REFUSED = "42501";

const chunks = <T,>(all: T[]): T[][] => Array.from({ length: Math.ceil(all.length / IDS_A_READ) }, (_, i) => all.slice(i * IDS_A_READ, (i + 1) * IDS_A_READ));

export type InboxRead = {
  issues: Issue[];
  /** Everything that holds, dismissed or not: readDone tells what stands from what has gone. */
  standing: Issue[];
  /** interviewerActivity stopped at its cap, so some feedback may be missing. */
  truncated: boolean;
  /** More current drafts than DRAFTS_MAX, or the scan stopped short, so older ones may not be listed. */
  draftsCapped: boolean;
};

type DraftHead = { id: string; application_id: string | null; created_at: string; updated_at: string };

type DraftRow = {
  id: string;
  person_id: string;
  application_id: string | null;
  to_email: string;
  subject: string;
  body: string;
  created_at: string;
  updated_at: string;
  people: { display_name: string | null } | null;
  applications: { roles: { title: string } | null } | null;
};

/**
 * The member's forgotten drafts, newest DRAFTS_MAX: current (a draft can't be
 * discarded, so replaced ones pile up for good) and older than DRAFT_LATE_MS.
 * Both are settled before the cap, by ids and times alone, or dead drafts or a
 * batch still being written would push out one worth sending. Only the drafts
 * kept bring their text.
 */
async function readDrafts(db: Db, actorId: string, now: Date): Promise<{ drafts: InboxDraft[]; capped: boolean }> {
  const { data: heads, error } = await db
    .from("candidate_emails")
    .select("id, application_id, created_at, updated_at")
    .eq("status", "draft")
    .eq("author_actor_id", actorId)
    .order("updated_at", { ascending: false })
    .limit(DRAFT_SCAN_MAX)
    .overrideTypes<DraftHead[], { merge: false }>();
  if (error) throw new Error(error.message);
  const scanned = (heads ?? []).map((d) => ({ draftId: d.id, applicationId: d.application_id, createdAt: d.created_at, updatedAt: d.updated_at }));
  if (!scanned.length) return { drafts: [], capped: false };

  // The member's emails that left draft since the oldest of these, newest first.
  const oldest = scanned.reduce((at, d) => (d.createdAt < at ? d.createdAt : at), scanned[0]!.createdAt);
  const { data: others, error: othersError } = await db
    .from("candidate_emails")
    .select("application_id, created_at")
    .eq("author_actor_id", actorId)
    .neq("status", "draft")
    .not("application_id", "is", null)
    .gte("created_at", oldest)
    .order("created_at", { ascending: false })
    .limit(DRAFT_SCAN_MAX);
  if (othersError) throw new Error(othersError.message);
  const later: LaterEmail[] = (others ?? []).flatMap((o) => (o.application_id ? [{ applicationId: o.application_id, createdAt: o.created_at }] : []));

  const current = currentDrafts(scanned, later).filter((d) => now.getTime() - Date.parse(d.updatedAt) > DRAFT_LATE_MS);
  const capped = current.length > DRAFTS_MAX || scanned.length >= DRAFT_SCAN_MAX;
  const ids = current.slice(0, DRAFTS_MAX).map((d) => d.draftId);
  if (!ids.length) return { drafts: [], capped };
  const { data, error: rowsError } = await db
    .from("candidate_emails")
    .select("id, person_id, application_id, to_email, subject, body, created_at, updated_at, people(display_name), applications(roles(title))")
    .in("id", ids)
    .order("updated_at", { ascending: false })
    .overrideTypes<DraftRow[], { merge: false }>();
  if (rowsError) throw new Error(rowsError.message);
  const drafts = (data ?? []).map((d) => ({
    draftId: d.id,
    personId: d.person_id,
    personName: d.people?.display_name ?? d.to_email,
    jobTitle: d.applications?.roles?.title ?? null,
    applicationId: d.application_id,
    toEmail: d.to_email,
    subject: d.subject,
    body: d.body,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }));
  return { drafts, capped };
}

/**
 * Which of what stands the member has set aside. Asked by key, so the read is
 * as long as the queue and not every dismissal they ever made. Only `dismissed`
 * hides: `resolved` is a record for Done, and an issue that comes back after its
 * fix (the same due date set again) is waiting again.
 */
async function readDismissed(db: Db, standing: Issue[]): Promise<Set<string>> {
  const dismissed = new Set<string>();
  const parts = await Promise.all(chunks([...new Set(standing.map((i) => i.key))]).map((keys) => readDismissalsOn(db, keys)));
  for (const rows of parts) {
    for (const r of rows) {
      if (isIssueReason(r.reason)) dismissed.add(instanceId({ key: r.issue_key, reason: r.reason, at: r.issue_at }));
    }
  }
  return dismissed;
}

/** Every dismissal on these keys, by pages: a key keeps its past instances, and a read cut off at the row limit would bring a dismissed issue back. */
async function readDismissalsOn(db: Db, keys: string[]) {
  const rows: { issue_key: string; reason: string; issue_at: string }[] = [];
  for (;;) {
    const { data, error } = await db.from("inbox_dismissals").select("issue_key, reason, issue_at").eq("how", "dismissed").in("issue_key", keys).order("id").range(rows.length, rows.length + ROWS_A_READ - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < ROWS_A_READ) return rows;
  }
}

export async function readInbox(db: Db, member: Omit<clientTools.ClientToolCtx, "source">, now: Date): Promise<InboxRead> {
  if (member.accessLevel === "limited") throw new clientTools.ClientToolError("forbidden", "An interviewer's work is on their home page.");
  // The reports never write an audit row, so the source is never read.
  const ctx: clientTools.ClientToolCtx = { ...member, source: "claude" };
  const [pipeline, activity, approvals, { drafts, capped }] = await Promise.all([
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

  const input: InboxInput = {
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
  };
  const standing = standingIssues(input, now.getTime());
  return {
    issues: inboxIssues(input, now.getTime(), await readDismissed(db, standing)),
    standing,
    truncated: activity?.truncated ?? false,
    draftsCapped: capped,
  };
}

/** The candidate's story, or null when the member can't read them. */
const readStory = (db: Db, ctx: clientTools.ClientToolCtx, candidateId: string) =>
  clientTools.getActivity(db, ctx, { candidateId, limit: STORY_MAX }).then(
    (a) => a.entries,
    (err: unknown) => {
      if (err instanceof clientTools.ClientToolError && err.code === "not_found") return null;
      throw err;
    },
  );

/**
 * What the reader adds for the issue open: the candidate's story, whether the
 * member may edit the job, the reasons a rejection can give, and an offer's
 * terms. The terms are read here, for the one open, and never reach the queue:
 * `my_approvals` shows them to whoever must approve, who can't decide without
 * them, and they go no further than this member's page. An approver may have no
 * access to the job (finance, an exec): the story is null then, and `canOpen`
 * false, so the reader doesn't link to a page that would 404.
 */
export async function readIssue(db: Db, member: Omit<clientTools.ClientToolCtx, "source">, issue: Issue) {
  const ctx: clientTools.ClientToolCtx = { ...member, source: "claude" };
  const offerRequest = issue.approval?.kind === "offer" ? issue.approval.requestId : null;
  const [story, canEdit, terms, reasons, jobSeen] = await Promise.all([
    issue.candidate ? readStory(db, ctx, issue.candidate.id) : [],
    issue.applicationId && issue.job.id
      ? db.rpc("can_on_role", { p_role: issue.job.id, perm: "can_edit_pipeline" }).then((r) => {
          if (r.error) throw new Error(r.error.message);
          return r.data === true;
        })
      : false,
    offerRequest ? clientTools.listMyApprovals(db, ctx).then((all) => all.find((a) => a.requestId === offerRequest)?.terms ?? null) : null,
    issue.reason === "decide"
      ? clientTools.listRejectionReasons(db, ctx).then((all): CloseReason[] => all.filter((r) => r.kind === "rejected"))
      : ([] as CloseReason[]),
    issue.approval && !issue.candidate && issue.job.id
      ? db.from("roles").select("id").eq("id", issue.job.id).maybeSingle().then((r) => {
          if (r.error) throw new Error(r.error.message);
          return r.data !== null;
        })
      : true,
  ]);
  return { story, canEdit, terms, reasons, canOpen: story !== null && jobSeen };
}

type DoneApplication = { id: string; person_id: string; role_id: string; people: { display_name: string | null } | null; roles: { title: string } | null };
type DoneApproval = { id: string; kind: string; role_id: string; roles: { title: string } | null };
type DoneDraft = { id: string; person_id: string; to_email: string; people: { display_name: string | null } | null; applications: { roles: { title: string } | null } | null };

/** Names for what no longer stands, on the member's own reads: what they can't read has no name, and drops off Done. */
async function readDoneSubjects(db: Db, actorId: string, keys: string[]): Promise<Map<string, DoneSubject>> {
  const ids = (prefix: string) => keys.filter((k) => k.startsWith(`${prefix}-`)).map((k) => k.slice(prefix.length + 1));
  const failed = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
  };
  const [applications, approvals, drafts] = await Promise.all([
    Promise.all(
      chunks(ids("app")).map((part) =>
        db.from("applications").select("id, person_id, role_id, people(display_name), roles(title)").in("id", part).is("merged_into_id", null).overrideTypes<DoneApplication[], { merge: false }>(),
      ),
    ),
    Promise.all(chunks(ids("appr")).map((part) => db.from("approval_requests").select("id, kind, role_id, roles(title)").in("id", part).overrideTypes<DoneApproval[], { merge: false }>())),
    Promise.all(
      chunks(ids("draft")).map((part) =>
        db.from("candidate_emails").select("id, person_id, to_email, people(display_name), applications(roles(title))").in("id", part).eq("author_actor_id", actorId).overrideTypes<DoneDraft[], { merge: false }>(),
      ),
    ),
  ]);
  const subjects = new Map<string, DoneSubject>();
  for (const r of applications) {
    failed(r);
    for (const a of r.data ?? []) subjects.set(`app-${a.id}`, { candidate: { id: a.person_id, name: a.people?.display_name ?? "This candidate" }, jobId: a.role_id, jobTitle: a.roles?.title ?? null, approvalKind: null });
  }
  for (const r of approvals) {
    failed(r);
    for (const a of r.data ?? []) subjects.set(`appr-${a.id}`, { candidate: null, jobId: a.role_id, jobTitle: a.roles?.title ?? null, approvalKind: a.kind === "offer" ? "offer" : "job_open" });
  }
  for (const r of drafts) {
    failed(r);
    for (const d of r.data ?? []) subjects.set(`draft-${d.id}`, { candidate: { id: d.person_id, name: d.people?.display_name ?? d.to_email }, jobId: null, jobTitle: d.applications?.roles?.title ?? null, approvalKind: null });
  }
  return subjects;
}

export type DoneRead = { items: DoneItem[]; /** The read reached DONE_MAX, so older ones may not be listed. */ capped: boolean };

/**
 * The Done tab: the member's own rows, newest first. What still stands is worded
 * from the live queue, which also keeps an approval on the list for an approver
 * who can't read the job, and can only get it back from here.
 */
export async function readDone(db: Db, actorId: string, standing: Issue[]): Promise<DoneRead> {
  const { data, error } = await db
    .from("inbox_dismissals")
    .select("id, issue_key, reason, issue_at, how, dismissed_at")
    // The digest's read marks share the table. doneItems would drop them, but only after this read's limit: one Mark all as read would push real rows off Done.
    .not("issue_key", "like", "evt-%")
    .not("issue_key", "like", "iv-%")
    .order("dismissed_at", { ascending: false })
    .order("id")
    .limit(DONE_MAX);
  if (error) throw new Error(error.message);
  const rows: Dismissal[] = (data ?? []).map((r) => ({ id: r.id, key: r.issue_key, reason: r.reason, at: r.issue_at, how: r.how === "resolved" ? "resolved" : "dismissed", dismissedAt: r.dismissed_at }));
  const live = new Set(standing.map(instanceId));
  const gone = rows.filter((r) => !isIssueReason(r.reason) || !live.has(instanceId({ key: r.key, reason: r.reason, at: r.at }))).map((r) => r.key);
  const subjects = await readDoneSubjects(db, actorId, [...new Set(gone)]);
  return { items: doneItems(rows, standing, subjects), capped: rows.length >= DONE_MAX };
}

/** The Done reader's story. Null when the member can no longer read them. */
export const readDoneStory = (db: Db, member: Omit<clientTools.ClientToolCtx, "source">, candidateId: string) => readStory(db, { ...member, source: "claude" }, candidateId);

export type DismissOutcome = { ok: true; changed: true; id: string } | { ok: true; changed: false } | { ok: false; error: "refused" };

const insertDismissal = (db: Db, i: IssueInstance, how: "dismissed" | "resolved") =>
  db.from("inbox_dismissals").insert({ issue_key: i.key, reason: i.reason, issue_at: i.at, how }).select("id").maybeSingle();

/**
 * E: sets this instance aside for this member. `org_id`, `actor_id` and
 * `dismissed_at` are the database's, so the form can name none of them. A row
 * already there is either the same dismissal, a second press, or a `resolved`
 * one for an issue that has since come back, which is only history: that row
 * gives way, or the issue could never be set aside. There is no update grant.
 */
export async function dismissIssue(db: Db, instance: IssueInstance): Promise<DismissOutcome> {
  const made = await insertDismissal(db, instance, "dismissed");
  if (made.data) return { ok: true, changed: true, id: made.data.id };
  if (made.error?.code === REFUSED) return { ok: false, error: "refused" };
  if (made.error?.code !== UNIQUE_VIOLATION) throw new Error(made.error?.message ?? "inbox_dismissals: no row came back");

  const there = await db.from("inbox_dismissals").select("id, how").eq("issue_key", instance.key).eq("reason", instance.reason).eq("issue_at", instance.at).maybeSingle();
  if (there.error) throw new Error(there.error.message);
  if (!there.data || there.data.how === "dismissed") return { ok: true, changed: false };
  const cleared = await db.from("inbox_dismissals").delete().eq("id", there.data.id);
  if (cleared.error) throw new Error(cleared.error.message);
  const again = await insertDismissal(db, instance, "dismissed");
  if (again.data) return { ok: true, changed: true, id: again.data.id };
  if (again.error?.code === UNIQUE_VIOLATION) return { ok: true, changed: false };
  throw new Error(again.error?.message ?? "inbox_dismissals: no row came back");
}

/** Back to the queue, and Undo: deletes the member's own row. Null when there is none, which is also someone else's id. */
export async function restoreIssue(db: Db, id: string): Promise<{ key: string } | null> {
  const { data, error } = await db.from("inbox_dismissals").delete().eq("id", id).select("issue_key").maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { key: data.issue_key } : null;
}

/**
 * The fix ran, so Done says so. Only a record, and the write it records has
 * happened: failing here must not say the fix did. A row already there stays.
 */
export async function noteResolved(db: Db, instance: IssueInstance | null): Promise<void> {
  if (!instance) return;
  try {
    const { error } = await insertDismissal(db, instance, "resolved");
    if (error && error.code !== UNIQUE_VIOLATION) console.error("[client-inbox] resolved row failed:", error.message);
  } catch (err) {
    console.error("[client-inbox] resolved row failed:", err instanceof Error ? err.message : err);
  }
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

export type ApprovalOutcome =
  /** `reset`: nobody decided it. Its terms or approvers changed, or the offer was withdrawn. */
  | { ok: true; outcome: clientTools.DecisionResult["outcome"] | "reset"; kind: clientTools.ApprovalKind }
  | { ok: false; error: "not_found" | "not_approver" | "reason_required" | "rate_limited" };

/** A or R on an approval: clientTools' decideApproval, the connector's approve and reject. A reason is the approver's own words, and core keeps it out of the audit row. */
export async function decideInboxApproval(
  db: Db,
  ctx: clientTools.ClientToolCtx,
  input: { requestId: string; decision: "approve" | "reject"; reason: string | null },
): Promise<ApprovalOutcome> {
  if (input.decision === "reject" && !input.reason?.trim()) return { ok: false, error: "reason_required" };
  try {
    const r = await clientTools.decideApproval(db, ctx, input);
    const reset = r.outcome === "not_pending" && (r.status === "reset" || r.status === "cancelled");
    return { ok: true, outcome: reset ? "reset" : r.outcome, kind: r.kind };
  } catch (err) {
    if (err instanceof clientTools.ClientToolError) {
      if (err.code === "not_found" || err.code === "rate_limited") return { ok: false, error: err.code };
      if (err.code === "forbidden") return { ok: false, error: "not_approver" };
    }
    throw err;
  }
}

/** O or R on the team's call: the candidate page's move, from the stage the issue stands on. */
export const decideInboxApplication = (db: Db, ctx: clientTools.ClientToolCtx, input: MoveInput) => moveCandidate(db, ctx, input);
