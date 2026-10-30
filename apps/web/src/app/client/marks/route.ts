import { readMarks } from "@/lib/client/marks";
import { resolveClient } from "@/lib/client/session";
import { NO_MARKS } from "@/lib/sidebar-marks";

// The sidebar's marks (lib/sidebar-marks.ts), read after the page has painted
// so a slow Inbox never holds up the shell. On the signed-in member's token;
// the answer is ids, and never cached.
export async function GET(): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  const gate = await resolveClient();
  if (gate.status !== "ok") return Response.json(NO_MARKS, { status: 401, headers });
  const { db, actorId, org, accessLevel } = gate.ctx;
  return Response.json(await readMarks(db, { actorId, orgId: org.id, accessLevel }, new Date()), { headers });
}
