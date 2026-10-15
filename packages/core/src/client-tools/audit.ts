import type { Db, Json } from "@tacit/db";

import { ClientToolError, type ClientToolCtx } from "./context.js";

/** The one claim a read-only org still takes, from an admin: switching the connector back. */
export const CONNECTOR_ACCESS_ACTION = "org.connector_access";

/**
 * What a write answers when the org's admin has made the connector read-only
 * (connector.ts): the database refuses the claim, so nothing was written.
 */
export const READ_ONLY_REFUSAL =
  "Your company's admin has set the Tacit connector to read-only, so it cannot make changes and nothing was " +
  "changed. An admin can turn changes back on with set_connector_access (read_write), here or by asking them; " +
  "reading still works.";

/**
 * Every write is claimed in audit_log before it happens and completed after
 * (client_claim_write / client_finish_write, 20261014180000): the claim is
 * also the hourly limit, so it comes immediately before the write, after
 * validation and the permission check. A write that fails leaves its claim
 * open (after = null); one that changed nothing, or was refused with a
 * ClientToolError, gives it back.
 */
export async function withAudit<T>(
  db: Db,
  ctx: ClientToolCtx,
  claim: { action: string; entity: string },
  write: () => Promise<{ result: T; entityId: string | null; before?: unknown; after?: unknown; changed: boolean }>,
): Promise<T> {
  const { data: auditId, error } = await db.rpc("client_claim_write", {
    p_source: ctx.source,
    p_action: claim.action,
    p_entity: claim.entity,
  });
  if (error) {
    // client_claim_write's refusal in a read-only org (20261017110000_client_connector_access).
    if (error.code === "42501" && /read-only/.test(error.message)) throw new ClientToolError("forbidden", READ_ONLY_REFUSAL);
    throw new Error(error.message);
  }
  if (!auditId) {
    throw new ClientToolError("rate_limited", "You have made 300 changes in the last hour, the limit. Try again later.");
  }
  let done: Awaited<ReturnType<typeof write>>;
  try {
    done = await write();
  } catch (err) {
    // A refusal changed nothing: give the claim back. Anything else keeps it open (after = null).
    if (err instanceof ClientToolError) {
      const release = await db.rpc("client_finish_write", {
        p_audit: auditId, p_entity_id: null as unknown as string, p_before: null as unknown as Json, p_after: null as unknown as Json, p_keep: false,
      });
      if (release.error) console.error(`[client-tools] could not release audit row ${auditId}:`, release.error.message);
    }
    throw err;
  }
  const finish = await db.rpc("client_finish_write", {
    p_audit: auditId,
    // A record of the write is still a record without the entity it touched.
    p_entity_id: done.entityId as string,
    p_before: (done.before ?? null) as Json,
    p_after: (done.after ?? {}) as Json,
    p_keep: done.changed,
  });
  if (finish.error) console.error(`[client-tools] could not complete audit row ${auditId}:`, finish.error.message);
  return done.result;
}
