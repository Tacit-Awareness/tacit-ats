import type { Db } from "@tacit/db";

import { withAudit } from "./audit.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";

/**
 * Interviews and interview feedback for the client connector. Same rules as
 * the rest of client-tools: the member's own client, and the policies decide
 * (20261013120000): an interview is written by whoever may schedule on its
 * job, feedback only by its own interviewer, and another interviewer's
 * feedback is read per the org's feedback_visibility.
 *
 * Feedback is private to the company's hiring team: nothing here sends it
 * anywhere, and its notes are kept out of the audit row.
 */

export const RECOMMENDATIONS = ["strong_yes", "yes", "no", "strong_no"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];
export const INTERVIEW_STATUSES = ["scheduled", "done", "cancelled"] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

const FEEDBACK_MAX = 10_000;
const LOCATION_MAX = 500;
const STEP_MAX = 120;
const MAX_INTERVIEWERS = 10;
const MAX_LENGTH_MS = 8 * 60 * 60 * 1000;

/** An instant the caller must give with its offset: a bare local time is ambiguous across time zones. */
function instant(value: string, label: string): string {
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(value.trim()) || Number.isNaN(Date.parse(value))) {
    throw new ClientToolError("invalid", `${label} must be an ISO 8601 time with its offset, e.g. 2026-10-20T15:00:00-07:00.`);
  }
  return new Date(value).toISOString();
}

function span(startsAt: string, endsAt: string) {
  if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new ClientToolError("invalid", "An interview must end after it starts.");
  if (Date.parse(endsAt) - Date.parse(startsAt) > MAX_LENGTH_MS) throw new ClientToolError("invalid", "An interview is at most 8 hours long.");
}

async function can(db: Db, roleId: string, perm: "can_schedule"): Promise<boolean> {
  const { data, error } = await db.rpc("can_on_role", { p_role: roleId, perm });
  if (error) throw new Error(error.message);
  return data === true;
}

/** The interviewers, each an active member of the caller's company. */
async function interviewers(db: Db, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) throw new ClientToolError("invalid", "An interview needs at least one interviewer.");
  if (unique.length > MAX_INTERVIEWERS) throw new ClientToolError("invalid", `At most ${MAX_INTERVIEWERS} interviewers.`);
  const { data, error } = await db.from("org_members").select("id").in("id", unique);
  if (error) throw new Error(error.message);
  const found = new Set((data ?? []).map((m) => m.id));
  if (unique.some((id) => !found.has(id))) {
    throw new ClientToolError("not_found", "Every interviewer must be someone at your company. Call list_team for the user ids.");
  }
  return unique;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type MyInterview = {
  interviewId: string;
  applicationId: string;
  candidateId: string;
  candidateName: string | null;
  jobId: string;
  jobTitle: string;
  startsAt: string;
  endsAt: string;
  status: string;
  step: string | null;
  locationOrLink: string | null;
  feedbackFiled: boolean;
};

export async function listMyInterviews(
  db: Db,
  _ctx: ClientToolCtx,
  input: { when?: "upcoming" | "past" | "all" } = {},
  now: Date = new Date(),
): Promise<MyInterview[]> {
  const { data, error } = await db.rpc("my_interviews");
  if (error) throw new Error(error.message);
  const t = now.getTime();
  const when = input.when ?? "upcoming";
  return (data ?? [])
    .filter((i) => when === "all" || (when === "upcoming" ? Date.parse(i.ends_at) >= t : Date.parse(i.ends_at) < t))
    .map((i) => ({
      interviewId: i.interview_id,
      applicationId: i.application_id,
      candidateId: i.person_id,
      candidateName: i.candidate_name,
      jobId: i.job_id,
      jobTitle: i.job_title,
      startsAt: i.starts_at,
      endsAt: i.ends_at,
      status: i.status,
      step: i.step,
      locationOrLink: i.location_or_link,
      feedbackFiled: i.feedback_filed,
    }))
    // Upcoming soonest first; past most recent first.
    .sort((a, b) => (when === "past" ? Date.parse(b.startsAt) - Date.parse(a.startsAt) : Date.parse(a.startsAt) - Date.parse(b.startsAt)));
}

export type FeedbackEntry = {
  feedbackId: string;
  interviewId: string;
  interviewerId: string;
  interviewer: string | null;
  recommendation: Recommendation;
  rating: number | null;
  notes: string;
  submittedAt: string;
  mine: boolean;
};

export type FeedbackSummary = {
  interviews: Array<{
    interviewId: string;
    startsAt: string;
    status: string;
    step: string | null;
    interviewers: Array<{ userId: string; name: string | null }>;
  }>;
  feedback: FeedbackEntry[];
  /** True when the caller is an interviewer here and has not filed yet: others' feedback may be held back until they do. */
  yoursOutstanding: boolean;
};

type InterviewRow = {
  id: string; application_id: string; starts_at: string; ends_at: string; status: string; step: string | null;
  interviewer_actor_ids: string[];
};
const INTERVIEW_COLUMNS = "id, application_id, starts_at, ends_at, status, step, interviewer_actor_ids";

export async function getFeedback(
  db: Db,
  ctx: ClientToolCtx,
  input: { interviewId?: string; applicationId?: string },
): Promise<FeedbackSummary> {
  if (!input.interviewId === !input.applicationId) {
    throw new ClientToolError("invalid", "Pass either interview_id or application_id.");
  }
  let q = db.from("interviews").select(INTERVIEW_COLUMNS).order("starts_at");
  q = input.interviewId ? q.eq("id", input.interviewId) : q.eq("application_id", input.applicationId!);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  const interviews = (rows ?? []) as InterviewRow[];
  if (!interviews.length) {
    throw new ClientToolError("not_found", "No interviews there that you can see. list_my_interviews and get_candidate have the ids.");
  }

  const { data: filed, error: feedbackError } = await db
    .from("interview_feedback")
    .select("id, interview_id, interviewer_actor_id, recommendation, rating, notes, submitted_at")
    .in("interview_id", interviews.map((i) => i.id))
    .order("submitted_at");
  if (feedbackError) throw new Error(feedbackError.message);

  const people = [...new Set([...interviews.flatMap((i) => i.interviewer_actor_ids), ...(filed ?? []).map((f) => f.interviewer_actor_id)])];
  const names = new Map<string, string | null>();
  if (people.length) {
    const { data: members, error: membersError } = await db.from("org_members").select("id, display_name").in("id", people);
    if (membersError) throw new Error(membersError.message);
    for (const m of members ?? []) if (m.id) names.set(m.id, m.display_name);
  }

  const feedback = (filed ?? []).map((f) => ({
    feedbackId: f.id,
    interviewId: f.interview_id,
    interviewerId: f.interviewer_actor_id,
    interviewer: names.get(f.interviewer_actor_id) ?? null,
    recommendation: f.recommendation as Recommendation,
    rating: f.rating,
    notes: f.notes,
    submittedAt: f.submitted_at,
    mine: f.interviewer_actor_id === ctx.actorId,
  }));
  const minePending = interviews.some((i) =>
    i.interviewer_actor_ids.includes(ctx.actorId) && i.status !== "cancelled"
    && !feedback.some((f) => f.mine && f.interviewId === i.id));

  return {
    interviews: interviews.map((i) => ({
      interviewId: i.id,
      startsAt: i.starts_at,
      status: i.status,
      step: i.step,
      // Interviewers no longer at the company drop out, as everywhere else.
      interviewers: i.interviewer_actor_ids.filter((id) => names.has(id)).map((id) => ({ userId: id, name: names.get(id) ?? null })),
    })),
    feedback,
    yoursOutstanding: minePending,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function scheduleInterview(
  db: Db,
  ctx: ClientToolCtx,
  input: {
    applicationId: string;
    startsAt: string;
    endsAt: string;
    interviewerIds: string[];
    locationOrLink?: string | null;
    step?: string | null;
  },
): Promise<{ interviewId: string }> {
  const startsAt = instant(input.startsAt, "starts_at");
  const endsAt = instant(input.endsAt, "ends_at");
  span(startsAt, endsAt);
  const location = input.locationOrLink?.trim() || null;
  if (location && location.length > LOCATION_MAX) throw new ClientToolError("invalid", `A location or link is at most ${LOCATION_MAX} characters.`);
  const step = input.step?.trim() || null;
  if (step && step.length > STEP_MAX) throw new ClientToolError("invalid", `A step name is at most ${STEP_MAX} characters.`);

  const { data: app, error } = await db.from("applications").select("id, role_id").eq("id", input.applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!app) throw new ClientToolError("not_found", "No application with that id that you can see. get_pipeline and get_candidate list them.");
  if (!(await can(db, app.role_id, "can_schedule"))) {
    throw new ClientToolError("forbidden", "You can see that candidate but not schedule interviews on this job.");
  }
  const ids = await interviewers(db, input.interviewerIds);

  return withAudit(db, ctx, { action: "interview.schedule", entity: "interview" }, async () => {
    const interviewId = globalThis.crypto.randomUUID();
    const row = {
      id: interviewId, application_id: app.id, starts_at: startsAt, ends_at: endsAt,
      interviewer_actor_ids: ids, location_or_link: location, step,
    };
    const { error: insertError } = await db.from("interviews").insert(row);
    if (insertError) throw new Error(insertError.message);
    return { result: { interviewId }, entityId: interviewId, after: row, changed: true };
  });
}

export async function updateInterview(
  db: Db,
  ctx: ClientToolCtx,
  input: {
    interviewId: string;
    startsAt?: string;
    endsAt?: string;
    interviewerIds?: string[];
    locationOrLink?: string | null;
    status?: InterviewStatus;
  },
): Promise<{ outcome: "updated" | "unchanged"; changed: string[] }> {
  if (input.status !== undefined && !INTERVIEW_STATUSES.includes(input.status)) {
    throw new ClientToolError("invalid", `An interview's status is one of ${INTERVIEW_STATUSES.join(", ")}.`);
  }
  const { data, error } = await db
    .from("interviews").select(`${INTERVIEW_COLUMNS}, location_or_link`).eq("id", input.interviewId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ClientToolError("not_found", "No interview with that id that you can see.");
  const current = data as InterviewRow & { location_or_link: string | null };

  const { data: roleId, error: roleError } = await db.rpc("application_role", { p_application: current.application_id });
  if (roleError) throw new Error(roleError.message);
  if (!roleId || !(await can(db, roleId as string, "can_schedule"))) {
    throw new ClientToolError("forbidden", "You can see that interview but not change it. Ask whoever schedules for this job.");
  }

  const next: Record<string, unknown> = {};
  const startsAt = input.startsAt !== undefined ? instant(input.startsAt, "starts_at") : current.starts_at;
  const endsAt = input.endsAt !== undefined ? instant(input.endsAt, "ends_at") : current.ends_at;
  if (input.startsAt !== undefined || input.endsAt !== undefined) span(startsAt, endsAt);
  if (Date.parse(startsAt) !== Date.parse(current.starts_at)) next.starts_at = startsAt;
  if (Date.parse(endsAt) !== Date.parse(current.ends_at)) next.ends_at = endsAt;
  if (input.interviewerIds !== undefined) {
    const ids = await interviewers(db, input.interviewerIds);
    const same = ids.length === current.interviewer_actor_ids.length && ids.every((id) => current.interviewer_actor_ids.includes(id));
    if (!same) next.interviewer_actor_ids = ids;
  }
  if (input.locationOrLink !== undefined) {
    const location = input.locationOrLink?.trim() || null;
    if (location && location.length > LOCATION_MAX) throw new ClientToolError("invalid", `A location or link is at most ${LOCATION_MAX} characters.`);
    if (location !== current.location_or_link) next.location_or_link = location;
  }
  if (input.status !== undefined && input.status !== current.status) next.status = input.status;

  const changed = Object.keys(next);
  if (!changed.length) return { outcome: "unchanged", changed: [] };
  const before = Object.fromEntries(changed.map((k) => [k, (current as Record<string, unknown>)[k]]));
  return withAudit(db, ctx, { action: "interview.update", entity: "interview" }, async () => {
    const { data: updated, error: updateError } = await db
      .from("interviews").update({ ...next, updated_at: new Date().toISOString() }).eq("id", current.id).select("id");
    if (updateError) throw new Error(updateError.message);
    const ok = !!updated?.length;
    return {
      result: ok ? { outcome: "updated" as const, changed } : { outcome: "unchanged" as const, changed: [] },
      entityId: current.id,
      before,
      after: next,
      changed: ok,
    };
  });
}

export async function submitFeedback(
  db: Db,
  ctx: ClientToolCtx,
  input: { interviewId: string; recommendation: Recommendation; rating?: number | null; notes: string },
  now: Date = new Date(),
): Promise<{ feedbackId: string; replaced: boolean }> {
  if (!RECOMMENDATIONS.includes(input.recommendation)) {
    throw new ClientToolError("invalid", `A recommendation is one of ${RECOMMENDATIONS.join(", ")}.`);
  }
  if (input.rating != null && (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 4)) {
    throw new ClientToolError("invalid", "A rating is a whole number from 1 to 4.");
  }
  const notes = input.notes.trim();
  if (!notes) throw new ClientToolError("invalid", "Feedback needs notes.");
  if (notes.length > FEEDBACK_MAX) throw new ClientToolError("invalid", `Feedback notes are at most ${FEEDBACK_MAX} characters.`);

  const { data, error } = await db
    .from("interviews").select(INTERVIEW_COLUMNS).eq("id", input.interviewId).maybeSingle();
  if (error) throw new Error(error.message);
  const interview = data as InterviewRow | null;
  if (!interview || !interview.interviewer_actor_ids.includes(ctx.actorId)) {
    throw new ClientToolError("forbidden", "You were not an interviewer on that interview, so you cannot file feedback on it. list_my_interviews has yours.");
  }
  if (interview.status === "cancelled") throw new ClientToolError("invalid", "That interview was cancelled. Nothing was saved.");
  if (Date.parse(interview.starts_at) > now.getTime()) throw new ClientToolError("invalid", "That interview has not happened yet. Nothing was saved.");

  const { data: existing, error: existingError } = await db
    .from("interview_feedback").select("id, recommendation, rating")
    .eq("interview_id", interview.id).eq("interviewer_actor_id", ctx.actorId).maybeSingle();
  if (existingError) throw new Error(existingError.message);

  return withAudit(db, ctx, { action: "feedback.submit", entity: "interview_feedback" }, async () => {
    const { data: saved, error: saveError } = await db
      .from("interview_feedback")
      .upsert(
        {
          interview_id: interview.id, interviewer_actor_id: ctx.actorId, recommendation: input.recommendation,
          rating: input.rating ?? null, notes, updated_at: now.toISOString(),
        },
        { onConflict: "interview_id,interviewer_actor_id" },
      )
      .select("id")
      .single();
    if (saveError) throw new Error(saveError.message);
    return {
      result: { feedbackId: saved.id, replaced: !!existing },
      entityId: saved.id,
      // The notes stay out of the audit row: admins read audit_log, and feedback is the interviewer's.
      before: existing ? { recommendation: existing.recommendation, rating: existing.rating } : null,
      after: { interview_id: interview.id, recommendation: input.recommendation, rating: input.rating ?? null },
      changed: true,
    };
  });
}
