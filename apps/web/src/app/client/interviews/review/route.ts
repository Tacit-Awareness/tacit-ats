import { parseReviewWrite } from "@/lib/client/interview-review-rules";
import { setReviewed } from "@/lib/client/interview-reviews";
import { resolveClient } from "@/lib/client/session";

// The reviewed check's one write, on the signed-in member's token. A route and
// not a server action: J right after E is the page's whole rhythm, and a
// navigation discards a server action in flight, whose promise then never
// settles (next's app-router-instance), leaving a check nobody can say was
// saved. Fetched, every write gets its answer. Another site's page cannot
// reach it: it cannot send JSON here without a preflight this route does not
// answer, and the browser says where a request came from. The answer is a yes
// or a no, and nothing about the interview.
export async function POST(request: Request): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  const answer = (status: number) => Response.json({ ok: status === 200 }, { status, headers });

  const site = request.headers.get("sec-fetch-site");
  if ((site && site !== "same-origin") || !request.headers.get("content-type")?.startsWith("application/json")) return answer(403);

  const gate = await resolveClient();
  if (gate.status !== "ok") return answer(401);
  const { db, actorId } = gate.ctx;

  const write = parseReviewWrite(await request.json().catch(() => null));
  if (!write) return answer(400);
  try {
    return answer((await setReviewed(db, actorId, write)) ? 200 : 404);
  } catch (err) {
    console.error("[client-interviews] review failed:", err instanceof Error ? err.message : "write failed");
    return answer(500);
  }
}
