import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { readOwnProfile, scanRows } from "./interviewers";
import { readMembers } from "./member-access";
import { buildSkillSheet, type SkillSheet } from "./skill-sheet";
import { buildTeamMatrix, type TeamMatrix } from "./team-matrix";

// What Onboarding's Teams and Interview skills steps read and save, on the
// member's own token. People come from the same read as the checklist's, so the
// rows on the page are the people it wants placed: the invited too.

const people = async (db: Db) => {
  const { rows, truncated } = await readMembers(db);
  return { people: rows.flatMap((m) => (m.id ? [{ id: m.id, name: m.display_name ?? m.email ?? "Unnamed" }] : [])), truncated };
};

export type TeamsRead = { matrix: TeamMatrix; truncated: boolean };

export async function readTeamMatrix(db: Db, ctx: clientTools.ClientToolCtx): Promise<TeamsRead> {
  const [members, teams, departments] = await Promise.all([people(db), clientTools.listTeams(db, ctx), clientTools.listDepartments(db, ctx, { includeArchived: true })]);
  const nodes = departments.map((d) => ({ id: d.departmentId, name: d.name, parentId: d.parentId, archived: d.archived }));
  return { matrix: buildTeamMatrix(members.people, nodes, teams), truncated: members.truncated };
}

export type SkillsRead = { sheet: SkillSheet; truncated: boolean };

export async function readSkillSheet(db: Db, ctx: clientTools.ClientToolCtx): Promise<SkillsRead> {
  const [{ matrix, truncated }, types, profiles] = await Promise.all([
    readTeamMatrix(db, ctx),
    clientTools.listInterviewTypes(db, ctx),
    scanRows((from, to) => db.from("interviewer_profiles").select(clientTools.PROFILE_COLUMNS).order("actor_id").range(from, to)),
  ]);
  const read = new Map(profiles.rows.map((r) => [r.actor_id, clientTools.profileFromRow(r)]));
  return { sheet: buildSkillSheet(matrix.people, read, types, matrix.teams), truncated };
}

/**
 * Saves one member's skills and leaves the rest of their profile as it stands.
 * clientTools.setInterviewerProfile writes the whole profile and checks the
 * version the page showed, so a save made since the page read it comes back
 * `stale` and overwrites nothing, whether it landed before this read or after.
 */
export async function saveFocusAreas(db: Db, ctx: clientTools.ClientToolCtx, input: { memberId: string; expectedUpdatedAt: string | null; focusAreas: string[] }) {
  const current = await readOwnProfile(db, input.memberId);
  return clientTools.setInterviewerProfile(db, ctx, {
    memberId: input.memberId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    profile: {
      preference: current?.preference ?? null,
      weeklyCap: current?.weeklyCap ?? null,
      focusAreas: input.focusAreas,
      channel: current?.channel ?? null,
      awayUntil: current?.awayUntil ?? null,
    },
  });
}
