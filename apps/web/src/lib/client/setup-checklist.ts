// Onboarding's five steps and the checklist beside them (design/tats's
// SETUP_STEPS and setupDone), pure. Done-ness is computed from what the company
// has set up, every time: nothing stores it, so undoing a thing un-ticks it. The
// prototype's Grokbot half of People and its `setupSaved` flag have no place
// here: People is done once there is someone besides the first admin, and Review
// is done when the other four are.

export const SETUP_STEPS = [
  { key: "people", label: "People" },
  { key: "teams", label: "Teams" },
  { key: "skills", label: "Interview skills" },
  { key: "process", label: "Interview process" },
  { key: "review", label: "Review" },
] as const;

export type SetupStep = (typeof SETUP_STEPS)[number]["key"];

export const stepHref = (step: SetupStep) => `/client/onboarding/${step}`;

/** The step a path is on; anything else under Onboarding is its first step. */
export function stepOf(pathname: string): SetupStep {
  const segment = pathname.split("/")[3];
  return SETUP_STEPS.find((s) => s.key === segment)?.key ?? "people";
}

export type SetupFacts = {
  /** Who should be placed: active members, invited ones too. */
  people: string[];
  /** Live teams only, and who is on each. */
  teams: Array<{ members: string[] }>;
  /** Live interview types only, and who runs each. */
  types: Array<{ interviewers: string[] }>;
  /** The drawn process, or null for none. */
  process: { steps: number; interviews: number } | null;
};

export type ChecklistItem = { key: SetupStep; label: string; href: string; done: boolean; detail: string };
export type Checklist = { items: ChecklistItem[]; done: number; total: number; complete: boolean };

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type GraphNode = { kind?: unknown; type?: unknown };

/** What the checklist says of a graph: the prototype's fcSummary. A node it cannot read is not a step. */
export function processSummary(graph: { nodes: unknown[] }): { steps: number; interviews: number } {
  const stages = graph.nodes.filter((n): n is GraphNode => typeof n === "object" && n !== null && (n as GraphNode).kind === "stage");
  return { steps: stages.length, interviews: stages.filter((n) => n.type === "interview").length };
}

/** Everyone in `people` is in one of `groups`. Someone who left is in no list that counts. */
function everyonePlaced(people: string[], groups: string[][]): number {
  const placed = new Set(groups.flat());
  return people.filter((id) => placed.has(id)).length;
}

export function setupChecklist(facts: SetupFacts): Checklist {
  const { people, teams, types, process } = facts;
  const onTeam = everyonePlaced(people, teams.map((t) => t.members));
  const running = everyonePlaced(people, types.map((t) => t.interviewers));
  const covered = types.filter((t) => t.interviewers.length > 0).length;

  const done: Record<Exclude<SetupStep, "review">, boolean> = {
    people: people.length > 1,
    teams: teams.length > 0 && onTeam === people.length,
    skills: types.length > 0 && running === people.length,
    process: (process?.interviews ?? 0) > 0,
  };
  const open = Object.values(done).filter((d) => !d).length;

  const detail: Record<SetupStep, string> = {
    people: people.length > 1 ? count(people.length, "person", "people") : "Just you so far",
    teams: teams.length ? `${count(teams.length, "team")}, ${onTeam} of ${count(people.length, "person", "people")} on one` : "No teams yet",
    skills: types.length ? `${covered} of ${count(types.length, "interview type")} covered, ${running} of ${count(people.length, "person", "people")} running one` : "No interview types yet",
    process: process ? `${count(process.steps, "step")}, ${count(process.interviews, "interview")}` : "Not drawn yet",
    review: open ? `${count(open, "step")} to go` : "All set",
  };

  const items = SETUP_STEPS.map(({ key, label }) => ({
    key,
    label,
    href: stepHref(key),
    done: key === "review" ? open === 0 : done[key],
    detail: detail[key],
  }));
  const finished = items.filter((i) => i.done).length;
  return { items, done: finished, total: items.length, complete: open === 0 };
}
