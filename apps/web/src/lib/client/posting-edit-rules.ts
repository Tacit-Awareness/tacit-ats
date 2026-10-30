import { clientTools } from "@tacit-ats/core";
import type { PostingError } from "@/app/client/jobs/messages";

// What the posting editor posts, re-read on the server: it is request data
// whatever the page sent. Pure, and unit-tested. The limits are the columns'
// own (the writes check them again and the database again), so a refusal is a
// sentence about the field instead of a failed save halfway through. A new
// role especially: everything here is checked before its job is made.

export const POST_TITLE_MAX = 200;
export const POST_LOCATION_MAX = 200;
export const POST_DESCRIPTION_MAX = 20_000;
const OPTION_MAX = 200;
const OPTIONS_MAX = 50;
const CUSTOM: readonly clientTools.QuestionType[] = ["short_text", "long_text", "yes_no", "select"];

export type PostingDraft = {
  title: string;
  location: string | null;
  departmentId: string | null;
  description: string | null;
  steps: string[];
  questions: clientTools.QuestionInput[];
};

export type ParsedDraft = { ok: true; draft: PostingDraft } | { ok: false; error: PostingError };

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const refuse = (error: PostingError): ParsedDraft => ({ ok: false, error });
const line = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseDraft(raw: unknown): ParsedDraft {
  if (!isRecord(raw)) return refuse("invalid");
  const title = line(raw.title);
  if (!title) return refuse("title_required");
  if (title.length > POST_TITLE_MAX) return refuse("title_too_long");
  const location = line(raw.location);
  if (location.length > POST_LOCATION_MAX) return refuse("location_too_long");
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (description.length > POST_DESCRIPTION_MAX) return refuse("description_too_long");
  const departmentId = raw.departmentId === null || raw.departmentId === "" || raw.departmentId === undefined ? null : raw.departmentId;
  if (departmentId !== null && (typeof departmentId !== "string" || !UUID.test(departmentId))) return refuse("invalid_department");

  if (!Array.isArray(raw.steps) || !Array.isArray(raw.questions)) return refuse("invalid");
  // A blank line is an unfilled row, not a step.
  const steps = raw.steps.map(line).filter(Boolean);
  if (steps.length > clientTools.PLAN_STEPS_MAX) return refuse("too_many_steps");
  if (steps.some((s) => s.length > clientTools.STEP_NAME_MAX)) return refuse("step_too_long");
  if (new Set(steps.map((s) => s.toLowerCase())).size !== steps.length) return refuse("step_repeated");

  if (raw.questions.length > clientTools.QUESTIONS_MAX) return refuse("too_many_questions");
  const questions: clientTools.QuestionInput[] = [];
  for (const q of raw.questions) {
    if (!isRecord(q) || !clientTools.QUESTION_TYPES.includes(q.type as clientTools.QuestionType)) return refuse("invalid_questions");
    const type = q.type as clientTools.QuestionType;
    const label = line(q.label);
    // As the prototype: a question left blank is dropped. A built-in falls back to its own label.
    if (CUSTOM.includes(type) && !label) continue;
    if (label.length > clientTools.QUESTION_LABEL_MAX) return refuse("question_too_long");
    // Name and email are required whatever was posted.
    const required = type === "name" || type === "email" ? true : q.required === true;
    const parsed: clientTools.QuestionInput = { type, required, ...(label ? { label } : {}) };
    if (CUSTOM.includes(type) && typeof q.questionId === "string" && q.questionId) parsed.questionId = q.questionId;
    if (type === "select") {
      if (!Array.isArray(q.options)) return refuse("options_needed");
      const options = q.options.map(line).filter(Boolean);
      if (options.length < 2 || options.length > OPTIONS_MAX || options.some((o) => o.length > OPTION_MAX) || new Set(options).size !== options.length) {
        return refuse("options_needed");
      }
      parsed.options = options;
    }
    questions.push(parsed);
  }
  try {
    clientTools.buildQuestions(questions);
  } catch (err) {
    if (err instanceof clientTools.ClientToolError) return refuse("invalid_questions");
    throw err;
  }
  return { ok: true, draft: { title, location: location || null, departmentId, description: description || null, steps, questions } };
}
