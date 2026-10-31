import { beforeEach, describe, expect, test, vi } from "vitest";

// saveProfileAction by hand: an action is callable by id from any page, so what
// a tampered form or a failing database gets back is checked here, without the
// page. What the database decides is in interviewer-profiles.integration.test.ts.

const { requireClient, setInterviewerProfile, revalidatePath, redirect } = vi.hoisted(() => ({
  requireClient: vi.fn(),
  setInterviewerProfile: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/client/session", () => ({ requireClient }));
vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, setInterviewerProfile } };
});

import { clientTools } from "@tacit-ats/core";
import { saveProfileAction } from "./actions";
import { PROFILE_ERRORS } from "./messages";

const MEMBER = { db: { fake: true }, actorId: "a1", accessLevel: "admin", org: { id: "o1" } };
const TARGET = "e6a00000-0000-4000-8000-0000000000a2";

const form = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  requireClient.mockResolvedValue(MEMBER);
  setInterviewerProfile.mockResolvedValue({ outcome: "changed" });
});

describe("saveProfileAction", () => {
  const SAVE = { actorId: TARGET, version: "2026-10-30T12:00:00+00:00", preference: "avoids", weeklyCap: "2", focusAreas: "Go\nRust", channel: "slack", awayUntil: "2026-11-14" };

  test("nothing runs for someone who is not signed in", async () => {
    requireClient.mockRejectedValue(new Error("unauthenticated: signed_out"));
    await expect(saveProfileAction(form(SAVE))).rejects.toThrow("unauthenticated");
    expect(setInterviewerProfile).not.toHaveBeenCalled();
  });

  test("who is saving comes from the token, and every field from the form", async () => {
    requireClient.mockResolvedValue({ ...MEMBER, accessLevel: "elevated" });
    expect(await saveProfileAction(form({ ...SAVE, accessLevel: "admin", orgId: "other", source: "claude" }))).toEqual({ ok: true, notice: "profile_saved" });
    expect(setInterviewerProfile).toHaveBeenCalledWith(
      MEMBER.db,
      { actorId: "a1", orgId: "o1", accessLevel: "elevated", source: "dashboard" },
      {
        memberId: TARGET,
        expectedUpdatedAt: SAVE.version,
        profile: { preference: "avoids", weeklyCap: 2, focusAreas: ["Go", "Rust"], channel: "slack", awayUntil: "2026-11-14" },
      },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/client/interviewers");
    expect(redirect).not.toHaveBeenCalled();
  });

  test("no version on the form is a page that showed no profile", async () => {
    await saveProfileAction(form({ actorId: TARGET }));
    expect(setInterviewerProfile.mock.calls[0]?.[2]).toMatchObject({ expectedUpdatedAt: null });
  });

  test.each([
    ["empty", ""],
    ["not a uuid", "nope"],
    ["a uuid with more after it", `${TARGET}' or 1=1`],
    ["huge", "a".repeat(200_000)],
  ])("a member id that is %s is refused before anything runs", async (_name, actorId) => {
    expect(await saveProfileAction(form({ ...SAVE, actorId }))).toEqual({ ok: false, error: "member_gone" });
    expect(setInterviewerProfile).not.toHaveBeenCalled();
  });

  test("the same values say so", async () => {
    setInterviewerProfile.mockResolvedValue({ outcome: "unchanged" });
    expect(await saveProfileAction(form(SAVE))).toEqual({ ok: true, notice: "profile_unchanged" });
  });

  test("a stale save is reported, and the page refreshes so a second Save has the new version", async () => {
    setInterviewerProfile.mockResolvedValue({ outcome: "stale" });
    expect(await saveProfileAction(form(SAVE))).toEqual({ ok: false, error: "stale" });
    expect(revalidatePath).toHaveBeenCalledWith("/client/interviewers");
  });

  test("an invalid field comes back with its sentence and its name, nothing saved", async () => {
    setInterviewerProfile.mockRejectedValue(new clientTools.ClientToolError("invalid", "Keep what they know to 20 areas.", "focusAreas"));
    expect(await saveProfileAction(form(SAVE))).toEqual({ ok: false, invalid: "Keep what they know to 20 areas.", field: "focusAreas" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test.each([
    ["forbidden", "forbidden"],
    ["not_found", "member_gone"],
    ["rate_limited", "rate_limited"],
  ] as const)("a %s refusal comes back as %s", async (code, error) => {
    setInterviewerProfile.mockRejectedValue(new clientTools.ClientToolError(code, "Refused, lee@acme.test."));
    expect(await saveProfileAction(form(SAVE))).toEqual({ ok: false, error });
  });

  test("a database failure is a generic error, with no message back", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    setInterviewerProfile.mockRejectedValue(new Error("connection lost at lee@acme.test"));
    expect(await saveProfileAction(form(SAVE))).toEqual({ ok: false, error: "failed" });
    // A write can fail after it landed, so the sentence cannot promise it did not.
    expect(PROFILE_ERRORS.failed).toMatch(/may not have gone through/);
    expect(PROFILE_ERRORS.failed).not.toMatch(/nothing was/i);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
