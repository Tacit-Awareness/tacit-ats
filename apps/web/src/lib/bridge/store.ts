import { getSupabaseServiceClient } from "@tacit/db";

import type { BridgeAnswer, BridgeCall } from "./requests";

/**
 * The staff bridge's database calls (supabase/migrations/
 * 20261106010000_staff_bridge.sql): the client half of what tacit-internal
 * did across orgs on the shared project. The service role, since the
 * bridge_* functions are granted to it alone and Tacit is no member here.
 *
 * Reached only from app/api/bridge/[endpoint]/route.ts, after the request's
 * signature checked out (src/client-area.test.ts's "the one way to the staff
 * bridge"). One function, never the client: each call names a bridge_*
 * function and nothing else.
 */
type Rpc = (fn: string, args: object) => PromiseLike<{
  data: unknown;
  error: { code?: string; message: string } | null;
}>;

export async function callBridge(call: BridgeCall): Promise<BridgeAnswer> {
  const db = getSupabaseServiceClient();
  // The bridge_* functions are this repo's own (supabase/), not in @tacit/db's
  // generated types, so the call is typed by BridgeCall above instead.
  const rpc = db.rpc.bind(db) as unknown as Rpc;
  const { data, error } = await rpc(call.fn, call.args);
  if (error) return { ok: false, code: error.code ?? "", message: error.message };
  return { ok: true, rows: Array.isArray(data) ? (data as Record<string, unknown>[]) : [] };
}
