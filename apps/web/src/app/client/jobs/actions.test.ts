import { beforeEach, describe, expect, test, vi } from "vitest";

// The job panel's actions by hand: an action is callable by id from any page,
// so what a tampered form or a failing database gets back is checked here. Who
// may change a job is core's and the database's (can_manage_job).

const { requireClient, updateJob, addOpenings, closeOpening, revalidatePath } = vi.hoisted(() => ({
  requireClient: vi.fn(),
  updateJob: vi.fn(),
  addOpenings: vi.fn(),
  closeOpening: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/client/session", () => ({ requireClient }));
vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, updateJob, addOpenings, closeOpening } };
});

import { clientTools } from "@tacit-ats/core";
import { addOpeningsAction, closeOpeningAction, saveJobAction } from "./actions";

const MEMBER = { db: { fake: true }, actorId: "a1", accessLevel: "member", org: { id: "o1" } };
const CTX = { actorId: "a1", orgId: "o1", accessLevel: "member", source: "dashboard" };
const JOB = "e6a00000-0000-4000-8000-0000000000a1";
const OPENING = "e6a00000-0000-4000-8000-0000000000d1";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};
const jobForm = (fields: Record<string, string>) =>
  form({ jobId: JOB, "was:title": "Engineer", "was:status": "open", title: "Engineer", status: "open", ...fields });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireClient.mockResolvedValue(MEMBER);
  updateJob.mockResolvedValue({ outcome: "updated", changed: ["status"] });
  addOpenings.mockResolvedValue({ jobId: JOB, jobStatus: "open", added: [], counts: { open: 2, filled: 0, closed: 0 } });
  closeOpening.mockResolvedValue({ outcome: "closed", openingId: OPENING, jobId: JOB, number: 1, counts: { open: 0, filled: 0, closed: 1 } });
});

describe("saveJobAction", () => {
  test("nothing runs for someone who is not signed in", async () => {
    requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(saveJobAction({}, jobForm({ status: "paused" }))).rejects.toThrow("unauthenticated");
    expect(updateJob).not.toHaveBeenCalled();
  });

  test("sends only what changed, as the member, source dashboard", async () => {
    expect(await saveJobAction({}, jobForm({ status: "paused", title: "Staff engineer" }))).toEqual({ notice: "saved" });
    expect(updateJob).toHaveBeenCalledWith(MEMBER.db, CTX, { jobId: JOB, title: "Staff engineer", status: "paused" });
    expect(revalidatePath).toHaveBeenCalledWith("/client", "layout");
  });

  test("nothing changed writes nothing", async () => {
    expect(await saveJobAction({}, jobForm({}))).toEqual({ notice: "unchanged" });
    expect(updateJob).not.toHaveBeenCalled();
  });

  test("a form refusal writes nothing and hands the draft back", async () => {
    expect(await saveJobAction({}, jobForm({ title: " ", status: "closed" }))).toEqual({ error: "title_required", draft: { title: " ", status: "closed" } });
    expect(await saveJobAction({}, jobForm({ status: "filled" }))).toMatchObject({ error: "bad_status" });
    expect(await saveJobAction({}, jobForm({ jobId: "x" }))).toEqual({});
    expect(updateJob).not.toHaveBeenCalled();
  });

  test("core's refusals keep the draft", async () => {
    updateJob.mockRejectedValue(new clientTools.ClientToolError("forbidden", "You can see that job but not change it."));
    expect(await saveJobAction({}, jobForm({ status: "closed" }))).toEqual({ error: "forbidden", draft: { title: "Engineer", status: "closed" } });
    updateJob.mockRejectedValue(new clientTools.ClientToolError("invalid", "Not saved: opening needs an approval. request_approval with the job_id asks for it."));
    expect(await saveJobAction({}, jobForm({ "was:status": "paused", status: "open" }))).toMatchObject({ error: "needs_approval" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("a failed request is a failure, not a crash", async () => {
    updateJob.mockRejectedValue(new Error("connection reset"));
    expect(await saveJobAction({}, jobForm({ status: "paused" }))).toMatchObject({ error: "failed", draft: { status: "paused" } });
  });
});

describe("addOpeningsAction", () => {
  test("adds as many as asked", async () => {
    expect(await addOpeningsAction({}, form({ jobId: JOB, count: "2" }))).toEqual({ notice: "added" });
    expect(addOpenings).toHaveBeenCalledWith(MEMBER.db, CTX, { jobId: JOB, count: 2 });
  });

  test("a bad count writes nothing", async () => {
    expect(await addOpeningsAction({}, form({ jobId: JOB, count: "51" }))).toMatchObject({ error: "bad_count", draft: { count: "51" } });
    expect(addOpenings).not.toHaveBeenCalled();
  });

  test("core's refusal is a code", async () => {
    addOpenings.mockRejectedValue(new clientTools.ClientToolError("forbidden", "Only an admin or someone who manages that job changes its openings."));
    expect(await addOpeningsAction({}, form({ jobId: JOB, count: "1" }))).toMatchObject({ error: "forbidden" });
  });

  test("nothing runs for someone who is not signed in", async () => {
    requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(addOpeningsAction({}, form({ jobId: JOB, count: "1" }))).rejects.toThrow("unauthenticated");
    expect(addOpenings).not.toHaveBeenCalled();
  });
});

describe("closeOpeningAction", () => {
  test("closes with the reason, and the reason never reaches a log", async () => {
    closeOpening.mockRejectedValueOnce(new Error("connection reset"));
    const err = vi.mocked(console.error);
    expect(await closeOpeningAction({}, form({ openingId: OPENING, reason: "Budget moved" }))).toEqual({
      error: "failed",
      draft: { count: "", reason: "Budget moved", openingId: OPENING },
    });
    expect(JSON.stringify(err.mock.calls)).not.toContain("Budget moved");

    expect(await closeOpeningAction({}, form({ openingId: OPENING, reason: "Budget moved" }))).toEqual({ notice: "closed" });
    expect(closeOpening).toHaveBeenLastCalledWith(MEMBER.db, CTX, { openingId: OPENING, reason: "Budget moved" });
  });

  test("a filled opening says so, keeping the reason", async () => {
    closeOpening.mockRejectedValue(new clientTools.ClientToolError("invalid", "That opening is filled. Moving its hire out of hired opens it again; then it can be closed."));
    expect(await closeOpeningAction({}, form({ openingId: OPENING, reason: "Budget" }))).toEqual({
      error: "opening_filled",
      draft: { count: "", reason: "Budget", openingId: OPENING },
    });
  });

  test("no reason writes nothing", async () => {
    expect(await closeOpeningAction({}, form({ openingId: OPENING, reason: "" }))).toMatchObject({ error: "reason_required" });
    expect(closeOpening).not.toHaveBeenCalled();
  });
});
