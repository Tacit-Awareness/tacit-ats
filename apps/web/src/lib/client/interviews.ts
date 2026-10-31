import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { jobSteps, type ProcessDoc, type ProcessLookup } from "./process-graph";
import { planMatches } from "./process-stages";
import { readDrawnProcess } from "./process";
import type { AccessLevel } from "./session";

// The Interviews page's reads, on the member's OWN client (never a privileged
// one). The policies decide what comes back: an interview is readable by its
// interviewers and by whoever can read its application (an admin's every job,
// a hiring-team member's own), and a feedback row only when the org's
// feedback_visibility lets the caller see it (can_see_feedback). Nothing here
// filters by org or level.
//
// An interviewer (`limited`) cannot read applications, so who they interview
// and for which job come from core's listMyInterviews (my_interviews()). Every
// one else reads the interviews and their applications directly, with
// my_interviews() filling in any they sit on without reading the application.

/** Interviews the list reads, newest first; older ones drop off. */
const LIST_MAX = 500;
/** Interview ids per `interview_feedback` read, to keep the query string short. */
const IDS_PER_READ = 150;

export type Member = { actorId: string; orgId: string; accessLevel: AccessLevel };

/** Core's tools want a source for their audit rows; these are reads, which write none. */
const toolCtx = (m: Member): clientTools.ClientToolCtx => ({ ...m, source: "claude" });

export type InterviewListItem = {
  interviewId: string;
  applicationId: string;
  candidateName: string | null;
  jobId: string;
  jobTitle: string;
  startsAt: string;
  endsAt: string;
  status: string;
  step: string | null;
  interviewers: string[];
  /** The member sat on it, so it may have Granola notes of theirs. */
  mine: boolean;
  /** The recommendations of the feedback the member may read. */
  recommendations: string[];
};

type InterviewRow = {
  id: string;
  application_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  step: string | null;
  interviewer_actor_ids: string[];
};

async function recommendationsFor(db: Db, ids: string[]) {
  const by = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += IDS_PER_READ) {
    const { data, error } = await db.from("interview_feedback").select("interview_id, recommendation").in("interview_id", ids.slice(i, i + IDS_PER_READ));
    if (error) throw new Error(error.message);
    for (const f of data ?? []) by.set(f.interview_id, [...(by.get(f.interview_id) ?? []), f.recommendation]);
  }
  return by;
}

async function namesFor(db: Db, actorIds: string[]) {
  const names = new Map<string, string>();
  if (!actorIds.length) return names;
  const { data, error } = await db.from("org_members").select("id, display_name").in("id", actorIds);
  if (error) throw new Error(error.message);
  for (const m of data ?? []) if (m.id) names.set(m.id, m.display_name ?? "");
  return names;
}

const COLUMNS = "id, application_id, starts_at, ends_at, status, step, interviewer_actor_ids";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every interview the member can see but cancelled ones, with what the list
 * shows. `asked` is the `?i=`: the Calendar and its search reach further back
 * than LIST_MAX, so an interview they open is read here even past the cap.
 */
export async function readInterviews(db: Db, member: Member, now: Date, asked?: string): Promise<InterviewListItem[]> {
  const [{ data: rows, error }, mine] = await Promise.all([
    db
      .from("interviews")
      .select(COLUMNS)
      .neq("status", "cancelled")
      .order("starts_at", { ascending: false })
      .limit(LIST_MAX),
    clientTools.listMyInterviews(db, toolCtx(member), { when: "all" }, now),
  ]);
  if (error) throw new Error(error.message);
  const interviews = (rows ?? []) as InterviewRow[];
  if (asked && UUID.test(asked) && !interviews.some((i) => i.id === asked)) {
    const { data: one, error: oneError } = await db.from("interviews").select(COLUMNS).eq("id", asked).neq("status", "cancelled").maybeSingle();
    if (oneError) throw new Error(oneError.message);
    if (one) interviews.push(one as InterviewRow);
  }

  // Who and for which job: the application where the member may read it, else their own my_interviews() row.
  const apps = new Map<string, { candidateName: string | null; jobId: string; jobTitle: string }>();
  for (const m of mine) apps.set(m.applicationId, { candidateName: m.candidateName, jobId: m.jobId, jobTitle: m.jobTitle });
  const unknown = [...new Set(interviews.map((i) => i.application_id))].filter((id) => !apps.has(id));
  if (member.accessLevel !== "limited") {
    for (let i = 0; i < unknown.length; i += IDS_PER_READ) {
      const { data, error: appError } = await db
        .from("applications")
        .select("id, role_id, people(display_name), roles(title)")
        .in("id", unknown.slice(i, i + IDS_PER_READ));
      if (appError) throw new Error(appError.message);
      for (const a of data ?? []) {
        apps.set(a.id, { candidateName: a.people?.display_name ?? null, jobId: a.role_id, jobTitle: a.roles?.title ?? "" });
      }
    }
  }

  const shown = interviews.filter((i) => apps.has(i.application_id));
  const [recommendations, names] = await Promise.all([
    recommendationsFor(db, shown.map((i) => i.id)),
    namesFor(db, [...new Set(shown.flatMap((i) => i.interviewer_actor_ids))]),
  ]);
  return shown.map((i) => {
    const app = apps.get(i.application_id)!;
    return {
      interviewId: i.id,
      applicationId: i.application_id,
      ...app,
      startsAt: i.starts_at,
      endsAt: i.ends_at,
      status: i.status,
      step: i.step,
      // Interviewers no longer at the company drop out, as in core's get_feedback.
      interviewers: i.interviewer_actor_ids.flatMap((id) => (names.get(id) ? [names.get(id)!] : [])),
      mine: i.interviewer_actor_ids.includes(member.actorId),
      recommendations: recommendations.get(i.id) ?? [],
    };
  });
}

export type InterviewDetail = {
  plan: clientTools.InterviewPlan;
  feedback: clientTools.FeedbackSummary;
};

/** The reader: the candidate's loop on this job, and this interview's feedback as far as the member may read it. */
export async function readInterview(db: Db, member: Member, item: Pick<InterviewListItem, "interviewId" | "applicationId" | "jobId">): Promise<InterviewDetail> {
  const ctx = toolCtx(member);
  const [plan, feedback] = await Promise.all([
    clientTools.getInterviewPlan(db, ctx, { jobId: item.jobId, applicationId: item.applicationId }),
    clientTools.getFeedback(db, ctx, { interviewId: item.interviewId }),
  ]);
  return { plan, feedback };
}

export type InterviewRoute = { graph: ProcessDoc; lookup: ProcessLookup; departmentId: string | null };

/**
 * What the routing graph is drawn from, or null for the plain loop: an interviewer
 * (refused before any read, so their token never touches the process), an external
 * recruiter, a company with no process, or a job whose plan is not the process's.
 */
export async function readInterviewRoute(db: Db, member: Member, jobId: string, plan: string[]): Promise<InterviewRoute | null> {
  const drawn = await readDrawnProcess(db, toolCtx(member));
  if (!drawn) return null;
  const { data, error } = await db.from("roles").select("department_id").eq("id", jobId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (!planMatches(plan, jobSteps(drawn.graph, data.department_id, drawn.lookup.departments))) return null;
  return { ...drawn, departmentId: data.department_id };
}
