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
  // svix secrets are whsec_<base64>; the key is the decoded bytes.
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${raw}`).digest("base64");
  return sigs.split(" ").some((s) => {
    const v = s.split(",")[1] ?? "";
    try {
      return timingSafeEqual(Buffer.from(v), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

async function resendGet(path: string): Promise<{ status: number; body: unknown } | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  const res = await fetch(`${RESEND}${path}`, { headers: { authorization: `Bearer ${key}` } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

type Att = { id?: string; filename?: string; content_type?: string; download_url?: string; content_disposition?: string };

const isIcs = (a: Att) => /text\/calendar|application\/ics|\.ics$/i.test(`${a.content_type ?? ""} ${a.filename ?? ""}`);

// Resend's received-email API returns attachment metadata with a temporary
// download_url; the shape differs by version, so try the field, then a
// per-attachment GET, then an inline VEVENT in the email body.
async function fetchIcs(emailId: string): Promise<{ ics: string | null; diag: string }> {
  const list = await resendGet(`/emails/receiving/${emailId}/attachments`);
  if (!list) return { ics: null, diag: "no_api_key" };
  if (list.status !== 200) return { ics: null, diag: `list_${list.status}` };
  const atts = ((list.body as { data?: Att[]; attachments?: Att[] })?.data
    ?? (list.body as { attachments?: Att[] })?.attachments
    ?? (Array.isArray(list.body) ? (list.body as Att[]) : [])) as Att[];
  const ics = atts.find(isIcs) ?? atts[0];
  if (!ics) return { ics: null, diag: "no_attachments" };
  if (ics.download_url) {
    const res = await fetch(ics.download_url);
    if (res.ok) return { ics: await res.text(), diag: "download_url" };
  }
  if (ics.id) {
    const att = await resendGet(`/emails/receiving/${emailId}/attachments/${ics.id}`);
    if (att && att.status === 200 && att.body) {
      const b = att.body as Record<string, unknown>;
      const content = (b.content ?? b.data ?? b.download_url) as string | undefined;
      if (typeof content === "string" && content.startsWith("http")) {
        const res = await fetch(content);
        if (res.ok) return { ics: await res.text(), diag: "attachment_get_url" };
      }
      if (typeof content === "string" && content.includes("BEGIN:VCALENDAR")) return { ics: content, diag: "attachment_get_body" };
      return { ics: null, diag: `att_keys_${Object.keys(b).join("|")}` };
    }
  }
  const mail = await resendGet(`/emails/receiving/${emailId}`);
  const body = (mail?.body as { text?: string })?.text ?? "";
  const inline = body.match(/BEGIN:VCALENDAR[\s\S]*END:VCALENDAR/)?.[0];
  return { ics: inline ?? null, diag: inline ? "inline" : "none" };
}

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  if (!svixOk(request, raw)) return new Response(null, { status: 401 });
  const event = JSON.parse(raw) as { type?: string; data?: { email_id?: string } };
  if (event.type !== "email.received" || !event.data?.email_id) return Response.json({});

  const { ics, diag } = await fetchIcs(event.data.email_id);
  const ev = ics ? parseIcs(ics) : null;
  if (!ev) return Response.json({ ok: true, skipped: "no_invite", diag }); // a normal email, not an invite: done

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

  // The interviewers: members of that org on the guest list, plus the
  // event's organizer (the member who booked it -- Google puts them in
  // ORGANIZER, not ATTENDEE, so matching guests alone misses them).
  const memberMails = ev.organizer ? [...mails, ev.organizer] : mails;
  const { data: actors } = await db
    .from("actors").select("id, email")
    .eq("org_id", person.org_id).in("email", memberMails);
  const interviewerIds = ((actors ?? []) as { id: string }[]).map((a) => a.id); // actors.id is what interviewer_actor_ids expects
  if (!ev.startsAt) return Response.json({ ok: true, skipped: "no_time" });

  const status = ev.status === "cancelled" ? "cancelled" : "scheduled";
  const endsAt = ev.endsAt ?? ev.startsAt;
  const { data: existing } = await db
    .from("interviews").select("id").eq("org_id", person.org_id).eq("google_event_id", ev.uid).maybeSingle();
  if (existing) {
    await db.from("interviews").update({ starts_at: ev.startsAt, ends_at: endsAt, status }).eq("id", existing.id);
    return Response.json({ ok: true, interview: existing.id, updated: true });
  }
  const { data: made, error } = await db.from("interviews")
    .insert({
      id: crypto.randomUUID(),
      org_id: person.org_id,
      application_id: app.id,
      google_event_id: ev.uid,
      starts_at: ev.startsAt,
      ends_at: endsAt,
      status,
      interviewer_actor_ids: interviewerIds,
      calendar_actor_id: interviewerIds[0] ?? null,
    }).select("id").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, interview: made?.id });
}
