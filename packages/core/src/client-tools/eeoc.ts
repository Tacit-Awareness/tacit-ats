import type { Db } from "@tacit/db";

import { withAudit } from "./audit.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";
import { parseSince, requireJob, scan, type ReportScope } from "./reports.js";

/**
 * EEO self-identification for the client connector
 * (20261016170000_client_reports_eeoc). Voluntary answers to the US EEO-1
 * (gender, race / ethnicity), VEVRAA (veteran) and Section 503 (disability)
 * questions, one set per application.
 *
 * The privacy rule this module exists to keep: no one on the hiring team ever
 * sees an individual's answers. The database lets only an org admin read a
 * row; this module never returns one, even to an admin. eeocReport is an
 * aggregate with every cell under EEOC_MIN_CELL people shown as "<5" (and,
 * when a lone small cell could be worked out from the total, the next
 * smallest one hidden too). recordEeoc is for a manager on the job typing in
 * a candidate's paper form; it says only whether it recorded or replaced one.
 * Nothing else in client-tools reads eeoc_responses (eeoc.test.ts checks), so
 * get_candidate, get_activity and the pipeline never show it.
 *
 * The candidate's own answers come from the public job-post apply path, which
 * writes the row itself with source 'candidate' (not through here).
 */

export const EEOC_GENDERS = ["male", "female", "decline_to_self_identify"] as const;
export const EEOC_RACES = [
  "hispanic_or_latino", "white", "black_or_african_american", "native_hawaiian_or_other_pacific_islander",
  "asian", "american_indian_or_alaska_native", "two_or_more_races", "decline_to_self_identify",
] as const;
export const EEOC_VETERAN = ["protected_veteran", "not_a_protected_veteran", "decline_to_self_identify"] as const;
export const EEOC_DISABILITY = ["has_disability", "no_disability", "decline_to_self_identify"] as const;
/** Fewer people than this in a cell and the report shows "<5". */
export const EEOC_MIN_CELL = 5;

export type EeocAnswers = {
  gender?: (typeof EEOC_GENDERS)[number] | null;
  raceEthnicity?: (typeof EEOC_RACES)[number] | null;
  veteranStatus?: (typeof EEOC_VETERAN)[number] | null;
  disabilityStatus?: (typeof EEOC_DISABILITY)[number] | null;
};

const QUESTIONS = [
  { key: "gender", column: "gender", answers: EEOC_GENDERS },
  { key: "raceEthnicity", column: "race_ethnicity", answers: EEOC_RACES },
  { key: "veteranStatus", column: "veteran_status", answers: EEOC_VETERAN },
  { key: "disabilityStatus", column: "disability_status", answers: EEOC_DISABILITY },
] as const;

// ---------------------------------------------------------------------------
// record_eeoc
// ---------------------------------------------------------------------------

/** The database's refusals as sentences. None of them names an answer. */
function recordError(error: { code?: string; message: string }): Error {
  switch (error.code) {
    case "23505":
      return new ClientToolError("invalid", "The candidate answered these questions themselves, and a paper form does not replace their own answers.");
    case "42501":
      return new ClientToolError("forbidden", "Only the people who manage this job (an admin, its hiring manager or recruiter) record its EEO forms.");
    case "P0002":
      return new ClientToolError("not_found", "No application with that id that you can see. get_pipeline and get_candidate list them.");
    case "22023":
      return new ClientToolError("invalid", `Not saved: ${error.message}.`);
    default:
      return new Error(error.message);
  }
}

/**
 * Records a candidate's paper EEO form on one application, replacing an
 * earlier paper form whole. Every answer is optional, but at least one is
 * needed. Audited as eeoc.record with no answers in the row.
 */
export async function recordEeoc(
  db: Db,
  ctx: ClientToolCtx,
  input: { applicationId: string } & EeocAnswers,
): Promise<{ outcome: "recorded" | "replaced"; applicationId: string }> {
  let answered = 0;
  for (const q of QUESTIONS) {
    const value = input[q.key];
    if (value === undefined || value === null) continue;
    if (!(q.answers as readonly string[]).includes(value)) {
      throw new ClientToolError("invalid", `${q.column} is one of ${q.answers.join(", ")}.`);
    }
    answered += 1;
  }
  if (!answered) throw new ClientToolError("invalid", "Nothing to record: answer at least one question (decline_to_self_identify counts).");
  if (ctx.accessLevel === "limited") {
    throw new ClientToolError("forbidden", "Interviewers do not record EEO forms.");
  }

  const { data: app, error } = await db.from("applications").select("id, role_id").eq("id", input.applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!app) throw new ClientToolError("not_found", "No application with that id that you can see. get_pipeline and get_candidate list them.");
  const { data: allowed, error: permError } = await db.rpc("can_on_role", { p_role: app.role_id, perm: "can_manage_job" });
  if (permError) throw new Error(permError.message);
  if (allowed !== true) throw recordError({ code: "42501", message: "" });

  return withAudit(db, ctx, { action: "eeoc.record", entity: "application" }, async () => {
    const { data, error: rpcError } = await db.rpc("record_eeoc", {
      p_application: app.id,
      p_gender: input.gender ?? undefined,
      p_race_ethnicity: input.raceEthnicity ?? undefined,
      p_veteran_status: input.veteranStatus ?? undefined,
      p_disability_status: input.disabilityStatus ?? undefined,
    });
    if (rpcError) throw recordError(rpcError);
    const outcome = data === "replaced" ? ("replaced" as const) : ("recorded" as const);
    // The answers never go into the audit row: admins read audit_log, and an
    // answer there would be one person's EEO data outside the aggregate.
    return { result: { outcome, applicationId: app.id }, entityId: app.id, after: { eeoc: "paper_form", outcome }, changed: true };
  });
}

// ---------------------------------------------------------------------------
// eeoc_report
// ---------------------------------------------------------------------------

/** A count, "<5" when under EEOC_MIN_CELL, or "hidden" when shown it would give away a "<5" cell. */
export type EeocCell = number | "<5" | "hidden";

export type EeocRow = { answer: string; applicants: EeocCell; hired: EeocCell };
export type EeocQuestion = { question: "gender" | "race_ethnicity" | "veteran_status" | "disability_status"; rows: EeocRow[] };

export type EeocReport = ReportScope & {
  /** Applications in scope that the admin can read, answered or not. */
  applications: number;
  /** Applications with a response. "<5" and no breakdown when there are too few. */
  responses: EeocCell;
  hired: EeocCell;
  minCell: number;
  questions: EeocQuestion[];
};

/**
 * Small cells hidden: anything under the minimum becomes "<5". When exactly
 * one cell in a column is hidden, it equals the shown total minus the rest,
 * so the smallest shown cell is hidden too.
 */
export function suppressColumn(values: number[], min = EEOC_MIN_CELL): EeocCell[] {
  const out: EeocCell[] = values.map((v) => (v < min ? "<5" : v));
  if (out.filter((c) => c === "<5").length === 1) {
    let smallest = -1;
    for (let i = 0; i < values.length; i++) {
      if (out[i] !== "<5" && (smallest < 0 || values[i] < values[smallest])) smallest = i;
    }
    if (smallest >= 0) out[smallest] = "hidden";
  }
  return out;
}

type ResponseRow = {
  gender: string | null;
  race_ethnicity: string | null;
  veteran_status: string | null;
  disability_status: string | null;
  applications: { stage: string };
};

/**
 * Admins only. Counts per answer for each question, applicants and hires,
 * over the applications in scope (one job, created since `since`).
 */
export async function eeocReport(
  db: Db,
  ctx: ClientToolCtx,
  input: { jobId?: string; since?: string } = {},
): Promise<EeocReport> {
  const since = parseSince(input.since);
  if (ctx.accessLevel !== "admin") {
    throw new ClientToolError("forbidden", "EEO data is for admins at your company only, and only as totals.");
  }
  const jobId = input.jobId ?? null;
  if (jobId) await requireJob(db, jobId);

  let count = db.from("applications").select("id", { count: "exact", head: true }).is("merged_into_id", null);
  if (jobId) count = count.eq("role_id", jobId);
  if (since) count = count.gte("created_at", since);
  const { count: applications, error } = await count;
  if (error) throw new Error(error.message);

  const responses = await scan<ResponseRow>((from, to) => {
    let q = db
      .from("eeoc_responses")
      .select("gender, race_ethnicity, veteran_status, disability_status, applications!inner(stage, role_id, created_at, merged_into_id)")
      // A merged application keeps its answers; only live ones count, so no one counts twice.
      .is("applications.merged_into_id", null);
    if (jobId) q = q.eq("applications.role_id", jobId);
    if (since) q = q.gte("applications.created_at", since);
    return q.order("id").range(from, to).overrideTypes<ResponseRow[], { merge: false }>();
  });

  const total = responses.rows.length;
  const hiredTotal = responses.rows.filter((r) => r.applications?.stage === "hired").length;
  const base = { jobId, since, truncated: responses.truncated, applications: applications ?? 0, minCell: EEOC_MIN_CELL };
  if (total < EEOC_MIN_CELL) {
    return { ...base, responses: "<5", hired: "<5", questions: [] };
  }

  const questions: EeocQuestion[] = QUESTIONS.map((q) => {
    const answers = [...q.answers, "not_answered"];
    const applicants = answers.map(() => 0);
    const hired = answers.map(() => 0);
    for (const r of responses.rows) {
      const value = r[q.column] ?? "not_answered";
      const i = answers.indexOf(value);
      if (i < 0) continue;
      applicants[i] += 1;
      if (r.applications?.stage === "hired") hired[i] += 1;
    }
    const a = suppressColumn(applicants);
    const h = suppressColumn(hired);
    return { question: q.column, rows: answers.map((answer, i) => ({ answer, applicants: a[i], hired: h[i] })) };
  });
  return { ...base, responses: total, hired: hiredTotal < EEOC_MIN_CELL ? "<5" : hiredTotal, questions };
}
