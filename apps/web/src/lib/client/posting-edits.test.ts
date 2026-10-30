import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import type { PostingDraft } from "./posting-edit-rules";
import { createRole, savePosting, type SaveInput } from "./posting-edits";

const tools = vi.hoisted(() => ({
  createJob: vi.fn(),
  createJobPost: vi.fn(),
  updateJobPost: vi.fn(),
  updateJob: vi.fn(),
  setJobPostStatus: vi.fn(),
  setInterviewPlan: vi.fn(),
  listJobPosts: vi.fn(),
}));

vi.mock("@tacit-ats/core", async (original) => {
  const real = await original<typeof import("@tacit-ats/core")>();
  return { ...real, clientTools: { ...real.clientTools, ...tools } };
});

const CTX: clientTools.ClientToolCtx = { actorId: "actor-1", orgId: "org-1", accessLevel: "admin", source: "dashboard" };
const DB = {} as Db;
const DRAFT: PostingDraft = {
  title: "Engineer",
  location: "Paris",
  departmentId: "dept-1",
  description: "Hello",
  steps: ["Screen"],
  questions: [{ type: "name", required: true }, { type: "email", required: true }],
};
const POST = { title: "Engineer", location: "Paris", description: "Hello", questions: DRAFT.questions };
const INPUT: SaveInput = { jobId: "job-1", postId: "post-1", draft: DRAFT, seenUpdatedAt: "v1", overwrite: false, status: null };
const PLAN = { outcome: "unchanged", steps: ["Screen"], removed: [], keptOnInterviews: [] };
const refused = (code: "forbidden" | "rate_limited" | "not_found" | "invalid") => new clientTools.ClientToolError(code, "No.");

beforeEach(() => {
  Object.values(tools).forEach((fn) => fn.mockReset());
  tools.createJob.mockResolvedValue({ jobId: "job-1" });
  tools.createJobPost.mockResolvedValue({ postId: "post-1" });
  tools.updateJobPost.mockResolvedValue({ outcome: "updated", changed: ["title"] });
  tools.updateJob.mockResolvedValue({ outcome: "unchanged", changed: [] });
  tools.setJobPostStatus.mockResolvedValue({ outcome: "updated", status: "live", slug: "s" });
  tools.setInterviewPlan.mockResolvedValue(PLAN);
  tools.listJobPosts.mockResolvedValue([{ postId: "post-1", updatedAt: "v1" }]);
});

describe("createRole", () => {
  test("the job, its post, its steps, then live, on the member's own client and context", async () => {
    expect(await createRole(DB, CTX, DRAFT, { publish: true })).toEqual({ ok: true, jobId: "job-1", postId: "post-1", notice: "posted", keptOnInterviews: 0 });
    expect(tools.createJob).toHaveBeenCalledWith(DB, CTX, { title: "Engineer", location: "Paris", department: "dept-1" });
    expect(tools.createJobPost).toHaveBeenCalledWith(DB, CTX, { jobId: "job-1", ...POST });
    expect(tools.setInterviewPlan).toHaveBeenCalledWith(DB, CTX, { jobId: "job-1", steps: ["Screen"] });
    expect(tools.setJobPostStatus).toHaveBeenCalledWith(DB, CTX, { postId: "post-1", status: "live" });
  });

  test("the description is the post's: it never reaches the job, whose audit row would keep it", async () => {
    await createRole(DB, CTX, DRAFT, { publish: false });
    expect(tools.createJob.mock.calls[0][2]).not.toHaveProperty("description");
  });

  test("a draft stays a draft", async () => {
    expect(await createRole(DB, CTX, DRAFT, { publish: false })).toMatchObject({ ok: true, notice: "drafted" });
    expect(tools.setJobPostStatus).not.toHaveBeenCalled();
  });

  test("no steps, no plan write", async () => {
    await createRole(DB, CTX, { ...DRAFT, steps: [] }, { publish: false });
    expect(tools.setInterviewPlan).not.toHaveBeenCalled();
  });

  test("someone not an admin is refused before anything exists", async () => {
    tools.createJob.mockRejectedValue(refused("forbidden"));
    expect(await createRole(DB, CTX, DRAFT, { publish: true })).toEqual({ ok: false, error: "forbidden", jobId: undefined, postId: undefined });
    expect(tools.createJobPost).not.toHaveBeenCalled();
  });

  test("stopping partway says how far it got, for the next save to carry on", async () => {
    tools.createJobPost.mockRejectedValue(refused("rate_limited"));
    expect(await createRole(DB, CTX, DRAFT, { publish: true })).toEqual({ ok: false, error: "rate_limited", jobId: "job-1", postId: undefined });
    tools.createJobPost.mockResolvedValue({ postId: "post-1" });
    tools.setJobPostStatus.mockRejectedValue(refused("invalid"));
    expect(await createRole(DB, CTX, DRAFT, { publish: true })).toEqual({ ok: false, error: "job_not_open", jobId: "job-1", postId: "post-1" });
  });

  test("a failed request after the job exists comes back as how far it got, not a throw", async () => {
    tools.createJobPost.mockRejectedValue(new Error("connection reset"));
    expect(await createRole(DB, CTX, DRAFT, { publish: true })).toEqual({ ok: false, error: "failed", jobId: "job-1", postId: undefined });
  });

  test("a failed request before anything exists stays a failure", async () => {
    tools.createJob.mockRejectedValue(new Error("connection reset"));
    await expect(createRole(DB, CTX, DRAFT, { publish: true })).rejects.toThrow("connection reset");
  });
});

describe("savePosting", () => {
  test("the post, the job's department, the steps, on the same client", async () => {
    expect(await savePosting(DB, CTX, INPUT)).toEqual({ ok: true, jobId: "job-1", postId: "post-1", notice: "saved", keptOnInterviews: 0 });
    expect(tools.updateJobPost).toHaveBeenCalledWith(DB, CTX, { postId: "post-1", ...POST });
    expect(tools.updateJob).toHaveBeenCalledWith(DB, CTX, { jobId: "job-1", department: "dept-1" });
    expect(tools.setInterviewPlan).toHaveBeenCalledWith(DB, CTX, { jobId: "job-1", steps: ["Screen"] });
    expect(tools.setJobPostStatus).not.toHaveBeenCalled();
  });

  test("a job's first post is created, with the job's id", async () => {
    expect(await savePosting(DB, CTX, { ...INPUT, postId: null, seenUpdatedAt: null })).toMatchObject({ ok: true, postId: "post-1" });
    expect(tools.createJobPost).toHaveBeenCalledWith(DB, CTX, { jobId: "job-1", ...POST });
    expect(tools.updateJobPost).not.toHaveBeenCalled();
  });

  test.each([["live", "published"], ["closed", "closed"]] as const)("%s saves first, then moves", async (status, notice) => {
    expect(await savePosting(DB, CTX, { ...INPUT, status })).toMatchObject({ ok: true, notice });
    expect(tools.setJobPostStatus).toHaveBeenCalledWith(DB, CTX, { postId: "post-1", status });
    expect(tools.updateJobPost.mock.invocationCallOrder[0]).toBeLessThan(tools.setJobPostStatus.mock.invocationCallOrder[0]);
  });

  test("a post someone else saved since is not overwritten, or published", async () => {
    tools.listJobPosts.mockResolvedValue([{ postId: "post-1", updatedAt: "v2" }]);
    expect(await savePosting(DB, CTX, { ...INPUT, status: "live" })).toMatchObject({ ok: false, error: "changed" });
    expect(tools.updateJobPost).not.toHaveBeenCalled();
    expect(tools.setJobPostStatus).not.toHaveBeenCalled();
  });

  test("the member can choose to save over it", async () => {
    tools.listJobPosts.mockResolvedValue([{ postId: "post-1", updatedAt: "v2" }]);
    expect(await savePosting(DB, CTX, { ...INPUT, overwrite: true })).toMatchObject({ ok: true });
    expect(tools.updateJobPost).toHaveBeenCalled();
  });

  test("a race lost inside the write is the same answer, and stops the rest", async () => {
    tools.updateJobPost.mockResolvedValue({ outcome: "changed_since", changed: [] });
    expect(await savePosting(DB, CTX, INPUT)).toMatchObject({ ok: false, error: "changed" });
    expect(tools.setInterviewPlan).not.toHaveBeenCalled();
  });

  test("a post that is gone, or belongs to another job, is not_found", async () => {
    tools.listJobPosts.mockResolvedValue([]);
    expect(await savePosting(DB, CTX, INPUT)).toMatchObject({ ok: false, error: "not_found" });
    expect(tools.updateJobPost).not.toHaveBeenCalled();
  });

  test("a job that is not open comes back as such, after the save", async () => {
    tools.setJobPostStatus.mockRejectedValue(refused("invalid"));
    expect(await savePosting(DB, CTX, { ...INPUT, status: "live" })).toEqual({ ok: false, error: "job_not_open", jobId: "job-1", postId: "post-1" });
  });

  test("what an interview keeps is counted", async () => {
    tools.setInterviewPlan.mockResolvedValue({ ...PLAN, keptOnInterviews: [{ step: "A", interviews: 2, scheduled: 1 }, { step: "B", interviews: 1, scheduled: 0 }] });
    expect(await savePosting(DB, CTX, INPUT)).toMatchObject({ ok: true, keptOnInterviews: 3 });
  });

  test.each([
    ["updateJobPost", "invalid", "invalid_post"],
    ["updateJob", "invalid", "invalid_department"],
    ["setInterviewPlan", "invalid", "invalid_steps"],
    ["updateJobPost", "forbidden", "forbidden"],
    ["updateJobPost", "rate_limited", "rate_limited"],
    ["setInterviewPlan", "not_found", "not_found"],
  ] as const)("%s refusing with %s is %s", async (tool, code, error) => {
    tools[tool].mockRejectedValue(refused(code));
    expect(await savePosting(DB, CTX, INPUT)).toMatchObject({ ok: false, error });
  });

  test("anything else is a failure, not an answer", async () => {
    tools.updateJobPost.mockRejectedValue(new Error("connection reset"));
    await expect(savePosting(DB, CTX, INPUT)).rejects.toThrow("connection reset");
  });

  test("a failed request after a first post exists says which post, or the next save makes a second", async () => {
    tools.updateJob.mockRejectedValue(new Error("connection reset"));
    expect(await savePosting(DB, CTX, { ...INPUT, postId: null, seenUpdatedAt: null })).toEqual({ ok: false, error: "failed", jobId: "job-1", postId: "post-1" });
  });

  test("an interviewer is refused before anything is read back to them", async () => {
    tools.listJobPosts.mockResolvedValue([{ postId: "post-1", updatedAt: "v2" }]);
    expect(await savePosting(DB, { ...CTX, accessLevel: "limited" }, INPUT)).toMatchObject({ ok: false, error: "forbidden" });
    expect(tools.listJobPosts).not.toHaveBeenCalled();
  });

  describe("the job's half, which the post's version does not cover", () => {
    const stored = (department_id: string | null, interview_steps: unknown) =>
      ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { department_id, interview_steps }, error: null }) }) }) }) }) as unknown as Db;
    const seenJob = { steps: ["Screen"], departmentId: "dept-1" };

    test("what the member did not change is not written, whatever is there now", async () => {
      expect(await savePosting(stored("dept-2", ["Theirs"]), CTX, { ...INPUT, seenJob })).toMatchObject({ ok: true });
      expect(tools.updateJob).not.toHaveBeenCalled();
      expect(tools.setInterviewPlan).not.toHaveBeenCalled();
      expect(tools.updateJobPost).toHaveBeenCalled();
    });

    test("only the half they changed is written", async () => {
      const db = stored("dept-1", ["Screen"]);
      await savePosting(db, CTX, { ...INPUT, seenJob, draft: { ...DRAFT, steps: ["Screen", "Onsite"] } });
      expect(tools.updateJob).not.toHaveBeenCalled();
      expect(tools.setInterviewPlan).toHaveBeenCalledWith(db, CTX, { jobId: "job-1", steps: ["Screen", "Onsite"] });
    });

    test.each([
      ["steps", { steps: ["Mine"] }, stored("dept-1", ["Theirs"])],
      ["department", { departmentId: "dept-3" }, stored("dept-2", ["Screen"])],
    ])("a change over someone else's %s comes back changed, before the post is touched", async (_, change, db) => {
      expect(await savePosting(db, CTX, { ...INPUT, seenJob, draft: { ...DRAFT, ...change }, status: "live" })).toMatchObject({ ok: false, error: "changed" });
      expect(tools.updateJobPost).not.toHaveBeenCalled();
      expect(tools.setJobPostStatus).not.toHaveBeenCalled();
    });

    test("Save mine over it writes what they changed, and still nothing they did not", async () => {
      await savePosting(stored("dept-2", ["Theirs"]), CTX, { ...INPUT, seenJob, overwrite: true, draft: { ...DRAFT, steps: ["Mine"] } });
      expect(tools.setInterviewPlan).toHaveBeenCalled();
      expect(tools.updateJob).not.toHaveBeenCalled();
    });

    test("no record of what was seen, as when the job was only just made: both are written", async () => {
      await savePosting(DB, CTX, { ...INPUT, seenJob: null });
      expect(tools.updateJob).toHaveBeenCalled();
      expect(tools.setInterviewPlan).toHaveBeenCalled();
    });
  });
});
