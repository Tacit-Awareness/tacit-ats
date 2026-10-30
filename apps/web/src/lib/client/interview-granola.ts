// What the Interviews reader needs around Granola's text, pure. Granola's MCP
// tools answer in text meant for a model, XML-ish tags and no fixed schema
// (packages/core's granola.ts), so this reads that text loosely: the few tags
// it knows become headings, and anything else stays as it came, tags included.
// Nothing else is dropped, and nothing here is ever markup: the text goes out as
// React text, so a tag inside a candidate's words shows as those characters.

/** Only an interviewer's own notes, once the interview has started; core refuses the rest anyway. */
export const granolaReadable = (item: { mine: boolean; status: string; startsAt: string }, now: number) =>
  item.mine && item.status !== "cancelled" && Date.parse(item.startsAt) <= now;

export function granolaHref(interviewId: string, opts: { note?: string; transcript?: boolean } = {}) {
  const params = new URLSearchParams({ i: interviewId });
  if (opts.note) params.set("note", opts.note);
  if (opts.transcript) params.set("transcript", "1");
  return `/client/interviews?${params}`;
}

export type GranolaSection = { label: string | null; text: string };
export type GranolaText = { title: string | null; date: string | null; sections: GranolaSection[] };

const LABELS: Record<string, string> = {
  known_participants: "Attendees",
  participants: "Attendees",
  private_notes: "Your notes",
  summary: "Summary",
};
const WRAPPER = /<\/?(?:meetings_data|meetings|meeting|transcript)\b[^<>]*>/gi;
// An unclosed one runs to the end: core cuts long text, closing tag and all.
const SECTION = /<(known_participants|participants|private_notes|summary)\b[^<>]*>([\s\S]*?)(?:<\/\1>|$)/gi;

const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]?.trim() || null;

/** A tag's content without the indent the tag's nesting gave it; bullets keep their own. */
function dedent(text: string) {
  const lines = text.replace(/^\s*\n/, "").trimEnd().split("\n");
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
  return lines.map((l) => l.slice(indent)).join("\n");
}

/** A meeting's text as a title, a date and its sections in Granola's order. */
export function granolaText(raw: string | null): GranolaText {
  const text = raw ?? "";
  const meeting = /<meeting\b[^<>]*>/i.exec(text)?.[0] ?? "";
  const body = text.replace(WRAPPER, "").trim();
  const sections: GranolaSection[] = [];
  let at = 0;
  const loose = (chunk: string) => {
    if (chunk.trim()) sections.push({ label: null, text: chunk.trim() });
  };
  for (const m of body.matchAll(SECTION)) {
    loose(body.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[2]!.trim()) sections.push({ label: LABELS[m[1]!.toLowerCase()]!, text: dedent(m[2]!) });
  }
  loose(body.slice(at));
  return { title: attr(meeting, "title"), date: attr(meeting, "date"), sections };
}

/** A transcript is the words as said: only Granola's own wrapper comes off. */
export const granolaTranscript = (raw: string | null) => (raw ?? "").replace(WRAPPER, "").trim();

const MATCHED: Record<string, string> = {
  event: "Matched by the calendar event",
  email: "Matched by the candidate's email",
  time: "The one meeting at that time",
  chosen: "The meeting you picked",
};
export const matchedLine = (by: string) => MATCHED[by] ?? null;
