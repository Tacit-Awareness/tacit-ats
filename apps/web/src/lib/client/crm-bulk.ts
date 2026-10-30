import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import { moveCandidate } from "./candidate-edits";
import type { BulkAnswer, BulkError, BulkNameInput, BulkOutcome, BulkRejectInput, BulkRow } from "./crm-bulk-rules";

// The CRM's bulk actions, on the member's OWN client (never a privileged
// one): each row is the same audited clientTools write the connector and the
// candidate page use, so the policies decide row by row and one row refused
// never stops the next. A row's refusal comes back as a code; only the
// hourly limit ends a run early, since every later row would hit it too, and
// the rest come back `not_tried`. Nothing here sends email.

/** Rows written at once: a run of 100 stays well inside a request, and the claims are the database's to count. */
const CONCURRENT = 4;

/** Runs `write` over the rows, a few at a time, each answering for itself. */
async function eachRow<T>(items: readonly T[], idOf: (item: T) => string, write: (item: T) => Promise<BulkOutcome>): Promise<BulkRow[]> {
  const rows: BulkRow[] = new Array(items.length);
  let next = 0;
  let limited = false;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const item = items[i]!;
      const id = idOf(item);
      if (limited) {
        rows[i] = { id, outcome: "not_tried" };
        continue;
      }
      let outcome: BulkOutcome;
      try {
        outcome = await write(item);
      } catch (err) {
        outcome = refusal(err);
      }
      if (outcome === "rate_limited") limited = true;
      rows[i] = { id, outcome };
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENT, items.length) }, worker));
  return rows;
}

/** A clientTools refusal as a row's outcome. Anything else is a failure, logged without the row's data. */
function refusal(err: unknown): BulkOutcome {
  if (err instanceof clientTools.ClientToolError) {
    if (err.code === "not_found" || err.code === "forbidden" || err.code === "rate_limited") return err.code;
    return "failed";
  }
  console.error("[client-crm] bulk row failed:", err instanceof Error ? err.message : err);
  return "failed";
}

/** A refusal before any row was tried. Anything but a clientTools refusal is the caller's to log. */
function startRefused(err: unknown): BulkError {
  if (!(err instanceof clientTools.ClientToolError)) throw err;
  if (err.code === "invalid") return "bad_name";
  if (err.code === "forbidden") return "cannot_create";
  if (err.code === "rate_limited") return "rate_limited";
  return "failed";
}

/**
 * Closes each application as rejected, with one reason and an optional note,
 * from the stage the page showed: one someone else moved since comes back
 * `changed`. The note stays on the application, out of the audit row. The
 * reason is checked first, so a bad one is one answer, not a hundred.
 */
export async function bulkReject(db: Db, ctx: clientTools.ClientToolCtx, input: BulkRejectInput): Promise<BulkAnswer> {
  const { data: reason, error } = await db
    .from("rejection_reasons")
    .select("id")
    .eq("id", input.reasonId)
    .eq("kind", "rejected")
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!reason) return { ok: false, error: "bad_reason" };

  const rows = await eachRow(
    input.applications,
    (a) => a.applicationId,
    async (a) => {
      const moved = await moveCandidate(db, ctx, {
        applicationId: a.applicationId,
        stage: "rejected",
        expectedStage: a.expectedStage,
        reasonId: input.reasonId,
        note: input.note,
      });
      if (moved.ok) return moved.changed ? "done" : "unchanged";
      // The reason was just read, so this is someone archiving it mid-run.
      return moved.error === "not_found" || moved.error === "forbidden" || moved.error === "changed" || moved.error === "rate_limited" ? moved.error : "failed";
    },
  );
  return { ok: true, rows };
}

/**
 * Puts one tag on each candidate. The name is the org's tag by that name, or
 * a new one for whoever can add candidates (createTag answers with an
 * existing tag, and an admin naming an archived one brings it back).
 */
export async function bulkTag(db: Db, ctx: clientTools.ClientToolCtx, input: BulkNameInput): Promise<BulkAnswer> {
  let tagId: string;
  try {
    tagId = (await clientTools.createTag(db, ctx, { name: input.name })).tagId;
  } catch (err) {
    return { ok: false, error: startRefused(err) };
  }
  const rows = await eachRow(
    input.candidateIds,
    (id) => id,
    async (candidateId) => {
      const r = await clientTools.tagCandidate(db, ctx, { candidateId, tag: tagId });
      return r.outcome === "tagged" ? "done" : "unchanged";
    },
  );
  return { ok: true, rows };
}

/** Puts each candidate in one talent pool, at its first stage; the name works as bulkTag's does. */
export async function bulkAddToPool(db: Db, ctx: clientTools.ClientToolCtx, input: BulkNameInput): Promise<BulkAnswer> {
  let poolId: string;
  try {
    poolId = (await clientTools.createPool(db, ctx, { name: input.name })).poolId;
  } catch (err) {
    return { ok: false, error: startRefused(err) };
  }
  const rows = await eachRow(
    input.candidateIds,
    (id) => id,
    async (candidateId) => {
      const r = await clientTools.addToPool(db, ctx, { candidateId, pool: poolId });
      return r.outcome === "added" ? "done" : "unchanged";
    },
  );
  return { ok: true, rows };
}
