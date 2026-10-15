import type { Db } from "@tacit/db";

import { CONNECTOR_ACCESS_ACTION, withAudit } from "./audit.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";

/**
 * The connector's own setting (Tacit-Awareness migration
 * 20261017110000_client_connector_access): an org's admin can make it
 * read-only, like Greenhouse's read scopes without write scopes. The database
 * enforces it: in a read-only org client_claim_write refuses every write's
 * claim, which withAudit answers with READ_ONLY_REFUSAL, except an admin's
 * claim to change this setting, so they can always switch it back here.
 * Org-wide; the /client portal is not affected.
 */
export const CONNECTOR_ACCESS = ["read_write", "read_only"] as const;
export type ConnectorAccess = (typeof CONNECTOR_ACCESS)[number];

export type ConnectorSettings = {
  access: ConnectorAccess;
  /** Who last changed it and when; null while it has never been changed. */
  setBy: string | null;
  setAt: string | null;
};

export async function getConnectorSettings(db: Db, ctx: ClientToolCtx): Promise<ConnectorSettings> {
  const { data, error } = await db
    .from("orgs")
    .select("connector_access, connector_access_set_at, setter:org_members!orgs_connector_access_set_by_actor_id_fkey(display_name)")
    .eq("id", ctx.orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("the member's org is not readable");
  const setter = data.setter as { display_name: string | null } | null;
  return {
    access: data.connector_access as ConnectorAccess,
    setBy: setter?.display_name ?? null,
    setAt: data.connector_access_set_at,
  };
}

export async function setConnectorAccess(
  db: Db,
  ctx: ClientToolCtx,
  input: { access: ConnectorAccess },
): Promise<{ outcome: "changed" | "unchanged"; previous: ConnectorAccess; access: ConnectorAccess }> {
  const notAdmin = new ClientToolError("forbidden", "Only an admin at your company can change the connector's access.");
  if (ctx.accessLevel !== "admin") throw notAdmin;
  if (!CONNECTOR_ACCESS.includes(input.access)) throw new ClientToolError("invalid", "Access is read_write or read_only.");
  return withAudit(db, ctx, { action: CONNECTOR_ACCESS_ACTION, entity: "org" }, async () => {
    const { data, error } = await db.rpc("set_connector_access", { p_access: input.access });
    if (error) {
      if (error.code === "42501") throw notAdmin;
      throw new Error(error.message);
    }
    const previous = data as ConnectorAccess;
    const changed = previous !== input.access;
    return {
      result: { outcome: changed ? ("changed" as const) : ("unchanged" as const), previous, access: input.access },
      entityId: ctx.orgId,
      before: { connector_access: previous },
      after: { connector_access: input.access },
      changed,
    };
  });
}
