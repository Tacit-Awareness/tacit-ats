import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import type { HomeTargets, ParsedTarget, TargetError } from "./home-target-rules";

// Home's targets on the member's own client: clientTools' audited writes
// (source `dashboard`), and the policies deciding again: admins write, admins
// and the hiring team read, an interviewer reads none.

/**
 * The targets, or null when they could not be read. Home keeps its numbers
 * without them, and null is not "no targets": it offers no Set a target, since
 * a target may be there that this read did not see.
 */
export async function readHomeTargets(db: Db): Promise<HomeTargets | null> {
  try {
    return await clientTools.getHomeTargets(db);
  } catch (err) {
    console.error("[client-home] targets read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export type SaveTargetOutcome = { ok: true; changed: boolean } | { ok: false; error: TargetError };

export async function saveHomeTarget(db: Db, ctx: clientTools.ClientToolCtx, target: Extract<ParsedTarget, { ok: true }>): Promise<SaveTargetOutcome> {
  try {
    const { outcome } =
      target.value === null
        ? await clientTools.clearHomeTarget(db, ctx, { metric: target.metric })
        : await clientTools.setHomeTarget(db, ctx, { metric: target.metric, value: target.value });
    return { ok: true, changed: outcome === "changed" };
  } catch (err) {
    if (err instanceof clientTools.ClientToolError) {
      if (err.code === "forbidden") return { ok: false, error: "forbidden" };
      if (err.code === "rate_limited") return { ok: false, error: "rate_limited" };
      if (err.code === "invalid") return { ok: false, error: "invalid" };
    }
    console.error("[client-home] target save failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "failed" };
  }
}
