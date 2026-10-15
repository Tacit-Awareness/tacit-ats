import type { Db } from "@tacit/db";

import {
  CANDIDATE_SOURCES, SOURCE_DETAIL_MAX, addToPipeline, findPersonByIdentifier, isCandidateSource, parseCandidateIdentity,
  type AddToPipelineResult, type CandidateSource,
} from "@tacit/core";
import { withAudit } from "./audit.js";
import { ClientToolError, LIST_MAX, type ClientToolCtx } from "./context.js";

/**
 * Prospects and talent pools for the client connector
 * (20261016140000_client_pools). Same rules as the rest of client-tools: the
 * member's own client, and the policies decide; the checks here ask the same
 * helpers first only to answer with a sentence.
 *
 * A prospect is a person in the org with no application. They are read by
 * every member above interviewer who is not an external recruiter, changed
 * by whoever added them and by admins, and added by anyone who can add
 * candidates. A talent pool is a named list of people (prospects or
 * candidates) at a pool stage; pools are read by the same members, made by
 * anyone who can add candidates and archived by admins, and worked (people
 * added, moved, removed) by anyone who can add candidates. Interviewers get
 * none of it.
 *
 * A pool is named by its id or its name, ignoring case, matched here over the
 * org's pools (tens of rows), as tags are.
 */

export const POOL_NAME_MAX = 80;
export const POOL_STAGES = ["new", "contacted", "engaged", "not_interested"] as const;
export type PoolStage = (typeof POOL_STAGES)[number];
export const isPoolStage = (v: unknown): v is PoolStage => typeof v === "string" && (POOL_STAGES as readonly string[]).includes(v);

const POOLS_READ_MAX = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PoolRow = { id: string; name: string; archived_at: string | null };

const notForInterviewers = () =>
  new ClientToolError("forbidden", "Interviewers do not see prospects or talent pools.");
const noPool = () => new ClientToolError("not_found", "No talent pool by that name or id. list_pools has them.");
const noCandidate = () =>
  new ClientToolError("not_found", "No candidate with that id that you can see. Call search_candidates for the ids.");
const cannotWorkPools = () =>
  new ClientToolError("forbidden", "Only admins and people who can add candidates add, move or remove people in talent pools.");

function poolName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new ClientToolError("invalid", "A talent pool needs a name.");
  if (name.length > POOL_NAME_MAX) throw new ClientToolError("invalid", `A talent pool's name is at most ${POOL_NAME_MAX} characters.`);
  return name;
}

function poolStage(stage: string | undefined): PoolStage | undefined {
  if (stage === undefined) return undefined;
  if (!isPoolStage(stage)) throw new ClientToolError("invalid", `A pool stage is one of ${POOL_STAGES.join(", ")}.`);
  return stage;
}

function sourceOf(input: { source?: string; sourceDetail?: string | null }): { source: CandidateSource | null; sourceDetail: string | null } {
  if (input.source !== undefined && !isCandidateSource(input.source)) {
    throw new ClientToolError("invalid", `A source is one of ${CANDIDATE_SOURCES.join(", ")}.`);
  }
  const sourceDetail = input.sourceDetail?.trim().replace(/\s+/g, " ") || null;
  if (sourceDetail && sourceDetail.length > SOURCE_DETAIL_MAX) {
    throw new ClientToolError("invalid", `A source detail is at most ${SOURCE_DETAIL_MAX} characters.`);
  }
  return { source: input.source ?? null, sourceDetail };
}

async function readPools(db: Db): Promise<PoolRow[]> {
  const { data, error } = await db.from("talent_pools").select("id, name, archived_at").order("name").limit(POOLS_READ_MAX);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The pool a member named, by id or by name ignoring case; archived ones included. */
export async function findPool(db: Db, pool: string): Promise<PoolRow | null> {
  const wanted = pool.trim();
  if (!wanted) return null;
  const rows = await readPools(db);
  if (UUID.test(wanted)) return rows.find((r) => r.id === wanted.toLowerCase()) ?? null;
  const key = wanted.replace(/\s+/g, " ").toLowerCase();
  return rows.find((r) => r.name.toLowerCase() === key) ?? null;
}

async function canAddPeople(db: Db): Promise<boolean> {
  const { data, error } = await db.rpc("can_add_people");
  if (error) throw new Error(error.message);
  return data === true;
}

async function visiblePerson(db: Db, candidateId: string): Promise<void> {
  const { data, error } = await db.from("people").select("id").eq("id", candidateId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw noCandidate();
}

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

export type Pool = {
  poolId: string;
  name: string;
  archived: boolean;
  /** How many of the people the member can see are in it. */
  members: number;
};

export async function listPools(db: Db, ctx: ClientToolCtx, input: { includeArchived?: boolean } = {}): Promise<Pool[]> {
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  // The embedded count runs under the pool_memberships policy: only people the member can read.
  let q = db.from("talent_pools").select("id, name, archived_at, pool_memberships(count)").order("name").limit(POOLS_READ_MAX);
  if (!input.includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q.overrideTypes<
    Array<PoolRow & { pool_memberships?: Array<{ count: number }> }>,
    { merge: false }
  >();
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({
    poolId: p.id,
    name: p.name,
    archived: p.archived_at !== null,
    members: p.pool_memberships?.[0]?.count ?? 0,
  }));
}

export type CreatePoolResult = { outcome: "created" | "exists" | "restored"; poolId: string; name: string };

/**
 * Makes a talent pool, for anyone who can add candidates. A pool already
 * there under that name (ignoring case) is answered with; an archived one is
 * brought back by an admin, and anyone else is told to ask one.
 */
export async function createPool(db: Db, ctx: ClientToolCtx, input: { name: string }): Promise<CreatePoolResult> {
  const name = poolName(input.name);
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  const existing = await findPool(db, name);
  if (existing && !existing.archived_at) return { outcome: "exists", poolId: existing.id, name: existing.name };
  if (existing) {
    if (ctx.accessLevel !== "admin") {
      throw new ClientToolError("invalid", "A talent pool by that name was archived. An admin at your company can bring it back with create_pool.");
    }
    return withAudit(db, ctx, { action: "pool.restore", entity: "pool" }, async () => {
      const { data, error } = await db
        .from("talent_pools").update({ archived_at: null }).eq("id", existing.id).not("archived_at", "is", null).select("id");
      if (error) throw new Error(error.message);
      const ok = !!data?.length;
      return {
        result: { outcome: ok ? ("restored" as const) : ("exists" as const), poolId: existing.id, name: existing.name },
        entityId: existing.id,
        before: { archived: true },
        after: { archived: false },
        changed: ok,
      };
    });
  }
  if (!(await canAddPeople(db))) {
    throw new ClientToolError("forbidden", "Only admins and people who can add candidates make talent pools. Use one from list_pools.");
  }
  return withAudit<CreatePoolResult>(db, ctx, { action: "pool.create", entity: "pool" }, async () => {
    // Made here and not read back, as every new row a member inserts.
    const poolId = globalThis.crypto.randomUUID();
    const { error } = await db.from("talent_pools").insert({ id: poolId, name });
    if (error?.code === "23505") {
      const raced = await findPool(db, name);
      if (raced) return { result: { outcome: "exists" as const, poolId: raced.id, name: raced.name }, entityId: raced.id, changed: false };
    }
    if (error) throw new Error(error.message);
    return { result: { outcome: "created" as const, poolId, name }, entityId: poolId, after: { name }, changed: true };
  });
}

/** Archives a pool (admins): its people stay in it, and it takes no one new. */
export async function archivePool(
  db: Db,
  ctx: ClientToolCtx,
  input: { pool: string },
): Promise<{ outcome: "archived" | "unchanged"; poolId: string; name: string }> {
  if (ctx.accessLevel !== "admin") throw new ClientToolError("forbidden", "Only an admin at your company archives talent pools.");
  const pool = await findPool(db, input.pool);
  if (!pool) throw noPool();
  if (pool.archived_at) return { outcome: "unchanged", poolId: pool.id, name: pool.name };
  return withAudit(db, ctx, { action: "pool.archive", entity: "pool" }, async () => {
    const { data, error } = await db
      .from("talent_pools").update({ archived_at: new Date().toISOString() }).eq("id", pool.id).is("archived_at", null).select("id");
    if (error) throw new Error(error.message);
    const ok = !!data?.length;
    return {
      result: { outcome: ok ? ("archived" as const) : ("unchanged" as const), poolId: pool.id, name: pool.name },
      entityId: pool.id,
      before: { archived: false },
      after: { archived: true },
      changed: ok,
    };
  });
}

// ---------------------------------------------------------------------------
// People in pools
// ---------------------------------------------------------------------------

export type PoolResult = {
  outcome: "added" | "already_in_pool" | "stage_changed" | "removed" | "not_in_pool";
  poolId: string;
  pool: string;
  /** Their pool stage after the call; null once removed or when they were not in it. */
  stage: PoolStage | null;
};

async function membership(db: Db, poolId: string, personId: string): Promise<{ id: string; stage: PoolStage } | null> {
  const { data, error } = await db
    .from("pool_memberships").select("id, stage").eq("pool_id", poolId).eq("person_id", personId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { id: data.id, stage: data.stage as PoolStage } : null;
}

async function putInPool(db: Db, ctx: ClientToolCtx, pool: PoolRow, personId: string, stage: PoolStage | undefined): Promise<PoolResult> {
  const there = await membership(db, pool.id, personId);
  if (there && (!stage || stage === there.stage)) {
    return { outcome: "already_in_pool", poolId: pool.id, pool: pool.name, stage: there.stage };
  }
  if (there) {
    return withAudit<PoolResult>(db, ctx, { action: "pool.stage_change", entity: "person" }, async () => {
      // Conditional on the stage read, so a move someone made since is not overwritten.
      const { data, error } = await db
        .from("pool_memberships").update({ stage }).eq("id", there.id).eq("stage", there.stage).select("id");
      if (error) throw new Error(error.message);
      const ok = !!data?.length;
      return {
        result: ok
          ? { outcome: "stage_changed" as const, poolId: pool.id, pool: pool.name, stage: stage! }
          : { outcome: "already_in_pool" as const, poolId: pool.id, pool: pool.name, stage: there.stage },
        entityId: personId,
        before: { pool_id: pool.id, stage: there.stage },
        after: { pool_id: pool.id, stage },
        changed: ok,
      };
    });
  }
  if (pool.archived_at) {
    // No name in the sentence: a pool's name is member-written, and refusals go back unfenced.
    throw new ClientToolError("invalid", "That talent pool is archived and takes no one new. Pick another from list_pools.");
  }
  const at = stage ?? "new";
  return withAudit<PoolResult>(db, ctx, { action: "pool.add", entity: "person" }, async () => {
    const { error } = await db.from("pool_memberships").insert({
      id: globalThis.crypto.randomUUID(), pool_id: pool.id, person_id: personId, stage: at, added_by_actor_id: ctx.actorId,
    });
    // Someone else put them there first: the same outcome, and nothing changed.
    if (error?.code === "23505") {
      return { result: { outcome: "already_in_pool" as const, poolId: pool.id, pool: pool.name, stage: at }, entityId: personId, changed: false };
    }
    if (error) throw new Error(error.message);
    return {
      result: { outcome: "added" as const, poolId: pool.id, pool: pool.name, stage: at },
      entityId: personId,
      after: { pool_id: pool.id, stage: at },
      changed: true,
    };
  });
}

/**
 * Puts a candidate or prospect in a pool (at `stage`, new when not said), or,
 * when they are already in it and `stage` is given, moves them to that stage.
 */
export async function addToPool(
  db: Db,
  ctx: ClientToolCtx,
  input: { candidateId: string; pool: string; stage?: string },
): Promise<PoolResult> {
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  const stage = poolStage(input.stage);
  const pool = await findPool(db, input.pool);
  if (!pool) throw noPool();
  await visiblePerson(db, input.candidateId);
  if (!(await canAddPeople(db))) throw cannotWorkPools();
  return putInPool(db, ctx, pool, input.candidateId, stage);
}

export async function removeFromPool(
  db: Db,
  ctx: ClientToolCtx,
  input: { candidateId: string; pool: string },
): Promise<PoolResult> {
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  const pool = await findPool(db, input.pool);
  if (!pool) throw noPool();
  await visiblePerson(db, input.candidateId);
  if (!(await canAddPeople(db))) throw cannotWorkPools();
  const there = await membership(db, pool.id, input.candidateId);
  if (!there) return { outcome: "not_in_pool", poolId: pool.id, pool: pool.name, stage: null };
  return withAudit<PoolResult>(db, ctx, { action: "pool.remove", entity: "person" }, async () => {
    const { data, error } = await db.from("pool_memberships").delete().eq("id", there.id).select("id");
    if (error) throw new Error(error.message);
    const ok = !!data?.length;
    return {
      result: { outcome: ok ? ("removed" as const) : ("not_in_pool" as const), poolId: pool.id, pool: pool.name, stage: null },
      entityId: input.candidateId,
      before: { pool_id: pool.id, stage: there.stage },
      after: {},
      changed: ok,
    };
  });
}

export type PoolMember = {
  candidateId: string;
  name: string | null;
  headline: string | null;
  stage: PoolStage;
  /** How many jobs the member can see them in; 0 for a prospect. */
  jobs: number;
  addedAt: string;
  updatedAt: string;
};

export type PoolView = { poolId: string; name: string; archived: boolean; members: PoolMember[] };

const headline = (title: string | null, company: string | null) =>
  [title, company].filter(Boolean).join(" at ") || null;

/** The people in one pool the member can see, most recently moved first. */
export async function listPool(
  db: Db,
  ctx: ClientToolCtx,
  input: { pool: string; stage?: string; limit?: number },
): Promise<PoolView> {
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  const stage = poolStage(input.stage);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), LIST_MAX);
  const pool = await findPool(db, input.pool);
  if (!pool) throw noPool();
  let q = db
    .from("pool_memberships")
    .select("person_id, stage, created_at, updated_at, people(display_name, current_title, current_company, applications(count))")
    .eq("pool_id", pool.id)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (stage) q = q.eq("stage", stage);
  const { data, error } = await q.overrideTypes<
    Array<{
      person_id: string; stage: PoolStage; created_at: string; updated_at: string;
      people: {
        display_name: string | null; current_title: string | null; current_company: string | null;
        applications?: Array<{ count: number }>;
      } | null;
    }>,
    { merge: false }
  >();
  if (error) throw new Error(error.message);
  return {
    poolId: pool.id,
    name: pool.name,
    archived: pool.archived_at !== null,
    members: (data ?? []).map((m) => ({
      candidateId: m.person_id,
      name: m.people?.display_name ?? null,
      headline: headline(m.people?.current_title ?? null, m.people?.current_company ?? null),
      stage: m.stage,
      jobs: m.people?.applications?.[0]?.count ?? 0,
      addedAt: m.created_at,
      updatedAt: m.updated_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Prospects
// ---------------------------------------------------------------------------

export type AddProspectResult = {
  /** exists: someone already in the company's records under that email, reused and not changed. */
  outcome: "added" | "exists";
  candidateId: string;
  /** The pool asked for, and what happened there; null when none was asked for. */
  pool: PoolResult | null;
};

/**
 * Adds someone to the company's records with no job: a prospect. With an
 * email, someone already on file under it (that the member can see) is
 * reused, not duplicated or changed. `source` and `sourceDetail` say how they
 * came in, and are what their application carries when convert_prospect puts
 * them in a job. With `pool`, they go into that pool at new.
 */
export async function addProspect(
  db: Db,
  ctx: ClientToolCtx,
  input: {
    name: string; email?: string | null; linkedinUrl?: string | null;
    source?: string; sourceDetail?: string | null; pool?: string | null;
  },
): Promise<AddProspectResult> {
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  const who = parseCandidateIdentity(input);
  if ("status" in who) {
    const what = { name: "a name", email: "a valid email address", linkedin: "a linkedin.com profile link" }[who.field];
    throw new ClientToolError("invalid", `That needs ${what}.`);
  }
  const { source, sourceDetail } = sourceOf(input);
  if (!(await canAddPeople(db))) {
    throw new ClientToolError("forbidden", "Only admins and people who can add candidates add prospects.");
  }
  let pool: PoolRow | null = null;
  if (input.pool?.trim()) {
    pool = await findPool(db, input.pool);
    if (!pool) throw noPool();
    if (pool.archived_at) throw new ClientToolError("invalid", "That talent pool is archived and takes no one new. Pick another from list_pools.");
  }

  // Only someone the member can see is found: a person in the org they cannot see gets a second row, as in add_candidate.
  const existing = who.email ? await findPersonByIdentifier(db, "email", who.email, ctx.orgId) : null;
  if (existing) {
    return { outcome: "exists", candidateId: existing, pool: pool ? await putInPool(db, ctx, pool, existing, undefined) : null };
  }

  const candidateId = globalThis.crypto.randomUUID();
  await withAudit(db, ctx, { action: "prospect.add", entity: "person" }, async () => {
    // Named, not left to the tenant trigger, and not read back: the people read
    // policy's helpers cannot see a row inserted by the same statement.
    const { error } = await db.from("people").insert({
      id: candidateId,
      org_id: ctx.orgId,
      display_name: who.name,
      email: who.email,
      linkedin_url: who.linkedinUrl,
      added_by_actor_id: ctx.actorId,
      ...(source ? { prospect_source: source } : {}),
      ...(sourceDetail ? { prospect_source_detail: sourceDetail } : {}),
    });
    if (error) throw new Error(error.message);
    // The source is the record; its detail can name a person and stays with the prospect.
    return { result: null, entityId: candidateId, after: { candidate_id: candidateId, prospect: true, source }, changed: true };
  });
  return { outcome: "added", candidateId, pool: pool ? await putInPool(db, ctx, pool, candidateId, undefined) : null };
}

export type ConvertResult = {
  outcome: "added" | "already_in_pipeline";
  applicationId: string;
  candidateId: string;
  stage: string;
  /** What the new application carries; null when they were already in the job (it keeps its own). */
  source: string | null;
};

/**
 * Puts a prospect (or anyone the member can see) in a job's pipeline at
 * sourced, over the same addToPipeline add_candidate uses. The application
 * takes `source` / `sourceDetail` when given, else the prospect's own, else
 * sourced. Their pools are left as they are.
 */
export async function convertProspect(
  db: Db,
  ctx: ClientToolCtx,
  input: { candidateId: string; jobId: string; source?: string; sourceDetail?: string | null },
): Promise<ConvertResult> {
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  const given = sourceOf(input);
  const { data: person, error } = await db
    .from("people").select("id, prospect_source, prospect_source_detail").eq("id", input.candidateId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!person) throw noCandidate();
  const { data: allowed, error: canError } = await db.rpc("can_on_role", { p_role: input.jobId, perm: "can_edit_pipeline" });
  if (canError) throw new Error(canError.message);
  if (allowed !== true) {
    throw new ClientToolError("forbidden", "You can't add candidates to that job. Ask an admin at your company for hiring-team access to it.");
  }
  const source: CandidateSource = given.source ?? (isCandidateSource(person.prospect_source) ? person.prospect_source : "sourced");
  const sourceDetail = given.source || given.sourceDetail ? given.sourceDetail : person.prospect_source_detail;

  const r = await withAudit<AddToPipelineResult>(db, ctx, { action: "prospect.convert", entity: "application" }, async () => {
    const added = await addToPipeline(db, { personId: person.id, roleId: input.jobId, actorId: ctx.actorId, source, sourceDetail });
    return {
      result: added,
      entityId: added.applicationId,
      // The source is the record; its detail stays with the application.
      after: { job_id: input.jobId, candidate_id: person.id, source },
      changed: added.status === "added",
    };
  });
  return {
    outcome: r.status === "added" ? "added" : "already_in_pipeline",
    applicationId: r.applicationId,
    candidateId: person.id,
    stage: r.status === "exists" ? r.stage : "sourced",
    source: r.status === "added" ? source : null,
  };
}

// ---------------------------------------------------------------------------
// For search_candidates and get_candidate
// ---------------------------------------------------------------------------

export type CandidatePool = { poolId: string; pool: string; stage: PoolStage };

/** The pools each of these people is in, as the member reads them. */
export async function poolsFor(db: Db, personIds: string[]): Promise<Map<string, CandidatePool[]>> {
  const out = new Map<string, CandidatePool[]>();
  if (!personIds.length) return out;
  const { data, error } = await db
    .from("pool_memberships")
    .select("person_id, stage, talent_pools(id, name)")
    .in("person_id", personIds)
    .order("created_at")
    .overrideTypes<Array<{ person_id: string; stage: PoolStage; talent_pools: { id: string; name: string } | null }>, { merge: false }>();
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    if (!row.talent_pools) continue;
    out.set(row.person_id, [...(out.get(row.person_id) ?? []), { poolId: row.talent_pools.id, pool: row.talent_pools.name, stage: row.stage }]);
  }
  return out;
}

/** Everyone the member can see in this pool (an id or a name). Null when there is no such pool. */
export async function peopleInPool(db: Db, pool: string): Promise<string[] | null> {
  const row = await findPool(db, pool);
  if (!row) return null;
  const { data, error } = await db.from("pool_memberships").select("person_id").eq("pool_id", row.id).limit(1000);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((r) => r.person_id))];
}

/** Whether this person is in no pipeline at all, including jobs the member cannot see. */
export async function isProspect(db: Db, personId: string): Promise<boolean> {
  const { data, error } = await db.rpc("person_in_no_pipeline", { p_person: personId });
  if (error) throw new Error(error.message);
  return data === true;
}
