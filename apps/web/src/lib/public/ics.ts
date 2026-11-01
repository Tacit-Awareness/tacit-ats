// A minimal VEVENT parser for Google Calendar invites. An invite.ics is a
// folded iCalendar text: long lines wrap by prefixing the next line with a
// space. We only read VEVENT properties we sync an interview from; anything
// unread (recurrence, alarms) is ignored, not an error.

export type ParsedEvent = {
  uid: string;
  summary: string | null;
  location: string | null;
  status: "confirmed" | "cancelled" | "tentative" | null;
  startsAt: string | null; // ISO instant when the stamp carries one
  endsAt: string | null;
  organizer: string | null;
  attendees: string[];
};

function unfold(ics: string): string[] {
  const lines = ics.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

/** "DTSTART;TZID=America/Los_Angeles:20261031T150000" -> name + params + value. */
function prop(line: string): { name: string; params: string; value: string } | null {
  const i = line.indexOf(":");
  if (i < 0) return null;
  const head = line.slice(0, i);
  const semi = head.indexOf(";");
  return { name: (semi < 0 ? head : head.slice(0, semi)).toUpperCase(), params: semi < 0 ? "" : head.slice(semi + 1), value: line.slice(i + 1) };
}

/** 20261031T150000Z -> ISO; TZID floats are kept as clock time (see header). */
function stamp(v: string, params: string): string | null {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  return v.endsWith("Z") ? `${iso}Z` : iso; // floating stamps have no zone; callers see local clock time
}

export function parseIcs(ics: string): ParsedEvent | null {
  let inEvent = false;
  const ev: ParsedEvent = { uid: "", summary: null, location: null, status: null, startsAt: null, endsAt: null, organizer: null, attendees: [] };
  for (const raw of unfold(ics)) {
    const up = raw.toUpperCase();
    if (up === "BEGIN:VEVENT") inEvent = true;
    else if (up === "END:VEVENT") break;
    else if (inEvent) {
      const p = prop(raw);
      if (!p) continue;
      if (p.name === "UID") ev.uid = p.value.trim();
      else if (p.name === "SUMMARY") ev.summary = p.value;
      else if (p.name === "LOCATION") ev.location = p.value;
      else if (p.name === "STATUS") ev.status = p.value.toLowerCase() as ParsedEvent["status"];
      else if (p.name === "DTSTART") ev.startsAt = stamp(p.value, p.params);
      else if (p.name === "DTEND") ev.endsAt = stamp(p.value, p.params);
      else if (p.name === "ORGANIZER") ev.organizer = p.value.replace(/^mailto:/i, "").toLowerCase();
      else if (p.name === "ATTENDEE") {
        const mail = p.value.match(/mailto:([^\s]+)/i)?.[1];
        if (mail) ev.attendees.push(mail.toLowerCase());
      }
    }
  }
  return ev.uid ? ev : null;
}
