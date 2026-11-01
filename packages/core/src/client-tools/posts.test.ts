import { describe, expect, test } from "vitest";

import { FakeSupabase } from "../test-helpers/fake-supabase.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import {
  buildQuestions, createJobPost, jobPostUrl, listApplicationsInbox, listJobPosts, setJobPostStatus, updateJobPost,
} from "./posts.js";
import { getCandidate } from "./reads.js";

/**
 * What the job-post tools add on top of the policies and the
 * validate_job_post trigger (pinned against real Postgres in the SQL suite's
 * section 25): the question list checked and shaped before any query, a
 * sentence before a refused write, ids and slugs made in code and never read
 * back, the audit claim around an allowed write, and no claim for a no-op.
 */

const ctx = (accessLevel: ClientToolCtx["accessLevel"] = "admin"): ClientToolCtx => ({
  actorId: "actor-1", orgId: "org-1", accessLevel, source: "claude",
});
const rpcs = (fake: FakeSupabase) => fake.calls.filter((c) => c.op === "rpc").map((c) => c.table);

async function refusal(promise: Promise<unknown>): Promise<ClientToolError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ClientToolError);
  return err as ClientToolError;
}

const JOB = { id: "6c1f0b4e-0000-4000-8000-0000000000a1", title: "Founding engineer", status: "open" };
// As jsonb hands them back: keys in its own order.
const STORED = [
  { id: "name", type: "name", label: "Full name", required: true },
  { id: "email", type: "email", label: "Email", required: true },
  { id: "q_why12", type: "long_text", label: "Why us?", required: true },
];
const POST = {
  id: "6c1f0b4e-0000-4000-8000-0000000000b1", role_id: JOB.id, title: "Founding Engineer", location: "Remote",
  description: "Build it.", status: "draft", slug: "a".repeat(32), questions: STORED,
  published_at: null, closed_at: null, updated_at: "2026-10-15T00:00:00+00:00", roles: { status: "open" },
};

describe("buildQuestions", () => {
  test("the default form: name and email, then optional phone, LinkedIn and resume link", () => {
    expect(buildQuestions(undefined).map((q) => [q.questionId, q.required])).toEqual([
      ["name", true], ["email", true], ["phone", false], ["linkedin", false], ["resume", false],
    ]);
  });

  test("name and email lead whatever is passed, and are always required", () => {
    const qs = buildQuestions([{ type: "short_text", label: "Pronouns" }, { type: "email", label: "Work email" }]);
    expect(qs.map((q) => q.type)).toEqual(["name", "email", "short_text"]);
    expect(qs[1]).toEqual({ questionId: "email", type: "email", label: "Work email", required: true });
    expect(qs[2].questionId).toMatch(/^q_[a-z0-9]{4,32}$/);
    expect(() => buildQuestions([{ type: "email", required: false }])).toThrow(/always required/);
  });

  test("refusals: a custom question without a label, a built-in twice, a bad select, options elsewhere", () => {
    expect(() => buildQuestions([{ type: "long_text" }])).toThrow(/label/);
    expect(() => buildQuestions([{ type: "phone" }, { type: "phone" }])).toThrow(/appears once/);
    expect(() => buildQuestions([{ type: "select", label: "Start", options: ["Now"] }])).toThrow(/2 to 50 options/);
    expect(() => buildQuestions([{ type: "select", label: "Start", options: ["Now", "now ", "Now"] }])).toThrow(/different/);
    expect(() => buildQuestions([{ type: "yes_no", label: "OK?", options: ["a", "b"] }])).toThrow(/Only a select/);
    expect(() => buildQuestions([{ type: "nope" as never, label: "x" }])).toThrow(/type is one of/);
    expect(() => buildQuestions([{ type: "short_text", label: "x", questionId: "Q_BAD" }])).toThrow(/question_id/);
  });

  test("an edit keeps a custom question's id when it comes back under the same label", () => {
    const existing = buildQuestions([{ type: "long_text", label: "Why us?", questionId: "q_why12" }]);
    const again = buildQuestions([{ type: "long_text", label: "why US?" }, { type: "yes_no", label: "Visa?" }], existing);
    expect(again[2].questionId).toBe("q_why12");
    expect(again[3].questionId).not.toBe("q_why12");
  });
});

describe("jobPostUrl", () => {
  test("built from the public origin, or null without one", () => {
    expect(jobPostUrl("https://internal.test/", "abc")).toBe("https://internal.test/jobs/abc");
    expect(jobPostUrl(null, "abc")).toBeNull();
  });
});

describe("createJobPost", () => {
  test("an interviewer, or a bad question list, is refused without a query", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(createJobPost(fake.asDb(), ctx("limited"), { jobId: JOB.id }))).code).toBe("forbidden");
    expect((await refusal(createJobPost(fake.asDb(), ctx(), { jobId: JOB.id, questions: [{ type: "short_text" }] }))).code).toBe("invalid");
    expect(fake.calls).toEqual([]);
  });

  test("someone who cannot manage the job is told so, and nothing is claimed", async () => {
    const fake = new FakeSupabase([{ data: JOB }, { data: false }]);
    expect((await refusal(createJobPost(fake.asDb(), ctx("elevated"), { jobId: JOB.id }))).code).toBe("forbidden");
    expect(rpcs(fake)).toEqual(["can_on_role"]);
  });

  test("a draft under the job's title, id and slug made in code, not read back, the description kept out of the audit row", async () => {
    const fake = new FakeSupabase([{ data: JOB }, { data: true }, { data: "audit-1" }, { data: null }, { data: null }]);
    const r = await createJobPost(fake.asDb(), ctx("elevated"), { jobId: JOB.id, description: "  Secret sauce. ", location: " Remote " });
    expect(r).toMatchObject({ status: "draft", title: "Founding engineer" });
    expect(r.slug).toMatch(/^[a-f0-9]{32}$/);
    const insert = fake.calls.find((c) => c.op === "insert");
    expect(insert).toMatchObject({
      table: "job_posts",
      args: { id: r.postId, slug: r.slug, role_id: JOB.id, title: "Founding engineer", location: "Remote", description: "Secret sauce." },
      terminal: "await",
    });
    expect((insert!.args as { questions: Array<{ id: string }> }).questions.map((q) => q.id)).toEqual(["name", "email", "phone", "linkedin", "resume"]);
    const finish = fake.calls.at(-1)!;
    expect(finish).toMatchObject({ table: "client_finish_write", args: { p_entity_id: r.postId, p_keep: true } });
    expect(JSON.stringify(finish.args)).not.toContain("Secret sauce");
  });

  test("the trigger's refusal comes back as a sentence, and the claim is given back", async () => {
    const fake = new FakeSupabase([
      { data: JOB }, { data: true }, { data: "audit-1" }, { error: { code: "22023", message: "a job post starts as a draft" } }, { data: null },
    ]);
    expect((await refusal(createJobPost(fake.asDb(), ctx(), { jobId: JOB.id }))).message).toMatch(/Not saved: a job post starts as a draft/);
    expect(fake.calls.at(-1)).toMatchObject({ table: "client_finish_write", args: { p_keep: false } });
  });
});

describe("updateJobPost", () => {
  test("the same questions in another key order change nothing and claim nothing", async () => {
    const fake = new FakeSupabase([{ data: POST }, { data: true }]);
    const r = await updateJobPost(fake.asDb(), ctx(), {
      postId: POST.id, title: "Founding Engineer",
      questions: [{ type: "long_text", label: "Why us?", required: true }],
    });
    expect(r).toEqual({ outcome: "unchanged", changed: [] });
    expect(rpcs(fake)).toEqual(["can_on_role"]);
  });

  test("a change is conditional on the version read, and audited without the description", async () => {
    const fake = new FakeSupabase([{ data: POST }, { data: true }, { data: "audit-1" }, { data: [{ id: POST.id }] }, { data: null }]);
    const r = await updateJobPost(fake.asDb(), ctx(), { postId: POST.id, description: "New words.", location: "NYC" });
    expect(r).toEqual({ outcome: "updated", changed: ["location", "description"] });
    const update = fake.calls.find((c) => c.op === "update")!;
    expect(update.filters).toEqual([
      { method: "eq", column: "id", value: POST.id }, { method: "eq", column: "updated_at", value: POST.updated_at },
    ]);
    expect(fake.calls.at(-1)).toMatchObject({ args: { p_before: { location: "Remote" }, p_after: { location: "NYC" }, p_keep: true } });
  });

  test("an unknown post is not found", async () => {
    const fake = new FakeSupabase([{ data: null }]);
    expect((await refusal(updateJobPost(fake.asDb(), ctx(), { postId: POST.id, title: "x" }))).code).toBe("not_found");
  });
});

describe("setJobPostStatus", () => {
  test("going live needs the job open", async () => {
    const fake = new FakeSupabase([{ data: { ...POST, roles: { status: "paused" } } }, { data: true }]);
    expect((await refusal(setJobPostStatus(fake.asDb(), ctx(), { postId: POST.id, status: "live" }))).message).toMatch(/paused.*update_job/);
    expect(rpcs(fake)).toEqual(["can_on_role"]);
  });

  test("the status it already has changes nothing", async () => {
    const fake = new FakeSupabase([{ data: { ...POST, status: "live" } }, { data: true }]);
    expect(await setJobPostStatus(fake.asDb(), ctx(), { postId: POST.id, status: "live" })).toMatchObject({ outcome: "unchanged" });
  });

  test("a move is conditional on the status read, so two closes record one", async () => {
    const fake = new FakeSupabase([{ data: { ...POST, status: "live" } }, { data: true }, { data: "audit-1" }, { data: [] }, { data: null }]);
    expect(await setJobPostStatus(fake.asDb(), ctx(), { postId: POST.id, status: "closed" })).toEqual({
      outcome: "changed_since", status: "live", slug: POST.slug,
    });
    expect(fake.calls.find((c) => c.op === "update")).toMatchObject({
      args: { status: "closed" },
      filters: [{ method: "eq", column: "id", value: POST.id }, { method: "eq", column: "status", value: "live" }],
    });
    expect(fake.calls.at(-1)).toMatchObject({ args: { p_keep: false } });
  });
});

describe("listJobPosts", () => {
  test("each post with its questions, whether it takes applications, and how many came in", async () => {
    const fake = new FakeSupabase([
      { data: [{ ...POST, status: "live", roles: { title: JOB.title, status: "open" }, application_answers: [{ count: 4 }] }] },
      { data: [{ ...POST, status: "live", roles: { title: JOB.title, status: "paused" }, application_answers: [{ count: 0 }] }] },
    ]);
    const [p] = await listJobPosts(fake.asDb(), ctx(), { jobId: JOB.id });
    expect(p).toMatchObject({ postId: POST.id, jobTitle: JOB.title, accepting: true, applications: 4, slug: POST.slug });
    expect(p.questions[2]).toEqual({ questionId: "q_why12", type: "long_text", label: "Why us?", required: true });
    expect(fake.calls[0].filters).toEqual([{ method: "eq", column: "role_id", value: JOB.id }]);
    const [i] = await listJobPosts(fake.asDb(), ctx("limited"));
    expect(i).toMatchObject({ accepting: false, applications: null });
  });
});

const ANSWER_ROW = {
  application_id: "app-1", job_post_id: POST.id, submitted_at: "2026-10-15T01:00:00Z",
  answers: [{ id: "q_why12", type: "long_text", label: "Why us?", value: "Hard problems." }],
};

describe("listApplicationsInbox", () => {
  test("an interviewer is refused without a query", async () => {
    const fake = new FakeSupabase();
    expect((await refusal(listApplicationsInbox(fake.asDb(), ctx("limited")))).code).toBe("forbidden");
    expect(fake.calls).toEqual([]);
  });

  test("applicants and referrals at the first stage, newest first, with their answers", async () => {
    const fake = new FakeSupabase([
      { data: { id: JOB.id } },
      {
        data: [{
          id: "app-1", person_id: "p-1", role_id: JOB.id, stage: "sourced", source: "job_board", source_detail: "Founding Engineer",
          created_at: "2026-10-15T01:00:00Z", people: { display_name: "Nia", email: "nia@x.test", linkedin_url: null }, roles: { title: JOB.title },
        }, {
          id: "app-2", person_id: "p-2", role_id: JOB.id, stage: "sourced", source: "referral", source_detail: "Priya Shah",
          created_at: "2026-10-14T01:00:00Z", people: { display_name: "Rita", email: null, linkedin_url: "https://linkedin.com/in/rita" }, roles: { title: JOB.title },
        }],
      },
      { data: [ANSWER_ROW] },
    ]);
    const [e, referral] = await listApplicationsInbox(fake.asDb(), ctx("elevated"), { jobId: JOB.id });
    expect(e).toEqual({
      applicationId: "app-1", candidateId: "p-1", name: "Nia", email: "nia@x.test", jobId: JOB.id, jobTitle: JOB.title,
      stage: "sourced", source: "job_board", post: "Founding Engineer", referredBy: null, linkedinUrl: null, appliedAt: "2026-10-15T01:00:00Z",
      answers: [{ questionId: "q_why12", type: "long_text", label: "Why us?", value: "Hard problems." }],
    });
    // A referral's source_detail is who referred them, never a post.
    expect(referral).toMatchObject({ source: "referral", post: null, referredBy: "Priya Shah", linkedinUrl: "https://linkedin.com/in/rita", answers: [] });
    expect(fake.calls[1].filters).toEqual([
      { method: "in", column: "source", value: ["job_board", "referral"] },
      { method: "in", column: "stage", value: ["applied", "sourced"] },
      { method: "eq", column: "role_id", value: JOB.id },
    ]);
  });

  test("a job the member cannot see is not found", async () => {
    const fake = new FakeSupabase([{ data: null }]);
    expect((await refusal(listApplicationsInbox(fake.asDb(), ctx(), { jobId: JOB.id }))).code).toBe("not_found");
  });
});

describe("getCandidate", () => {
  test("a job-board application carries its answers; others ask for none", async () => {
    const fake = new FakeSupabase([
      { data: { id: "p-1", display_name: "Nia", current_title: null, current_company: null, email: "nia@x.test", location: null, linkedin_url: null, summary: null } },
      {
        data: [
          { id: "app-1", role_id: JOB.id, stage: "sourced", source: "job_board", source_detail: "Founding Engineer", next_action: null,
            next_action_due: null, last_touch_at: "2026-10-15T01:00:00Z", rejection_note: null, roles: { title: JOB.title }, rejection_reasons: null },
          { id: "app-2", role_id: "r-2", stage: "screening", source: "referral", source_detail: null, next_action: null,
            next_action_due: null, last_touch_at: "2026-10-14T01:00:00Z", rejection_note: null, roles: { title: "Designer" }, rejection_reasons: null },
        ],
      },
      { data: [] }, // offers
      { data: [ANSWER_ROW] },
      { data: [] }, // tags
      { data: [] }, // notes
      { data: [] }, // files
      // The rest of the card (emails, custom fields, pools), none of which this test is about.
      ...Array.from({ length: 10 }, () => ({ data: [] })),
    ]);
    const c = await getCandidate(fake.asDb(), ctx(), "p-1");
    expect(c.applications[0].answers).toEqual({
      postId: POST.id, submittedAt: "2026-10-15T01:00:00Z",
      answers: [{ questionId: "q_why12", type: "long_text", label: "Why us?", value: "Hard problems." }],
    });
    expect(c.applications[1].answers).toBeNull();
    expect(fake.calls.find((c) => c.table === "application_answers")?.filters).toEqual([
      { method: "in", column: "application_id", value: ["app-1"] },
    ]);
  });
});
