import type { PublicQuestion } from "./jobs";

// How the public application is laid out (design/careers): its sections, and
// the side checklist that fills as the form does. Pure, and free of the
// database client, so the checklist's client component can import it.

const ABOUT_YOU: ReadonlyArray<PublicQuestion["type"]> = ["name", "email", "phone", "linkedin"];

/** A post's questions by section, each in the post's own order. */
export function formSections(questions: PublicQuestion[]): { resume: PublicQuestion[]; about: PublicQuestion[]; custom: PublicQuestion[] } {
  return {
    resume: questions.filter((q) => q.type === "resume"),
    about: questions.filter((q) => ABOUT_YOU.includes(q.type)),
    custom: questions.filter((q) => q.type !== "resume" && !ABOUT_YOU.includes(q.type)),
  };
}

export type GuideItem = { field: string; label: string };
export type GuideStep = { key: string; title: string; items: GuideItem[] };

/** What the checklist asks for: the required questions, by section. A section with none is left out. */
export function guideSteps(questions: PublicQuestion[], fieldOf: (q: PublicQuestion) => string): GuideStep[] {
  const { resume, about, custom } = formSections(questions);
  const step = (key: string, title: string, list: PublicQuestion[]): GuideStep => ({
    key,
    title,
    items: list.filter((q) => q.required).map((q) => ({ field: fieldOf(q), label: q.label })),
  });
  return [step("resume", "Resume", resume), step("about", "About you", about), step("questions", "Questions", custom)].filter((s) => s.items.length > 0);
}

/** How far along a form is, given which of its fields are answered. */
export function guideProgress(steps: GuideStep[], done: ReadonlySet<string>): { total: number; finished: number; next: GuideItem | null; current: string | null } {
  const items = steps.flatMap((s) => s.items);
  const next = items.find((i) => !done.has(i.field)) ?? null;
  return {
    total: items.length,
    finished: items.filter((i) => done.has(i.field)).length,
    next,
    current: next ? (steps.find((s) => s.items.includes(next))?.key ?? null) : null,
  };
}
