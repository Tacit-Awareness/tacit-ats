import { beforeEach, describe, expect, test, vi } from "vitest";

const { moveCandidate, revalidatePath } = vi.hoisted(() => ({ moveCandidate: vi.fn(), revalidatePath: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/client/candidate-edits", () => ({ moveCandidate }));
vi.mock("@/lib/client/session", () => ({
  requireClient: async () => ({ db: {}, actorId: "a-1", accessLevel: "admin", org: { id: "o-1" } }),
}));

import { moveCardAction } from "./actions";

const APP = "c1d00000-0000-4000-8000-000000000001";
const PERSON = "c1c00000-0000-4000-8000-000000000001";

const form = (stage = "offer") => {
  const f = new FormData();
  f.set("applicationId", APP);
  f.set("candidateId", PERSON);
  f.set("stage", stage);
  f.set("expectedStage", "screening");
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("moveCardAction", () => {
  test("a refused form reaches no write", async () => {
    expect(await moveCardAction(form("rejected"))).toEqual({ ok: false, error: "not_found" });
    expect(moveCandidate).not.toHaveBeenCalled();
  });

  // The board is stale in each of these: the card went, or the member's access
  // did, so what it shows has to be read again.
  test.each(["changed", "not_found", "forbidden"] as const)("a %s refusal re-reads the board", async (error) => {
    moveCandidate.mockResolvedValue({ ok: false, error });
    expect(await moveCardAction(form())).toEqual({ ok: false, error });
    expect(revalidatePath).toHaveBeenCalledWith("/client/pipeline");
  });

  // moveStage writes the stage, then its event: a failure can come after the
  // stage changed, so neither the card nor the message may assume it did not.
  test("a write that throws re-reads the board and doesn't claim nothing changed", async () => {
    moveCandidate.mockRejectedValue(new Error("event insert failed"));
    expect(await moveCardAction(form())).toEqual({ ok: false, error: "unsure" });
    expect(revalidatePath).toHaveBeenCalledWith("/client/pipeline");
  });

  test("a move that landed refreshes every page it shows on", async () => {
    moveCandidate.mockResolvedValue({ ok: true, changed: true, roleId: "r-1" });
    expect(await moveCardAction(form())).toEqual({ ok: true, changed: true });
    expect(revalidatePath.mock.calls.flat()).toEqual(
      expect.arrayContaining([`/client/candidates/${PERSON}`, "/client/jobs/r-1", "/client/candidates", "/client/pipeline", "/client"]),
    );
  });
});
