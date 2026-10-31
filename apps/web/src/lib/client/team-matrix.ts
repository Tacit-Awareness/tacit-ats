import { departmentOptions, type DepartmentNode } from "./department-tree";

// Onboarding's Teams step, pure (design/tats's `.su-mx`): who is on which team,
// with each team labelled by its path, "Engineering › Platform". The departments
// come whole, since a live team can sit inside an archived one and its path still
// names it; only live ones become a team here. `applyTeamChange` is what a tick
// shows before the server has answered.

export type MatrixPerson = { id: string; name: string };
export type MatrixTeam = { id: string; name: string; path: string; depth: number; members: string[]; lead: string | null };
export type TeamMatrix = { people: MatrixPerson[]; teams: MatrixTeam[] };

export type TeamChange =
  | { kind: "member"; teamId: string; memberId: string; on: boolean }
  /** A lead who was not on the team joins it, as core's setTeamLead does. Null clears the lead. */
  | { kind: "lead"; teamId: string; memberId: string | null };

type TeamRead = { departmentId: string; members: Array<{ memberId: string; lead: boolean }> };

export function buildTeamMatrix(people: MatrixPerson[], departments: DepartmentNode[], teams: TeamRead[]): TeamMatrix {
  const read = new Map(teams.map((t) => [t.departmentId, t.members]));
  return {
    people,
    teams: departmentOptions(departments).map((o) => {
      const members = read.get(o.id) ?? [];
      return { ...o, members: members.map((m) => m.memberId), lead: members.find((m) => m.lead)?.memberId ?? null };
    }),
  };
}

export const teamsOf = (matrix: TeamMatrix, memberId: string) => matrix.teams.filter((t) => t.members.includes(memberId));

/** On more than one team: they can interview across both. */
export const isMultidisciplinary = (matrix: TeamMatrix, memberId: string) => teamsOf(matrix, memberId).length > 1;

function change(team: MatrixTeam, c: TeamChange): MatrixTeam {
  if (c.kind === "lead") {
    const joins = c.memberId !== null && !team.members.includes(c.memberId);
    return { ...team, lead: c.memberId, members: joins ? [...team.members, c.memberId!] : team.members };
  }
  if (c.on) return team.members.includes(c.memberId) ? team : { ...team, members: [...team.members, c.memberId] };
  return { ...team, members: team.members.filter((m) => m !== c.memberId), lead: team.lead === c.memberId ? null : team.lead };
}

export const applyTeamChange = (matrix: TeamMatrix, c: TeamChange): TeamMatrix => ({
  ...matrix,
  teams: matrix.teams.map((t) => (t.id === c.teamId ? change(t, c) : t)),
});
