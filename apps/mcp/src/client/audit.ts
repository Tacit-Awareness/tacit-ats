import { breadthExceeded, recordCall } from "@tacit/core";
import { getSupabaseTacitClient } from "@tacit/db";

/**
 * The read audit (`mcp_calls`) for the client connector: one row per tool
 * call, as `client:<tool>`, and the hourly breadth ceiling over those rows.
 * The table is Tacit's own and has no org, so the member's token can neither
 * write nor read it; this file is the other place under src/client allowed a
 * privileged client, and it only ever inserts that row or counts the
 * member's own.
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

/** True when this read would take the member past 150 distinct candidates in the trailing hour. */
export async function clientBreadthExceeded(actorId: string, candidateIds: string[]): Promise<boolean> {
  return breadthExceeded(getSupabaseTacitClient(), actorId, candidateIds);
}
