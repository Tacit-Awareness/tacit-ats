// An invite to the org's calendar address, Greenhouse-style: the client
// books (or moves, or cancels) an interview in their own Google Calendar
// with calendar@tacitawareness.com as a guest, Google emails the invite to
// that address, the Workspace group forwards it to Resend's inbound
// domain, and Resend posts email.received here. The VEVENT in invite.ics
// is the sync contract: its UID is interviews.google_event_id, so a resend
// of the same event updates rather than duplicates, and a cancelled event
// lands cancelled. App-booked interviews get a calendar@ guest too, so
// moves made in Google write back to the row the app created.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSupabaseServiceClient } from "@tacit/db";
import { parseIcs } from "@/lib/public/ics";

const RESEND = "https://api.resend.com";

// Resend signs webhooks with svix: signature = base64(HMAC(secret, id.ts.body)).
function svixOk(req: Request, raw: string): boolean {
  const secret = process.env.RESEND_INBOUND_SECRET;
  if (!secret) return false; // refuse unless the route is configured
  const id = req.headers.get("svix-id") ?? "";
  const ts = req.headers.get("svix-timestamp") ?? "";
  const sigs = req.headers.get("svix-signature") ?? "";
  if (!id || !ts || !sigs) return false;
  const expected = createHmac("sha256", secret.replace(/^whsec_/, "")).update(`${id}.${ts}.${raw}`).digest("base64");
  return sigs.split(" ").some((s) => {
    const v = s.split(",")[1] ?? "";
    try {
      return timingSafeEqual(Buffer.from(v), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

async function resendGet(path: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  const res = await fetch(`${RESEND}${path}`, { headers: { authorization: `Bearer ${key}` } });
  return res.ok ? res.json() : null;
}

type Att = { filename?: string; content_type?: string; download_url?: string; content_disposition?: string };

async function fetchIcs(emailId: string): Promise<string | null> {
  const atts = (await resendGet(`/emails/receiving/${emailId}/attachments`)) as { data?: Att[] } | null;
  for (const a of atts?.data ?? []) {
    const isIcs = /text\/calendar|\.ics$/i.test(`${a.content_type ?? ""} ${a.filename ?? ""}`);
    if (isIcs && a.download_url) {
      const res = await fetch(a.download_url);
      if (res.ok) return res.text();
    }
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  if (!svixOk(request, raw)) return new Response(null, { status: 401 });
  const event = JSON.parse(raw) as { type?: string; data?: { email_id?: string } };
  if (event.type !== "email.received" || !event.data?.email_id) return Response.json({});

  const ics = await fetchIcs(event.data.email_id);
  const ev = ics ? parseIcs(ics) : null;
  if (!ev) return Response.json({ ok: true, skipped: "no_invite" }); // a normal email, not an invite: done

  const db = getSupabaseServiceClient();
  // The candidate: an attendee whose address is a person identifier. Org follows the person.
  const mails = ev.attendees.filter((m) => !m.endsWith("@tacitawareness.com"));
  const { data: people } = await db
    .from("person_identifiers").select("person_id, org_id, people!inner(id, display_name)")
    .eq("kind", "email").in("value", mails);
  const person = (people ?? [])[0] as { person_id: string; org_id: string } | undefined;
  if (!person) return Response.json({ ok: true, skipped: "no_candidate" });

  const { data: app } = await db
    .from("applications").select("id")
    .eq("person_id", person.person_id).eq("org_id", person.org_id)
    .not("stage", "in", '("hired","rejected","withdrawn")')
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!app) return Response.json({ ok: true, skipped: "no_application" });

  // The interviewer: an attendee who is a member actor of that org.
  const { data: actors } = await db
    .from("org_members").select("actor_id, actors!inner(email)")
    .eq("org_id", person.org_id).in("actors.email", mails);
  const interviewerIds = ((actors ?? []) as { actor_id: string }[]).map((a) => a.actor_id);

  const status = ev.status === "cancelled" ? "cancelled" : "scheduled";
  const row = {
    org_id: person.org_id,
    application_id: app.id,
    google_event_id: ev.uid,
    title: ev.summary ?? "Interview",
    starts_at: ev.startsAt,
    ends_at: ev.endsAt,
    status,
    interviewer_actor_ids: interviewerIds,
    mode: "video",
  };
  const { data: existing } = await db
    .from("interviews").select("id, created_by_actor_id").eq("org_id", person.org_id).eq("google_event_id", ev.uid).maybeSingle();
  if (existing) {
    await db.from("interviews").update({ starts_at: ev.startsAt, ends_at: ev.endsAt, status, title: row.title }).eq("id", existing.id);
    return Response.json({ ok: true, interview: existing.id, updated: true });
  }
  const { data: made, error } = await db.from("interviews")
    .insert({ ...row, id: crypto.randomUUID(), calendar_actor_id: interviewerIds[0] ?? null }).select("id").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, interview: made?.id });
}
