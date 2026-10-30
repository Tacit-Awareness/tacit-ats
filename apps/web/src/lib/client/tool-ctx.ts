import type { clientTools } from "@tacit-ats/core";
import type { ClientContext } from "./session";

/**
 * The signed-in member as clientTools' audited writes take them, with source
 * `dashboard`: the audit row says the write came from the web app, and an org
 * that set its connector read-only has not stopped its people working here
 * (tacit-internal 20261030120000_client_dashboard_source). The source is a
 * label, not a permission: the policies still decide each write.
 */
export const toolCtx = (member: Pick<ClientContext, "actorId" | "accessLevel" | "org">): clientTools.ClientToolCtx => ({
  actorId: member.actorId,
  orgId: member.org.id,
  accessLevel: member.accessLevel,
  source: "dashboard",
});
