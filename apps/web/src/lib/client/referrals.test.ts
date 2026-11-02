import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { addReferral, referralFile, type ReferralInput } from "./referrals";

const { addCandidate, addFile, logTouch } = vi.hoisted(() => ({ addCandidate: vi.fn(), addFile: vi.fn(), logTouch: vi.fn() }));

vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, addCandidate, addFile } };
});
vi.mock("@tacit/core", async (original) => ({ ...(await original<typeof import("@tacit/core")>()), logTouch }));

const CTX: clientTools.ClientToolCtx = { actorId: "actor-1", orgId: "org-1", accessLevel: "admin", source: "dashboard" };
const DB = {} as Db;
const INPUT: ReferralInput = { jobId: "role-1", name: "Rita", email: "rita@x.test", linkedinUrl: null, referredBy: "  Priya   Shah ", note: "Great" };
const ADDED = { outcome: "added", applicationId: "app-1", candidateId: "person-1", newCandidate: true, stage: "sourced" };

beforeEach(() => {
  addCandidate.mockReset();
  addFile.mockReset();
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

  test("a note that fails says so: they're in, and a retry would answer exists", async () => {
    addCandidate.mockResolvedValue(ADDED);
    logTouch.mockRejectedValue(new Error("no"));
    expect(await addReferral(DB, CTX, INPUT)).toMatchObject({ ok: true, status: "added_no_note" });
  });

  test("a NUL leaves the note, which Postgres couldn't store", async () => {
    addCandidate.mockResolvedValue(ADDED);
    await addReferral(DB, CTX, { ...INPUT, note: "Gr\0eat" });
    expect(logTouch).toHaveBeenCalledWith(DB, expect.objectContaining({ note: "Great" }));
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

describe("addReferral with a resume", () => {
  const file = { filename: "cv.pdf", contentType: "application/pdf", contentBase64: "JVBERi0=" };
  const store = { put: vi.fn(), signedUrl: vi.fn() };

  test("stores it on the person, through the member's own client", async () => {
    addCandidate.mockResolvedValue(ADDED);
    expect(await addReferral(DB, CTX, { ...INPUT, file }, store)).toMatchObject({ ok: true, status: "added" });
    expect(addFile).toHaveBeenCalledWith(DB, CTX, store, { candidateId: "person-1", kind: "resume", ...file });
  });

  test("someone already in the job gets nothing added", async () => {
    addCandidate.mockResolvedValue({ ...ADDED, outcome: "already_in_pipeline" });
    expect(await addReferral(DB, CTX, { ...INPUT, file }, store)).toMatchObject({ status: "exists" });
    expect(addFile).not.toHaveBeenCalled();
  });

  test("a file that fails still adds them, and says so", async () => {
    addCandidate.mockResolvedValue(ADDED);
    addFile.mockRejectedValue(new Error("storage down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await addReferral(DB, CTX, { ...INPUT, file }, store)).toMatchObject({ ok: true, status: "added_no_file" });
    logTouch.mockRejectedValue(new Error("db down"));
    expect(await addReferral(DB, CTX, { ...INPUT, file }, store)).toMatchObject({ ok: true, status: "added_no_extras" });
  });
});

describe("referralFile", () => {
  const pdf = (name: string, size = 8) => new File([new Uint8Array(size).fill(0x25).map((b, i) => [0x25, 0x50, 0x44, 0x46, 0x2d][i] ?? b)], name, { type: "application/pdf" });

  test("no file picked is no file", async () => {
    expect(await referralFile(null)).toBeNull();
    expect(await referralFile(new File([], ""))).toBeNull();
  });

  test("takes the type from the extension and cleans the name for core", async () => {
    expect(await referralFile(pdf("[Jane] CV #2.PDF"))).toMatchObject({ filename: "Jane CV 2.pdf", contentType: "application/pdf" });
    expect(await referralFile(pdf("###.pdf"))).toMatchObject({ filename: "Resume.pdf" });
  });

  test("refuses what core would, before anyone is added", async () => {
    expect(await referralFile(pdf("cv.exe"))).toBe("invalid");
    expect(await referralFile(pdf("noextension"))).toBe("invalid");
    expect(await referralFile(new File(["not a pdf"], "cv.pdf"))).toBe("invalid");
    expect(await referralFile(pdf("big.pdf", 3 * 1024 * 1024 + 1))).toBe("invalid");
  });
});
