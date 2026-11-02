import { clientTools } from "@tacit-ats/core";
import type { Db } from "@tacit/db";
import { jobSettingsRefusal, type JobSettings, type JobSettingsError, type SettableStatus } from "./job-settings-rules";

// A job's own title, status and openings, changed from the posting editor:
// the connector's update_job, add_openings and close_opening (core's audited
// `updateJob`, `addOpenings`, `closeOpening`) on the member's own token with
// `toolCtx`, source `dashboard`. Core decides who may (whoever may manage the
// job, `can_on_role(job, 'can_manage_job')`), the job_open approval gate may
// refuse opening it, and an opening's close reason stays on its row, out of
// `audit_log`. Filling an opening is the database's, on a hire.

type Outcome<T> = { ok: true; value: T } | { ok: false; error: JobSettingsError };

async function refused<T>(write: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await write() };
  } catch (err) {
    if (err instanceof clientTools.ClientToolError) return { ok: false, error: jobSettingsRefusal(err.code, err.message) };
    throw err;
  }
}

/** What the panel opens on. Openings that cannot be read leave the panel without them, not the page without a panel. */
export async function readJobSettings(
  db: Db,
  ctx: clientTools.ClientToolCtx,
  job: { id: string; title: string; status: string },
): Promise<JobSettings> {
  let openings: JobSettings["openings"] = null;
  try {
    const read = await clientTools.listOpenings(db, ctx, { jobId: job.id });
    openings = {
      counts: read.counts,
      open: read.openings.filter((o) => o.status === "open").map((o) => ({ openingId: o.openingId, number: o.number, code: o.code })),
    };
  } catch (err) {
    console.error("[client-job-settings] openings read failed:", err instanceof Error ? err.message : "read failed");
  }
  return { jobId: job.id, title: job.title, status: job.status, openings };
}

export const changeJob = (db: Db, ctx: clientTools.ClientToolCtx, input: { jobId: string; title?: string; status?: SettableStatus }) =>
  refused(() => clientTools.updateJob(db, ctx, input));

export const addJobOpenings = (db: Db, ctx: clientTools.ClientToolCtx, input: { jobId: string; count: number }) =>
  refused(() => clientTools.addOpenings(db, ctx, input));

export const closeJobOpening = (db: Db, ctx: clientTools.ClientToolCtx, input: { openingId: string; reason: string }) =>
  refused(() => clientTools.closeOpening(db, ctx, input));
