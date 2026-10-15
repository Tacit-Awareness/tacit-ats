import type { Db } from "@tacit/db";

import { getRolePipeline, type PipelineCard } from "@tacit/core";
import { ClientToolError, LIST_MAX, type ClientToolCtx } from "./context.js";
import { peopleTagged, tagsFor } from "./tags.js";
import { filesFor, type CandidateFile } from "./files.js";
import { isProspect, peopleInPool, poolsFor, type CandidatePool } from "./pools.js";
import { emailsFor, type CandidateEmail } from "./email.js";
import { customFieldValuesFor, type CustomFieldValue } from "./custom-fields.js";
import { countOpenings, type OpeningCounts } from "./openings.js";
import { departmentAndBelow, pickByRef, readDepartments, readOffices } from "./structure.js";
import { answersFor, type ApplicationAnswers } from "./posts.js";

export type JobView = {
  jobId: string;
  title: string;
  status: string;
  location: string | null;
  seniority: string | null;
  /** How many candidates the member can see in it; null for an interviewer. */
  inPipeline: number | null;
  /** The job's custom field values the member can read; empty for an interviewer. */
  customFields: CustomFieldValue[];
  /** Its department's name, and its offices' (20261016130000); null and [] for an interviewer. */
  department: string | null;
  offices: string[];
  /** Its openings by status; null for an interviewer, or someone who cannot read them. */
  openings: OpeningCounts | null;
};

type JobListRow = {
  id: string; title: string; status: string; location: string | null; seniority: string | null;
  applications?: Array<{ count: number }>;
  departments?: { name: string } | null;
  job_offices?: Array<{ offices: { name: string } | null }>;
  openings?: Array<{ status: string }>;
};

/**
 * The jobs the member can see, newest first. `department` (an id or name;
 * the jobs in it and in the departments inside it) and `office` (an id or
 * name) narrow it, for anyone above interviewer.
 */
export async function listJobs(
  db: Db,
  ctx: ClientToolCtx,
  input: { status?: string; department?: string; office?: string } = {},
): Promise<JobView[]> {
  const full = ctx.accessLevel !== "limited";
  if (!full && (input.department || input.office)) {
    throw new ClientToolError("forbidden", "Interviewers do not see your company's departments or offices.");
  }
  // Archived ones too: their jobs are still there.
  let departmentIds: string[] | null = null;
  if (input.department?.trim()) {
    const rows = await readDepartments(db);
    const department = pickByRef(rows, input.department);
    if (!department) throw new ClientToolError("not_found", "No department by that name or id. list_departments has them.");
    departmentIds = departmentAndBelow(rows, department.id);
  }
  let officeJobs: string[] | null = null;
  if (input.office?.trim()) {
    const office = pickByRef(await readOffices(db), input.office);
    if (!office) throw new ClientToolError("not_found", "No office by that name or id. list_offices has them.");
    const { data, error } = await db.from("job_offices").select("role_id").eq("office_id", office.id).limit(1000);
    if (error) throw new Error(error.message);
    officeJobs = [...new Set((data ?? []).map((r) => r.role_id))];
    if (!officeJobs.length) return [];
  }
  let q = db
    .from("roles")
    .select(
      full
        ? "id, title, status, location, seniority, applications(count), departments(name), job_offices(offices(name)), openings(status)"
        : "id, title, status, location, seniority",
    )
    .order("created_at", { ascending: false })
    .limit(LIST_MAX);
  if (input.status) q = q.eq("status", input.status);
  if (departmentIds) q = q.in("department_id", departmentIds);
  if (officeJobs) q = q.in("id", officeJobs);
  const { data, error } = await q.overrideTypes<JobListRow[], { merge: false }>();
  if (error) throw new Error(error.message);
  const fields = full ? await customFieldValuesFor(db, "job", (data ?? []).map((r) => r.id)) : new Map<string, CustomFieldValue[]>();
  return (data ?? []).map((r) => ({
    jobId: r.id,
    title: r.title,
    status: r.status,
    location: r.location,
    seniority: r.seniority,
    inPipeline: full ? (r.applications?.[0]?.count ?? 0) : null,
    customFields: fields.get(r.id) ?? [],
    department: r.departments?.name ?? null,
    offices: (r.job_offices ?? []).map((o) => o.offices?.name).filter((n): n is string => !!n).sort(),
    // Empty for a member who cannot read them as for a job with none: say "none we can see".
    openings: full && r.openings?.length ? countOpenings(r.openings.map((o) => o.status)) : null,
  }));
}

export type JobPipeline = {
  jobId: string;
  title: string;
  status: string;
  /** Each card carries what its applicant answered on a job post, when they applied through one. */
  cards: Array<PipelineCard & { answers: ApplicationAnswers | null }>;
  stalledCount: number;
  customFields: CustomFieldValue[];
};

/** One job's pipeline: the applications the member can read in it. */
export async function getJobPipeline(db: Db, ctx: ClientToolCtx, jobId: string): Promise<JobPipeline> {
  if (ctx.accessLevel === "limited") {
    throw new ClientToolError(
      "forbidden",
      "Interviewers do not see a job's pipeline. Use search_candidates for the people you interview.",
    );
  }
  const pipeline = await getRolePipeline(db, jobId);
  if (!pipeline) throw new ClientToolError("not_found", "No job with that id that you can see. Call list_jobs for the ids.");
  const answers = await answersFor(db, pipeline.cards.filter((c) => c.source === "job_board").map((c) => c.applicationId));
  return {
    jobId: pipeline.roleId,
    title: pipeline.roleTitle,
    status: pipeline.roleStatus,
    cards: pipeline.cards.map((c) => ({ ...c, answers: answers.get(c.applicationId) ?? null })),
    stalledCount: pipeline.stalledCount,
    customFields: (await customFieldValuesFor(db, "job", [pipeline.roleId])).get(pipeline.roleId) ?? [],
  };
}

export type CandidateHit = {
  candidateId: string;
  name: string | null;
  headline: string | null;
  /** The jobs the member can see this candidate in. Empty for an interviewer. */
  applications: Array<{ applicationId: string; jobId: string; jobTitle: string | null; stage: string }>;
};

const headline = (title: string | null, company: string | null) =>
  [title, company].filter(Boolean).join(" at ") || null;

/** How many people a prospects_only search reads to find `limit` prospects. */
const PROSPECT_SCAN = 200;

/** PostgREST's or() is a comma-separated filter: keep a query to letters, digits and a few separators. */
const cleanQuery = (q: string) => q.replace(/[^\p{L}\p{N}@.\-' ]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 100);

type PersonRow = {
  id: string;
  display_name: string | null;
  current_title: string | null;
  current_company: string | null;
  applications: Array<{ id: string; role_id: string; stage: string; roles: { title: string } | null }>;
};

export async function searchCandidates(
  db: Db,
  ctx: ClientToolCtx,
  input: { query?: string; jobId?: string; tag?: string; pool?: string; prospectsOnly?: boolean; limit?: number },
): Promise<CandidateHit[]> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), LIST_MAX);
  const query = input.query ? cleanQuery(input.query) : "";

  if (ctx.accessLevel === "limited") {
    if (input.tag) throw new ClientToolError("forbidden", "Interviewers do not see or use your company's tags.");
    if (input.pool || input.prospectsOnly) throw new ClientToolError("forbidden", "Interviewers do not see prospects or talent pools.");
    // What an interviewer may know: the five fields of the people they interview.
    const { data, error } = await db.rpc("my_interview_candidates");
    if (error) throw new Error(error.message);
    const needle = query.toLowerCase();
    return (data ?? [])
      .filter((c) => !needle || (c.display_name ?? "").toLowerCase().includes(needle))
      .slice(0, limit)
      .map((c) => ({ candidateId: c.person_id, name: c.display_name, headline: headline(c.current_title, c.current_company), applications: [] }));
  }

  // Nobody in a job is a prospect.
  if (input.prospectsOnly && input.jobId) return [];
  let personIds: string[] | null = null;
  if (input.jobId) {
    const { data, error } = await db.from("applications").select("person_id").eq("role_id", input.jobId).limit(500);
    if (error) throw new Error(error.message);
    personIds = [...new Set((data ?? []).map((a) => a.person_id))];
    if (personIds.length === 0) return [];
  }
  if (input.tag?.trim()) {
    const tagged = await peopleTagged(db, input.tag);
    if (!tagged) throw new ClientToolError("not_found", "No tag by that name or id. list_tags has them.");
    personIds = personIds ? personIds.filter((id) => tagged.includes(id)) : tagged;
    if (personIds.length === 0) return [];
  }
  if (input.pool?.trim()) {
    const pooled = await peopleInPool(db, input.pool);
    if (!pooled) throw new ClientToolError("not_found", "No talent pool by that name or id. list_pools has them.");
    personIds = personIds ? personIds.filter((id) => pooled.includes(id)) : pooled;
    if (personIds.length === 0) return [];
  }
  // A prospect is in no job: read more rows than asked for, keep those in no
  // job the member can see, then ask the database whether they are in none at
  // all (an admin does not see a confidential job's applications).
  const prospectsOnly = !!input.prospectsOnly;
  let q = db
    .from("people")
    .select("id, display_name, current_title, current_company, applications(id, role_id, stage, roles(title))")
    .order("display_name")
    .limit(prospectsOnly ? PROSPECT_SCAN : limit);
  if (query) {
    const like = `%${query}%`;
    q = q.or(`display_name.ilike.${like},email.ilike.${like},current_company.ilike.${like},current_title.ilike.${like}`);
  }
  if (personIds) q = q.in("id", personIds);
  const { data, error } = await q.overrideTypes<PersonRow[], { merge: false }>();
  if (error) throw new Error(error.message);
  let rows = data ?? [];
  if (prospectsOnly) {
    const kept: PersonRow[] = [];
    for (const p of rows.filter((r) => !r.applications?.length)) {
      if (kept.length >= limit) break;
      if (await isProspect(db, p.id)) kept.push(p);
    }
    rows = kept;
  }
  return rows.map((p) => ({
    candidateId: p.id,
    name: p.display_name,
    headline: headline(p.current_title, p.current_company),
    applications: (p.applications ?? []).map((a) => ({
      applicationId: a.id,
      jobId: a.role_id,
      jobTitle: a.roles?.title ?? null,
      stage: a.stage,
    })),
  }));
}

export type CandidateNote = { noteId: string; text: string; author: string | null; createdAt: string; mine: boolean };

export type CandidateDetail = {
  candidateId: string;
  name: string | null;
  headline: string | null;
  /** False for an interviewer: they get the five-field card and their own notes only. */
  full: boolean;
  email: string | null;
  location: string | null;
  linkedinUrl: string | null;
  summary: string | null;
  /** Its tags' names, oldest first; empty for an interviewer. */
  tags: string[];
  applications: Array<{
    applicationId: string;
    jobId: string;
    jobTitle: string | null;
    stage: string;
    /** How they came in (one of CANDIDATE_SOURCES), and which referrer, board or event. */
    source: string;
    sourceDetail: string | null;
    nextAction: string | null;
    nextActionDue: string | null;
    lastTouchAt: string;
    /** Why it closed, at rejected or withdrawn. */
    rejectionReason: string | null;
    rejectionNote: string | null;
    /** The newest offer, for someone who manages the job; null otherwise or when there is none. */
    offer: { offerId: string; status: string } | null;
    /** What they answered on the job post they applied through; null when they did not. */
    answers: ApplicationAnswers | null;
  }>;
  notes: CandidateNote[];
  /** The files the member can read: an interviewer, only the resume. */
  files: CandidateFile[];
  /** Emails to them the member can read (sent ones, and their own drafts); empty for an interviewer. */
  emails: CandidateEmail[];
  /** The custom field values the member can read; empty for an interviewer. */
  customFields: CustomFieldValue[];
  /** In no job at all; always false for an interviewer. */
  prospect: boolean;
  /** How a prospect came in (one of CANDIDATE_SOURCES), and which referrer, board or event. */
  prospectSource: string | null;
  prospectSourceDetail: string | null;
  /** The talent pools they are in, with their stage in each; empty for an interviewer. */
  pools: CandidatePool[];
};

async function notesFor(db: Db, ctx: ClientToolCtx, personId: string): Promise<CandidateNote[]> {
  const { data, error } = await db
    .from("person_notes")
    .select("id, text, actor_id, created_at")
    .eq("person_id", personId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  const authorIds = [...new Set((data ?? []).map((n) => n.actor_id).filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  if (authorIds.length) {
    const { data: members, error: membersError } = await db.from("org_members").select("id, display_name").in("id", authorIds);
    if (membersError) throw new Error(membersError.message);
    for (const m of members ?? []) if (m.id) names.set(m.id, m.display_name ?? "");
  }
  return (data ?? []).map((n) => ({
    noteId: n.id,
    text: n.text,
    author: n.actor_id ? (names.get(n.actor_id) ?? null) : null,
    createdAt: n.created_at,
    mine: n.actor_id === ctx.actorId,
  }));
}

export async function getCandidate(db: Db, ctx: ClientToolCtx, candidateId: string): Promise<CandidateDetail> {
  const notFound = () =>
    new ClientToolError("not_found", "No candidate with that id that you can see. Call search_candidates for the ids.");

  if (ctx.accessLevel === "limited") {
    const { data, error } = await db.rpc("my_interview_candidates");
    if (error) throw new Error(error.message);
    const card = (data ?? []).find((c) => c.person_id === candidateId);
    if (!card) throw notFound();
    return {
      candidateId,
      name: card.display_name,
      headline: headline(card.current_title, card.current_company),
      full: false,
      email: null,
      location: null,
      linkedinUrl: card.linkedin_url,
      summary: null,
      tags: [],
      applications: [],
      notes: await notesFor(db, ctx, candidateId),
      files: await filesFor(db, candidateId),
      emails: [],
      customFields: [],
      prospect: false,
      prospectSource: null,
      prospectSourceDetail: null,
      pools: [],
    };
  }

  const { data: person, error } = await db
    .from("people")
    .select("id, display_name, current_title, current_company, email, location, linkedin_url, summary, prospect_source, prospect_source_detail")
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!person) throw notFound();
  const { data: apps, error: appsError } = await db
    .from("applications")
    .select(
      "id, role_id, stage, source, source_detail, next_action, next_action_due, last_touch_at, rejection_note, roles(title), rejection_reasons(name)",
    )
    .eq("person_id", candidateId)
    .order("last_touch_at", { ascending: false })
    .overrideTypes<
      Array<{
        id: string; role_id: string; stage: string; source: string; source_detail: string | null;
        next_action: string | null; next_action_due: string | null; last_touch_at: string;
        rejection_note: string | null; roles: { title: string } | null; rejection_reasons: { name: string } | null;
      }>,
      { merge: false }
    >();
  if (appsError) throw new Error(appsError.message);
  // Offers read only for someone who manages the job: the policy returns none to anyone else.
  const offers = new Map<string, { offerId: string; status: string }>();
  if (apps?.length) {
    const { data: rows, error: offersError } = await db
      .from("offers").select("id, application_id, status").in("application_id", apps.map((a) => a.id))
      .order("created_at", { ascending: false });
    if (offersError) throw new Error(offersError.message);
    for (const o of rows ?? []) if (!offers.has(o.application_id)) offers.set(o.application_id, { offerId: o.id, status: o.status });
  }
  const answers = await answersFor(db, (apps ?? []).filter((a) => a.source === "job_board").map((a) => a.id));
  return {
    candidateId,
    name: person.display_name,
    headline: headline(person.current_title, person.current_company),
    full: true,
    email: person.email,
    location: person.location,
    linkedinUrl: person.linkedin_url,
    summary: person.summary,
    tags: (await tagsFor(db, [candidateId])).get(candidateId) ?? [],
    applications: (apps ?? []).map((a) => ({
      applicationId: a.id,
      jobId: a.role_id,
      jobTitle: a.roles?.title ?? null,
      stage: a.stage,
      source: a.source,
      sourceDetail: a.source_detail,
      nextAction: a.next_action,
      nextActionDue: a.next_action_due,
      lastTouchAt: a.last_touch_at,
      rejectionReason: a.rejection_reasons?.name ?? null,
      rejectionNote: a.rejection_note,
      offer: offers.get(a.id) ?? null,
      answers: answers.get(a.id) ?? null,
    })),
    notes: await notesFor(db, ctx, candidateId),
    files: await filesFor(db, candidateId),
    emails: await emailsFor(db, ctx, candidateId),
    customFields: (await customFieldValuesFor(db, "candidate", [candidateId])).get(candidateId) ?? [],
    prospect: apps?.length ? false : await isProspect(db, candidateId),
    prospectSource: person.prospect_source,
    prospectSourceDetail: person.prospect_source_detail,
    pools: (await poolsFor(db, [candidateId])).get(candidateId) ?? [],
  };
}

export type TeamMember = { userId: string; name: string; email: string | null; access: string | null };

export async function listTeam(db: Db): Promise<TeamMember[]> {
  const { data, error } = await db.from("org_members").select("id, display_name, email, access_level").order("display_name");
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((m) => m.id)
    .map((m) => ({ userId: m.id!, name: m.display_name ?? "", email: m.email, access: m.access_level }));
}
