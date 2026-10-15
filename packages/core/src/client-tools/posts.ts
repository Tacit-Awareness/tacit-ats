import type { Db, Json, TablesUpdate } from "@tacit/db";

import { withAudit } from "./audit.js";
import { ClientToolError, LIST_MAX, type ClientToolCtx } from "./context.js";

/**
 * Job posts and the applications they bring in (20261016150000_client_job_posts),
 * Greenhouse-style. Same rules as the rest of client-tools: the member's own
 * client, and the policies decide. A post is read by anyone who can see its
 * job and written by whoever can manage it; the database refuses a post that
 * does not start as a draft, a status move out of order, a changed slug and
 * a question list it could not ask, and the checks here only say so first, in
 * a sentence.
 *
 * The public half is not here: apps/web's /jobs/[slug] reads a live post
 * through job_post_public and submits through submit_job_application, both on
 * the publishable key. An applicant lands in the job at sourced with source
 * job_board, and listApplicationsInbox is where the team finds them.
 */

export const JOB_POST_STATUSES = ["draft", "live", "closed"] as const;
export type JobPostStatus = (typeof JOB_POST_STATUSES)[number];
export const QUESTION_TYPES = [
  "name", "email", "phone", "linkedin", "resume", "short_text", "long_text", "yes_no", "select",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
const BUILT_IN: readonly QuestionType[] = ["name", "email", "phone", "linkedin", "resume"];
const ALWAYS: readonly QuestionType[] = ["name", "email"];
const DEFAULT_LABELS: Partial<Record<QuestionType, string>> = {
  name: "Full name",
  email: "Email",
  phone: "Phone",
  linkedin: "LinkedIn profile",
  resume: "Link to your resume",
};
/** Where an applicant lands: the first stage. "applied" is listed for a pipeline that grows one. */
export const INBOX_STAGES = ["applied", "sourced"] as const;

export const QUESTIONS_MAX = 40;
export const QUESTION_LABEL_MAX = 300;
const OPTION_MAX = 200;
const OPTIONS_MIN = 2;
const OPTIONS_MAX = 50;
const POST_TITLE_MAX = 200;
const POST_LOCATION_MAX = 200;
const POST_DESCRIPTION_MAX = 20_000;
const CUSTOM_ID = /^q_[a-z0-9]{4,32}$/;

export type Question = {
  questionId: string;
  type: QuestionType;
  label: string;
  required: boolean;
  /** A select question's choices, in order. */
  options?: string[];
};

export type QuestionInput = {
  type: QuestionType;
  /** Defaults for the built-ins; a custom question needs one. */
  label?: string;
  required?: boolean;
  options?: string[];
  /** Keeps a custom question's id across edits; otherwise matched by label, or made. */
  questionId?: string;
};

type StoredQuestion = { id: string; type: QuestionType; label: string; required: boolean; options?: string[] };

const fromStored = (q: StoredQuestion): Question => ({
  questionId: q.id,
  type: q.type,
  label: q.label,
  required: q.required,
  ...(q.options ? { options: q.options } : {}),
});
const toStored = (q: Question): StoredQuestion => ({
  id: q.questionId,
  type: q.type,
  label: q.label,
  required: q.required,
  ...(q.options ? { options: q.options } : {}),
});

const newQuestionId = () => `q_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;

/**
 * The checked question list, name and email first. Undefined gives the
 * default form: name, email, and optional phone, LinkedIn and resume link.
 * `existing` lets an edit keep each custom question's id when it is passed
 * again by label.
 */
export function buildQuestions(input: QuestionInput[] | undefined, existing: Question[] = []): Question[] {
  const given: QuestionInput[] = input ?? [
    { type: "phone", required: false },
    { type: "linkedin", required: false },
    { type: "resume", required: false },
  ];
  const out: Question[] = [];
  const ids = new Set<string>();
  for (const q of given) {
    if (!QUESTION_TYPES.includes(q.type)) {
      throw new ClientToolError("invalid", `A question's type is one of ${QUESTION_TYPES.join(", ")}.`);
    }
    const label = (q.label ?? DEFAULT_LABELS[q.type] ?? "").trim();
    if (!label) throw new ClientToolError("invalid", "Each custom question needs a label: the question as the applicant reads it.");
    if (label.length > QUESTION_LABEL_MAX) {
      throw new ClientToolError("invalid", `A question's label is at most ${QUESTION_LABEL_MAX} characters.`);
    }
    if (ALWAYS.includes(q.type) && q.required === false) {
      throw new ClientToolError("invalid", "Name and email are always asked and always required.");
    }
    let questionId: string;
    if (BUILT_IN.includes(q.type)) {
      questionId = q.type;
    } else if (q.questionId !== undefined) {
      if (!CUSTOM_ID.test(q.questionId)) {
        throw new ClientToolError("invalid", "A question_id is one from list_job_posts (q_ and letters or digits), or left out for a new question.");
      }
      questionId = q.questionId;
    } else {
      const same = existing.find((e) => e.type === q.type && e.label.toLowerCase() === label.toLowerCase() && !ids.has(e.questionId));
      questionId = same?.questionId ?? newQuestionId();
    }
    if (ids.has(questionId)) {
      throw new ClientToolError(
        "invalid",
        BUILT_IN.includes(q.type) ? `The ${q.type} question appears once.` : "Each question_id appears once.",
      );
    }
    ids.add(questionId);
    let options: string[] | undefined;
    if (q.type === "select") {
      options = (q.options ?? []).map((o) => o.trim());
      if (options.length < OPTIONS_MIN || options.length > OPTIONS_MAX) {
        throw new ClientToolError("invalid", `A select question has ${OPTIONS_MIN} to ${OPTIONS_MAX} options.`);
      }
      if (options.some((o) => !o || o.length > OPTION_MAX) || new Set(options).size !== options.length) {
        throw new ClientToolError("invalid", `A select question's options are different from each other and 1 to ${OPTION_MAX} characters.`);
      }
    } else if (q.options?.length) {
      throw new ClientToolError("invalid", "Only a select question has options.");
    }
    out.push({
      questionId,
      type: q.type,
      label,
      required: ALWAYS.includes(q.type) ? true : (q.required ?? false),
      ...(options ? { options } : {}),
    });
  }
  // Name and email lead, whether or not they were passed.
  const lead = ALWAYS.map(
    (t) => out.find((q) => q.type === t) ?? { questionId: t, type: t, label: DEFAULT_LABELS[t]!, required: true },
  );
  const all = [...lead, ...out.filter((q) => !ALWAYS.includes(q.type))];
  if (all.length > QUESTIONS_MAX) throw new ClientToolError("invalid", `A job post asks at most ${QUESTIONS_MAX} questions.`);
  return all;
}

/** The public address of a post, or null when this deployment does not know the public site's origin. */
export function jobPostUrl(origin: string | null | undefined, slug: string): string | null {
  return origin ? `${origin.replace(/\/+$/, "")}/jobs/${slug}` : null;
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export type JobPost = {
  postId: string;
  jobId: string;
  jobTitle: string | null;
  title: string;
  location: string | null;
  description: string | null;
  status: JobPostStatus;
  slug: string;
  /** Live, and its job is open: the public page takes applications. */
  accepting: boolean;
  questions: Question[];
  /** Applications that came in through it that the member can read; null for an interviewer. */
  applications: number | null;
  publishedAt: string | null;
  closedAt: string | null;
  updatedAt: string;
};

const POST_COLUMNS =
  "id, role_id, title, location, description, status, slug, questions, published_at, closed_at, updated_at";

type PostRow = {
  id: string; role_id: string; title: string; location: string | null; description: string | null; status: string;
  slug: string; questions: Json; published_at: string | null; closed_at: string | null; updated_at: string;
};

const notForInterviewers = () =>
  new ClientToolError("forbidden", "Only the people who manage a job (an admin, its hiring manager or recruiter) handle its posts.");

const clean = (value: string | null | undefined, max: number, label: string): string | null | undefined => {
  if (value === undefined) return undefined;
  const v = value?.trim() || null;
  if (v && v.length > max) throw new ClientToolError("invalid", `${label} is at most ${max} characters.`);
  return v;
};

async function canManage(db: Db, jobId: string): Promise<boolean> {
  const { data, error } = await db.rpc("can_on_role", { p_role: jobId, perm: "can_manage_job" });
  if (error) throw new Error(error.message);
  return data === true;
}

async function managedJob(db: Db, ctx: ClientToolCtx, jobId: string): Promise<{ id: string; title: string; status: string }> {
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  const { data, error } = await db.from("roles").select("id, title, status").eq("id", jobId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ClientToolError("not_found", "No job with that id that you can see. Call list_jobs for the ids.");
  if (!(await canManage(db, data.id))) throw notForInterviewers();
  return data;
}

/** The post, if the member can see it and may change it, with its job's status. */
async function managedPost(db: Db, ctx: ClientToolCtx, postId: string): Promise<PostRow & { jobStatus: string | null }> {
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  const { data, error } = await db.from("job_posts").select(`${POST_COLUMNS}, roles(status)`).eq("id", postId).maybeSingle();
  if (error) throw new Error(error.message);
  const found = data as unknown as (PostRow & { roles: { status: string } | null }) | null;
  if (!found) throw new ClientToolError("not_found", "No job post with that id that you can see. list_job_posts has them.");
  if (!(await canManage(db, found.role_id))) throw notForInterviewers();
  const { roles, ...row } = found;
  return { ...row, jobStatus: roles?.status ?? null };
}

const storedQuestions = (raw: Json): Question[] =>
  Array.isArray(raw) ? (raw as unknown as StoredQuestion[]).map(fromStored) : [];

/** The database's own refusals (22023 from the validate_job_post trigger) as sentences. */
function postWriteError(error: { code?: string; message: string }): Error {
  if (error.code === "22023") return new ClientToolError("invalid", `Not saved: ${error.message}.`);
  return new Error(error.message);
}

export type JobPostInput = {
  title?: string;
  location?: string | null;
  description?: string | null;
  questions?: QuestionInput[];
};

/** A new post on a job, as a draft: nothing is public until set_job_post_status makes it live. */
export async function createJobPost(
  db: Db,
  ctx: ClientToolCtx,
  input: { jobId: string } & JobPostInput,
): Promise<{ postId: string; slug: string; status: "draft"; title: string; questions: Question[] }> {
  const title = clean(input.title, POST_TITLE_MAX, "A post's title");
  const location = clean(input.location, POST_LOCATION_MAX, "A location") ?? null;
  const description = clean(input.description, POST_DESCRIPTION_MAX, "A description") ?? null;
  const questions = buildQuestions(input.questions);
  const job = await managedJob(db, ctx, input.jobId);
  const postTitle = title ?? job.title;

  return withAudit(db, ctx, { action: "job_post.create", entity: "job_post" }, async () => {
    // Made here and never read back; the slug is the post's whole public address.
    const postId = globalThis.crypto.randomUUID();
    const slug = globalThis.crypto.randomUUID().replace(/-/g, "");
    const { error } = await db.from("job_posts").insert({
      id: postId, role_id: job.id, slug, title: postTitle, location, description,
      questions: questions.map(toStored) as unknown as Json,
    });
    if (error) throw postWriteError(error);
    return {
      result: { postId, slug, status: "draft" as const, title: postTitle, questions },
      entityId: postId,
      // The description is a body: out of the audit row, as notes are.
      after: { job_id: job.id, title: postTitle, location, status: "draft", questions: questions.map((q) => q.questionId) },
      changed: true,
    };
  });
}

/** Changes a post's text or questions, in any status. The questions given replace the list. */
export async function updateJobPost(
  db: Db,
  ctx: ClientToolCtx,
  input: { postId: string } & JobPostInput,
): Promise<{ outcome: "updated" | "unchanged" | "changed_since"; changed: string[] }> {
  const next: Record<string, unknown> = {};
  if (input.title !== undefined) {
    const title = clean(input.title, POST_TITLE_MAX, "A post's title");
    if (!title) throw new ClientToolError("invalid", "A job post needs a title.");
    next.title = title;
  }
  const location = clean(input.location, POST_LOCATION_MAX, "A location");
  if (location !== undefined) next.location = location;
  const description = clean(input.description, POST_DESCRIPTION_MAX, "A description");
  if (description !== undefined) next.description = description;
  if (input.questions !== undefined) buildQuestions(input.questions); // checked before any read

  const post = await managedPost(db, ctx, input.postId);
  if (input.questions !== undefined) {
    next.questions = buildQuestions(input.questions, storedQuestions(post.questions)).map(toStored);
  }
  const current = post as unknown as Record<string, unknown>;
  // jsonb hands keys back in its own order, so questions are compared in one shape.
  const canonical = (k: string, v: unknown) =>
    JSON.stringify(k === "questions" ? storedQuestions(v as Json).map(toStored) : v);
  const changed = Object.keys(next).filter((k) => canonical(k, next[k]) !== canonical(k, current[k]));
  if (!changed.length) return { outcome: "unchanged", changed: [] };
  const patch = Object.fromEntries(changed.map((k) => [k, next[k]]));

  return withAudit(db, ctx, { action: "job_post.update", entity: "job_post" }, async () => {
    // Conditional on the version read, so a concurrent edit is reported rather than overwritten.
    const { data, error } = await db
      .from("job_posts").update(patch as TablesUpdate<"job_posts">).eq("id", post.id).eq("updated_at", post.updated_at).select("id");
    if (error) throw postWriteError(error);
    const ok = !!data?.length;
    const record = (row: Record<string, unknown>) =>
      Object.fromEntries(
        changed
          .filter((k) => k !== "description")
          .map((k) => [k, k === "questions" ? (row[k] as StoredQuestion[] | null)?.map((q) => q.id) ?? null : row[k]]),
      );
    return {
      result: ok ? { outcome: "updated" as const, changed } : { outcome: "changed_since" as const, changed: [] },
      entityId: post.id,
      before: record(current),
      after: record(patch),
      changed: ok,
    };
  });
}

/**
 * Publishes (live) or closes (closed) a post; a closed post can go live again.
 * Going live needs the job open, since the public page takes applications only
 * for an open job.
 */
export async function setJobPostStatus(
  db: Db,
  ctx: ClientToolCtx,
  input: { postId: string; status: "live" | "closed" },
): Promise<{ outcome: "updated" | "unchanged" | "changed_since"; status: JobPostStatus; slug: string }> {
  if (input.status !== "live" && input.status !== "closed") {
    throw new ClientToolError("invalid", "A post's status is set to live or closed.");
  }
  const post = await managedPost(db, ctx, input.postId);
  const status = post.status as JobPostStatus;
  if (status === input.status) return { outcome: "unchanged", status, slug: post.slug };
  if (input.status === "live" && post.jobStatus !== "open") {
    throw new ClientToolError(
      "invalid",
      `Its job is ${post.jobStatus ?? "not open"}, and a post takes applications only for an open job. Open the job with update_job first.`,
    );
  }
  return withAudit(db, ctx, { action: "job_post.status", entity: "job_post" }, async () => {
    const { data, error } = await db
      .from("job_posts").update({ status: input.status }).eq("id", post.id).eq("status", status).select("id");
    if (error) throw postWriteError(error);
    const ok = !!data?.length;
    return {
      result: { outcome: ok ? ("updated" as const) : ("changed_since" as const), status: ok ? input.status : status, slug: post.slug },
      entityId: post.id,
      before: { status },
      after: { status: input.status },
      changed: ok,
    };
  });
}

/** A job's posts (or every post the member can see), newest first, with what each public page asks. */
export async function listJobPosts(db: Db, ctx: ClientToolCtx, input: { jobId?: string } = {}): Promise<JobPost[]> {
  let q = db
    .from("job_posts")
    .select(`${POST_COLUMNS}, roles(title, status), application_answers(count)`)
    .order("created_at", { ascending: false })
    .limit(LIST_MAX);
  if (input.jobId) q = q.eq("role_id", input.jobId);
  const { data, error } = await q.overrideTypes<
    Array<PostRow & { roles: { title: string; status: string } | null; application_answers?: Array<{ count: number }> }>,
    { merge: false }
  >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({
    postId: p.id,
    jobId: p.role_id,
    jobTitle: p.roles?.title ?? null,
    title: p.title,
    location: p.location,
    description: p.description,
    status: p.status as JobPostStatus,
    slug: p.slug,
    accepting: p.status === "live" && p.roles?.status === "open",
    questions: storedQuestions(p.questions),
    // Counted under the answers policy: what the member can read.
    applications: ctx.accessLevel === "limited" ? null : (p.application_answers?.[0]?.count ?? 0),
    publishedAt: p.published_at,
    closedAt: p.closed_at,
    updatedAt: p.updated_at,
  }));
}

// ---------------------------------------------------------------------------
// Answers and the inbox
// ---------------------------------------------------------------------------

export type ApplicationAnswer = { questionId: string; type: string; label: string; value: string };
export type ApplicationAnswers = { postId: string | null; submittedAt: string; answers: ApplicationAnswer[] };

type StoredAnswer = { id: string; type: string; label: string; value: string };

/** What each of these applications' applicants answered, as the member reads it (absent = none, or not theirs to read). */
export async function answersFor(db: Db, applicationIds: string[]): Promise<Map<string, ApplicationAnswers>> {
  const out = new Map<string, ApplicationAnswers>();
  if (!applicationIds.length) return out;
  const { data, error } = await db
    .from("application_answers")
    .select("application_id, job_post_id, submitted_at, answers")
    .in("application_id", applicationIds);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    out.set(row.application_id, {
      postId: row.job_post_id,
      submittedAt: row.submitted_at,
      answers: (Array.isArray(row.answers) ? (row.answers as unknown as StoredAnswer[]) : []).map((a) => ({
        questionId: a.id, type: a.type, label: a.label, value: a.value,
      })),
    });
  }
  return out;
}

export type InboxEntry = {
  applicationId: string;
  candidateId: string;
  name: string | null;
  email: string | null;
  jobId: string;
  jobTitle: string | null;
  stage: string;
  /** The post they applied through (its title at the time). */
  post: string | null;
  appliedAt: string;
  answers: ApplicationAnswer[];
};

/**
 * New applicants from job posts: applications with source job_board still at
 * the first stage, newest first, with their answers. Moving one on (update_stage)
 * takes them out of the inbox.
 */
export async function listApplicationsInbox(
  db: Db,
  ctx: ClientToolCtx,
  input: { jobId?: string; limit?: number } = {},
): Promise<InboxEntry[]> {
  if (ctx.accessLevel === "limited") {
    throw new ClientToolError("forbidden", "Interviewers do not see a job's applicants. Use list_my_interviews for yours.");
  }
  const limit = Math.min(Math.max(input.limit ?? 20, 1), LIST_MAX);
  if (input.jobId) {
    const { data, error } = await db.from("roles").select("id").eq("id", input.jobId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new ClientToolError("not_found", "No job with that id that you can see. Call list_jobs for the ids.");
  }
  let q = db
    .from("applications")
    .select("id, person_id, role_id, stage, source_detail, created_at, people(display_name, email), roles(title)")
    .eq("source", "job_board")
    .in("stage", [...INBOX_STAGES])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (input.jobId) q = q.eq("role_id", input.jobId);
  const { data, error } = await q.overrideTypes<
    Array<{
      id: string; person_id: string; role_id: string; stage: string; source_detail: string | null; created_at: string;
      people: { display_name: string | null; email: string | null } | null; roles: { title: string } | null;
    }>,
    { merge: false }
  >();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const answers = await answersFor(db, rows.map((r) => r.id));
  return rows.map((r) => ({
    applicationId: r.id,
    candidateId: r.person_id,
    name: r.people?.display_name ?? null,
    email: r.people?.email ?? null,
    jobId: r.role_id,
    jobTitle: r.roles?.title ?? null,
    stage: r.stage,
    post: r.source_detail,
    appliedAt: r.created_at,
    answers: answers.get(r.id)?.answers ?? [],
  }));
}
