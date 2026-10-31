import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import type { CrmCandidate, CrmRow } from "./crm-views";
import { readDrawnProcess } from "./process";
import { jobStages, nextPlanStep, processStages, stageNameFor } from "./process-stages";

// The CRM's read, on the member's OWN client (never a privileged one): every
// candidate they can read in `people`, each with the applications they can
// read and those applications' owners. The policies decide what comes back:
// an admin's whole org, a hiring-team member's own jobs' candidates (and
// prospects, in no job, for whoever may add people), an external recruiter's
// own adds; nothing here filters by org or level. An interviewer is not read
// for: the page sends them home, as the Pipeline does.
//
// Not core's searchCandidates: it stops at 50 rows and carries no owner or
// last touch, and the table sorts, counts and pages over everyone.

/** Rows per request: PostgREST's own maximum. */
const PAGE = 1000;
/** Candidates read at most; past it the table says so (`truncated`). */
export const CRM_SCAN_MAX = 5000;

type PersonRow = {
  id: string;
  display_name: string | null;
  current_title: string | null;
  current_company: string | null;
  email: string | null;
  linkedin_url: string | null;
  created_at: string;
  applications: Array<{ id: string; role_id: string; stage: string; owner_actor_id: string | null; last_touch_at: string; roles: { title: string } | null }>;
};

export type CrmRead = { candidates: CrmCandidate[]; truncated: boolean };

export async function readCandidates(db: Db): Promise<CrmRead> {
  const rows: PersonRow[] = [];
  for (let from = 0; from < CRM_SCAN_MAX; from += PAGE) {
    const { data, error } = await db
      .from("people")
      .select("id, display_name, current_title, current_company, email, linkedin_url, created_at, applications(id, role_id, stage, owner_actor_id, last_touch_at, roles(title))")
      .order("id")
      .range(from, from + PAGE - 1)
      .overrideTypes<PersonRow[], { merge: false }>();
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  const truncated = rows.length >= CRM_SCAN_MAX;

  const ownerIds = [...new Set(rows.flatMap((p) => p.applications ?? []).map((a) => a.owner_actor_id).filter((id): id is string => !!id))];
  const owners = new Map<string, string | null>();
  for (let i = 0; i < ownerIds.length; i += 150) {
    const { data, error } = await db.from("org_members").select("id, display_name").in("id", ownerIds.slice(i, i + 150));
    if (error) throw new Error(error.message);
    for (const m of data ?? []) if (m.id) owners.set(m.id, m.display_name);
  }

  return {
    truncated,
    candidates: rows.map((p) => ({
      candidateId: p.id,
      name: p.display_name,
      headline: [p.current_title, p.current_company].filter(Boolean).join(" at ") || null,
      email: p.email,
      linkedinUrl: p.linkedin_url,
      addedAt: p.created_at,
      applications: (p.applications ?? []).map((a) => ({
        applicationId: a.id,
        jobId: a.role_id,
        jobTitle: a.roles?.title ?? null,
        stage: a.stage,
        ownerName: a.owner_actor_id ? (owners.get(a.owner_actor_id) ?? null) : null,
        lastTouchAt: a.last_touch_at,
      })),
    })),
  };
}

const IDS_PER_READ = 150;

/**
 * What the process calls the stage of each row in view, by application id; none
 * for a member who may not read it (`readDrawnProcess`), so the page keeps today's
 * labels. Only the page's rows, since `interviewing` wants that application's
 * interviews: the table sorts by the enum and never needs a name to order them.
 */
export async function readStageNames(db: Db, ctx: clientTools.ClientToolCtx, rows: CrmRow[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const leads = rows.flatMap((r) => (r.lead && r.stage ? [{ ...r.lead, stage: r.stage }] : []));
  if (!leads.length) return names;
  const drawn = await readDrawnProcess(db, ctx);
  if (!drawn) return names;

  const jobIds = [...new Set(leads.map((l) => l.jobId))];
  const interviewing = leads.filter((l) => l.stage === "interviewing").map((l) => l.applicationId);
  const interviews = new Map<string, Array<{ step: string | null; status: string }>>();
  for (let i = 0; i < interviewing.length; i += IDS_PER_READ) {
    const { data, error } = await db.from("interviews").select("application_id, step, status").in("application_id", interviewing.slice(i, i + IDS_PER_READ)).neq("status", "cancelled");
    if (error) throw new Error(error.message);
    for (const row of data ?? []) if (row.application_id) interviews.set(row.application_id, [...(interviews.get(row.application_id) ?? []), row]);
  }
  const { data: jobs, error } = await db.from("roles").select("id, department_id, interview_steps").in("id", jobIds);
  if (error) throw new Error(error.message);

  const process = processStages(drawn.graph, drawn.lookup.departments);
  const byJob = new Map((jobs ?? []).map((j) => {
    const steps = clientTools.stepsOf(j.interview_steps);
    return [j.id, { steps, stages: jobStages(process, { departmentId: j.department_id, steps }) }];
  }));
  for (const lead of leads) {
    const job = byJob.get(lead.jobId);
    if (!job) continue;
    const name = stageNameFor(job.stages, lead.stage, nextPlanStep(job.steps, interviews.get(lead.applicationId) ?? []));
    if (name) names.set(lead.applicationId, name.name);
  }
  return names;
}
