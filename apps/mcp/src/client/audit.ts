import { recordCall } from "@tacit/core";
import { getSupabaseTacitClient } from "@tacit/db";

/**
 * The read audit (`mcp_calls`) for the client connector: one row per tool
 * call, as `client:<tool>`. The table is Tacit's own and has no org, so the
 * member's token cannot write it; this file is the other place under
 * src/client allowed a privileged client, and it only ever inserts that row.
 */
export async function auditClientCall(entry: {
  actorId: string;
  tool: string;
  args: unknown;
  personIds: string[];
  ok: boolean;
}): Promise<void> {
  await recordCall(getSupabaseTacitClient(), { ...entry, tool: `client:${entry.tool}` });
}
