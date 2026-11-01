import { describe, expect, test } from "vitest";
import { parseIcs } from "./ics";

const INVITE = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-abc-123@google.com
DTSTART;TZID=America/Los_Angeles:20261031T150000
DTEND;TZID=America/Los_Angeles:20261031T160000
SUMMARY:Interview: Jane Doe x Acme
LOCATION:Zoom
STATUS:CONFIRMED
ORGANIZER:mailto:ryan@acme.com
ATTENDEE;CN=Jane Doe;RSVP=TRUE:mailto:jane@example.com
ATTENDEE;CUTYPE=RESOURCE:mailto:calendar@tacitawareness.com
END:VEVENT
END:VCALENDAR`;

describe("parseIcs", () => {
  test("reads the fields a sync needs", () => {
    const ev = parseIcs(INVITE)!;
    expect(ev.uid).toBe("evt-abc-123@google.com");
    expect(ev.summary).toBe("Interview: Jane Doe x Acme");
    expect(ev.status).toBe("confirmed");
    expect(ev.organizer).toBe("ryan@acme.com");
    expect(ev.attendees).toContain("jane@example.com");
    expect(ev.attendees).toContain("calendar@tacitawareness.com");
    expect(ev.startsAt).toBe("2026-10-31T15:00:00");
  });
  test("a cancelled event reads cancelled", () => {
    expect(parseIcs(INVITE.replace("STATUS:CONFIRMED", "STATUS:CANCELLED"))!.status).toBe("cancelled");
  });
  test("no VEVENT is null", () => {
    expect(parseIcs("BEGIN:VCALENDAR\nEND:VCALENDAR")).toBeNull();
  });
});
