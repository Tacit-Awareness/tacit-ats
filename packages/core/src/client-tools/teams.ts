import type { Db } from "@tacit/db";

import { activeMember } from "./admin.js";
import { withAudit } from "./audit.js";
import { memberNames, readAllPages, requireSetupAdmin, requireSetupReader } from "./company-setup.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { listDepartments, liveDepartment, pickByRef, readDepartments } from "./structure.js";

/**
 * Who is on which team (department_members, tacit-internal
 * 20261031120000_tats_onboarding): a team is a department, a member may be on
 * several, and a team has at most one lead. Admins write on their own token;
 * admins and the company's own hiring team read (company-setup.ts).
 *
 * A row outlives its department being archived and its member leaving, so
 * listTeams leaves both out, and a lead who has left is no lead here. Their row
 * still holds the lead's place in the table's unique index, though, so setTeamLead
 * reads every lead row, not only the ones the list would show.
 */

export type TeamMember = { memberId: string; name: string; lead: boolean };

export type Team = {
  departmentId: string;
  name: string;
  parentId: string | null;
  /** Outermost first, ending with this one: "Engineering > Platform". */
  path: string;
  /** Lead first, then by name. */
  members: TeamMember[];
};

type MembershipRow = { department_id: string; actor_id: string; is_lead: boolean };

const departmentGone = () => new ClientToolError("not_found", "No team by that name or id.");
const leadRaced = () => new ClientToolError("invalid", "Someone changed this team's lead just now. Look again and retry.");

/** Every live team and its active members. */
export async function listTeams(db: Db, ctx: ClientToolCtx): Promise<Team[]> {
  await requireSetupReader(db, ctx);
  const [departments, rows, names] = await Promise.all([
    listDepartments(db, ctx),
    readAllPages<MembershipRow>((from, to) =>
      db.from("department_members").select("department_id, actor_id, is_lead").order("department_id").order("actor_id").range(from, to),
    ),
    memberNames(db),
  ]);
  return departments.map((d) => ({
    departmentId: d.departmentId,
    name: d.name,
    parentId: d.parentId,
    path: d.path,
    members: rows
      .filter((r) => r.department_id === d.departmentId && names.has(r.actor_id))
      .map((r) => ({ memberId: r.actor_id, name: names.get(r.actor_id) ?? "", lead: r.is_lead }))
      .sort((a, b) => Number(b.lead) - Number(a.lead) || a.name.localeCompare(b.name)),
  }));
}

export type TeamMemberChange = { outcome: "added" | "already_on_team"; departmentId: string };

export async function addTeamMember(db: Db, ctx: ClientToolCtx, input: { department: string; memberId: string }): Promise<TeamMemberChange> {
  requireSetupAdmin(ctx, "change who is on a team");
  const team = await liveDepartment(db, input.department);
  const who = await activeMember(db, input.memberId);
  return withAudit(db, ctx, { action: "department.member_add", entity: "department" }, async () => {
    const { error } = await db.from("department_members").insert({ department_id: team.id, actor_id: who.id });
    if (error && error.code !== "23505") throw new Error(error.message);
    const added = !error;
    return {
      result: { outcome: added ? ("added" as const) : ("already_on_team" as const), departmentId: team.id },
      entityId: team.id,
      after: { actor_id: who.id },
      changed: added,
    };
  });
}

/**
 * Takes a member off a team, lead or not (the team then has no lead). Works on
 * an archived team, and for someone who has left: that is the row a page hides.
 */
export async function removeTeamMember(
  db: Db,
  ctx: ClientToolCtx,
  input: { department: string; memberId: string },
): Promise<{ outcome: "removed" | "not_on_team"; departmentId: string; wasLead: boolean }> {
  requireSetupAdmin(ctx, "change who is on a team");
  const team = pickByRef(await readDepartments(db), input.department);
  if (!team) throw departmentGone();
  return withAudit(db, ctx, { action: "department.member_remove", entity: "department" }, async () => {
    const { data, error } = await db
      .from("department_members").delete().eq("department_id", team.id).eq("actor_id", input.memberId).select("is_lead");
    if (error) throw new Error(error.message);
    const removed = !!data?.length;
    const wasLead = data?.[0]?.is_lead === true;
    return {
      result: { outcome: removed ? ("removed" as const) : ("not_on_team" as const), departmentId: team.id, wasLead },
      entityId: team.id,
      after: { actor_id: input.memberId, was_lead: wasLead },
      changed: removed,
    };
  });
}

export type TeamLeadChange = {
  outcome: "changed" | "unchanged";
  departmentId: string;
  leadId: string | null;
  /** The new lead was not on the team, and now is. */
  added: boolean;
};

/**
 * Makes a member the team's lead, adding them if they are not on it, or clears
 * the lead with null. The table's one-lead index is checked row by row, so the
 * old lead's row goes first in one upsert: one statement, so a refusal leaves the
 * old lead standing and two changes at once cannot leave a team with two.
 */
export async function setTeamLead(
  db: Db,
  ctx: ClientToolCtx,
  input: { department: string; memberId: string | null },
): Promise<TeamLeadChange> {
  requireSetupAdmin(ctx, "change a team's lead");
  const team = await liveDepartment(db, input.department);
  const next = input.memberId === null ? null : (await activeMember(db, input.memberId)).id;
  // Lead first, so a read cut off at the database's 1000 rows still finds them.
  const { data, error } = await db.from("department_members").select("actor_id, is_lead").eq("department_id", team.id).order("is_lead", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const current = rows.find((r) => r.is_lead)?.actor_id ?? null;
  if (current === next) return { outcome: "unchanged", departmentId: team.id, leadId: next, added: false };
  const added = next !== null && !rows.some((r) => r.actor_id === next);

  return withAudit(db, ctx, { action: "department.lead", entity: "department" }, async () => {
    const write = [
      ...(current ? [{ department_id: team.id, actor_id: current, is_lead: false }] : []),
      ...(next ? [{ department_id: team.id, actor_id: next, is_lead: true }] : []),
    ];
    const { error: writeError } = await db.from("department_members").upsert(write, { onConflict: "department_id,actor_id" });
    if (writeError) {
      // 23505: another lead landed first. 23503: the old lead's actor went since the read.
      if (writeError.code === "23505" || writeError.code === "23503") throw leadRaced();
      throw new Error(writeError.message);
    }
    return {
      result: { outcome: "changed" as const, departmentId: team.id, leadId: next, added },
      entityId: team.id,
      before: { lead: current },
      after: { lead: next },
      changed: true,
    };
  });
}
