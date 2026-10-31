import { readCandidateCard, readMemberCard } from "@/lib/client/hover-card";
import { resolveClient } from "@/lib/client/session";
import { parseHoverTarget, type HoverCardData } from "@/lib/hover-card";

// A hover card (components/hover-card.tsx), read when a mouse rests on a name. On
// the signed-in member's own token (lib/client/hover-card.ts), so what they cannot
// read is a line missing, and someone they cannot see is a 404, the same as nobody
// by that id. Never cached.
export async function GET(req: Request): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  const answer = (card: HoverCardData | null, status: number) => Response.json({ card }, { status, headers });
  const gate = await resolveClient();
  if (gate.status !== "ok") return answer(null, 401);
  const target = parseHoverTarget(new URL(req.url).searchParams.get("t"));
  if (!target) return answer(null, 400);
  try {
    const now = new Date();
    const card = target.kind === "candidate" ? await readCandidateCard(gate.ctx, target.id, now.getTime()) : await readMemberCard(gate.ctx, target.id, now);
    return answer(card, card ? 200 : 404);
  } catch (err) {
    console.error("[client-hover] read failed:", err instanceof Error ? err.message : err);
    return answer(null, 500);
  }
}
