import type { Db } from "@tacit/db";

import { withAudit } from "./audit.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";

// The targets a company sets for Home's cards (tacit-internal
// 20261030223000_home_targets): at most one row per org and metric, and no row
// means no target. Admins write, on their own token; the migration leaves
// audit_log to the caller, so it is written here. A target's number is what the
// member chose and nothing more, so it can sit in the audit row. Whether a card
// is over its target is worked out where the card is drawn.

/** new_applications is a count, flagged below; the rest are hours, flagged over. */
export const HOME_TARGET_METRICS = ["new_applications", "review", "schedule", "feedback", "workload"] as const;
export type HomeTargetMetric = (typeof HOME_TARGET_METRICS)[number];
export type HomeTargets = Partial<Record<HomeTargetMetric, number>>;

/** home_targets.value's check. */
export const HOME_TARGET_MAX = 1_000_000;

export const isHomeTargetMetric = (m: unknown): m is HomeTargetMetric => (HOME_TARGET_METRICS as readonly unknown[]).includes(m);

const AUDIT = { entity: "home_target", set: "home_target.set", clear: "home_target.clear" } as const;

const notAdmin = () => new ClientToolError("forbidden", "Only an admin at your company can change Home's targets.");

/**
 * What the column keeps. numeric(10, 2) rounds before its check runs, so 0.004
 * would land as a target of 0 and -0.004 would pass: a value is judged rounded,
 * and one that rounds away from what was asked for is refused.
 */
function storable(value: number): number {
  if (!Number.isFinite(value)) throw new ClientToolError("invalid", "A target is a number.");
  const rounded = Math.round(value * 100) / 100;
  if (rounded < 0 || rounded > HOME_TARGET_MAX) throw new ClientToolError("invalid", `A target is 0 to ${HOME_TARGET_MAX.toLocaleString("en-US")}.`);
  if (value > 0 && rounded === 0) throw new ClientToolError("invalid", "A target is at least 0.01.");
  return rounded;
}

function refused(error: { code?: string; message: string }): Error {
  // The policies said no: the level on the token has moved since the page was drawn.
  return error.code === "42501" ? notAdmin() : new Error(error.message);
}

/** Every target the member can read: an admin's or a hiring-team member's org's, nothing for an interviewer. */
export async function getHomeTargets(db: Db): Promise<HomeTargets> {
  const { data, error } = await db.from("home_targets").select("metric, value");
  if (error) throw new Error(error.message);
  const targets: HomeTargets = {};
  for (const row of data ?? []) if (isHomeTargetMetric(row.metric)) targets[row.metric] = Number(row.value);
  return targets;
}

export type HomeTargetChange = { outcome: "changed" | "unchanged"; previous: number | null; value: number | null };

/** Sets one card's target. The same number again changes nothing and leaves no audit row. */
export async function setHomeTarget(db: Db, ctx: ClientToolCtx, input: { metric: HomeTargetMetric; value: number }): Promise<HomeTargetChange> {
  if (ctx.accessLevel !== "admin") throw notAdmin();
  if (!isHomeTargetMetric(input.metric)) throw new ClientToolError("invalid", "That card takes no target.");
  const value = storable(input.value);
  return withAudit(db, ctx, { action: AUDIT.set, entity: AUDIT.entity }, async () => {
    const before = await db.from("home_targets").select("value").eq("metric", input.metric).maybeSingle();
    if (before.error) throw refused(before.error);
    const previous = before.data === null ? null : Number(before.data.value);
    const changed = previous !== value;
    if (changed) {
      const { error } = await db.from("home_targets").upsert({ metric: input.metric, value }, { onConflict: "org_id,metric" });
      if (error) throw refused(error);
    }
    return {
      result: { outcome: changed ? ("changed" as const) : ("unchanged" as const), previous, value },
      entityId: null,
      before: { metric: input.metric, value: previous },
      after: { metric: input.metric, value },
      changed,
    };
  });
}

/** Removes one card's target. Nothing to remove changes nothing and leaves no audit row. */
export async function clearHomeTarget(db: Db, ctx: ClientToolCtx, input: { metric: HomeTargetMetric }): Promise<HomeTargetChange> {
  if (ctx.accessLevel !== "admin") throw notAdmin();
  if (!isHomeTargetMetric(input.metric)) throw new ClientToolError("invalid", "That card takes no target.");
  return withAudit(db, ctx, { action: AUDIT.clear, entity: AUDIT.entity }, async () => {
    // A delete the policies refuse removes no rows and raises nothing, so the answer comes from the rows it returns.
    const { data, error } = await db.from("home_targets").delete().eq("metric", input.metric).select("value");
    if (error) throw refused(error);
    const row = data?.[0];
    const previous = row ? Number(row.value) : null;
    return {
      result: { outcome: row ? ("changed" as const) : ("unchanged" as const), previous, value: null },
      entityId: null,
      before: { metric: input.metric, value: previous },
      after: { metric: input.metric, value: null },
      changed: !!row,
    };
  });
}
