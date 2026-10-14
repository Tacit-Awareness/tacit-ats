import type { Db } from "@tacit/db";

import { getRolePipeline, type PipelineCard } from "../pipeline/pipeline.js";
import { ClientToolError, LIST_MAX, type ClientToolCtx } from "./context.js";
import { filesFor, type CandidateFile } from "./files.js";

export type JobView = {
  jobId: string;
  title: string;
  status: string;
  location: string | null;
  seniority: string | null;
  /** How many candidates the member can see in it; null for an interviewer. */
  inPipeline: number | null;
};

export async function listJobs(db: Db, ctx: ClientToolCtx, input: { status?: string } = {}): Promise<JobView[]> {
  const withCounts = ctx.accessLevel !== "limited";
  let q = db
    .from("roles")
    .select(withCounts ? "id, title, status, location, seniority, applications(count)" : "id, title, status, location, seniority")
    .order("created_at", { ascending: false })
    .limit(LIST_MAX);
  if (input.status) q = q.eq("status", input.status);
  const { data, error } = await q.overrideTypes<
    Array<{ id: string; title: string; status: string; location: string | null; seniority: string | null; applications?: Array<{ count: number }> }>,
    { merge: false }
  >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    jobId: r.id,
    title: r.title,
    status: r.status,
    location: r.location,
    seniority: r.seniority,
    inPipeline: withCounts ? (r.applications?.[0]?.count ?? 0) : null,
  }));
}

export type JobPipeline = {
  jobId: string;
  title: string;
  status: string;
  cards: PipelineCard[];
  stalledCount: number;
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
  return {
    jobId: pipeline.roleId,
    title: pipeline.roleTitle,
    status: pipeline.roleStatus,
    cards: pipeline.cards,
    stalledCount: pipeline.stalledCount,
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
  input: { query?: string; jobId?: string; limit?: number },
): Promise<CandidateHit[]> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), LIST_MAX);
  const query = input.query ? cleanQuery(input.query) : "";

  if (ctx.accessLevel === "limited") {
    // What an interviewer may know: the five fields of the people they interview.
    const { data, error } = await db.rpc("my_interview_candidates");
    if (error) throw new Error(error.message);
    const needle = query.toLowerCase();
    return (data ?? [])
      .filter((c) => !needle || (c.display_name ?? "").toLowerCase().includes(needle))
      .slice(0, limit)
      .map((c) => ({ candidateId: c.person_id, name: c.display_name, headline: headline(c.current_title, c.current_company), applications: [] }));
  }

  let personIds: string[] | null = null;
  if (input.jobId) {
    const { data, error } = await db.from("applications").select("person_id").eq("role_id", input.jobId).limit(500);
    if (error) throw new Error(error.message);
    personIds = [...new Set((data ?? []).map((a) => a.person_id))];
    if (personIds.length === 0) return [];
  }
  let q = db
    .from("people")
    .select("id, display_name, current_title, current_company, applications(id, role_id, stage, roles(title))")
    .order("display_name")
    .limit(limit);
  if (query) {
    const like = `%${query}%`;
    q = q.or(`display_name.ilike.${like},email.ilike.${like},current_company.ilike.${like},current_title.ilike.${like}`);
  }
  if (personIds) q = q.in("id", personIds);
  const { data, error } = await q.overrideTypes<PersonRow[], { merge: false }>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({
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
  applications: Array<{
    applicationId: string;
    jobId: string;
    jobTitle: string | null;
    stage: string;
    nextAction: string | null;
    nextActionDue: string | null;
    lastTouchAt: string;
    /** Why it closed, at rejected or withdrawn. */
    rejectionReason: string | null;
    rejectionNote: string | null;
    /** The newest offer, for someone who manages the job; null otherwise or when there is none. */
    offer: { offerId: string; status: string } | null;
  }>;
  notes: CandidateNote[];
  /** The files the member can read: an interviewer, only the resume. */
  files: CandidateFile[];
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
      applications: [],
      notes: await notesFor(db, ctx, candidateId),
      files: await filesFor(db, candidateId),
    };
  }

  const { data: person, error } = await db
    .from("people")
    .select("id, display_name, current_title, current_company, email, location, linkedin_url, summary")
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!person) throw notFound();
  const { data: apps, error: appsError } = await db
    .from("applications")
    .select("id, role_id, stage, next_action, next_action_due, last_touch_at, rejection_note, roles(title), rejection_reasons(name)")
    .eq("person_id", candidateId)
    .order("last_touch_at", { ascending: false })
    .overrideTypes<
      Array<{
        id: string; role_id: string; stage: string; next_action: string | null; next_action_due: string | null; last_touch_at: string;
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
  return {
    candidateId,
    name: person.display_name,
    headline: headline(person.current_title, person.current_company),
    full: true,
    email: person.email,
    location: person.location,
    linkedinUrl: person.linkedin_url,
    summary: person.summary,
    applications: (apps ?? []).map((a) => ({
      applicationId: a.id,
      jobId: a.role_id,
      jobTitle: a.roles?.title ?? null,
      stage: a.stage,
      nextAction: a.next_action,
      nextActionDue: a.next_action_due,
      lastTouchAt: a.last_touch_at,
      rejectionReason: a.rejection_reasons?.name ?? null,
      rejectionNote: a.rejection_note,
      offer: offers.get(a.id) ?? null,
    })),
    notes: await notesFor(db, ctx, candidateId),
    files: await filesFor(db, candidateId),
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
