import type { Db } from "@tacit/db";

import { withAudit } from "./audit.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";

/**
 * A job's openings (Greenhouse's headcount; 20261016130000_client_org_structure):
 * one row per seat, numbered 1, 2, 3 ... per job by the database, with the
 * org's own optional opening code. Read by whoever can view the job's
 * candidates (not interviewers, not external recruiters), added and closed by
 * whoever can manage the job. Filling is the database's: an application moved
 * to hired fills the job's oldest open opening, and the job becomes filled
 * when no opening is left open; leaving hired opens it again. Nothing deletes
 * an opening.
 */

export const OPENING_STATUSES = ["open", "filled", "closed"] as const;
export type OpeningStatus = (typeof OPENING_STATUSES)[number];
export const OPENINGS_ADD_MAX = 50;
export const OPENING_CODE_MAX = 50;
export const CLOSE_REASON_MAX = 200;

export type Opening = {
  openingId: string;
  number: number;
  /** The org's own requisition code, if it gave one. */
  code: string | null;
  status: OpeningStatus;
  targetStartDate: string | null;
  closeReason: string | null;
  /** The hired application that filled it, and its candidate when the member can read them. */
  filledByApplicationId: string | null;
  filledByCandidateId: string | null;
  filledByName: string | null;
  filledAt: string | null;
  closedAt: string | null;
};

export type OpeningCounts = { open: number; filled: number; closed: number };

export type JobOpenings = { jobId: string; title: string; jobStatus: string; counts: OpeningCounts; openings: Opening[] };

type OpeningRow = {
  id: string; number: number; opening_code: string | null; status: string; target_start_date: string | null;
  close_reason: string | null; filled_by_application_id: string | null; filled_at: string | null; closed_at: string | null;
  applications: { person_id: string; people: { display_name: string | null } | null } | null;
};

const notForInterviewers = () => new ClientToolError("forbidden", "Interviewers do not see a job's openings.");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function countOpenings(statuses: string[]): OpeningCounts {
  const counts: OpeningCounts = { open: 0, filled: 0, closed: 0 };
  for (const s of statuses) if (s in counts) counts[s as OpeningStatus] += 1;
  return counts;
}

async function visibleJob(db: Db, jobId: string): Promise<{ id: string; title: string; status: string }> {
  const { data, error } = await db.from("roles").select("id, title, status").eq("id", jobId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ClientToolError("not_found", "No job with that id that you can see. Call list_jobs for the ids.");
  return data;
}

async function canManage(db: Db, jobId: string): Promise<boolean> {
  const { data, error } = await db.rpc("can_on_role", { p_role: jobId, perm: "can_manage_job" });
  if (error) throw new Error(error.message);
  return data === true;
}

const cantManage = () =>
  new ClientToolError("forbidden", "Only an admin or someone who manages that job changes its openings.");

function cleanCode(raw: string): string {
  const code = raw.trim();
  if (!code) throw new ClientToolError("invalid", "An opening code cannot be blank.");
  if (code.length > OPENING_CODE_MAX) throw new ClientToolError("invalid", `An opening code is at most ${OPENING_CODE_MAX} characters.`);
  return code;
}

function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.trim();
  if (!DATE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) {
    throw new ClientToolError("invalid", "A target start date is YYYY-MM-DD.");
  }
  return d;
}

const toOpening = (r: OpeningRow): Opening => ({
  openingId: r.id,
  number: r.number,
  code: r.opening_code,
  status: r.status as OpeningStatus,
  targetStartDate: r.target_start_date,
  closeReason: r.close_reason,
  filledByApplicationId: r.filled_by_application_id,
  filledByCandidateId: r.applications?.person_id ?? null,
  filledByName: r.applications?.people?.display_name ?? null,
  filledAt: r.filled_at,
  closedAt: r.closed_at,
});

const OPENING_COLUMNS =
  "id, number, opening_code, status, target_start_date, close_reason, filled_by_application_id, filled_at, closed_at, " +
  "applications(person_id, people(display_name))";

export async function listOpenings(
  db: Db,
  ctx: ClientToolCtx,
  input: { jobId: string; status?: OpeningStatus },
): Promise<JobOpenings> {
  if (ctx.accessLevel === "limited") throw notForInterviewers();
  if (input.status !== undefined && !OPENING_STATUSES.includes(input.status)) {
    throw new ClientToolError("invalid", `An opening's status is one of ${OPENING_STATUSES.join(", ")}.`);
  }
  const job = await visibleJob(db, input.jobId);
  const { data, error } = await db
    .from("openings").select(OPENING_COLUMNS).eq("role_id", job.id).order("number").limit(500)
    .overrideTypes<OpeningRow[], { merge: false }>();
  if (error) throw new Error(error.message);
  const all = (data ?? []).map(toOpening);
  return {
    jobId: job.id,
    title: job.title,
    jobStatus: job.status,
    counts: countOpenings(all.map((o) => o.status)),
    openings: input.status ? all.filter((o) => o.status === input.status) : all,
  };
}

export async function addOpenings(
  db: Db,
  ctx: ClientToolCtx,
  input: { jobId: string; count?: number; codes?: string[]; targetStartDate?: string | null },
): Promise<{ jobId: string; jobStatus: string; added: Opening[]; counts: OpeningCounts }> {
  const codes = input.codes?.map(cleanCode);
  const count = input.count ?? codes?.length ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > OPENINGS_ADD_MAX) {
    throw new ClientToolError("invalid", `Add between 1 and ${OPENINGS_ADD_MAX} openings at a time.`);
  }
  if (codes && codes.length !== count) throw new ClientToolError("invalid", "Give one opening code for each opening, or none.");
  if (codes && new Set(codes.map((c) => c.toLowerCase())).size !== codes.length) {
    throw new ClientToolError("invalid", "Each opening code is used once.");
  }
  const targetStartDate = parseDate(input.targetStartDate);
  if (ctx.accessLevel === "limited") throw cantManage();
  const job = await visibleJob(db, input.jobId);
  if (!(await canManage(db, job.id))) throw cantManage();

  const ids = await withAudit(db, ctx, { action: "opening.add", entity: "role" }, async () => {
    const rows = await insertOpenings(db, job.id, count, codes, targetStartDate);
    return {
      result: rows,
      entityId: job.id,
      after: { opening_ids: rows, count, codes: codes ?? [], target_start_date: targetStartDate },
      changed: true,
    };
  });
  // A separate read, not a RETURNING: the number is the database's.
  const listed = await listOpenings(db, ctx, { jobId: job.id });
  return {
    jobId: job.id,
    jobStatus: listed.jobStatus,
    added: listed.openings.filter((o) => ids.includes(o.openingId)),
    counts: listed.counts,
  };
}

/**
 * Inserts openings on a job the caller has already checked, with ids made
 * here and not read back. A code already used in the org is a sentence.
 * Shared with createJob, which opens one with every new job.
 */
export async function insertOpenings(
  db: Db,
  jobId: string,
  count: number,
  codes?: string[],
  targetStartDate?: string | null,
): Promise<string[]> {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: globalThis.crypto.randomUUID(),
    role_id: jobId,
    ...(codes?.[i] ? { opening_code: codes[i] } : {}),
    ...(targetStartDate ? { target_start_date: targetStartDate } : {}),
  }));
  // One request: every row names the same columns, so none falls back to null.
  const { error } = await db.from("openings").insert(rows);
  if (error?.code === "23505") throw new ClientToolError("invalid", "That opening code is already used at your company.");
  if (error) throw new Error(error.message);
  return rows.map((r) => r.id);
}

export async function closeOpening(
  db: Db,
  ctx: ClientToolCtx,
  input: { openingId: string; reason: string },
): Promise<{ outcome: "closed" | "unchanged"; openingId: string; jobId: string; number: number; counts: OpeningCounts }> {
  const reason = input.reason.trim().replace(/\s+/g, " ");
  if (!reason) throw new ClientToolError("invalid", "Closing an opening needs a reason.");
  if (reason.length > CLOSE_REASON_MAX) throw new ClientToolError("invalid", `A close reason is at most ${CLOSE_REASON_MAX} characters.`);
  if (ctx.accessLevel === "limited") throw cantManage();
  const { data: opening, error } = await db
    .from("openings").select("id, role_id, number, status").eq("id", input.openingId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!opening) throw new ClientToolError("not_found", "No opening with that id that you can see. list_openings has them.");
  if (!(await canManage(db, opening.role_id))) throw cantManage();
  if (opening.status === "filled") {
    throw new ClientToolError("invalid", "That opening is filled. Moving its hire out of hired opens it again; then it can be closed.");
  }
  const counts = async () => {
    const { data: rows, error: countError } = await db.from("openings").select("status").eq("role_id", opening.role_id);
    if (countError) throw new Error(countError.message);
    return countOpenings((rows ?? []).map((o) => o.status));
  };
  if (opening.status === "closed") {
    return { outcome: "unchanged", openingId: opening.id, jobId: opening.role_id, number: opening.number, counts: await counts() };
  }
  const outcome = await withAudit(db, ctx, { action: "opening.close", entity: "opening" }, async () => {
    // Conditional on its still being open, so a hire landing first wins.
    const { data, error: updateError } = await db
      .from("openings").update({ status: "closed", close_reason: reason }).eq("id", opening.id).eq("status", "open").select("id");
    if (updateError) throw new Error(updateError.message);
    const ok = !!data?.length;
    return {
      result: ok ? ("closed" as const) : ("unchanged" as const),
      entityId: opening.id,
      before: { status: "open" },
      // The reason is the org's own words; the row keeps it.
      after: { status: "closed" },
      changed: ok,
    };
  });
  return { outcome, openingId: opening.id, jobId: opening.role_id, number: opening.number, counts: await counts() };
}

export type HireOpening = { openingId: string; number: number; code: string | null; openLeft: number; jobStatus: string | null };

/**
 * After a move to hired: the opening the database filled with this
 * application, how many are still open on its job, and the job's status now.
 * Null when it filled none (no open opening, or none the member can read).
 */
export async function openingFilledBy(db: Db, applicationId: string, jobId: string): Promise<HireOpening | null> {
  const { data, error } = await db
    .from("openings").select("id, number, opening_code").eq("filled_by_application_id", applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const open = await db.from("openings").select("id").eq("role_id", jobId).eq("status", "open");
  if (open.error) throw new Error(open.error.message);
  const job = await db.from("roles").select("status").eq("id", jobId).maybeSingle();
  if (job.error) throw new Error(job.error.message);
  return { openingId: data.id, number: data.number, code: data.opening_code, openLeft: open.data?.length ?? 0, jobStatus: job.data?.status ?? null };
}
