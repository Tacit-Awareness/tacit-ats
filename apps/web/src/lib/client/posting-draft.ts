import type { clientTools } from "@tacit-ats/core";
import { parsePostText, serializePostText, type PostBlock } from "../public/post-text";
import type { StepSeeds } from "./process-stages";

// The posting editor's state (design/tats's jobDraft), pure and with no runtime
// import from core, so the client component can use it. What the prototype
// keeps as intro / does / fit is the post's one description, read into blocks
// (lib/public/post-text.ts); a block the editor did not make stays as it was.
// Left out of the prototype's posting with no field behind them: employment
// type, location type, compensation and equity, the date answer type, and
// Testbench.

export type DraftQuestion = {
  /** React's key: the question's id, or made up for a new one. */
  key: string;
  questionId?: string;
  type: clientTools.QuestionType;
  label: string;
  required: boolean;
  options: string[];
};

export type EditorDraft = {
  title: string;
  location: string;
  /** "" for none. */
  departmentId: string;
  blocks: PostBlock[];
  steps: string[];
  questions: DraftQuestion[];
};

/** What the editor posts: the blocks written out as the description, and no keys. */
export type DraftPayload = {
  title: string;
  location: string;
  departmentId: string | null;
  description: string;
  steps: string[];
  questions: Array<Omit<DraftQuestion, "key" | "options"> & { options?: string[] }>;
};

export const CUSTOM_KINDS: ReadonlyArray<readonly [clientTools.QuestionType, string]> = [
  ["short_text", "Short answer"],
  ["long_text", "Long answer"],
  ["yes_no", "Yes / No"],
  ["select", "Dropdown"],
];

/** The questions an application may ask or not, with what to call them on "Add". */
export const OPTIONAL_BUILT_INS: ReadonlyArray<readonly [clientTools.QuestionType, string]> = [
  ["phone", "Phone"],
  ["linkedin", "LinkedIn profile"],
  ["resume", "Link to your resume"],
];

const SECTIONS = ["What you'll do", "You might be a fit if"];

const question = (q: Omit<DraftQuestion, "key" | "options"> & { options?: string[] }, n: number): DraftQuestion => ({
  key: q.questionId ?? `new-${q.type}-${n}`,
  options: [],
  ...q,
});

/** The first block a paragraph to type in, and the two sections when the post has no list of its own. */
export function editorBlocks(description: string | null | undefined): PostBlock[] {
  const blocks = parsePostText(description).map((b) => (b.kind === "list" ? { ...b, lines: b.lines.length ? b.lines : [""] } : b));
  const lead: PostBlock[] = blocks[0]?.kind === "text" ? [] : [{ kind: "text", text: "" }];
  const sections: PostBlock[] = blocks.some((b) => b.kind === "list") ? [] : SECTIONS.map((heading) => ({ kind: "list", heading, lines: [""] }));
  return [...lead, ...blocks, ...sections];
}

function draftQuestions(questions: clientTools.Question[]): DraftQuestion[] {
  return questions.map((q, n) => question(
    { questionId: q.questionId, type: q.type, label: q.label, required: q.required, ...(q.options ? { options: q.options } : {}) },
    n,
  ));
}

export function draftFromPost(input: {
  job: { title: string; location: string | null };
  departmentId: string | null;
  steps: string[];
  post: Pick<clientTools.JobPost, "title" | "location" | "description" | "questions"> | null;
}): EditorDraft {
  const { job, post } = input;
  return {
    title: post?.title ?? job.title,
    // A post's own, cleared or not: job_post_page shows no other, so falling back here would put a cleared one back on the next save.
    location: post ? (post.location ?? "") : (job.location ?? ""),
    departmentId: input.departmentId ?? "",
    blocks: editorBlocks(post?.description),
    steps: input.steps,
    questions: post ? draftQuestions(post.questions) : defaultQuestions(),
  };
}

/** The form a new post starts with: core's default, then the prototype's questions (its date is a short answer: there is no date type). */
export function defaultQuestions(): DraftQuestion[] {
  const fixed: Array<[clientTools.QuestionType, string, boolean]> = [
    ["name", "Full name", true],
    ["email", "Email", true],
    ["phone", "Phone", false],
    ["linkedin", "LinkedIn profile", false],
    ["resume", "Link to your resume", false],
  ];
  const asked: Array<[clientTools.QuestionType, string, boolean]> = [
    ["yes_no", "Are you authorized to work in the US?", true],
    ["yes_no", "Will you need visa sponsorship now or in the future?", true],
    ["short_text", "Earliest start date", true],
  ];
  return [...fixed, ...asked].map(([type, label, required], n) => question({ type, label, required }, n));
}

/** The steps the company's process gives a new job in this department. */
export const seededSteps = (seeds: StepSeeds | null, departmentId: string | null): string[] =>
  !seeds ? [] : [...((departmentId ? seeds.byDepartment[departmentId] : null) ?? seeds.none)];

/** `seeds` is the company's process, when it has a sound one the member may read. */
export function newRoleDraft(departmentId: string | null, seeds: StepSeeds | null = null): EditorDraft {
  return { title: "", location: "", departmentId: departmentId ?? "", blocks: editorBlocks(null), steps: seededSteps(seeds, departmentId), questions: defaultQuestions() };
}

/** A new role moved to another department follows that department's way through, until the member has made the steps their own. */
export function withDepartment(d: EditorDraft, departmentId: string, seeds: StepSeeds | null, stepsEdited: boolean): EditorDraft {
  return { ...d, departmentId, steps: seeds && !stepsEdited ? seededSteps(seeds, departmentId || null) : d.steps };
}

export function draftPayload(d: EditorDraft): DraftPayload {
  return {
    title: d.title,
    location: d.location,
    departmentId: d.departmentId || null,
    description: serializePostText(d.blocks),
    steps: d.steps.map((s) => s.trim()).filter(Boolean),
    questions: d.questions.map(({ key: _key, options, ...q }) => ({ ...q, ...(q.type === "select" ? { options: options.map((o) => o.trim()).filter(Boolean) } : {}) })),
  };
}

/** The application as it would go out, for Preview: what a save would keep. */
export function previewQuestions(d: EditorDraft): clientTools.Question[] {
  return d.questions
    .filter((q) => q.label.trim())
    .map((q) => ({
      questionId: q.key,
      type: q.type,
      label: q.label.trim(),
      required: q.required,
      ...(q.type === "select" ? { options: q.options.map((o) => o.trim()).filter(Boolean) } : {}),
    }));
}

/** A job or post a save made before it stopped, which the next save carries on from. */
export type Made = { jobId: string | null; postId: string | null };

/** An answer names what it knows of, so one that does not name the post has not unmade it. */
export function carryOn(made: Made, result: { jobId?: string; postId?: string }): Made {
  return { jobId: result.jobId ?? made.jobId, postId: result.postId ?? made.postId };
}

// Next refuses a server action's body over 1 MB before the action runs, which the page could only call a failed save.
const SEND_BYTES_MAX = 950_000;
export const tooBigToSend = (sent: string): boolean => new TextEncoder().encode(sent).length > SEND_BYTES_MAX;

type Click = Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented">;

/**
 * A plain click on a link that moves this tab elsewhere in the app. Next's
 * Link changes page with no `beforeunload`, so the editor has to ask for these
 * itself; a link to another site is the browser's to ask about.
 */
export function leavesPage(click: Click, link: { href: string; target: string; download: string }, here: string): boolean {
  if (click.defaultPrevented || click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false;
  if ((link.target && link.target !== "_self") || link.download) return false;
  const to = new URL(link.href, here);
  const at = new URL(here);
  return to.origin === at.origin && (to.pathname !== at.pathname || to.search !== at.search);
}
