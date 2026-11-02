import type { Db } from "@tacit/db";

import { ClientToolError, LIST_MAX, type ClientToolCtx } from "./context.js";

/**
 * One candidate's activity, newest first, for the client connector: their
 * pipeline history (application_events), the team's notes, their interviews,
 * their offers (and those offers' approvals), the tags put on them and the
 * emails sent to them. Each is read with the member's own client, so what the member's token cannot read simply does not appear: a
 * private note they may not see, a job they have no access to, an offer on a
 * job they do not manage. Nothing here filters by org or level beyond
 * choosing how an interviewer reads.
 *
 * An interviewer is answered, not refused as get_pipeline refuses them: their
 * view is their own notes and the interviews they are on with this
 * candidate. That is what get_candidate and list_my_interviews already give
 * them, put in order, and refusing would hide from them what they themselves
 * did. Their token cannot read the applications an interview hangs off, so
 * the interviews come through my_interviews(), like list_my_interviews.
 *
 * An interview's `done` or `cancelled` entry is dated by its updated_at: the
 * table records when it last changed, not when its status did.
 */

export const ACTIVITY_DEFAULT = 30;

export type ActivityKind =
  | "application.added" | "application.stage_changed" | "application.owner_changed" | "application.next_action"
  | "application.touched" | "application.note"
  | "note"
  | "interview.scheduled" | "interview.done" | "interview.cancelled"
  | "offer.drafted" | "offer.extended" | "offer.accepted" | "offer.declined" | "offer.withdrawn"
  | "tag.added"
  | "email" | "email.reply"
  // An offer's approval (20261016110000_client_approvals): asked for, each
  // step's decision, and the request ending because the terms or the flow
  // changed (reset) or the offer was withdrawn (cancelled).
  | "approval.requested" | "approval.approved" | "approval.rejected" | "approval.reset" | "approval.cancelled";

export type ActivityEntry = {
  at: string;
  kind: ActivityKind;
  /** The teammate who did it, when the record says. */
  actor: string | null;
  applicationId: string | null;
  jobTitle: string | null;
  /** Stage moves; the stage an application was added at. */
  fromStage: string | null;
  toStage: string | null;
  /** How an application came in (application.added). */
  source: string | null;
  /** Teammates the entry names: a new owner, an interview's interviewers. */
  people: string[];
  /**
   * Member-written or candidate-derived text: a note, a next action, a
   * rejection reason, a source detail, an interview step, a tag, an email's
   * subject or a reply's, an approver's reason.
   */
  text: string | null;
  /** When an interview is (interview entries). */
  startsAt: string | null;
  /** The note, interview, offer, tag, email or approval request the entry is about. */
  refId: string | null;
};

export type Activity = {
  candidateId: string;
  /** False for an interviewer: only their own notes and interviews. */
  full: boolean;
  entries: ActivityEntry[];
};

const entry = (e: Partial<ActivityEntry> & Pick<ActivityEntry, "at" | "kind">): ActivityEntry => ({
  actor: null, applicationId: null, jobTitle: null, fromStage: null, toStage: null, source: null,
  people: [], text: null, startsAt: null, refId: null, ...e,
});

const EVENT_KINDS: Record<string, ActivityKind> = {
  added: "application.added",
  stage_changed: "application.stage_changed",
  owner_changed: "application.owner_changed",
  next_action_set: "application.next_action",
  touched: "application.touched",
  note: "application.note",
};

type InterviewRow = {
  id: string; application_id: string; status: string; step: string | null; starts_at: string;
  interviewer_actor_ids: string[]; created_at: string; updated_at: string;
};

const INTERVIEW_COLUMNS = "id, application_id, status, step, starts_at, interviewer_actor_ids, created_at, updated_at";

function interviewEntries(rows: InterviewRow[], jobOf: (applicationId: string) => string | null, names: Map<string, string | null>): ActivityEntry[] {
  return rows.flatMap((i) => {
    const base = {
      applicationId: i.application_id, jobTitle: jobOf(i.application_id), text: i.step, startsAt: i.starts_at, refId: i.id,
      people: i.interviewer_actor_ids.map((id) => names.get(id) ?? null).filter((n): n is string => !!n),
    };
    const out = [entry({ ...base, at: i.created_at, kind: "interview.scheduled" })];
    if (i.status === "done" || i.status === "cancelled") out.push(entry({ ...base, at: i.updated_at, kind: `interview.${i.status}` }));
    return out;
  });
}

async function memberNames(db: Db, ids: Array<string | null>): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const names = new Map<string, string | null>();
  if (!unique.length) return names;
  const { data, error } = await db.from("org_members").select("id, display_name").in("id", unique);
  if (error) throw new Error(error.message);
  for (const m of data ?? []) if (m.id) names.set(m.id, m.display_name);
  return names;
}

type NoteRow = { id: string; text: string; actor_id: string | null; created_at: string };

/** The query, not its result: it runs beside the others in one Promise.all. */
const notesQuery = (db: Db, candidateId: string, limit: number) =>
  db.from("person_notes")
    .select("id, text, actor_id, created_at")
    .eq("person_id", candidateId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

const noteEntries = (rows: NoteRow[], names: Map<string, string | null>) =>
  rows.map((n) => entry({ at: n.created_at, kind: "note", actor: n.actor_id ? (names.get(n.actor_id) ?? null) : null, text: n.text, refId: n.id }));

const newestFirst = (entries: ActivityEntry[], limit: number) =>
  entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);

export async function getActivity(
  db: Db,
  ctx: ClientToolCtx,
  input: { candidateId: string; limit?: number },
): Promise<Activity> {
  const limit = Math.min(Math.max(input.limit ?? ACTIVITY_DEFAULT, 1), LIST_MAX);
  const notFound = () =>
    new ClientToolError("not_found", "No candidate with that id that you can see. Call search_candidates for the ids.");

  if (ctx.accessLevel === "limited") {
    const { data: mine, error } = await db.rpc("my_interviews");
    if (error) throw new Error(error.message);
    const theirs = (mine ?? []).filter((i) => i.person_id === input.candidateId);
    if (!theirs.length) throw notFound();
    const jobs = new Map(theirs.map((i) => [i.application_id, i.job_title]));
    const [interviews, noteRows] = await Promise.all([
      db.from("interviews").select(INTERVIEW_COLUMNS).in("id", theirs.map((i) => i.interview_id)),
      notesQuery(db, input.candidateId, limit),
    ]);
    for (const r of [interviews, noteRows]) if (r.error) throw new Error(r.error.message);
    const rows = (interviews.data ?? []) as InterviewRow[];
    const notes: NoteRow[] = noteRows.data ?? [];
    const names = await memberNames(db, [...rows.flatMap((i) => i.interviewer_actor_ids), ...notes.map((n) => n.actor_id)]);
    return {
      candidateId: input.candidateId,
      full: false,
      entries: newestFirst([...interviewEntries(rows, (a) => jobs.get(a) ?? null, names), ...noteEntries(notes, names)], limit),
    };
  }

  const { data: person, error } = await db.from("people").select("id").eq("id", input.candidateId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!person) throw notFound();

  // The applications the member can read; everything hanging off one follows it.
  const { data: apps, error: appsError } = await db
    .from("applications")
    .select("id, source_detail, roles(title)")
    .eq("person_id", input.candidateId)
    .overrideTypes<Array<{ id: string; source_detail: string | null; roles: { title: string } | null }>, { merge: false }>();
  if (appsError) throw new Error(appsError.message);
  const appIds = (apps ?? []).map((a) => a.id);
  const jobOf = (applicationId: string) => (apps ?? []).find((a) => a.id === applicationId)?.roles?.title ?? null;
  const detailOf = (applicationId: string) => (apps ?? []).find((a) => a.id === applicationId)?.source_detail ?? null;

  const none = Promise.resolve({ data: [], error: null });
  const [events, interviews, offers, tags, noteRows, emails, replies] = await Promise.all([
    appIds.length
      ? db.from("application_events").select("id, application_id, actor_id, kind, from_stage, to_stage, detail, created_at")
        .in("application_id", appIds).order("created_at", { ascending: false }).limit(limit)
      : none,
    appIds.length
      ? db.from("interviews").select(INTERVIEW_COLUMNS).in("application_id", appIds).order("created_at", { ascending: false }).limit(limit)
      : none,
    // Offers read only for someone who manages the job: the policy returns none to anyone else.
    appIds.length
      ? db.from("offers").select("id, application_id, status, created_by_actor_id, created_at, extended_at, resolved_at")
        .in("application_id", appIds).order("created_at", { ascending: false }).limit(limit)
      : none,
    db.from("person_tags").select("id, added_by_actor_id, created_at, tags(name)").eq("person_id", input.candidateId)
      .order("created_at", { ascending: false }).limit(limit),
    notesQuery(db, input.candidateId, limit),
    // Sent emails only: a draft is its author's, and not something that happened.
    db.from("candidate_emails").select("id, application_id, author_actor_id, subject, sent_at").eq("person_id", input.candidateId)
      .eq("status", "sent").order("sent_at", { ascending: false }).limit(limit),
    db.from("candidate_email_replies").select("id, subject, received_at, candidate_emails!inner(application_id)").eq("candidate_emails.person_id", input.candidateId)
      .order("received_at", { ascending: false }).limit(limit),
  ]);
  for (const r of [events, interviews, offers, tags, noteRows, emails, replies]) if (r.error) throw new Error(r.error.message);
  const notes: NoteRow[] = noteRows.data ?? [];

  type EventRow = {
    id: string; application_id: string; actor_id: string | null; kind: string;
    from_stage: string | null; to_stage: string | null; detail: string | null; created_at: string;
  };
  type OfferRow = {
    id: string; application_id: string; status: string; created_by_actor_id: string | null;
    created_at: string; extended_at: string | null; resolved_at: string | null;
  };
  type TagRow = { id: string; added_by_actor_id: string | null; created_at: string; tags: { name: string } | null };
  const eventRows = (events.data ?? []) as EventRow[];
  const interviewRows = (interviews.data ?? []) as InterviewRow[];
  const offerRows = (offers.data ?? []) as OfferRow[];
  const tagRows = (tags.data ?? []) as unknown as TagRow[];
  type EmailRow = { id: string; application_id: string | null; author_actor_id: string | null; subject: string; sent_at: string | null };
  const emailRows = ((emails.data ?? []) as EmailRow[]).filter((e) => e.sent_at);
  type ReplyRow = { id: string; subject: string; received_at: string; candidate_emails: { application_id: string | null } };
  const replyRows = (replies.data ?? []) as unknown as ReplyRow[];

  // The offers' approval requests and decisions: readable exactly where the offers are.
  type ApprovalRow = {
    id: string; offer_id: string; status: string; requested_by_actor_id: string | null; created_at: string; resolved_at: string | null;
    approval_decisions: Array<{ step: number; decision: string; actor_id: string | null; reason: string | null; created_at: string }>;
  };
  let approvalRows: ApprovalRow[] = [];
  if (offerRows.length) {
    const { data, error: approvalsError } = await db
      .from("approval_requests")
      .select("id, offer_id, status, requested_by_actor_id, created_at, resolved_at, approval_decisions(step, decision, actor_id, reason, created_at)")
      .in("offer_id", offerRows.map((o) => o.id))
      .order("created_at", { ascending: false })
      .limit(limit)
      .overrideTypes<ApprovalRow[], { merge: false }>();
    if (approvalsError) throw new Error(approvalsError.message);
    approvalRows = data ?? [];
  }
  const offerApp = (offerId: string) => offerRows.find((o) => o.id === offerId)?.application_id ?? null;

  const names = await memberNames(db, [
    ...eventRows.map((e) => e.actor_id),
    ...interviewRows.flatMap((i) => i.interviewer_actor_ids),
    ...offerRows.map((o) => o.created_by_actor_id),
    ...tagRows.map((t) => t.added_by_actor_id),
    ...notes.map((n) => n.actor_id),
    ...emailRows.map((e) => e.author_actor_id),
    ...approvalRows.flatMap((r) => [r.requested_by_actor_id, ...(r.approval_decisions ?? []).map((d) => d.actor_id)]),
  ]);
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null);

  const entries: ActivityEntry[] = [
    ...eventRows.map((e) => {
      const kind = EVENT_KINDS[e.kind] ?? "application.note";
      const base = { at: e.created_at, kind, actor: nameOf(e.actor_id), applicationId: e.application_id, jobTitle: jobOf(e.application_id), refId: e.id };
      if (kind === "application.added") {
        // The event's detail is the source it came in with; the detail beside it lives on the application.
        return entry({ ...base, toStage: e.to_stage, source: e.detail, text: detailOf(e.application_id) });
      }
      // An owner change names the new owner, a teammate.
      if (kind === "application.owner_changed") return entry({ ...base, people: e.detail ? [e.detail] : [] });
      return entry({ ...base, fromStage: e.from_stage, toStage: e.to_stage, text: e.detail });
    }),
    ...interviewEntries(interviewRows, jobOf, names),
    // Status and dates only: the terms are get_offers', for the people who may read them.
    ...offerRows.flatMap((o) => {
      const base = { applicationId: o.application_id, jobTitle: jobOf(o.application_id), refId: o.id };
      const out = [entry({ ...base, at: o.created_at, kind: "offer.drafted", actor: nameOf(o.created_by_actor_id) })];
      if (o.extended_at) out.push(entry({ ...base, at: o.extended_at, kind: "offer.extended" }));
      if (o.resolved_at && (o.status === "accepted" || o.status === "declined" || o.status === "withdrawn")) {
        out.push(entry({ ...base, at: o.resolved_at, kind: `offer.${o.status}` }));
      }
      return out;
    }),
    // Who asked and who decided, and an approver's reason; never the terms.
    ...approvalRows.flatMap((r) => {
      const applicationId = offerApp(r.offer_id);
      const base = { applicationId, jobTitle: applicationId ? jobOf(applicationId) : null, refId: r.id };
      const out = [entry({ ...base, at: r.created_at, kind: "approval.requested", actor: nameOf(r.requested_by_actor_id) })];
      for (const d of r.approval_decisions ?? []) {
        out.push(entry({
          ...base, at: d.created_at, kind: d.decision === "rejected" ? "approval.rejected" : "approval.approved",
          actor: nameOf(d.actor_id), text: d.reason,
        }));
      }
      if (r.resolved_at && (r.status === "reset" || r.status === "cancelled")) {
        out.push(entry({ ...base, at: r.resolved_at, kind: `approval.${r.status}` }));
      }
      return out;
    }),
    ...tagRows.map((t) => entry({ at: t.created_at, kind: "tag.added", actor: nameOf(t.added_by_actor_id), text: t.tags?.name ?? null, refId: t.id })),
    ...noteEntries(notes, names),
    ...emailRows.map((e) => entry({
      at: e.sent_at!, kind: "email", actor: nameOf(e.author_actor_id), applicationId: e.application_id,
      jobTitle: e.application_id ? jobOf(e.application_id) : null, text: e.subject, refId: e.id,
    })),
    ...replyRows.map((r) => {
      const applicationId = r.candidate_emails.application_id;
      return entry({ at: r.received_at, kind: "email.reply", applicationId, jobTitle: applicationId ? jobOf(applicationId) : null, text: r.subject || null, refId: r.id });
    }),
  ];
  return { candidateId: input.candidateId, full: true, entries: newestFirst(entries, limit) };
}
