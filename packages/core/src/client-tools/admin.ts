import type { Db } from "@tacit/db";

import {
  inviteClientMember, listPendingInvites, withdrawClientInvite, ClientInviteError,
  type InvitationRevoker, type PendingInvite,
} from "../client-auth/invite.js";
import type { IdentityProvider } from "@tacit/core";
import { withAudit } from "./audit.js";
import { ClientToolError, type AccessLevel, type ClientToolCtx } from "./context.js";
import { OPENINGS_ADD_MAX, insertOpenings } from "./openings.js";
import { liveDepartment, liveOffices } from "./structure.js";

/**
 * The client connector's admin tools: jobs, each job's hiring team, and the
 * company's members. Same rules as reads.ts and writes.ts: the member's own
 * client, the policies decide, and the code asks first only to answer with a
 * sentence. Two things are done differently on purpose:
 *
 * - New rows get their id here and are not read back. The read policies on
 *   roles and people call helpers that look the row up in a snapshot taken
 *   before the insert, so `insert ... returning` is refused for the very row
 *   the member was allowed to insert.
 * - access_level is written through set_org_member_access
 *   (20261014200000): `authenticated` cannot write actors at all.
 */

export const JOB_STATUSES = ["open", "paused", "filled", "closed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const TEAM_ROLES = ["hiring_manager", "recruiter", "coordinator", "sourcer", "interviewer"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

const TITLE_MAX = 200;
const FIELD_MAX = 200;
const DESCRIPTION_MAX = 20_000;

const notAdmin = (what: string) =>
  new ClientToolError("forbidden", `Only an admin at your company can ${what}.`);

const clean = (value: string | null | undefined, max: number, label: string): string | null | undefined => {
  if (value === undefined) return undefined;
  const v = value?.trim() || null;
  if (v && v.length > max) throw new ClientToolError("invalid", `${label} is at most ${max} characters.`);
  return v;
};

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export type JobInput = {
  title: string;
  status?: JobStatus;
  location?: string | null;
  seniority?: string | null;
  description?: string | null;
  /** A department's id or name (list_departments); null clears it on update. */
  department?: string | null;
  /** Offices' ids or names (list_offices): on update, the job's whole set. */
  offices?: string[];
};

/** The company a client's jobs hang off: its oldest companies row, made from the org's name the first time. */
async function ownCompany(db: Db, ctx: ClientToolCtx): Promise<string> {
  const { data, error } = await db.from("companies").select("id").order("created_at").limit(1);
  if (error) throw new Error(error.message);
  if (data?.[0]) return data[0].id;
  const { data: org, error: orgError } = await db.from("orgs").select("name").eq("id", ctx.orgId).maybeSingle();
  if (orgError) throw new Error(orgError.message);
  const id = globalThis.crypto.randomUUID();
  const { error: insertError } = await db.from("companies").insert({ id, name: org?.name ?? "Our company" });
  if (insertError) throw new Error(insertError.message);
  return id;
}

export type CreatedJob = {
  jobId: string;
  title: string;
  status: JobStatus;
  department: string | null;
  offices: string[];
  /** How many openings it was made with. */
  openings: number;
};

/**
 * Makes a job, in a department and offices when given, with `openings` open
 * seats: 1 unless said, none for a job made filled or closed.
 */
export async function createJob(db: Db, ctx: ClientToolCtx, input: JobInput & { openings?: number }): Promise<CreatedJob> {
  if (ctx.accessLevel !== "admin") throw notAdmin("create a job");
  const title = clean(input.title, TITLE_MAX, "A title");
  if (!title) throw new ClientToolError("invalid", "A job needs a title.");
  const status = input.status ?? "open";
  if (!JOB_STATUSES.includes(status)) throw new ClientToolError("invalid", `A job's status is one of ${JOB_STATUSES.join(", ")}.`);
  const fields = {
    location: clean(input.location, FIELD_MAX, "A location") ?? null,
    seniority: clean(input.seniority, FIELD_MAX, "A level") ?? null,
    description: clean(input.description, DESCRIPTION_MAX, "A description") ?? null,
  };
  const openings = input.openings ?? (status === "open" || status === "paused" ? 1 : 0);
  if (!Number.isInteger(openings) || openings < 0 || openings > OPENINGS_ADD_MAX) {
    throw new ClientToolError("invalid", `A new job has between 0 and ${OPENINGS_ADD_MAX} openings.`);
  }
  const department = input.department?.trim() ? await liveDepartment(db, input.department) : null;
  const offices = await liveOffices(db, input.offices ?? []);

  return withAudit<CreatedJob>(db, ctx, { action: "role.create", entity: "role" }, async () => {
    const companyId = await ownCompany(db, ctx);
    const jobId = globalThis.crypto.randomUUID();
    const { error } = await db.from("roles").insert({
      id: jobId, company_id: companyId, title, status, ...fields, ...(department ? { department_id: department.id } : {}),
    });
    if (error) throw new Error(error.message);
    if (offices.length) {
      const { error: officeError } = await db
        .from("job_offices").insert(offices.map((o) => ({ id: globalThis.crypto.randomUUID(), role_id: jobId, office_id: o.id })));
      if (officeError) throw new Error(officeError.message);
    }
    if (openings) await insertOpenings(db, jobId, openings);
    return {
      result: { jobId, title, status, department: department?.name ?? null, offices: offices.map((o) => o.name), openings },
      entityId: jobId,
      after: {
        title, status, ...fields,
        ...(department ? { department_id: department.id } : {}),
        ...(offices.length ? { office_ids: offices.map((o) => o.id) } : {}),
        openings,
      },
      changed: true,
    };
  });
}

type JobRow = {
  id: string; title: string; status: string; location: string | null; seniority: string | null; description: string | null;
  department_id: string | null;
};

async function visibleJob(db: Db, jobId: string): Promise<JobRow> {
  const { data, error } = await db
    .from("roles").select("id, title, status, location, seniority, description, department_id").eq("id", jobId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ClientToolError("not_found", "No job with that id that you can see. Call list_jobs for the ids.");
  return data;
}

async function canManage(db: Db, jobId: string): Promise<boolean> {
  const { data, error } = await db.rpc("can_on_role", { p_role: jobId, perm: "can_manage_job" });
  if (error) throw new Error(error.message);
  return data === true;
}

export type JobChange = Partial<Omit<JobInput, "title">> & { title?: string };

/**
 * Changes what is given. `department` is an id or name, or null to clear;
 * `offices` is the job's whole set of offices, [] for none. `changed` names
 * the columns, plus "department" and "offices".
 */
export async function updateJob(
  db: Db,
  ctx: ClientToolCtx,
  input: { jobId: string } & JobChange,
): Promise<{ outcome: "updated" | "unchanged"; changed: string[] }> {
  const next: Partial<Record<Exclude<keyof JobRow, "id" | "department_id">, string | null>> = {};
  if (input.title !== undefined) {
    const title = clean(input.title, TITLE_MAX, "A title");
    if (!title) throw new ClientToolError("invalid", "A job needs a title.");
    next.title = title;
  }
  if (input.status !== undefined) {
    if (!JOB_STATUSES.includes(input.status)) throw new ClientToolError("invalid", `A job's status is one of ${JOB_STATUSES.join(", ")}.`);
    next.status = input.status;
  }
  for (const [key, max, label] of [["location", FIELD_MAX, "A location"], ["seniority", FIELD_MAX, "A level"], ["description", DESCRIPTION_MAX, "A description"]] as const) {
    const v = clean(input[key], max, label);
    if (v !== undefined) next[key] = v;
  }

  const job = await visibleJob(db, input.jobId);
  if (!(await canManage(db, job.id))) throw new ClientToolError("forbidden", "You can see that job but not change it. Ask an admin at your company.");
  const columns = (Object.keys(next) as Array<keyof typeof next>).filter((k) => next[k] !== job[k]);
  const patch: Record<string, string | null> = Object.fromEntries(columns.map((k) => [k, next[k] ?? null]));
  const before: Record<string, unknown> = Object.fromEntries(columns.map((k) => [k, job[k]]));
  const changed: string[] = [...columns];

  if (input.department !== undefined) {
    const department = input.department?.trim() ? await liveDepartment(db, input.department, job.department_id) : null;
    if ((department?.id ?? null) !== job.department_id) {
      patch.department_id = department?.id ?? null;
      before.department_id = job.department_id;
      changed.push("department");
    }
  }
  let officesAdd: string[] = [];
  let officesRemove: string[] = [];
  if (input.offices !== undefined) {
    const { data: current, error } = await db.from("job_offices").select("office_id").eq("role_id", job.id);
    if (error) throw new Error(error.message);
    const had = (current ?? []).map((o) => o.office_id);
    const want = (await liveOffices(db, input.offices, had)).map((o) => o.id);
    officesAdd = want.filter((id) => !had.includes(id));
    officesRemove = had.filter((id) => !want.includes(id));
    if (officesAdd.length || officesRemove.length) {
      before.office_ids = had;
      changed.push("offices");
    }
  }
  if (!changed.length) return { outcome: "unchanged", changed: [] };

  return withAudit(db, ctx, { action: "role.update", entity: "role" }, async () => {
    let ok = false;
    if (Object.keys(patch).length) {
      const { data, error } = await db
        .from("roles").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", job.id).select("id");
      // 22023: the job_open approval gate (20261016110000_client_approvals) refused opening it.
      if (error?.code === "22023") {
        throw new ClientToolError("invalid", `Not saved: ${error.message}. request_approval with the job_id asks for it.`);
      }
      if (error) throw new Error(error.message);
      ok = !!data?.length;
    }
    if (officesRemove.length) {
      const { data, error } = await db
        .from("job_offices").delete().eq("role_id", job.id).in("office_id", officesRemove).select("id");
      if (error) throw new Error(error.message);
      ok = ok || !!data?.length;
    }
    if (officesAdd.length) {
      const { error } = await db
        .from("job_offices").insert(officesAdd.map((id) => ({ id: globalThis.crypto.randomUUID(), role_id: job.id, office_id: id })));
      // Someone added it first: the job is in that office either way.
      if (error && error.code !== "23505") throw new Error(error.message);
      ok = true;
    }
    return {
      result: ok ? { outcome: "updated" as const, changed } : { outcome: "unchanged" as const, changed: [] },
      entityId: job.id,
      before,
      after: {
        ...patch,
        ...(changed.includes("offices") ? { office_ids_added: officesAdd, office_ids_removed: officesRemove } : {}),
      },
      changed: ok,
    };
  });
}

// ---------------------------------------------------------------------------
// Hiring team
// ---------------------------------------------------------------------------

export type HiringTeamMember = {
  userId: string;
  name: string | null;
  teamRoles: TeamRole[];
  /** The access role this member holds on the job (Hiring Manager, Admin, ...), or null. */
  access: string | null;
  /** True when an admin set that access by hand rather than through the team. */
  accessSetByHand: boolean;
};

export async function getHiringTeam(db: Db, _ctx: ClientToolCtx, jobId: string): Promise<{ jobId: string; title: string; team: HiringTeamMember[] }> {
  const job = await visibleJob(db, jobId);
  const [team, access] = await Promise.all([
    db.from("hiring_team").select("actor_id, team_role").eq("role_id", job.id),
    db.from("job_access").select("actor_id, source, access_roles(name)").eq("role_id", job.id)
      .overrideTypes<Array<{ actor_id: string; source: string; access_roles: { name: string } | null }>, { merge: false }>(),
  ]);
  if (team.error) throw new Error(team.error.message);
  if (access.error) throw new Error(access.error.message);

  const byActor = new Map<string, HiringTeamMember>();
  const member = (id: string) => {
    let m = byActor.get(id);
    if (!m) byActor.set(id, (m = { userId: id, name: null, teamRoles: [], access: null, accessSetByHand: false }));
    return m;
  };
  for (const t of team.data ?? []) member(t.actor_id).teamRoles.push(t.team_role as TeamRole);
  for (const a of access.data ?? []) {
    const m = member(a.actor_id);
    m.access = a.access_roles?.name ?? null;
    m.accessSetByHand = a.source === "manual";
  }
  if (byActor.size) {
    const { data, error } = await db.from("org_members").select("id, display_name").in("id", [...byActor.keys()]);
    if (error) throw new Error(error.message);
    for (const m of data ?? []) if (m.id && byActor.has(m.id)) byActor.get(m.id)!.name = m.display_name;
  }
  return { jobId: job.id, title: job.title, team: [...byActor.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")) };
}

async function activeMember(db: Db, userId: string): Promise<{ id: string; name: string | null }> {
  const { data, error } = await db
    .from("org_members").select("id, display_name").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  // org_members is the active members of the caller's org: anyone else is not found.
  if (!data?.id) {
    throw new ClientToolError("not_found", "No one at your company with that user id. Call list_team for the ids.");
  }
  return { id: data.id, name: data.display_name };
}

async function teamGate(db: Db, ctx: ClientToolCtx, jobId: string) {
  if (ctx.accessLevel !== "admin") throw notAdmin("change a job's hiring team");
  const job = await visibleJob(db, jobId);
  if (!(await canManage(db, job.id))) throw new ClientToolError("forbidden", "That job is confidential, and you are not on it.");
  return job;
}

export async function addToHiringTeam(
  db: Db,
  ctx: ClientToolCtx,
  input: { jobId: string; userId: string; teamRole: TeamRole },
): Promise<{ outcome: "added" | "already_on_team" }> {
  if (!TEAM_ROLES.includes(input.teamRole)) throw new ClientToolError("invalid", `A team role is one of ${TEAM_ROLES.join(", ")}.`);
  const job = await teamGate(db, ctx, input.jobId);
  const who = await activeMember(db, input.userId);
  return withAudit(db, ctx, { action: "hiring_team.add", entity: "role" }, async () => {
    const { data, error } = await db
      .from("hiring_team")
      .upsert({ role_id: job.id, actor_id: who.id, team_role: input.teamRole }, { onConflict: "role_id,actor_id,team_role", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(error.message);
    const added = !!data?.length;
    return {
      result: { outcome: added ? ("added" as const) : ("already_on_team" as const) },
      entityId: job.id,
      after: { user_id: who.id, team_role: input.teamRole },
      changed: added,
    };
  });
}

export async function removeFromHiringTeam(
  db: Db,
  ctx: ClientToolCtx,
  input: { jobId: string; userId: string; teamRole?: TeamRole },
): Promise<{ outcome: "removed" | "not_on_team"; removed: TeamRole[] }> {
  if (input.teamRole !== undefined && !TEAM_ROLES.includes(input.teamRole)) {
    throw new ClientToolError("invalid", `A team role is one of ${TEAM_ROLES.join(", ")}.`);
  }
  const job = await teamGate(db, ctx, input.jobId);
  return withAudit(db, ctx, { action: "hiring_team.remove", entity: "role" }, async () => {
    let q = db.from("hiring_team").delete().eq("role_id", job.id).eq("actor_id", input.userId);
    if (input.teamRole) q = q.eq("team_role", input.teamRole);
    const { data, error } = await q.select("team_role");
    if (error) throw new Error(error.message);
    const removed = (data ?? []).map((r) => r.team_role as TeamRole);
    return {
      result: { outcome: removed.length ? ("removed" as const) : ("not_on_team" as const), removed },
      entityId: job.id,
      before: { user_id: input.userId, team_roles: removed },
      after: {},
      changed: removed.length > 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

const LEVELS: readonly AccessLevel[] = ["limited", "elevated", "admin"];

export async function setMemberAccess(
  db: Db,
  ctx: ClientToolCtx,
  input: { userId: string; access: AccessLevel },
): Promise<{ outcome: "changed" | "unchanged"; previous: AccessLevel; access: AccessLevel }> {
  if (ctx.accessLevel !== "admin") throw notAdmin("change someone's access");
  if (!LEVELS.includes(input.access)) throw new ClientToolError("invalid", "Access is interviewer, hiring team or admin.");
  const who = await activeMember(db, input.userId);
  return withAudit(db, ctx, { action: "member.access_change", entity: "actor" }, async () => {
    const { data, error } = await db.rpc("set_org_member_access", { p_actor: who.id, p_access_level: input.access });
    if (error) {
      if (error.code === "23514") throw new ClientToolError("invalid", "Your company would have no admin left. Make someone else an admin first.");
      if (error.code === "42501") throw notAdmin("change someone's access");
      if (error.code === "22023") throw new ClientToolError("not_found", "No one at your company with that user id. Call list_team for the ids.");
      throw new Error(error.message);
    }
    const previous = data as AccessLevel;
    const changed = previous !== input.access;
    return {
      result: { outcome: changed ? ("changed" as const) : ("unchanged" as const), previous, access: input.access },
      entityId: who.id,
      before: { access_level: previous },
      after: { access_level: input.access },
      changed,
    };
  });
}

/** WorkOS for invitations, and the member's own WorkOS identity: the org on their token, and them as the inviter. */
export type InviteDeps = {
  invitations: (IdentityProvider & InvitationRevoker) | null;
  workosOrgId: string;
  inviterUserId: string;
};

const inviteRefusal = (err: unknown): never => {
  if (!(err instanceof ClientInviteError)) throw err;
  switch (err.code) {
    case "forbidden":
      throw new ClientToolError("forbidden", "Only an admin at your company can invite people.");
    case "already_member":
      throw new ClientToolError("invalid", "That person is already a member of your company's workspace.");
    case "provider_failed":
      throw new ClientToolError("invalid", "The invitation email could not be sent, so nobody was invited. Try again.");
    default:
      throw new ClientToolError("invalid", `That was refused: ${err.message}.`);
  }
};

const NAME_MAX = 120;

export async function inviteMember(
  db: Db,
  ctx: ClientToolCtx,
  deps: InviteDeps,
  input: { email: string; name: string; access: AccessLevel },
): Promise<{ outcome: "invited" | "resent"; userId: string }> {
  if (ctx.accessLevel !== "admin") throw notAdmin("invite people");
  if (!deps.invitations) throw new ClientToolError("forbidden", "Inviting people is not turned on for this connector yet. Use the Tacit workspace instead.");
  const name = input.name.trim();
  if (!name || name.length > NAME_MAX) throw new ClientToolError("invalid", `A name is 1 to ${NAME_MAX} characters.`);
  if (!LEVELS.includes(input.access)) throw new ClientToolError("invalid", "Access is interviewer, hiring team or admin.");
  const invitations = deps.invitations;
  return withAudit(db, ctx, { action: "member.invite", entity: "actor" }, async () => {
    const r = await inviteClientMember(db, invitations, {
      email: input.email, displayName: name, accessLevel: input.access,
      workosOrgId: deps.workosOrgId, inviterUserId: deps.inviterUserId,
    }).catch(inviteRefusal);
    return {
      result: { outcome: r.resent ? ("resent" as const) : ("invited" as const), userId: r.actorId },
      entityId: r.actorId,
      after: { email: input.email.trim().toLowerCase(), access_level: input.access, resent: r.resent },
      changed: true,
    };
  });
}

export async function listInvites(db: Db, ctx: ClientToolCtx): Promise<PendingInvite[]> {
  if (ctx.accessLevel !== "admin") throw notAdmin("see who is invited");
  return listPendingInvites(db);
}

export async function withdrawInvite(
  db: Db,
  ctx: ClientToolCtx,
  deps: InviteDeps,
  input: { userId: string },
): Promise<{ outcome: "withdrawn" | "not_pending" }> {
  if (ctx.accessLevel !== "admin") throw notAdmin("withdraw an invitation");
  const revoker: InvitationRevoker = deps.invitations ?? { revokeInvitations: async () => {} };
  return withAudit(db, ctx, { action: "member.withdraw_invite", entity: "actor" }, async () => {
    const r = await withdrawClientInvite(db, revoker, { actorId: input.userId, workosOrgId: deps.workosOrgId }).catch(inviteRefusal);
    return {
      result: { outcome: r.withdrawn ? ("withdrawn" as const) : ("not_pending" as const) },
      entityId: input.userId,
      before: { user_id: input.userId },
      after: {},
      changed: r.withdrawn,
    };
  });
}
