import type { Db } from "@tacit/db";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// runScheduleRequest by hand: what stops a change before core is called, and
// what a failure may say. What the policies decide, and the calendar side
// against a fake Google, are in schedule-writes.integration.test.ts.

const { scheduleInterview, updateInterview, findInterviewTimes } = vi.hoisted(() => ({
  scheduleInterview: vi.fn(),
  updateInterview: vi.fn(),
  findInterviewTimes: vi.fn(),
}));

vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, scheduleInterview, updateInterview, findInterviewTimes } };
});

import { clientTools } from "@tacit-ats/core";
import { runScheduleRequest } from "./schedule-ops";
import { COULD_NOT_FINISH, type BookRequest, type CancelRequest, type MoveRequest } from "./schedule-requests";

const ctx = { actorId: "a1", orgId: "o1", accessLevel: "admin", source: "dashboard" } as const;
const NOW = new Date("2030-01-07T12:00:00Z");
const deps = { calendar: null, now: () => NOW };
const ID = "d1a00000-0000-4000-8000-0000000000e1";

const book: BookRequest = {
  op: "book", confirmed: false, interviewId: ID, applicationId: ID, startsAt: "2030-01-08T15:00:00Z", endsAt: "2030-01-08T16:00:00Z",
  interviewerIds: [ID], step: null, locationOrLink: null, timezone: "UTC", bookDespiteConflicts: false, recordOnly: false,
};
const move: MoveRequest = { op: "move", confirmed: false, interviewId: ID, startsAt: "2030-01-08T15:00:00Z", endsAt: "2030-01-08T16:00:00Z", timezone: "UTC", bookDespiteConflicts: false, recordOnly: false };
const cancel: CancelRequest = { op: "cancel", confirmed: false, interviewId: ID, timezone: "UTC", recordOnly: false };

type Row = { status: string; starts_at: string };
type App = { stage: string; merged_into_id: string | null; roles: { status: string } | null };
const IN_PROCESS: App = { stage: "interviewing", merged_into_id: null, roles: { status: "open" } };

/** The interview a move or a cancel reads first (each read the next of `rows`, the last again), and the application a book reads. */
const dbOf = (rows: Array<Row | null>, app: App | null = IN_PROCESS, error: { message: string } | null = null) => {
  let at = 0;
  const query = (read: () => unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) q[m] = () => q;
    q.maybeSingle = async () => ({ data: read(), error });
    return q;
  };
  return { from: (table: string) => query(() => (table === "applications" ? app : rows[Math.min(at++, rows.length - 1)])) } as unknown as Db;
};
const db = (row: Row | null, error: { message: string } | null = null) => dbOf([row], IN_PROCESS, error);
const ahead = db({ status: "scheduled", starts_at: "2030-01-09T15:00:00Z" });

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => log.mockRestore());

describe("an unconfirmed request is core's dry run, and only that", () => {
  test("a book", async () => {
    scheduleInterview.mockResolvedValue({ outcome: "preview", calendar: { status: "not_sent", reason: "not_set_up", connectUrl: null }, conflicts: { busy: [], unknown: [] } });
    expect(await runScheduleRequest(ahead, ctx, book, deps)).toMatchObject({ ok: true, kind: "book_preview" });
    expect(scheduleInterview.mock.calls[0]![2]).toMatchObject({ dryRun: true, draftCandidateEmail: false });
  });

  test("a move and a cancel", async () => {
    updateInterview.mockResolvedValue({ outcome: "preview", calendar: { status: "none" }, conflicts: { busy: [], unknown: [] } });
    expect(await runScheduleRequest(ahead, ctx, move, deps)).toMatchObject({ ok: true, kind: "change_preview", op: "move" });
    expect(await runScheduleRequest(ahead, ctx, cancel, deps)).toMatchObject({ ok: true, kind: "change_preview", op: "cancel" });
    for (const call of updateInterview.mock.calls) expect(call[2]).toMatchObject({ dryRun: true });
    expect(updateInterview.mock.calls[1]![2]).toMatchObject({ status: "cancelled" });
  });

  test("a confirmed one carries no dry run", async () => {
    scheduleInterview.mockResolvedValue({ outcome: "scheduled", interviewId: ID, calendar: { status: "not_sent", reason: "not_set_up", connectUrl: null } });
    expect(await runScheduleRequest(ahead, ctx, { ...book, confirmed: true }, deps)).toMatchObject({ ok: true, kind: "booked", interviewId: ID });
    expect(scheduleInterview.mock.calls[0]![2]).not.toHaveProperty("dryRun");
  });
});

describe("Tacit's record only", () => {
  test("reaches core as what leaves the calendar out", async () => {
    scheduleInterview.mockResolvedValue({ outcome: "scheduled", interviewId: ID, calendar: { status: "not_sent", reason: "not_asked", connectUrl: null } });
    updateInterview.mockResolvedValue({ outcome: "updated", changed: ["status"], calendar: "left_alone", conflicts: { busy: [], unknown: [] }, candidateDraft: null, noDraftBecause: null });
    await runScheduleRequest(ahead, ctx, { ...book, confirmed: true, recordOnly: true }, deps);
    await runScheduleRequest(ahead, ctx, { ...cancel, confirmed: true, recordOnly: true }, deps);
    expect(scheduleInterview.mock.calls[0]![2]).toMatchObject({ sendInvites: false });
    expect(updateInterview.mock.calls[0]![2]).toMatchObject({ updateCalendar: false });
  });

  test("is off by default: nothing tells core to skip the calendar", async () => {
    scheduleInterview.mockResolvedValue({ outcome: "scheduled", interviewId: ID, calendar: { status: "not_sent", reason: "not_set_up", connectUrl: null } });
    await runScheduleRequest(ahead, ctx, { ...book, confirmed: true }, deps);
    expect(scheduleInterview.mock.calls[0]![2].sendInvites).toBeUndefined();
  });
});

describe("what is no longer there to change", () => {
  test.each([
    ["gone or never theirs", db(null), "not_found"],
    ["already cancelled", db({ status: "cancelled", starts_at: "2030-01-09T15:00:00Z" }), "stale"],
    ["marked done", db({ status: "done", starts_at: "2030-01-09T15:00:00Z" }), "stale"],
    ["already started", db({ status: "scheduled", starts_at: "2030-01-07T11:00:00Z" }), "stale"],
  ])("%s: core is never called", async (_, row, code) => {
    for (const request of [{ ...move, confirmed: true }, { ...cancel, confirmed: true }]) {
      expect(await runScheduleRequest(row, ctx, request, deps)).toMatchObject({ ok: false, code });
    }
    expect(updateInterview).not.toHaveBeenCalled();
  });

  test("a move into the past is refused before core", async () => {
    const answer = await runScheduleRequest(ahead, ctx, { ...move, startsAt: "2030-01-07T11:00:00Z" }, deps);
    expect(answer).toMatchObject({ ok: false, code: "invalid" });
    expect(updateInterview).not.toHaveBeenCalled();
  });

  const untouched = { outcome: "unchanged", changed: [], calendar: "left_alone", conflicts: { busy: [], unknown: [] }, candidateDraft: null, noDraftBecause: null };

  test("a retry of what did go through comes back unchanged, never as done", async () => {
    updateInterview.mockResolvedValue(untouched);
    expect(await runScheduleRequest(ahead, ctx, { ...cancel, confirmed: true }, deps)).toEqual({ ok: true, kind: "unchanged" });
  });

  test("a move that lost to a cancel says so, not that it was already that way", async () => {
    updateInterview.mockResolvedValue(untouched);
    const raced = dbOf([{ status: "scheduled", starts_at: "2030-01-09T15:00:00Z" }, { status: "cancelled", starts_at: "2030-01-09T15:00:00Z" }]);
    expect(await runScheduleRequest(raced, ctx, { ...move, confirmed: true }, deps)).toMatchObject({ ok: false, code: "stale", message: expect.stringContaining("cancelled") });
  });

  test("someone else moved it since the page was read: the time asked for is not put over theirs", async () => {
    const was = "2030-01-09T14:00:00Z"; // The grid's; the row says 15:00.
    for (const request of [{ ...move, confirmed: true, was }, { ...move, was }, { ...cancel, confirmed: true, was }]) {
      expect(await runScheduleRequest(ahead, ctx, request, deps)).toMatchObject({ ok: false, code: "stale", message: expect.stringContaining("since") });
    }
    expect(updateInterview).not.toHaveBeenCalled();
  });

  test("a retry of this very move, after an answer that never came, is not someone else's move", async () => {
    updateInterview.mockResolvedValue(untouched);
    const there = db({ status: "scheduled", starts_at: "2030-01-08T15:00:00+00:00" }); // Where `move` is going.
    expect(await runScheduleRequest(there, ctx, { ...move, confirmed: true, was: "2030-01-09T15:00:00Z" }, deps)).toEqual({ ok: true, kind: "unchanged" });
  });

  test("the same instant in another spelling is the same time", async () => {
    updateInterview.mockResolvedValue(untouched);
    expect(await runScheduleRequest(ahead, ctx, { ...cancel, was: "2030-01-09T10:00:00-05:00" }, deps)).toEqual({ ok: true, kind: "unchanged" });
  });

  test.each([
    ["rejected", { ...IN_PROCESS, stage: "rejected" }],
    ["hired", { ...IN_PROCESS, stage: "hired" }],
    ["merged into another record", { ...IN_PROCESS, merged_into_id: ID }],
    ["on a job that closed", { ...IN_PROCESS, roles: { status: "closed" } }],
  ])("a candidate %s is not booked: the dialog was read before that happened", async (_, app) => {
    for (const request of [book, { ...book, confirmed: true }]) {
      expect(await runScheduleRequest(dbOf([null], app), ctx, request, deps)).toMatchObject({ ok: false, code: "stale" });
    }
    expect(scheduleInterview).not.toHaveBeenCalled();
  });

  test("an application the member cannot read is core's to refuse", async () => {
    scheduleInterview.mockRejectedValue(new clientTools.ClientToolError("not_found", "No application with that id that you can see."));
    expect(await runScheduleRequest(dbOf([null], null), ctx, book, deps)).toMatchObject({ ok: false, code: "not_found" });
    expect(scheduleInterview).toHaveBeenCalled();
  });

  test("the same booking again, after an answer that never came, is the booking", async () => {
    scheduleInterview.mockRejectedValue(new clientTools.ClientToolError("invalid", "This interview is already booked.", "interview_id"));
    expect(await runScheduleRequest(ahead, ctx, { ...book, confirmed: true }, deps)).toEqual({ ok: true, kind: "already_booked" });
  });

  test("a clash that turned up since the dry run comes back with nothing written", async () => {
    const conflicts = { busy: [{ userId: "a", name: "Dana" }], unknown: [] };
    scheduleInterview.mockResolvedValue({ outcome: "conflicts", interviewId: null, conflicts });
    expect(await runScheduleRequest(ahead, ctx, { ...book, confirmed: true }, deps)).toEqual({ ok: true, kind: "conflicts", conflicts });
  });
});

describe("what a failure may say", () => {
  test("core's refusal is an answer, in its words", async () => {
    scheduleInterview.mockRejectedValue(new clientTools.ClientToolError("forbidden", "You can see that candidate but not schedule interviews on this job."));
    expect(await runScheduleRequest(ahead, ctx, book, deps)).toEqual({ ok: false, code: "forbidden", message: "You can see that candidate but not schedule interviews on this job." });
  });

  test("core's not_found is said without its connector's tool names", async () => {
    scheduleInterview.mockRejectedValue(new clientTools.ClientToolError("not_found", "No application with that id that you can see. get_pipeline and get_candidate list them."));
    const answer = await runScheduleRequest(ahead, ctx, book, deps);
    expect(answer).toMatchObject({ ok: false, code: "not_found" });
    expect(JSON.stringify(answer)).not.toContain("get_pipeline");
  });

  test("anything else stays in the log: the page is told only that it may not have finished", async () => {
    scheduleInterview.mockRejectedValue(new Error('duplicate key in "interviews" for rt-secret-refresh-token'));
    const answer = await runScheduleRequest(ahead, ctx, { ...book, confirmed: true }, deps);
    expect(answer).toEqual({ ok: false, code: "failed", message: COULD_NOT_FINISH });
    expect(JSON.stringify(answer)).not.toContain("secret");
  });

  test("a read that fails is that too", async () => {
    expect(await runScheduleRequest(db(null, { message: "boom" }), ctx, cancel, deps)).toEqual({ ok: false, code: "failed", message: COULD_NOT_FINISH });
  });

  test("Find a time's unread calendars come back with why, by name", async () => {
    findInterviewTimes.mockResolvedValue({
      timezone: "UTC", durationMinutes: 60, slots: [], checked: [{ userId: "a", name: "Dana", via: "their_calendar" }], unknown: [{ userId: "b", name: "Lee", reason: "not_connected" }],
    });
    const answer = await runScheduleRequest(ahead, ctx, { op: "find", interviewerIds: [ID], durationMinutes: 60, windowStart: "2030-01-07T12:00:00Z", windowEnd: "2030-01-20T12:00:00Z", timezone: "UTC", applicationId: ID }, deps);
    expect(answer).toMatchObject({ ok: true, kind: "times", found: { checked: ["Dana"], unknown: [{ name: "Lee", why: clientTools.unknownText("not_connected") }] } });
  });
});
