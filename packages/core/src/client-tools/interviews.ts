import { connector } from "@tacit/core";
import type { Db } from "@tacit/db";

import { withAudit } from "./audit.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { STEP_NAME_MAX, planStep, stepsOf } from "./plans.js";
import {
  accessToken, availability, busyIn, checkInterviewers as interviewers, checkTimezone, connectHint, instant,
  interviewerDetails, notSetUp, unknownText, type Availability, type ClientCalendar, type Person, type UnknownReason,
} from "./calendar.js";
import { draftEmail, type ClientMailer, type DraftEmailResult } from "./email.js";

/**
 * Interviews and interview feedback for the client connector. Same rules as
 * the rest of client-tools: the member's own client, and the policies decide
 * (20261013120000): an interview is written by whoever may schedule on its
 * job, feedback only by its own interviewer, and another interviewer's
 * feedback is read per the org's feedback_visibility. A step is checked
 * against the job's interview plan when it has one (plans.ts). A feedback's
 * scorecard ratings (20261015140000) follow it: written by its interviewer
 * against the job's attributes, read whenever the feedback is.
 *
 * Scheduling books on the member's own Google Calendar when they have
 * connected it (calendar.ts): the event goes on the booker's calendar under an
 * id derived from the interview's, with the interviewers invited by Google
 * and a Meet link unless a place is given; a move, a change of interviewers
 * or a cancellation follows to the event, with the grant of whoever holds
 * it. The candidate is never on the event: what they are told is a DRAFT
 * email (email.ts) the member reads and sends.
 *
 * Feedback is private to the company's hiring team: nothing here sends it
 * anywhere, and its notes and the ratings' notes are kept out of the audit row.
 */

export const RECOMMENDATIONS = ["strong_yes", "yes", "no", "strong_no"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];
export const INTERVIEW_STATUSES = ["scheduled", "done", "cancelled"] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

const FEEDBACK_MAX = 10_000;
const RATING_NOTE_MAX = 500;
const RATINGS_MAX = 25;
const LOCATION_MAX = 500;
const MAX_LENGTH_MS = 8 * 60 * 60 * 1000;

function span(startsAt: string, endsAt: string) {
  if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new ClientToolError("invalid", "An interview must end after it starts.");
  if (Date.parse(endsAt) - Date.parse(startsAt) > MAX_LENGTH_MS) throw new ClientToolError("invalid", "An interview is at most 8 hours long.");
}

async function can(db: Db, roleId: string, perm: "can_schedule"): Promise<boolean> {
  const { data, error } = await db.rpc("can_on_role", { p_role: roleId, perm });
  if (error) throw new Error(error.message);
  return data === true;
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

export type FeedbackRating = {
  attributeId: string;
  /** Null when the caller cannot see the job the attribute is on. */
  attribute: string | null;
  rating: number;
  note: string | null;
};

export type FeedbackEntry = {
  feedbackId: string;
  interviewId: string;
  interviewerId: string;
  interviewer: string | null;
  recommendation: Recommendation;
  rating: number | null;
  notes: string;
  /** Per scorecard attribute, in the scorecard's order. */
  ratings: FeedbackRating[];
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

  const ratings = await feedbackRatings(db, (filed ?? []).map((f) => f.id));
  const feedback = (filed ?? []).map((f) => ({
    feedbackId: f.id,
    interviewId: f.interview_id,
    interviewerId: f.interviewer_actor_id,
    interviewer: names.get(f.interviewer_actor_id) ?? null,
    recommendation: f.recommendation as Recommendation,
    rating: f.rating,
    notes: f.notes,
    ratings: ratings.get(f.id) ?? [],
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

/** Each feedback's ratings with their attribute's name, in the scorecard's order. Read under the caller's own policies. */
async function feedbackRatings(db: Db, feedbackIds: string[]): Promise<Map<string, FeedbackRating[]>> {
  const out = new Map<string, FeedbackRating[]>();
  if (!feedbackIds.length) return out;
  const { data: rows, error } = await db
    .from("interview_feedback_ratings").select("feedback_id, attribute_id, rating, note").in("feedback_id", feedbackIds);
  if (error) throw new Error(error.message);
  if (!rows?.length) return out;
  const { data: attrs, error: attrError } = await db
    .from("scorecard_attributes").select("id, name, position").in("id", [...new Set(rows.map((r) => r.attribute_id))]);
  if (attrError) throw new Error(attrError.message);
  const byId = new Map((attrs ?? []).map((a) => [a.id, a]));
  const order = (id: string) => byId.get(id)?.position ?? Number.MAX_SAFE_INTEGER;
  for (const r of [...rows].sort((a, b) => order(a.attribute_id) - order(b.attribute_id))) {
    const list = out.get(r.feedback_id) ?? [];
    list.push({ attributeId: r.attribute_id, attribute: byId.get(r.attribute_id)?.name ?? null, rating: r.rating, note: r.note });
    out.set(r.feedback_id, list);
  }
  return out;
}

export type RatingInput = { attributeId: string; rating: number; note?: string | null };

/** Checked ratings, before any read: whole 1-4, each attribute once, short notes. */
function checkRatings(ratings: RatingInput[]): Array<{ attributeId: string; rating: number; note: string | null }> {
  if (ratings.length > RATINGS_MAX) throw new ClientToolError("invalid", `At most ${RATINGS_MAX} ratings.`);
  const seen = new Set<string>();
  return ratings.map((r) => {
    if (seen.has(r.attributeId)) throw new ClientToolError("invalid", "Each scorecard attribute is rated once.");
    seen.add(r.attributeId);
    if (!Number.isInteger(r.rating) || r.rating < 1 || r.rating > 4) {
      throw new ClientToolError("invalid", "A scorecard rating is a whole number from 1 to 4.");
    }
    const note = r.note?.trim() || null;
    if (note && note.length > RATING_NOTE_MAX) throw new ClientToolError("invalid", `A rating's note is at most ${RATING_NOTE_MAX} characters.`);
    return { attributeId: r.attributeId, rating: r.rating, note };
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** What scheduling needs beyond the member's client. Absent = Tacit's record only, as before calendars. */
export type SchedulingDeps = {
  calendar?: ClientCalendar | null;
  /** For the draft to the candidate (email.ts). Absent or null = no draft. */
  mailer?: ClientMailer | null;
  now?: () => Date;
};

export type InterviewConflicts = {
  /** Interviewers with something else on their calendar then. */
  busy: Person[];
  /** Interviewers whose calendar could not be read, and why. */
  unknown: Array<Person & { reason: UnknownReason }>;
};

export type CalendarOutcome =
  | { status: "invited"; eventLink: string | null; meetLink: string | null; invited: Person[]; notInvited: Person[] }
  /** Recorded in Tacit only. */
  | { status: "not_sent"; reason: "not_connected" | "not_set_up" | "not_asked" | "in_the_past"; connectUrl: string | null };

export type ScheduleResult =
  | {
      outcome: "scheduled";
      interviewId: string;
      calendar: CalendarOutcome;
      conflicts: InterviewConflicts;
      candidateDraft: DraftEmailResult | null;
      noDraftBecause: string | null;
    }
  /** Someone is busy and the caller did not say to book anyway. Nothing was written. */
  | { outcome: "conflicts"; interviewId: null; startsAt: string; endsAt: string; conflicts: InterviewConflicts };

const firstNames = (people: Person[]) => people.map((p) => p.name).join(", ");

function conflictsOf(avail: Availability | null, busyIds: string[], people: Array<{ id: string; name: string }>): InterviewConflicts {
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? "(no name)";
  return {
    busy: busyIds.map((id) => ({ userId: id, name: name(id) })),
    unknown: avail ? [...avail.unknown].map(([id, reason]) => ({ userId: id, name: name(id), reason })) : [],
  };
}

const googleRefusal = (err: unknown, what: string): ClientToolError => {
  if (!(err instanceof connector.CalendarError)) throw err;
  console.error(`[client-tools interviews] Google refused: ${what}`, err);
  return new ClientToolError(
    "forbidden",
    err.status === 401 || err.status === 403
      ? `Google Calendar refused: the connection does not allow calendar changes. Connect the calendar again. ${what}`
      : `Google Calendar refused the change. ${what} Try again.`,
  );
};

/** The draft to the candidate. Best effort: the interview stands if it cannot be written. */
async function draftToCandidate(
  db: Db,
  ctx: ClientToolCtx,
  mailer: ClientMailer | null | undefined,
  input: { candidateId: string; applicationId: string; subject: string; body: string },
): Promise<{ candidateDraft: DraftEmailResult | null; noDraftBecause: string | null }> {
  if (mailer === undefined) return { candidateDraft: null, noDraftBecause: "Candidate email is not set up here." };
  try {
    return { candidateDraft: await draftEmail(db, ctx, mailer, input), noDraftBecause: null };
  } catch (err) {
    if (!(err instanceof ClientToolError)) throw err;
    return { candidateDraft: null, noDraftBecause: err.message };
  }
}

type AppDetail = { personId: string; candidateName: string | null; jobTitle: string };

async function applicationDetail(db: Db, applicationId: string): Promise<AppDetail> {
  const { data, error } = await db
    .from("applications").select("person_id, people(display_name), roles(title)").eq("id", applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  const app = data as unknown as { person_id: string; people: { display_name: string | null } | null; roles: { title: string } | null } | null;
  if (!app) throw new ClientToolError("not_found", "No application with that id that you can see.");
  return { personId: app.person_id, candidateName: app.people?.display_name ?? null, jobTitle: app.roles?.title ?? "the job" };
}

/** Who gets Google's invite: the interviewers other than whoever holds the event, at their calendar's address. */
function inviteesOf(
  people: Array<{ id: string; name: string; email: string | null }>,
  avail: Pick<Availability, "connections">,
  holder: string,
): { emails: string[]; invited: Person[]; notInvited: Person[] } {
  const emails: string[] = [];
  const invited: Person[] = [];
  const notInvited: Person[] = [];
  for (const p of people) {
    if (p.id === holder) continue;
    const address = avail.connections.get(p.id)?.accountEmail ?? p.email?.toLowerCase() ?? null;
    if (address && connector.isPlainEmail(address)) {
      emails.push(address);
      invited.push({ userId: p.id, name: p.name });
    } else {
      notInvited.push({ userId: p.id, name: p.name });
    }
  }
  return { emails: [...new Set(emails)], invited, notInvited };
}

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
    /** Default: invite when the caller's calendar is connected. True = refuse unless it is; false = Tacit only. */
    sendInvites?: boolean;
    bookDespiteConflicts?: boolean;
    /** What the event is anchored in and the candidate's draft is written in. */
    timezone?: string;
    /** Default true when candidate email is set up. */
    draftCandidateEmail?: boolean;
  },
  deps: SchedulingDeps = {},
): Promise<ScheduleResult> {
  const startsAt = instant(input.startsAt, "starts_at");
  const endsAt = instant(input.endsAt, "ends_at");
  span(startsAt, endsAt);
  const location = input.locationOrLink?.trim() || null;
  if (location && location.length > LOCATION_MAX) throw new ClientToolError("invalid", `A location or link is at most ${LOCATION_MAX} characters.`);
  let step = input.step?.trim() || null;
  if (step && step.length > STEP_NAME_MAX) throw new ClientToolError("invalid", `A step name is at most ${STEP_NAME_MAX} characters.`);
  const tz = checkTimezone(input.timezone);
  const calendar = deps.calendar ?? null;
  if (input.sendInvites === true && !calendar) throw notSetUp("Nothing was scheduled; pass send_invites: false to record it in Tacit only.");
  // An interview that already happened is recorded (for its feedback), never invited to or announced.
  const past = Date.parse(startsAt) <= (deps.now ?? (() => new Date()))().getTime();
  if (past && input.sendInvites === true) {
    throw new ClientToolError("invalid", "That start time is in the past, so there is nobody to invite. Nothing was scheduled; leave send_invites out to record it.");
  }

  const { data: app, error } = await db.from("applications").select("id, role_id").eq("id", input.applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!app) throw new ClientToolError("not_found", "No application with that id that you can see. get_pipeline and get_candidate list them.");
  if (!(await can(db, app.role_id, "can_schedule"))) {
    throw new ClientToolError("forbidden", "You can see that candidate but not schedule interviews on this job.");
  }
  if (step) {
    // A job with an interview plan takes only its steps, spelled as the plan spells them.
    const { data: job, error: jobError } = await db.from("roles").select("interview_steps").eq("id", app.role_id).maybeSingle();
    if (jobError) throw new Error(jobError.message);
    step = planStep(stepsOf(job?.interview_steps), step);
  }
  const ids = await interviewers(db, input.interviewerIds);

  // The calendar side, decided before anything is written.
  let invite: { token: string; avail: Availability; people: Array<{ id: string; name: string; email: string | null }>; detail: AppDetail } | null = null;
  let notSent: CalendarOutcome = {
    status: "not_sent", reason: input.sendInvites === false ? "not_asked" : past ? "in_the_past" : "not_set_up", connectUrl: calendar?.connectUrl ?? null,
  };
  let conflicts: InterviewConflicts = { busy: [], unknown: [] };
  if (calendar && input.sendInvites !== false && !past) {
    const people = await interviewerDetails(db, ids);
    const avail = await availability(calendar, ctx, people, { startIso: startsAt, endIso: endsAt });
    if (avail.callerExpired) {
      throw new ClientToolError("forbidden", `Your Google connection has expired. ${connectHint(calendar)} Nothing was scheduled; or pass send_invites: false to record it without invites.`);
    }
    if (!avail.callerToken) {
      if (input.sendInvites === true) {
        throw new ClientToolError("forbidden", `Your calendar is not connected. ${connectHint(calendar)} Nothing was scheduled; or pass send_invites: false to record it without invites.`);
      }
      notSent = { status: "not_sent", reason: "not_connected", connectUrl: calendar.connectUrl };
    } else {
      const busy = busyIn(avail, Date.parse(startsAt), Date.parse(endsAt));
      conflicts = conflictsOf(avail, busy, people);
      if (busy.length && !input.bookDespiteConflicts) return { outcome: "conflicts", interviewId: null, startsAt, endsAt, conflicts };
      invite = { token: avail.callerToken, avail, people, detail: await applicationDetail(db, app.id) };
    }
  }

  const scheduled = await withAudit<{ interviewId: string; calendar: CalendarOutcome }>(db, ctx, { action: "interview.schedule", entity: "interview" }, async () => {
    const interviewId = globalThis.crypto.randomUUID();
    const row = {
      id: interviewId, application_id: app.id, starts_at: startsAt, ends_at: endsAt,
      interviewer_actor_ids: ids, location_or_link: location, step,
      ...(invite ? { calendar_actor_id: ctx.actorId } : {}),
    };
    const { error: insertError } = await db.from("interviews").insert(row);
    // interviews_one_active_per_step: one scheduled interview per step of an application.
    if (insertError?.code === "23505") {
      throw new ClientToolError("invalid", `This candidate already has a scheduled "${step}" interview. Move or cancel it with update_interview.`);
    }
    if (insertError) throw new Error(insertError.message);
    if (!invite) return { result: { interviewId, calendar: notSent }, entityId: interviewId, after: row, changed: true };

    const to = inviteesOf(invite.people, invite.avail, ctx.actorId);
    let event: connector.CreatedCalendarEvent;
    try {
      event = await connector.createInterviewEvent(calendar!.google, invite.token, {
        // A uuid without its dashes is 32 characters of 0-9a-f, which Google takes as an event id.
        eventId: interviewId.replace(/-/g, ""),
        summary: `${step ?? "Interview"}: ${invite.detail.candidateName ?? "Candidate"} for ${invite.detail.jobTitle}`,
        description: "Scheduled in Tacit.",
        startIso: startsAt, endIso: endsAt, timezone: tz,
        attendeeEmails: to.emails,
        location, conferencing: !location,
      });
    } catch (err) {
      // Nothing is on a calendar (or we cannot tell): the row goes, so the step can be booked again.
      const { error: undoError } = await db.from("interviews").delete().eq("id", interviewId);
      if (undoError) console.error(`[client-tools interviews] could not remove interview ${interviewId} after a failed booking`, undoError);
      throw googleRefusal(err, "Nothing was scheduled.");
    }
    // The event exists. Nothing below may report the booking as failed.
    const links = {
      google_event_id: event.eventId, google_event_link: event.link,
      ...(location ? {} : { location_or_link: event.meetLink }),
    };
    const { error: linkError } = await db.from("interviews").update(links).eq("id", interviewId);
    if (linkError) console.error(`[client-tools interviews] booked interview ${interviewId}, but could not save its event`, linkError);
    const outcome: CalendarOutcome = {
      status: "invited", eventLink: event.link, meetLink: event.meetLink, invited: to.invited, notInvited: to.notInvited,
    };
    return { result: { interviewId, calendar: outcome }, entityId: interviewId, after: { ...row, ...links }, changed: true };
  });

  let drafted: { candidateDraft: DraftEmailResult | null; noDraftBecause: string | null } = { candidateDraft: null, noDraftBecause: null };
  if (input.draftCandidateEmail !== false && deps.mailer !== undefined && !past) {
    const detail = invite?.detail ?? (await applicationDetail(db, app.id));
    const where = scheduled.calendar.status === "invited" ? (scheduled.calendar.meetLink ?? location) : location;
    const people = invite?.people ?? (await interviewerDetails(db, ids));
    const minutes = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000);
    drafted = await draftToCandidate(db, ctx, deps.mailer, {
      candidateId: detail.personId, applicationId: app.id,
      subject: `Your ${step ?? "interview"} for {{job_title}}`,
      body:
        `Hi {{candidate_first_name}},\n\nYou are confirmed for your ${step ?? "interview"} for the {{job_title}} role.\n\n` +
        `When: ${connector.formatLocal(startsAt, tz)} (${minutes} minutes)\n` +
        (where ? `Where: ${where}\n` : "") +
        `With: ${firstNames(people.map((p) => ({ userId: p.id, name: p.name })))}\n` +
        `\nIf that time no longer works, reply and we will find another.\n\n{{sender_name}}`,
    });
  }
  return { outcome: "scheduled", interviewId: scheduled.interviewId, calendar: scheduled.calendar, conflicts, ...drafted };
}

export type UpdateInterviewResult =
  | {
      outcome: "updated" | "unchanged";
      changed: string[];
      /** What happened to the calendar event: none when there is none or it did not need to change. */
      calendar: "moved" | "updated" | "cancelled" | "already_gone" | "left_alone" | "none";
      conflicts: InterviewConflicts;
      candidateDraft: DraftEmailResult | null;
      noDraftBecause: string | null;
    }
  | { outcome: "conflicts"; changed: string[]; startsAt: string; endsAt: string; conflicts: InterviewConflicts };

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
    bookDespiteConflicts?: boolean;
    /** False = Tacit's record only; the calendar event stays as it is. */
    updateCalendar?: boolean;
    timezone?: string;
    /** Default true when candidate email is set up: a move or a cancellation drafts a note to the candidate. */
    draftCandidateEmail?: boolean;
  },
  deps: SchedulingDeps = {},
): Promise<UpdateInterviewResult> {
  if (input.status !== undefined && !INTERVIEW_STATUSES.includes(input.status)) {
    throw new ClientToolError("invalid", `An interview's status is one of ${INTERVIEW_STATUSES.join(", ")}.`);
  }
  const tz = checkTimezone(input.timezone);
  const { data, error } = await db
    .from("interviews")
    .select(`${INTERVIEW_COLUMNS}, location_or_link, google_event_id, calendar_actor_id`)
    .eq("id", input.interviewId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ClientToolError("not_found", "No interview with that id that you can see.");
  const current = data as InterviewRow & { location_or_link: string | null; google_event_id: string | null; calendar_actor_id: string | null };

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
  let ids = current.interviewer_actor_ids;
  if (input.interviewerIds !== undefined) {
    ids = await interviewers(db, input.interviewerIds);
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
  const none = { conflicts: { busy: [], unknown: [] }, candidateDraft: null, noDraftBecause: null };
  if (!changed.length) return { outcome: "unchanged", changed: [], calendar: "none", ...none };
  const moved = "starts_at" in next || "ends_at" in next;
  const cancelling = next.status === "cancelled";
  const reinvite = "interviewer_actor_ids" in next;

  // The calendar side, decided before anything is written: the event is moved
  // or cancelled with the grant of whoever holds it.
  const eventId = current.google_event_id;
  const touchesEvent = !!eventId && current.status === "scheduled" && (cancelling || (next.status === undefined && (moved || reinvite)));
  let google: { token: string; holder: string; people: Array<{ id: string; name: string; email: string | null }>; avail: Pick<Availability, "connections"> } | null = null;
  let conflicts: InterviewConflicts = { busy: [], unknown: [] };
  if (touchesEvent && input.updateCalendar !== false) {
    const calendar = deps.calendar ?? null;
    if (!calendar) throw notSetUp("Nothing was changed; pass update_calendar: false to change Tacit's record only.");
    const holder = current.calendar_actor_id ?? ctx.actorId;
    const people = await interviewerDetails(db, [...new Set([holder, ...ids])]);
    const interviewing = people.filter((p) => ids.includes(p.id));
    if (moved && !cancelling) {
      const now = (deps.now ?? (() => new Date()))();
      if (Date.parse(startsAt) <= now.getTime()) throw new ClientToolError("invalid", "That time is in the past. Nothing was changed.");
      const avail = await availability(calendar, ctx, interviewing, { startIso: startsAt, endIso: endsAt }, holder);
      // The interview's own event shows its interviewers busy at the old time: that is not a clash.
      const own = { start: Date.parse(current.starts_at), end: Date.parse(current.ends_at) };
      for (const c of avail.checked.values()) c.busy = c.busy.filter((b) => !(b.start === own.start && b.end === own.end));
      const busy = busyIn(avail, Date.parse(startsAt), Date.parse(endsAt));
      conflicts = conflictsOf(avail, busy, people);
      if (busy.length && !input.bookDespiteConflicts) return { outcome: "conflicts", changed, startsAt, endsAt, conflicts };
      if (avail.callerToken) google = { token: avail.callerToken, holder, people: interviewing, avail };
    } else {
      const connections = await calendar.connections(ctx.orgId, [...new Set([holder, ...ids])]);
      const conn = connections.get(holder);
      const token = conn ? await accessToken(calendar, conn) : null;
      if (token) google = { token, holder, people: interviewing, avail: { connections } };
    }
    if (!google) {
      const name = people.find((p) => p.id === holder)?.name ?? "the member who booked it";
      throw new ClientToolError(
        "forbidden",
        holder === ctx.actorId
          ? `This interview's event is on your calendar, which is not connected now. ${connectHint(calendar)} Nothing was changed; or pass update_calendar: false to change Tacit's record only.`
          : `This interview's event is on ${name}'s calendar, which is not connected now. They can connect it again, or pass update_calendar: false to change Tacit's record only (the event then stays as it is). Nothing was changed.`,
      );
    }
  }

  const before = Object.fromEntries(changed.map((k) => [k, (current as Record<string, unknown>)[k]]));
  const done = await withAudit(db, ctx, { action: "interview.update", entity: "interview" }, async () => {
    const { data: updated, error: updateError } = await db
      .from("interviews").update({ ...next, updated_at: new Date().toISOString() })
      .eq("id", current.id).eq("status", current.status).select("id");
    if (updateError) throw new Error(updateError.message);
    const ok = !!updated?.length;
    let cal: Extract<UpdateInterviewResult, { outcome: "updated" | "unchanged" }>["calendar"] = eventId && touchesEvent ? "left_alone" : "none";
    if (ok && google && eventId) {
      try {
        if (cancelling) {
          cal = (await connector.cancelInterviewEvent(deps.calendar!.google, google.token, eventId)) === "gone" ? "already_gone" : "cancelled";
        } else {
          if (moved) await connector.moveInterviewEvent(deps.calendar!.google, google.token, eventId, { startIso: startsAt, endIso: endsAt, timezone: tz });
          if (reinvite) {
            await connector.setInterviewEventAttendees(deps.calendar!.google, google.token, eventId, inviteesOf(google.people, google.avail, google.holder).emails);
          }
          cal = moved ? "moved" : "updated";
        }
      } catch (err) {
        // The calendar did not follow: put the row back, so Tacit and the calendar agree.
        const { error: undoError } = await db.from("interviews").update({ ...before, updated_at: new Date().toISOString() }).eq("id", current.id);
        if (undoError) console.error(`[client-tools interviews] could not put interview ${current.id} back after a failed calendar change`, undoError);
        throw googleRefusal(err, "Nothing was changed.");
      }
    }
    return {
      result: { outcome: ok ? ("updated" as const) : ("unchanged" as const), changed: ok ? changed : [], calendar: cal },
      entityId: current.id,
      before,
      after: next,
      changed: ok,
    };
  });

  let drafted: { candidateDraft: DraftEmailResult | null; noDraftBecause: string | null } = { candidateDraft: null, noDraftBecause: null };
  // Only about an interview still ahead: moved to the future, or cancelled before it happened.
  const ahead = Date.parse(cancelling ? current.starts_at : startsAt) > (deps.now ?? (() => new Date()))().getTime();
  if (done.outcome === "updated" && (moved || cancelling) && ahead && input.draftCandidateEmail !== false && deps.mailer !== undefined) {
    const detail = await applicationDetail(db, current.application_id);
    const what = current.step ?? "interview";
    drafted = await draftToCandidate(db, ctx, deps.mailer, cancelling
      ? {
          candidateId: detail.personId, applicationId: current.application_id,
          subject: `Your ${what} for {{job_title}} is cancelled`,
          body:
            `Hi {{candidate_first_name}},\n\nWe have had to cancel your ${what} for the {{job_title}} role, ` +
            `planned for ${connector.formatLocal(current.starts_at, tz)}.\n\nWe will be in touch about what comes next.\n\n{{sender_name}}`,
        }
      : {
          candidateId: detail.personId, applicationId: current.application_id,
          subject: `New time for your ${what} for {{job_title}}`,
          body:
            `Hi {{candidate_first_name}},\n\nWe have had to move your ${what} for the {{job_title}} role.\n\n` +
            `New time: ${connector.formatLocal(startsAt, tz)}\nWas: ${connector.formatLocal(current.starts_at, tz)}\n` +
            ((next.location_or_link ?? current.location_or_link) ? `Where: ${String(next.location_or_link ?? current.location_or_link)}\n` : "") +
            `\nIf the new time does not work, reply and we will find another.\n\n{{sender_name}}`,
        });
  }
  return { ...done, conflicts, ...drafted };
}

export async function submitFeedback(
  db: Db,
  ctx: ClientToolCtx,
  input: { interviewId: string; recommendation: Recommendation; rating?: number | null; notes: string; ratings?: RatingInput[] },
  now: Date = new Date(),
): Promise<{ feedbackId: string; replaced: boolean; ratings: number }> {
  if (!RECOMMENDATIONS.includes(input.recommendation)) {
    throw new ClientToolError("invalid", `A recommendation is one of ${RECOMMENDATIONS.join(", ")}.`);
  }
  if (input.rating != null && (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 4)) {
    throw new ClientToolError("invalid", "A rating is a whole number from 1 to 4.");
  }
  const notes = input.notes.trim();
  if (!notes) throw new ClientToolError("invalid", "Feedback needs notes.");
  if (notes.length > FEEDBACK_MAX) throw new ClientToolError("invalid", `Feedback notes are at most ${FEEDBACK_MAX} characters.`);
  const ratings = checkRatings(input.ratings ?? []);

  const { data, error } = await db
    .from("interviews").select(INTERVIEW_COLUMNS).eq("id", input.interviewId).maybeSingle();
  if (error) throw new Error(error.message);
  const interview = data as InterviewRow | null;
  if (!interview || !interview.interviewer_actor_ids.includes(ctx.actorId)) {
    throw new ClientToolError("forbidden", "You were not an interviewer on that interview, so you cannot file feedback on it. list_my_interviews has yours.");
  }
  if (interview.status === "cancelled") throw new ClientToolError("invalid", "That interview was cancelled. Nothing was saved.");
  if (Date.parse(interview.starts_at) > now.getTime()) throw new ClientToolError("invalid", "That interview has not happened yet. Nothing was saved.");
  if (ratings.length) await checkScorecard(db, interview.application_id, ratings.map((r) => r.attributeId));

  const { data: existing, error: existingError } = await db
    .from("interview_feedback").select("id, recommendation, rating")
    .eq("interview_id", interview.id).eq("interviewer_actor_id", ctx.actorId).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  let previous: Array<{ attribute_id: string; rating: number }> = [];
  if (existing) {
    const { data, error: previousError } = await db
      .from("interview_feedback_ratings").select("attribute_id, rating").eq("feedback_id", existing.id);
    if (previousError) throw new Error(previousError.message);
    previous = data ?? [];
  }

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
    // Filing again replaces the ratings too: the old ones go, the new ones (if any) take their place.
    if (existing) {
      const { error: clearError } = await db.from("interview_feedback_ratings").delete().eq("feedback_id", saved.id);
      if (clearError) throw new Error(clearError.message);
    }
    if (ratings.length) {
      // Not read back: each id is made here.
      const { error: ratingsError } = await db.from("interview_feedback_ratings").insert(
        ratings.map((r) => ({
          id: globalThis.crypto.randomUUID(), feedback_id: saved.id, attribute_id: r.attributeId, rating: r.rating, note: r.note,
        })),
      );
      // A plain error even for the trigger's 22023 (an attribute archived since the check above): the
      // feedback row has already changed, so the claim must stay open rather than be given back.
      if (ratingsError) throw new Error(ratingsError.message);
    }
    const scored = (rows: Array<{ attribute_id: string; rating: number }>) => rows.map((r) => ({ attribute_id: r.attribute_id, rating: r.rating }));
    return {
      result: { feedbackId: saved.id, replaced: !!existing, ratings: ratings.length },
      entityId: saved.id,
      // The notes, the feedback's and the ratings', stay out of the audit row: admins read audit_log, and feedback is the interviewer's.
      before: existing ? { recommendation: existing.recommendation, rating: existing.rating, ratings: scored(previous) } : null,
      after: {
        interview_id: interview.id, recommendation: input.recommendation, rating: input.rating ?? null,
        ratings: scored(ratings.map((r) => ({ attribute_id: r.attributeId, rating: r.rating }))),
      },
      changed: true,
    };
  });
}

/** Every rated attribute is live on the interview's job, said before anything is written; the database checks it again. */
async function checkScorecard(db: Db, applicationId: string, attributeIds: string[]): Promise<void> {
  // An interviewer cannot read the application; application_role answers the job inside their org.
  const { data: roleId, error } = await db.rpc("application_role", { p_application: applicationId });
  if (error) throw new Error(error.message);
  const missing = new ClientToolError(
    "not_found", "Every rating must be for an attribute on this job's scorecard. get_scorecard lists them. Nothing was saved.",
  );
  if (!roleId) throw missing;
  const { data, error: attrError } = await db
    .from("scorecard_attributes").select("id, name, archived_at").eq("role_id", roleId as string).in("id", attributeIds);
  if (attrError) throw new Error(attrError.message);
  const found = new Map((data ?? []).map((a) => [a.id, a]));
  if (attributeIds.some((id) => !found.has(id))) throw missing;
  const archived = (data ?? []).find((a) => a.archived_at);
  if (archived) {
    throw new ClientToolError("invalid", `"${archived.name}" was taken off this job's scorecard. Rate its current attributes. Nothing was saved.`);
  }
}
