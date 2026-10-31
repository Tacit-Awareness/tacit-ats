import { searchForMenu, searchQuery, type SearchHit } from "@/lib/client/candidate-search";
import { resolveClient } from "@/lib/client/session";

// ⌘K's candidate search (components/app-shell/command-menu.tsx), on the signed-in
// member's own token through core's searchCandidates. Nothing searchable asks
// nothing. Never cached.
export async function GET(req: Request): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  const answer = (hits: SearchHit[], status = 200) => Response.json({ hits }, { status, headers });
  const gate = await resolveClient();
  if (gate.status !== "ok") return answer([], 401);
  const query = searchQuery(new URL(req.url).searchParams.get("q"));
  if (!query) return answer([]);
  try {
    return answer(await searchForMenu(gate.ctx, query));
  } catch (err) {
    console.error("[client-search] search failed:", err instanceof Error ? err.message : err);
    return answer([], 500);
  }
}
