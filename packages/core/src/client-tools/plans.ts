import type { Db } from "@tacit/db";

import { withAudit } from "./audit.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";

/**
 * A job's interview plan for the client connector: the ordered steps of its
 * interview process ("Recruiter screen", "Technical", "Onsite"). The plan is
 * roles.interview_steps, the jsonb list of step names the staff connector
 * already reads (connector/roles.ts, connector/scheduling.ts), so there is one
 * plan per job whichever side writes it. Same rules as the rest of
 * client-tools: the member's own client, and the policies decide. Reading the
 * plan is reading the job; writing it is updating the job (can_manage_job).
 *
 * An interview names its step as text (interviews.step), not by position, so
 * replacing the plan never touches an interview: one whose step was removed
 * keeps that name and shows as off-plan, and set_interview_plan says how many.
 */

/** The longest step name: what interviews.ts takes for a step too. */
export const STEP_NAME_MAX = 120;
/** The most steps a plan holds, as on the staff connector (INTERVIEW_STEPS_MAX). */
export const PLAN_STEPS_MAX = 15;

/** interview_steps is jsonb the database only promises is an array; the staff readers filter it the same way. */
export const stepsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : [];

/** A plan as it will be stored: trimmed, one line each, no repeats in any case. */
export function cleanPlan(steps: string[]): string[] {
  if (steps.length > PLAN_STEPS_MAX) throw new ClientToolError("invalid", `A plan has at most ${PLAN_STEPS_MAX} steps.`);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of steps) {
    const step = raw.trim();
    if (!step) throw new ClientToolError("invalid", "A step needs a name.");
    if (step.length > STEP_NAME_MAX) throw new ClientToolError("invalid", `A step name is at most ${STEP_NAME_MAX} characters.`);
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(step)) throw new ClientToolError("invalid", "A step name is one line of text.");
    const key = step.toLowerCase();
    if (seen.has(key)) throw new ClientToolError("invalid", `"${step}" is in the plan twice. Each step needs its own name.`);
    seen.add(key);
    out.push(step);
  }
  return out;
}

/** The step as the plan spells it. A job with no plan takes any name, as on the staff connector. */
export function planStep(plan: string[], step: string): string {
  if (!plan.length) return step;
  const match = plan.find((s) => s.toLowerCase() === step.toLowerCase());
  if (!match) {
    throw new ClientToolError(
      "invalid",
      `"${step}" is not a step of this job's interview plan. The steps are: ${plan.join(", ")}. Nothing was saved.`,
    );
  }
  return match;
}

type JobPlanRow = { id: string; title: string; interview_steps: unknown };

async function visibleJob(db: Db, jobId: string): Promise<JobPlanRow> {
  const { data, error } = await db.from("roles").select("id, title, interview_steps").eq("id", jobId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ClientToolError("not_found", "No job with that id that you can see. Call list_jobs for the ids.");
  return data;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** filed / not_filed, or hidden when the org's feedback_visibility keeps it from the caller (often until they file theirs). */
export type FeedbackState = "filed" | "not_filed" | "hidden";
/** not_visible: the caller sees only their own interviews on this candidate, and none is on this step. */
export type StepState = "not_scheduled" | "scheduled" | "done" | "cancelled" | "not_visible";

export type PlanInterview = {
  interviewId: string;
  step: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  /** Feedback is null on a cancelled interview: none is expected. */
  interviewers: Array<{ userId: string; name: string | null; feedback: FeedbackState | null }>;
};

export type PlanProgress = {
  applicationId: string;
  /** False for an interviewer, who reads only the interviews they are on. */
  seesAllInterviews: boolean;
  steps: Array<{ position: number; step: string; state: StepState; interviews: PlanInterview[] }>;
  /** Interviews with no step, or a step the plan no longer has (they keep its name). */
  offPlan: PlanInterview[];
  /** The first step not yet scheduled or done, when the caller sees every interview. */
  nextStep: string | null;
};

export type InterviewPlan = {
  jobId: string;
  title: string;
  steps: string[];
  candidate: PlanProgress | null;
};

type InterviewRow = {
  id: string; application_id: string; starts_at: string; ends_at: string; status: string; step: string | null;
  interviewer_actor_ids: string[];
};

function stepState(interviews: PlanInterview[], seesAll: boolean): StepState {
  if (interviews.some((i) => i.status === "scheduled")) return "scheduled";
  if (interviews.some((i) => i.status === "done")) return "done";
  if (interviews.length) return "cancelled";
  return seesAll ? "not_scheduled" : "not_visible";
}

async function progress(db: Db, jobId: string, plan: string[], applicationId: string): Promise<PlanProgress> {
  // An interviewer cannot read the application, only the interviews they are on.
  const { data: app, error } = await db.from("applications").select("id, role_id").eq("id", applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  const { data: rows, error: interviewsError } = await db
    .from("interviews")
    .select("id, application_id, starts_at, ends_at, status, step, interviewer_actor_ids")
    .eq("application_id", applicationId)
    .order("starts_at");
  if (interviewsError) throw new Error(interviewsError.message);
  const interviews = (rows ?? []) as InterviewRow[];
  if (!app && !interviews.length) {
    throw new ClientToolError("not_found", "No application with that id that you can see. get_pipeline, get_candidate and list_my_interviews have them.");
  }
  let roleId = app?.role_id ?? null;
  if (!roleId) {
    const { data, error: roleError } = await db.rpc("application_role", { p_application: applicationId });
    if (roleError) throw new Error(roleError.message);
    roleId = (data as string | null) ?? null;
  }
  if (roleId !== jobId) {
    throw new ClientToolError("invalid", "That application is for another job. Pass the job it is on.");
  }

  const ids = interviews.map((i) => i.id);
  const filed = new Set<string>();
  if (ids.length) {
    // Only who filed, never what: get_feedback is where the feedback itself is read.
    const { data, error: feedbackError } = await db
      .from("interview_feedback").select("interview_id, interviewer_actor_id").in("interview_id", ids);
    if (feedbackError) throw new Error(feedbackError.message);
    for (const f of data ?? []) filed.add(`${f.interview_id}:${f.interviewer_actor_id}`);
  }
  const people = [...new Set(interviews.flatMap((i) => i.interviewer_actor_ids))];
  const names = new Map<string, string | null>();
  if (people.length) {
    const { data, error: membersError } = await db.from("org_members").select("id, display_name").in("id", people);
    if (membersError) throw new Error(membersError.message);
    for (const m of data ?? []) if (m.id) names.set(m.id, m.display_name);
  }

  const shaped: PlanInterview[] = [];
  for (const i of interviews) {
    const interviewers: PlanInterview["interviewers"] = [];
    // Interviewers no longer at the company drop out, as in get_feedback.
    for (const userId of i.interviewer_actor_ids.filter((id) => names.has(id))) {
      let feedback: FeedbackState | null = null;
      if (i.status !== "cancelled") {
        if (filed.has(`${i.id}:${userId}`)) {
          feedback = "filed";
        } else {
          // No row read: either none was filed, or the policy hides it. The policy's own helper says which.
          const { data: visible, error: seeError } = await db.rpc("can_see_feedback", { p_interview: i.id, p_interviewer: userId });
          if (seeError) throw new Error(seeError.message);
          feedback = visible === true ? "not_filed" : "hidden";
        }
      }
      interviewers.push({ userId, name: names.get(userId) ?? null, feedback });
    }
    shaped.push({ interviewId: i.id, step: i.step, startsAt: i.starts_at, endsAt: i.ends_at, status: i.status, interviewers });
  }

  const seesAll = !!app;
  const byStep = new Map(plan.map((s) => [s.toLowerCase(), s]));
  const steps = plan.map((step, n) => {
    const on = shaped.filter((i) => i.step !== null && i.step.toLowerCase() === step.toLowerCase());
    return { position: n + 1, step, state: stepState(on, seesAll), interviews: on };
  });
  return {
    applicationId,
    seesAllInterviews: seesAll,
    steps,
    offPlan: shaped.filter((i) => i.step === null || !byStep.has(i.step.toLowerCase())),
    nextStep: seesAll ? (steps.find((s) => s.state === "not_scheduled" || s.state === "cancelled")?.step ?? null) : null,
  };
}

export async function getInterviewPlan(
  db: Db,
  _ctx: ClientToolCtx,
  input: { jobId: string; applicationId?: string },
): Promise<InterviewPlan> {
  const job = await visibleJob(db, input.jobId);
  const steps = stepsOf(job.interview_steps);
  return {
    jobId: job.id,
    title: job.title,
    steps,
    candidate: input.applicationId ? await progress(db, job.id, steps, input.applicationId) : null,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type PlanChange = {
  outcome: "updated" | "unchanged";
  steps: string[];
  removed: string[];
  /** Interviews on this job still naming a removed step: they keep the name and show as off-plan. */
  keptOnInterviews: Array<{ step: string; interviews: number; scheduled: number }>;
};

export async function setInterviewPlan(
  db: Db,
  ctx: ClientToolCtx,
  input: {
    jobId: string;
    steps: string[];
    /** Every check and the answer it would give, with nothing written and no audit claim. Not on the connector. */
    dryRun?: boolean;
  },
): Promise<PlanChange> {
  const steps = cleanPlan(input.steps);
  const job = await visibleJob(db, input.jobId);
  const { data: allowed, error } = await db.rpc("can_on_role", { p_role: job.id, perm: "can_manage_job" });
  if (error) throw new Error(error.message);
  if (allowed !== true) {
    throw new ClientToolError("forbidden", "You can see that job but not change its interview plan. Ask whoever manages the job.");
  }
  const current = stepsOf(job.interview_steps);
  if (current.length === steps.length && current.every((s, n) => s === steps[n])) {
    return { outcome: "unchanged", steps, removed: [], keptOnInterviews: [] };
  }

  // A step renamed only in case is kept: interviews match their step without regard to case.
  const kept = new Set(steps.map((s) => s.toLowerCase()));
  const removed = current.filter((s) => !kept.has(s.toLowerCase()));
  const keptOnInterviews: PlanChange["keptOnInterviews"] = [];
  if (removed.length) {
    // Read before the write, so nothing after the write can fail it.
    const { data, error: interviewsError } = await db
      .from("interviews")
      .select("step, status, applications!inner(role_id)")
      .eq("applications.role_id", job.id)
      .not("step", "is", null);
    if (interviewsError) throw new Error(interviewsError.message);
    for (const step of removed) {
      const on = (data ?? []).filter((i) => i.step?.toLowerCase() === step.toLowerCase());
      if (on.length) keptOnInterviews.push({ step, interviews: on.length, scheduled: on.filter((i) => i.status === "scheduled").length });
    }
  }

  if (input.dryRun) return { outcome: "updated", steps, removed, keptOnInterviews };

  return withAudit(db, ctx, { action: "role.interview_plan", entity: "role" }, async () => {
    const { data, error: updateError } = await db
      .from("roles").update({ interview_steps: steps, updated_at: new Date().toISOString() }).eq("id", job.id).select("id");
    if (updateError) throw new Error(updateError.message);
    const ok = !!data?.length;
    return {
      result: ok
        ? { outcome: "updated" as const, steps, removed, keptOnInterviews }
        : { outcome: "unchanged" as const, steps: current, removed: [], keptOnInterviews: [] },
      entityId: job.id,
      before: { interview_steps: current },
      after: { interview_steps: steps },
      changed: ok,
    };
  });
}
