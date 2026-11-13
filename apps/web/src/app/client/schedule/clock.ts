// How the Calendar says a time: a 12-hour clock ("9:30 AM", a range as
// "12:40 – 1:40 PM", an hour as "8 AM"), in the member's own time zone, and
// the zone itself as a short offset ("GMT-8") with its full name kept for a
// hover. Shared by the grid (view.tsx) and the booking steps (booking.tsx).

const formats = new Map<string, Intl.DateTimeFormat>();
function format(key: string, make: () => Intl.DateTimeFormat) {
  let f = formats.get(key);
  if (!f) formats.set(key, (f = make()));
  return f;
}

const clockFormat = (timeZone: string) => format(`clock:${timeZone}`, () => new Intl.DateTimeFormat(undefined, { timeZone, hour: "numeric", minute: "2-digit", hour12: true }));

/** "9:30 AM". */
export const clock12 = (iso: string | number, timeZone: string) => clockFormat(timeZone).format(new Date(iso));

/** What the locale puts between a range's two times, " – " in English, read once from a range it formats. */
let dash: string | null = null;
const between = () =>
  (dash ??= clockFormat("UTC").formatRangeToParts(Date.UTC(2000, 0, 1, 1), Date.UTC(2000, 0, 1, 2)).find((p) => p.source === "shared")?.value ?? " – ");

/**
 * Two times as a range, the period said once when both ends share it. A range
 * that ends on the next day, as one ending at midnight does, would have the
 * locale add both dates ("11/13/2026, 1:30 PM – 11/14/2026, 12:00 AM"): the
 * date is said elsewhere, so it is the two times, "1:30 PM – 12:00 AM".
 */
function rangeOf(f: Intl.DateTimeFormat, a: Date, b: Date): string {
  const parts = f.formatRangeToParts(a, b);
  if (!parts.some((p) => p.type === "year" || p.type === "month" || p.type === "day")) return parts.map((p) => p.value).join("");
  return `${f.format(a)}${between()}${f.format(b)}`;
}

/** "12:40 – 1:40 PM": the period said once when both ends share it. */
export const range12 = (startsAt: string | number, endsAt: string | number, timeZone: string) => rangeOf(clockFormat(timeZone), new Date(startsAt), new Date(endsAt));

/** An hour of the grid's day: "8 AM", "12 PM". */
export const hour12 = (hour: number) => format("hour", () => new Intl.DateTimeFormat(undefined, { timeZone: "UTC", hour: "numeric", hour12: true })).format(Date.UTC(2000, 0, 1, hour % 24));

/** Minutes after midnight as a clock, for a slot being drawn before it is an instant. */
export const minutes12 = (minutes: number) => clockFormat("UTC").format(Date.UTC(2000, 0, 1, 0, minutes));

/** A span of minutes after midnight: "10 – 11 AM" style, the period said once. */
export const minutesRange12 = (start: number, end: number) => rangeOf(clockFormat("UTC"), new Date(Date.UTC(2000, 0, 1, 0, start)), new Date(Date.UTC(2000, 0, 1, 0, end)));

/** The zone as a short offset, "GMT-8"; "UTC" stays itself. */
export function zoneShort(timeZone: string, at: number = Date.now()): string {
  const part = format(`zone:${timeZone}`, () => new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }))
    .formatToParts(new Date(at))
    .find((p) => p.type === "timeZoneName")?.value;
  return part === "GMT" ? "UTC" : (part ?? timeZone);
}

/** The zone's full name for a hover, "America/Los Angeles". */
export const zoneLong = (timeZone: string) => timeZone.replace(/_/g, " ");
