import { beforeEach, describe, expect, test, vi } from "vitest";

// fileFeedbackAction by hand: an action is callable by id from any page, so
// what a tampered form or a failing database gets back is checked here. Who may
// file is core's and the database's (core's interviews tests).

const { requireClient, submitFeedback, revalidatePath } = vi.hoisted(() => ({
  requireClient: vi.fn(),
  submitFeedback: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/client/session", () => ({ requireClient }));
vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, submitFeedback } };
});

import { clientTools } from "@tacit-ats/core";
import { fileFeedbackAction } from "./actions";

const MEMBER = { db: { fake: true }, actorId: "a1", accessLevel: "limited", org: { id: "o1" } };
const IV = "e6a00000-0000-4000-8000-0000000000b1";
const A1 = "e6a00000-0000-4000-8000-0000000000c1";

const form = (fields: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of fields) f.append(k, v);
  return f;
};
const FILING: [string, string][] = [["interviewId", IV], ["recommendation", "strong_yes"], ["rating", "4"], ["notes", "Private words"], ["attr", A1], ["r:" + A1, "3"]];

beforeEach(() => {
  vi.clearAllMocks();
  requireClient.mockResolvedValue(MEMBER);
  submitFeedback.mockResolvedValue({ feedbackId: "f1", replaced: false, ratings: 1 });
});

describe("fileFeedbackAction", () => {
  test("nothing runs for someone who is not signed in", async () => {
    requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(fileFeedbackAction({ filed: 0 }, form(FILING))).rejects.toThrow("unauthenticated");
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  test("files as the member, source dashboard, and counts it", async () => {
    expect(await fileFeedbackAction({ filed: 2 }, form(FILING))).toEqual({ filed: 3 });
    expect(submitFeedback).toHaveBeenCalledWith(MEMBER.db, { actorId: "a1", orgId: "o1", accessLevel: "limited", source: "dashboard" }, {
      interviewId: IV, recommendation: "strong_yes", rating: 4, notes: "Private words", ratings: [{ attributeId: A1, rating: 3, note: null }],
    });
    expect(revalidatePath).toHaveBeenCalledWith("/client", "layout");
  });

  test("a form refusal writes nothing and hands the draft back", async () => {
    const state = await fileFeedbackAction({ filed: 1 }, form([["interviewId", IV], ["notes", "kept"]]));
    expect(state).toMatchObject({ filed: 1, error: "no_recommendation", draft: { notes: "kept" } });
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  test("a tampered id is no answer", async () => {
    expect(await fileFeedbackAction({ filed: 0 }, form([["interviewId", "../x"], ...FILING.slice(1)]))).toEqual({ filed: 0 });
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  test("core's refusals come back as codes with the draft", async () => {
    submitFeedback.mockRejectedValue(new clientTools.ClientToolError("forbidden", "You were not an interviewer on that interview"));
    expect(await fileFeedbackAction({ filed: 0 }, form(FILING))).toMatchObject({ error: "not_interviewer", draft: { notes: "Private words", ratings: { [A1]: 3 } } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("a database failure says it may not have saved, and logs no words", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    submitFeedback.mockRejectedValue(new Error("connection reset"));
    expect(await fileFeedbackAction({ filed: 0 }, form(FILING))).toMatchObject({ error: "failed" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("Private words");
    log.mockRestore();
  });
});
