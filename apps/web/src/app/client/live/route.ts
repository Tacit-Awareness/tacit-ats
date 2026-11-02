import { readLiveStamp } from "@/lib/client/live";
import { resolveClient } from "@/lib/client/session";

// The live stamp (lib/client/live.ts) the Pipeline and the Inbox poll while
// they are on screen (components/live-refresh.tsx). On the signed-in member's
// token; never cached.
export async function GET(): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  const gate = await resolveClient();
  if (gate.status !== "ok") return Response.json({ stamp: null }, { status: 401, headers });
  return Response.json({ stamp: await readLiveStamp(gate.ctx.db) }, { headers });
}
