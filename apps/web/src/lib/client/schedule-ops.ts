import type { Db } from "@tacit/db";
import { ACTIVE_STAGES } from "@tacit/core";
import { clientTools } from "@tacit-ats/core";
import { COULD_NOT_FINISH, type ScheduleAnswer, type ScheduleRequest } from "./schedule-requests";

// The Calendar's writes and Find a time: core's audited clientTools on the
// member's OWN client, so the policies decide each one, with source
// `dashboard`. `calendar` is what the caller was given to reach members'
// grants: this file never names a client, and never decides whose grant is
// read; core asks only for the caller, the interviewers the member's token has
// already named, or the holder of an interview it has read and may change.
//
// An unconfirmed book, move or cancel is core's dry run, the real decisions up
// to the first write. A confirmed one is the same call, so what the dialog
// showed is what runs, and a clash that turned up since comes back as
// `conflicts` with nothing written.
//
// No candidate email is drafted here: core's draft takes a mailer, and apps/web
// has none. The candidate is on the event, so Google tells them.

export type ScheduleDeps = {
  calendar: clientTools.ClientCalendar | null;
  now?: () => Date;
};

/**
 * Whether the dialog's choice still stands: it was read when the dialog opened,
 * and a confirmed booking emails the candidate. The same rule as
 * schedule-choices.ts. One the member cannot read is core's to refuse.
 */
async function bookable(db: Db, applicationId: string): Promise<ScheduleAnswer | null> {
  const { data, error } = await db.from("applications").select("stage, merged_into_id, roles(status)").eq("id", applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (data.merged_into_id) return { ok: false, code: "stale", message: "That candidate was merged into another record. Nothing was booked." };
  if (!(ACTIVE_STAGES as readonly string[]).includes(data.stage)) return { ok: false, code: "stale", message: "That candidate is no longer in process on this job. Nothing was booked." };
  if (data.roles?.status !== "open") return { ok: false, code: "stale", message: "That job is no longer open. Nothing was booked." };
  return null;
}

/** An interview a move or a cancel can act on, or why not, read on the member's own token. */
async function changeable(db: Db, interviewId: string, now: Date, was?: string | null, movingTo?: string): Promise<ScheduleAnswer | null> {
  const { data, error } = await db.from("interviews").select("status, starts_at").eq("id", interviewId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ok: false, code: "not_found", message: "That interview is no longer there for you." };
  if (data.status === "cancelled") return { ok: false, code: "stale", message: "That interview was already cancelled." };
  if (data.status !== "scheduled") return { ok: false, code: "stale", message: "That interview has already been marked done." };
  if (Date.parse(data.starts_at) <= now.getTime()) return { ok: false, code: "stale", message: "That interview has already started, so it can no longer be moved or cancelled here." };
  // Already at the time asked for is a retry of this move, whose answer never came.
  const since = !!was && Date.parse(was) !== Date.parse(data.starts_at) && !(movingTo && Date.parse(movingTo) === Date.parse(data.starts_at));
  if (since) return { ok: false, code: "stale", message: "That interview has moved since this page was read. Nothing was changed." };
  return null;
}

function refusal(err: unknown): ScheduleAnswer {
  if (err instanceof clientTools.ClientToolError) {
    // The dialog's own id again: an earlier try went through and its answer never came.
    if (err.field === "interview_id") return { ok: true, kind: "already_booked" };
    // Core's not_found sentences are for the connector's model, and name its tools.
    if (err.code === "not_found") return { ok: false, code: "not_found", message: "That candidate or teammate is no longer there for you." };
    return { ok: false, code: err.code, message: err.message };
  }
  // What the database or Google said stays in the log, and never reaches the page.
  console.error("[client-schedule] a calendar request failed:", err instanceof Error ? err.message : err);
  return { ok: false, code: "failed", message: COULD_NOT_FINISH };
}

async function run(db: Db, ctx: clientTools.ClientToolCtx, request: ScheduleRequest, deps: ScheduleDeps, now: Date): Promise<ScheduleAnswer> {
  const scheduling = { calendar: deps.calendar, now: () => now };

  switch (request.op) {
    case "find": {
      const found = await clientTools.findInterviewTimes(db, ctx, deps.calendar, {
        interviewerIds: request.interviewerIds,
        durationMinutes: request.durationMinutes,
        windowStart: request.windowStart,
        windowEnd: request.windowEnd,
        timezone: request.timezone,
        applicationId: request.applicationId,
      }, now);
      return {
        ok: true,
        kind: "times",
        found: {
          timezone: found.timezone,
          durationMinutes: found.durationMinutes,
          slots: found.slots,
          checked: found.checked.map((p) => p.name),
          unknown: found.unknown.map((p) => ({ name: p.name, why: clientTools.unknownText(p.reason) })),
        },
      };
    }

    case "book": {
      const gone = await bookable(db, request.applicationId);
      if (gone) return gone;
      const input = {
        interviewId: request.interviewId,
        applicationId: request.applicationId,
        startsAt: request.startsAt,
        endsAt: request.endsAt,
        interviewerIds: request.interviewerIds,
        step: request.step,
        locationOrLink: request.locationOrLink,
        timezone: request.timezone,
        bookDespiteConflicts: request.bookDespiteConflicts,
        sendInvites: request.recordOnly ? false : undefined,
        draftCandidateEmail: false,
      };
      if (!request.confirmed) {
        return { ok: true, kind: "book_preview", preview: await clientTools.scheduleInterview(db, ctx, { ...input, dryRun: true }, scheduling) };
      }
      const booked = await clientTools.scheduleInterview(db, ctx, input, scheduling);
      if (booked.outcome === "conflicts") return { ok: true, kind: "conflicts", conflicts: booked.conflicts };
      return { ok: true, kind: "booked", interviewId: booked.interviewId, calendar: booked.calendar };
    }

    case "move":
    case "cancel": {
      const stopped = await changeable(db, request.interviewId, now, request.was, request.op === "move" ? request.startsAt : undefined);
      if (stopped) return stopped;
      const input = {
        interviewId: request.interviewId,
        timezone: request.timezone,
        updateCalendar: request.recordOnly ? false : undefined,
        draftCandidateEmail: false,
        ...(request.op === "move"
          ? { startsAt: request.startsAt, endsAt: request.endsAt, bookDespiteConflicts: request.bookDespiteConflicts }
          : { status: "cancelled" as const }),
      };
      if (request.op === "move" && Date.parse(request.startsAt) <= now.getTime()) {
        return { ok: false, code: "invalid", message: "That time is in the past. Nothing was changed." };
      }
      if (!request.confirmed) {
        const preview = await clientTools.updateInterview(db, ctx, { ...input, dryRun: true }, scheduling);
        return preview.outcome === "preview" ? { ok: true, kind: "change_preview", op: request.op, preview } : { ok: true, kind: "unchanged" };
      }
      const done = await clientTools.updateInterview(db, ctx, input, scheduling);
      if (done.outcome === "conflicts") return { ok: true, kind: "conflicts", conflicts: done.conflicts };
      // Nothing to do, or its status changed under the write and the conditional update touched nothing.
      if (done.outcome === "unchanged") return (await changeable(db, request.interviewId, now)) ?? { ok: true, kind: "unchanged" };
      return { ok: true, kind: "changed", op: request.op, calendar: done.calendar };
    }
  }
}

/** One request, answered: a refusal is an answer, and nothing here throws. */
export async function runScheduleRequest(db: Db, ctx: clientTools.ClientToolCtx, request: ScheduleRequest, deps: ScheduleDeps): Promise<ScheduleAnswer> {
  try {
    return await run(db, ctx, request, deps, (deps.now ?? (() => new Date()))());
  } catch (err) {
    return refusal(err);
  }
}
