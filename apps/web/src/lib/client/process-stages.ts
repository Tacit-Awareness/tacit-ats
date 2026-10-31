import type { DepartmentNode } from "./department-tree";
import { jobSteps, levelsOf, pathFor, validateGraph, type ProcessDoc, type ProcessNode } from "./process-graph";

// A candidate's stage as the company calls it (design/tats's processNames), pure.
// Computed from the drawn process every time and never stored: `applications.stage`
// stays the enum, and these are only its words. The enum has five live values and a
// process any number of steps, so:
//
//   sourced, contacted, screening   the steps before the first interview
//   interviewing                    the level of the plan's next step
//   offer                           the end node
//
// Steps side by side after a split are one stage: a level, named by its labels. No
// process, a job whose plan is not what the process would give it, or a stage with
// nothing to map to is null, which the page reads as today's label.
//
// A pure module with no runtime import from core: the posting editor runs in the browser.

export type StageName = {
  name: string;
  /** Where it falls in the process, for ordering a list of stages. */
  order: number;
};

export type ProcessStages = {
  graph: ProcessDoc;
  departments: DepartmentNode[];
  /** Node id to its level. */
  levelOf: Map<string, number>;
  /** Each level's name, then the end's when it has one. A level with no name stays, as "", so the order holds. */
  names: string[];
  end: StageName | null;
};

const key = (s: string) => s.trim().toLowerCase();

/** A level's name: each label once, in any case, as the prototype's `xs.join(" / ")`. */
function levelName(level: ProcessNode[]): string {
  const seen = new Map<string, string>();
  for (const n of level) {
    const label = n.label.trim();
    if (label && !seen.has(key(label))) seen.set(key(label), label);
  }
  return [...seen.values()].join(" / ");
}

export function processStages(graph: ProcessDoc, departments: DepartmentNode[]): ProcessStages {
  const levels = levelsOf(graph);
  const levelOf = new Map(levels.flatMap((level, i) => level.map((n) => [n.id, i] as const)));
  const names = levels.map(levelName);
  const endLabel = graph.nodes.find((n) => n.kind === "end")?.label.trim() ?? "";
  return { graph, departments, levelOf, names, end: endLabel ? { name: endLabel, order: names.length } : null };
}

/** Every stage's name in order, for a page that lists them all: no level without one. */
export const stageList = (process: ProcessStages): StageName[] => [
  ...process.names.flatMap((name, order) => (name ? [{ name, order }] : [])),
  ...(process.end ? [process.end] : []),
];

/** The same steps in the same order, as interviews match a step: without regard to case. */
export function planMatches(plan: string[], steps: string[] | null): steps is string[] {
  return !!steps && plan.length === steps.length && plan.every((s, i) => key(s) === key(steps[i]));
}

/** What a job's process says, when its plan is the one the process gives it. */
export type JobStages = {
  /** The levels before the first interview, in order. */
  leading: StageName[];
  /** Each interview step on the way through, by its name in any case. */
  steps: Map<string, StageName>;
  last: StageName | null;
  end: StageName | null;
};

/**
 * Null when this job's plan is not what the process would give it: the job keeps
 * today's labels rather than wear names from a process it does not follow. That is
 * also what a job in no department with no default branch comes to.
 */
export function jobStages(process: ProcessStages, job: { departmentId: string | null; steps: string[] }): JobStages | null {
  const { graph, departments, levelOf, names, end } = process;
  if (!planMatches(job.steps, jobSteps(graph, job.departmentId, departments))) return null;
  const stage = (n: ProcessNode): StageName | null => {
    const order = levelOf.get(n.id);
    return order !== undefined && names[order] ? { name: names[order], order } : null;
  };
  const path = pathFor(graph, job.departmentId, departments).nodes.filter((n) => n.kind === "stage");
  const first = path.findIndex((n) => n.type === "interview");
  const leading: StageName[] = [];
  for (const n of first < 0 ? path : path.slice(0, first)) {
    const s = stage(n);
    if (s && !leading.some((l) => l.order === s.order)) leading.push(s);
  }
  const interviews = path.filter((n) => n.type === "interview");
  const steps = new Map(interviews.flatMap((n) => {
    const s = stage(n);
    return s ? [[key(n.label), s] as const] : [];
  }));
  return { leading, steps, last: interviews.length ? stage(interviews[interviews.length - 1]) : null, end };
}

type PlanInterview = { step?: string | null; status: string };

/**
 * The first step of a plan with nothing scheduled or held on it: core's `nextStep`,
 * for a list read here, since asking core is a read per application. Null when none is left.
 */
export function nextPlanStep(plan: string[], interviews: PlanInterview[]): string | null {
  const taken = new Set(interviews.filter((i) => i.step && (i.status === "scheduled" || i.status === "done")).map((i) => key(i.step!)));
  return plan.find((s) => !taken.has(key(s))) ?? null;
}

/** Three stages onto however many steps there are: the first gets the first, screening the last. */
function leadingFor(leading: StageName[], stage: string): StageName | null {
  if (!leading.length) return null;
  const last = leading.length - 1;
  if (stage === "screening") return leading[last];
  return leading[stage === "contacted" && leading.length > 2 ? 1 : 0];
}

/** A stage's name on this job, or null for today's label. A closed stage is an outcome, not a step. */
export function stageNameFor(job: JobStages | null, stage: string, nextStep: string | null): StageName | null {
  if (!job) return null;
  switch (stage) {
    case "sourced":
    case "contacted":
    case "screening":
      return leadingFor(job.leading, stage);
    case "interviewing":
      // Every step taken: they are in the last of them, until someone moves them on.
      return (nextStep ? job.steps.get(key(nextStep)) : null) ?? job.last;
    case "offer":
      return job.end;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// A new job's first plan
// ---------------------------------------------------------------------------

export type StepSeeds = {
  byDepartment: Record<string, string[]>;
  /** For a job in no department. */
  none: string[];
};

/**
 * What a new job's plan starts as: what Apply would write, so the job matches the
 * process from the start. A drawing with problems seeds nothing, as it applies nothing.
 */
export function stepSeeds(process: ProcessStages): StepSeeds | null {
  const { graph, departments } = process;
  if (validateGraph(graph, { departments, members: [] }).problems.length) return null;
  return {
    byDepartment: Object.fromEntries(departments.map((d) => [d.id, jobSteps(graph, d.id, departments) ?? []])),
    none: jobSteps(graph, null, departments) ?? [],
  };
}
