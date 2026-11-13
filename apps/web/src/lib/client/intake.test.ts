import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { FakeSupabase } from "../../../../../packages/core/src/test-helpers/fake-supabase";
import { addApplicant, readAddedBy, type IntakeInput } from "./intake";

const { addCandidate, addFile, logTouch } = vi.hoisted(() => ({ addCandidate: vi.fn(), addFile: vi.fn(), logTouch: vi.fn() }));

vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, addCandidate, addFile } };
});
vi.mock("@tacit/core", async (original) => ({ ...(await original<typeof import("@tacit/core")>()), logTouch }));

const CTX: clientTools.ClientToolCtx = { actorId: "actor-1", orgId: "org-1", accessLevel: "admin", source: "dashboard" };
const DB = {} as Db;
const INPUT: IntakeInput = { jobId: "role-1", name: "Maya Chen", email: "maya@acme.test", linkedinUrl: "linkedin.com/in/maya-chen", note: "Met her at the infra meetup" };
const ADDED = { outcome: "added", applicationId: "app-1", candidateId: "person-1", newCandidate: true, stage: "sourced" };

beforeEach(() => {
  addCandidate.mockReset();
  addFile.mockReset();
  logTouch.mockReset();
});

describe("addApplicant", () => {
  test("is clientTools' audited add, sourced, with nothing in the source detail and the words as the note", async () => {
    addCandidate.mockResolvedValue(ADDED);
    expect(await addApplicant(DB, CTX, INPUT)).toEqual({ ok: true, status: "added", applicationId: "app-1", personId: "person-1" });
    expect(addCandidate).toHaveBeenCalledWith(DB, CTX, {
      jobId: "role-1", name: "Maya Chen", email: "maya@acme.test", linkedinUrl: "linkedin.com/in/maya-chen", source: "sourced", sourceDetail: null,
    });
    expect(logTouch).toHaveBeenCalledWith(DB, { applicationId: "app-1", actorId: "actor-1", note: "Met her at the infra meetup" });
  });

  test("someone already in the job keeps what they had: no note, no file", async () => {
    addCandidate.mockResolvedValue({ ...ADDED, outcome: "already_in_pipeline", newCandidate: false, stage: "interviewing" });
    const file = { filename: "cv.pdf", contentType: "application/pdf", contentBase64: "JVBERi0=" };
    expect(await addApplicant(DB, CTX, { ...INPUT, file })).toEqual({ ok: true, status: "exists", applicationId: "app-1", personId: "person-1" });
    expect(logTouch).not.toHaveBeenCalled();
    expect(addFile).not.toHaveBeenCalled();
  });

  test("the resume goes on their file", async () => {
    addCandidate.mockResolvedValue(ADDED);
    const file = { filename: "cv.pdf", contentType: "application/pdf", contentBase64: "JVBERi0=" };
    const store = { put: vi.fn(), signedUrl: vi.fn() };
    expect(await addApplicant(DB, CTX, { ...INPUT, file }, store)).toMatchObject({ ok: true, status: "added" });
    expect(addFile).toHaveBeenCalledWith(DB, CTX, store, { candidateId: "person-1", kind: "resume", ...file });
  });

  test.each(["name", "email", "linkedin"])("an invalid %s points at its field", async (field) => {
    addCandidate.mockRejectedValue(new clientTools.ClientToolError("invalid", "That needs it.", field));
    expect(await addApplicant(DB, CTX, INPUT)).toEqual({ ok: false, error: `invalid_${field}` });
  });

  test("forbidden comes back as its code; anything else throws", async () => {
    addCandidate.mockRejectedValue(new clientTools.ClientToolError("forbidden", "No."));
    expect(await addApplicant(DB, CTX, INPUT)).toEqual({ ok: false, error: "forbidden" });
    addCandidate.mockRejectedValue(new Error("connection reset"));
    await expect(addApplicant(DB, CTX, INPUT)).rejects.toThrow("connection reset");
  });
});

describe("readAddedBy", () => {
  test("names each application's adder from the team, and leaves out who it can't name", async () => {
    const fake = new FakeSupabase([
      { data: [{ id: "app-1", added_by_actor_id: "actor-1" }, { id: "app-2", added_by_actor_id: null }, { id: "app-3", added_by_actor_id: "gone" }] },
      { data: [{ id: "actor-1", display_name: "Ryan Huang" }] },
    ]);
    expect(await readAddedBy(fake.asDb(), ["app-1", "app-2", "app-3"])).toEqual(new Map([["app-1", "Ryan Huang"]]));
  });

  test("nothing asked, nothing read", async () => {
    const fake = new FakeSupabase();
    expect(await readAddedBy(fake.asDb(), [])).toEqual(new Map());
    expect(fake.calls).toEqual([]);
  });
});
