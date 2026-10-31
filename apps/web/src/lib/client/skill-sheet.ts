// Onboarding's Interview skills step, pure (design/tats's `.su-sk`): per person,
// what they know, the teams they are on and the interview types they run. Nothing
// is seeded: an org with no types has none here. No imports, because the step's
// client component needs it.

export type RunState = "off" | "runs" | "starred";

export type SheetPerson = {
  id: string;
  name: string;
  /** Team paths, in the team list's order. */
  teams: string[];
  skills: string[];
  /** The profile's `updated_at`, which a save has to name; null with no profile yet. */
  version: string | null;
  /** Interview type id to starred or not. Absent: they do not run it. */
  runs: Record<string, boolean>;
};

export type SheetType = { id: string; name: string; interviewers: number };
export type SkillSheet = { people: SheetPerson[]; types: SheetType[] };

type PersonRead = { id: string; name: string };
type ProfileRead = { focusAreas: string[]; updatedAt: string };
type TypeRead = { typeId: string; name: string; interviewers: Array<{ memberId: string; prioritized: boolean }> };
type TeamRead = { path: string; members: string[] };

export function buildSkillSheet(people: PersonRead[], profiles: Map<string, ProfileRead>, types: TypeRead[], teams: TeamRead[]): SkillSheet {
  return {
    people: people.map((p) => {
      const profile = profiles.get(p.id);
      return {
        ...p,
        teams: teams.filter((t) => t.members.includes(p.id)).map((t) => t.path),
        skills: profile?.focusAreas ?? [],
        version: profile?.updatedAt ?? null,
        runs: Object.fromEntries(types.flatMap((t) => t.interviewers.filter((i) => i.memberId === p.id).map((i) => [t.typeId, i.prioritized] as const))),
      };
    }),
    types: types.map((t) => ({ id: t.typeId, name: t.name, interviewers: t.interviewers.length })),
  };
}

export const runState = (runs: Record<string, boolean>, typeId: string): RunState => (!Object.hasOwn(runs, typeId) ? "off" : runs[typeId] ? "starred" : "runs");

/** What a click shows before the server answers. Taking someone off a type drops their star with them. */
export function applyRun(runs: Record<string, boolean>, typeId: string, next: RunState): Record<string, boolean> {
  const { [typeId]: _gone, ...rest } = runs;
  return next === "off" ? rest : { ...rest, [typeId]: next === "starred" };
}
