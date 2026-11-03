import { describe, expect, test } from "vitest";
import { clientTools } from "@tacit-ats/core";
import {
  CLOSE_REASON_MAX, JOB_TITLE_MAX, OPENINGS_ADD_MAX, jobSettingsRefusal, parseAddOpenings, parseCloseOpening, parseJobForm,
} from "./job-settings-rules";

const JOB = "e6a00000-0000-4000-8000-0000000000a1";
const OPENING = "e6a00000-0000-4000-8000-0000000000d1";
const CTX: clientTools.ClientToolCtx = { actorId: "a1", orgId: "o1", accessLevel: "admin", source: "dashboard" };
// Nothing below reaches the database: core refuses the input first.
const NO_DB = {} as Parameters<typeof clientTools.updateJob>[0];

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};
const job = (fields: Record<string, string>) => form({ jobId: JOB, "was:title": "Engineer", "was:status": "open", title: "Engineer", status: "open", ...fields });

/** Core's sentence for an input it refuses before reading anything. */
async function refusal(write: () => Promise<unknown>) {
  try {
    await write();
  } catch (err) {
    if (err instanceof clientTools.ClientToolError) return jobSettingsRefusal(err.code, err.message);
    throw err;
  }
  throw new Error("core did not refuse");
}

describe("the limits", () => {
  test("are core's", () => {
    expect(OPENINGS_ADD_MAX).toBe(clientTools.OPENINGS_ADD_MAX);
    expect(CLOSE_REASON_MAX).toBe(clientTools.CLOSE_REASON_MAX);
  });
});

describe("parseJobForm", () => {
  test("a form with no job id is dropped", () => {
    expect(parseJobForm(job({ jobId: "nope" }))).toEqual({ ok: false, error: null });
  });

  test("only what changed is sent", () => {
    expect(parseJobForm(job({}))).toMatchObject({ ok: true, change: {} });
    expect(parseJobForm(job({ title: "  Staff   engineer " }))).toMatchObject({ ok: true, jobId: JOB, change: { title: "Staff engineer" } });
    expect(parseJobForm(job({ status: "paused" }))).toMatchObject({ ok: true, change: { status: "paused", expectedStatus: "open" } });
    // A title alone carries no status at all, not even the one it was read on.
    expect(parseJobForm(job({ "was:status": "paused", status: "paused", title: "Lead" }))).toEqual({
      ok: true, jobId: JOB, change: { title: "Lead" }, draft: { title: "Lead", status: "paused" },
    });
    // Spacing alone is no rename.
    expect(parseJobForm(job({ title: " Engineer\n" }))).toMatchObject({ ok: true, change: {} });
  });

  test("a title is needed, and fits", () => {
    expect(parseJobForm(job({ title: "  " }))).toEqual({ ok: false, error: "title_required", draft: { title: "  ", status: "open" } });
    expect(parseJobForm(job({ title: "x".repeat(JOB_TITLE_MAX + 1) }))).toMatchObject({ ok: false, error: "title_too_long" });
    expect(parseJobForm(job({ title: "x".repeat(JOB_TITLE_MAX) }))).toMatchObject({ ok: true });
  });

  test("stray characters become spaces", () => {
    expect(parseJobForm(job({ title: "Eng\0ineer\u0007 lead" }))).toMatchObject({ ok: true, change: { title: "Eng ineer lead" } });
  });

  test("filled and pending approval are left alone, never picked", () => {
    expect(parseJobForm(job({ "was:status": "filled", status: "filled" }))).toMatchObject({ ok: true, change: {} });
    expect(parseJobForm(job({ status: "filled" }))).toMatchObject({ ok: false, error: "bad_status" });
    expect(parseJobForm(job({ status: "pending_approval" }))).toMatchObject({ ok: false, error: "bad_status" });
    expect(parseJobForm(job({ "was:status": "filled", status: "open" }))).toMatchObject({ ok: true, change: { status: "open" } });
  });
});

describe("parseAddOpenings", () => {
  test("a whole number from 1 to the limit", () => {
    expect(parseAddOpenings(form({ jobId: JOB, count: " 3 " }))).toEqual({ ok: true, jobId: JOB, count: 3 });
    expect(parseAddOpenings(form({ jobId: JOB, count: String(OPENINGS_ADD_MAX) }))).toMatchObject({ ok: true });
    for (const count of ["0", "", "-1", "1.5", "1e1", String(OPENINGS_ADD_MAX + 1), "abc"]) {
      expect(parseAddOpenings(form({ jobId: JOB, count }))).toMatchObject({ ok: false, error: "bad_count" });
    }
  });

  test("no job id, nothing", () => {
    expect(parseAddOpenings(form({ count: "1" }))).toEqual({ ok: false, error: null });
  });
});

describe("parseCloseOpening", () => {
  test("a reason, tidied", () => {
    expect(parseCloseOpening(form({ openingId: OPENING, reason: " Budget\n moved " }))).toEqual({ ok: true, openingId: OPENING, reason: "Budget moved" });
  });

  test("a refusal keeps the reason and which opening", () => {
    expect(parseCloseOpening(form({ openingId: OPENING, reason: " " }))).toEqual({ ok: false, error: "reason_required", draft: { count: "", reason: " ", openingId: OPENING } });
    expect(parseCloseOpening(form({ openingId: OPENING, reason: "x".repeat(CLOSE_REASON_MAX + 1) }))).toMatchObject({ ok: false, error: "reason_too_long" });
    expect(parseCloseOpening(form({ openingId: "x", reason: "Budget" }))).toEqual({ ok: false, error: null });
  });
});

describe("jobSettingsRefusal", () => {
  test("core's own sentences", async () => {
    expect(await refusal(() => clientTools.updateJob(NO_DB, CTX, { jobId: JOB, title: " " }))).toBe("title_required");
    expect(await refusal(() => clientTools.updateJob(NO_DB, CTX, { jobId: JOB, title: "x".repeat(201) }))).toBe("title_too_long");
    expect(await refusal(() => clientTools.updateJob(NO_DB, CTX, { jobId: JOB, status: "gone" as "open" }))).toBe("bad_status");
    expect(await refusal(() => clientTools.addOpenings(NO_DB, CTX, { jobId: JOB, count: 0 }))).toBe("bad_count");
    expect(await refusal(() => clientTools.closeOpening(NO_DB, CTX, { openingId: OPENING, reason: " " }))).toBe("reason_required");
    expect(await refusal(() => clientTools.closeOpening(NO_DB, CTX, { openingId: OPENING, reason: "x".repeat(201) }))).toBe("reason_too_long");
    // An interviewer is refused before anything is read.
    expect(await refusal(() => clientTools.addOpenings(NO_DB, { ...CTX, accessLevel: "limited" }, { jobId: JOB, count: 1 }))).toBe("forbidden");
  });

  test("the ones that need the database, by their sentences", () => {
    expect(jobSettingsRefusal("invalid", "Not saved: opening this job needs an approval. request_approval with the job_id asks for it.")).toBe("needs_approval");
    expect(jobSettingsRefusal("invalid", "That opening is filled. Moving its hire out of hired opens it again; then it can be closed.")).toBe("opening_filled");
    expect(jobSettingsRefusal("invalid", "Not saved: the job's status changed since it was read (it was open, it is now paused). Read the job again and decide from there.")).toBe("status_changed");
    expect(jobSettingsRefusal("not_found", "No job with that id that you can see.")).toBe("not_found");
    expect(jobSettingsRefusal("rate_limited", "You have made 300 changes")).toBe("rate_limited");
    expect(jobSettingsRefusal("invalid", "Something new")).toBe("failed");
    expect(jobSettingsRefusal("other", "anything")).toBe("failed");
  });
});
