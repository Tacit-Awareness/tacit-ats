import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { addReferral, type ReferralInput } from "./referrals";

const { addCandidate, logTouch } = vi.hoisted(() => ({ addCandidate: vi.fn(), logTouch: vi.fn() }));

vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, addCandidate } };
});
vi.mock("@tacit/core", async (original) => ({ ...(await original<typeof import("@tacit/core")>()), logTouch }));

const CTX: clientTools.ClientToolCtx = { actorId: "actor-1", orgId: "org-1", accessLevel: "admin", source: "dashboard" };
const DB = {} as Db;
const INPUT: ReferralInput = { jobId: "role-1", name: "Rita", email: "rita@x.test", linkedinUrl: null, referredBy: "  Priya   Shah ", note: "Great" };
const ADDED = { outcome: "added", applicationId: "app-1", candidateId: "person-1", newCandidate: true, stage: "sourced" };

beforeEach(() => {
  addCandidate.mockReset();
  logTouch.mockReset();
});

describe("addReferral", () => {
  test("is clientTools' audited add, with source referral and the cleaned referrer", async () => {
    addCandidate.mockResolvedValue(ADDED);
    expect(await addReferral(DB, CTX, INPUT)).toEqual({ ok: true, status: "added", applicationId: "app-1", personId: "person-1" });
    expect(addCandidate).toHaveBeenCalledWith(DB, CTX, {
      jobId: "role-1", name: "Rita", email: "rita@x.test", linkedinUrl: null, source: "referral", sourceDetail: "Priya Shah",
    });
    expect(logTouch).toHaveBeenCalledWith(DB, { applicationId: "app-1", actorId: "actor-1", note: "Great" });
  });

  test("someone already in the records is added_existing", async () => {
    addCandidate.mockResolvedValue({ ...ADDED, newCandidate: false });
    expect(await addReferral(DB, CTX, INPUT)).toMatchObject({ ok: true, status: "added_existing" });
  });

  test("someone already in the job keeps what they had: no note", async () => {
    addCandidate.mockResolvedValue({ ...ADDED, outcome: "already_in_pipeline", newCandidate: false, stage: "offer" });
    expect(await addReferral(DB, CTX, INPUT)).toEqual({ ok: true, status: "exists", applicationId: "app-1", personId: "person-1" });
    expect(logTouch).not.toHaveBeenCalled();
  });

  test("no note, no touch", async () => {
    addCandidate.mockResolvedValue(ADDED);
    await addReferral(DB, CTX, { ...INPUT, note: null });
    expect(logTouch).not.toHaveBeenCalled();
  });

  test("a missing referrer is refused before the add", async () => {
    expect(await addReferral(DB, CTX, { ...INPUT, referredBy: "   " })).toEqual({ ok: false, error: "invalid_referrer" });
    expect(await addReferral(DB, CTX, { ...INPUT, referredBy: null })).toEqual({ ok: false, error: "invalid_referrer" });
    expect(addCandidate).not.toHaveBeenCalled();
  });

  test.each(["forbidden", "rate_limited"] as const)("%s comes back as its code", async (code) => {
    addCandidate.mockRejectedValue(new clientTools.ClientToolError(code, "No."));
    expect(await addReferral(DB, CTX, INPUT)).toEqual({ ok: false, error: code });
  });

  test.each(["name", "email", "linkedin"])("an invalid %s points at its field", async (field) => {
    addCandidate.mockRejectedValue(new clientTools.ClientToolError("invalid", "That needs it.", field));
    expect(await addReferral(DB, CTX, INPUT)).toEqual({ ok: false, error: `invalid_${field}` });
  });

  test("anything else is a failure, not an answer", async () => {
    addCandidate.mockRejectedValue(new clientTools.ClientToolError("invalid", "A source detail is too long."));
    await expect(addReferral(DB, CTX, INPUT)).rejects.toThrow("too long");
    addCandidate.mockRejectedValue(new Error("connection reset"));
    await expect(addReferral(DB, CTX, INPUT)).rejects.toThrow("connection reset");
    addCandidate.mockRejectedValue(new clientTools.ClientToolError("not_found", "No such job."));
    await expect(addReferral(DB, CTX, INPUT)).rejects.toThrow("No such job.");
  });
});
