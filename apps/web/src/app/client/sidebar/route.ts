import { readSidebarCounts } from "@/lib/client/sidebar-counts";
import { resolveClient } from "@/lib/client/session";

// The sidebar's counts (lib/client/sidebar-counts.ts), which shell-frame.tsx
// asks for after the page has drawn. On the signed-in member's token; never cached.
export async function GET(): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  const gate = await resolveClient();
  if (gate.status !== "ok") return Response.json({ triage: 0, teams: {} }, { status: 401, headers });
  const { db, actorId, org, accessLevel } = gate.ctx;
  return Response.json(await readSidebarCounts(db, { actorId, orgId: org.id, accessLevel }, new Date()), { headers });
}
