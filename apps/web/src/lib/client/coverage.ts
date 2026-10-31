import type { SkillSheet } from "./skill-sheet";

// Onboarding's Review step, pure (design/tats's ivCoverage): the company's totals,
// and who runs each interview type, starred people first. A type with nobody on it
// is a gap. Everything comes from the same sheet as the Interview skills step, so the
// two cannot disagree. The prototype's Grokbots count has nothing behind it here.

export type CoveragePerson = { id: string; name: string; starred: boolean };
export type CoverageRow = { typeId: string; name: string; people: CoveragePerson[] };

export type Coverage = {
  /** Everyone who runs at least one type. */
  interviewers: number;
  teams: number;
  /** On more than one team. */
  multidisciplinary: number;
  types: number;
  covered: number;
  rows: CoverageRow[];
  /** The types nobody runs, by name. */
  gaps: string[];
  state: "no_types" | "gaps" | "covered";
};

export function coverageOf(sheet: SkillSheet, teams: number): Coverage {
  const rows = sheet.types.map((t) => ({
    typeId: t.id,
    name: t.name,
    people: sheet.people
      .filter((p) => Object.hasOwn(p.runs, t.id))
      .map((p) => ({ id: p.id, name: p.name, starred: p.runs[t.id] }))
      .sort((a, b) => Number(b.starred) - Number(a.starred) || a.name.localeCompare(b.name)),
  }));
  const gaps = rows.filter((r) => !r.people.length).map((r) => r.name);
  return {
    interviewers: sheet.people.filter((p) => Object.keys(p.runs).length > 0).length,
    teams,
    multidisciplinary: sheet.people.filter((p) => p.teams.length > 1).length,
    types: rows.length,
    covered: rows.length - gaps.length,
    rows,
    gaps,
    state: !rows.length ? "no_types" : gaps.length ? "gaps" : "covered",
  };
}
