import { revalidatePath } from "next/cache";
import { memberCalendar } from "@/lib/member-calendar/grants";
import { runScheduleRequest } from "@/lib/client/schedule-ops";
import { parseScheduleRequest, sameOrigin, SIGNED_OUT, type ScheduleAnswer } from "@/lib/client/schedule-requests";
import { resolveClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";

// POST /client/schedule/api: the server-side path the Calendar's book, move,
// cancel and Find a time take to a member's Google Calendar (PR 44's follow-up).
// It runs as the member: who they are comes from their session, every read and
// write in lib/client/schedule-ops.ts is on their own token, and the only other
// thing it holds is core's way to the calendar grants (lib/member-calendar).
//
// A route rather than a server action because of that one import: everything an
// action needs is reachable from app/client, and nothing there may reach a
// privileged client. In a route group, so the folder is outside app/client and
// the URL is inside the proxy's sign-in. An action gets Next's origin check for
// free; here sameOrigin makes it.
//
// Only JSON, at most 16KB, from this site. A refused request reads as an answer
// in the dialog. What the database or Google said never comes back.

const BODY_MAX = 16_000;

const refused = (status: number, code: "invalid" | "forbidden" | "signed_out", message: string) =>
  Response.json({ ok: false, code, message } satisfies ScheduleAnswer, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  const gate = await resolveClient();
  if (gate.status !== "ok") return refused(401, "signed_out", SIGNED_OUT);
  if (!sameOrigin(request.headers)) return refused(403, "forbidden", "That request did not come from this site.");
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) return refused(415, "invalid", "That request was not understood.");

  const text = await request.text();
  if (text.length > BODY_MAX) return refused(413, "invalid", "That request was too long.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refused(400, "invalid", "That request was not understood.");
  }
  const parsed = parseScheduleRequest(body);
  if (!parsed.ok) return refused(400, "invalid", "That request was not understood.");

  const member = gate.ctx;
  const answer = await runScheduleRequest(member.db, toolCtx(member), parsed.request, {
    calendar: memberCalendar(new URL(request.url).origin),
  });
  if (answer.ok && (answer.kind === "booked" || answer.kind === "changed")) {
    revalidatePath("/client/schedule");
    revalidatePath("/client/interviews");
  }
  return Response.json(answer, { headers: { "cache-control": "no-store" } });
}
