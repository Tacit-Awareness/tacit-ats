import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { moveCandidate, setCandidateNextAction } from "./candidate-edits";
import type { MoveInput } from "./candidate-edit-rules";

const { updateStage, setApplicationNextAction } = vi.hoisted(() => ({ updateStage: vi.fn(), setApplicationNextAction: vi.fn() }));

vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, updateStage, setApplicationNextAction } };
});

const CTX: clientTools.ClientToolCtx = { actorId: "actor-1", orgId: "org-1", accessLevel: "admin", source: "dashboard" };

/** The page's gate: the application as the member reads it, and can_on_role's answer. */
function fakeDb(app: { id: string; role_id: string; stage: string } | null, allowed = true): Db {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: app, error: null }) }) }) }),
    rpc: async () => ({ data: allowed, error: null }),
  } as unknown as Db;
}

const APP = { id: "app-1", role_id: "role-1", stage: "screening" };
const move = (over: Partial<MoveInput> = {}): MoveInput => ({
  applicationId: "app-1", stage: "interviewing", expectedStage: "screening", reasonId: null, note: null, ...over,
});
const reject = (over: Partial<MoveInput> = {}) => move({ stage: "rejected", reasonId: "reason-1", note: "Why", ...over });

beforeEach(() => {
  updateStage.mockReset();
  setApplicationNextAction.mockReset();
});

describe("moveCandidate", () => {
  test("a move is clientTools' audited write, as the member, from the stage the page showed", async () => {
    updateStage.mockResolvedValue({ outcome: "moved", stage: "interviewing", reason: null });
    expect(await moveCandidate(fakeDb(APP), CTX, move())).toEqual({ ok: true, changed: true, roleId: "role-1" });
    expect(updateStage).toHaveBeenCalledWith(expect.anything(), CTX, {
      applicationId: "app-1", stage: "interviewing", expectedStage: "screening", reasonId: null, note: null,
    });
  });

  test("a note and a reason only travel with a close", async () => {
    updateStage.mockResolvedValue({ outcome: "moved", stage: "interviewing", reason: null });
    await moveCandidate(fakeDb(APP), CTX, move({ reasonId: "reason-1", note: "stray" }));
    expect(updateStage.mock.calls[0]![2]).toMatchObject({ reasonId: null, note: null });

    updateStage.mockResolvedValue({ outcome: "moved", stage: "rejected", reason: "Too junior" });
    await moveCandidate(fakeDb(APP), CTX, reject());
    expect(updateStage.mock.calls[1]![2]).toMatchObject({ reasonId: "reason-1", note: "Why" });
  });

  test("what the page's own checks answer never reaches the write", async () => {
    expect(await moveCandidate(fakeDb(null), CTX, move())).toEqual({ ok: false, error: "not_found" });
    expect(await moveCandidate(fakeDb(APP, false), CTX, move())).toEqual({ ok: false, error: "forbidden" });
    expect(await moveCandidate(fakeDb({ ...APP, stage: "offer" }), CTX, move())).toEqual({ ok: false, error: "changed" });
    expect(await moveCandidate(fakeDb(APP), CTX, move({ stage: "screening" }))).toEqual({ ok: true, changed: false, roleId: "role-1" });
    expect(await moveCandidate(fakeDb(APP), CTX, reject({ reasonId: null }))).toEqual({ ok: false, error: "reason_required" });
    expect(updateStage).not.toHaveBeenCalled();
  });

  test("a close already at that stage does not replace its reason", async () => {
    const closed = { ...APP, stage: "rejected" };
    expect(await moveCandidate(fakeDb(closed), CTX, reject({ expectedStage: "rejected" }))).toEqual({ ok: true, changed: false, roleId: "role-1" });
    expect(updateStage).not.toHaveBeenCalled();
  });

  test.each(["changed_since", "unchanged"])("%s means someone else got there first", async (outcome) => {
    updateStage.mockResolvedValue({ outcome, stage: "offer", reason: null });
    expect(await moveCandidate(fakeDb(APP), CTX, move())).toEqual({ ok: false, error: "changed" });
  });

  test.each(["not_found", "invalid"] as const)("a close's %s is about the reason", async (code) => {
    updateStage.mockRejectedValue(new clientTools.ClientToolError(code, "No such reason."));
    expect(await moveCandidate(fakeDb(APP), CTX, reject())).toEqual({ ok: false, error: "reason_required" });
  });

  test("a move that loses the application is not found, not a reason problem", async () => {
    updateStage.mockRejectedValue(new clientTools.ClientToolError("not_found", "Gone."));
    expect(await moveCandidate(fakeDb(APP), CTX, move())).toEqual({ ok: false, error: "not_found" });
  });

  test.each(["forbidden", "rate_limited"] as const)("%s comes back as its code, on a close too", async (code) => {
    updateStage.mockRejectedValue(new clientTools.ClientToolError(code, "No."));
    expect(await moveCandidate(fakeDb(APP), CTX, move())).toEqual({ ok: false, error: code });
    expect(await moveCandidate(fakeDb(APP), CTX, reject())).toEqual({ ok: false, error: code });
  });

  test("anything but a refusal is a failure, not an answer", async () => {
    updateStage.mockRejectedValue(new Error("connection reset"));
    await expect(moveCandidate(fakeDb(APP), CTX, move())).rejects.toThrow("connection reset");
    updateStage.mockRejectedValue(new clientTools.ClientToolError("invalid", "Unknown stage."));
    await expect(moveCandidate(fakeDb(APP), CTX, move())).rejects.toThrow("Unknown stage.");
  });
});

describe("setCandidateNextAction", () => {
  const input = { applicationId: "app-1", nextAction: "Call", due: "2026-11-02" };

  test("is clientTools' audited write, and says whether anything changed", async () => {
    setApplicationNextAction.mockResolvedValue({ outcome: "set", nextAction: "Call", due: "2026-11-02" });
    expect(await setCandidateNextAction(fakeDb(APP), CTX, input)).toEqual({ ok: true, changed: true, roleId: "role-1" });
    expect(setApplicationNextAction).toHaveBeenCalledWith(expect.anything(), CTX, input);

    setApplicationNextAction.mockResolvedValue({ outcome: "cleared", nextAction: null, due: null });
    expect(await setCandidateNextAction(fakeDb(APP), CTX, input)).toEqual({ ok: true, changed: true, roleId: "role-1" });

    setApplicationNextAction.mockResolvedValue({ outcome: "unchanged", nextAction: "Call", due: null });
    expect(await setCandidateNextAction(fakeDb(APP), CTX, input)).toEqual({ ok: true, changed: false, roleId: "role-1" });
  });

  test("the page's checks come first, and a refusal is its code", async () => {
    expect(await setCandidateNextAction(fakeDb(null), CTX, input)).toEqual({ ok: false, error: "not_found" });
    expect(await setCandidateNextAction(fakeDb(APP, false), CTX, input)).toEqual({ ok: false, error: "forbidden" });
    expect(setApplicationNextAction).not.toHaveBeenCalled();

    setApplicationNextAction.mockRejectedValue(new clientTools.ClientToolError("rate_limited", "Limit."));
    expect(await setCandidateNextAction(fakeDb(APP), CTX, input)).toEqual({ ok: false, error: "rate_limited" });
  });
});
