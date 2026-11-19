// Tacit Tickets' status colours for people (design/tacit-tickets/src/kit.tsx),
// pure, so a server page and a client chart colour the same person the same way.
// Amber is waiting on you, red is overdue, blue is waiting on someone else, green
// is moving. One meaning each, everywhere (DESIGN.md section 3).

export type Tone = "needs" | "failed" | "waiting" | "running";

export const TONE_COLOR: Record<Tone, string> = {
  needs: "var(--amber)",
  failed: "var(--red)",
  waiting: "var(--blue)",
  running: "var(--green)",
};

/** What each colour means, in the legend's order. */
export const TONE_MEANING: [Tone, string, string][] = [
  ["needs", "Needs you", "Waiting on you to act"],
  ["failed", "Overdue", "Past its date, needs a look"],
  ["running", "Moving", "Nothing for you to do"],
  ["waiting", "Waiting on them", "Nobody has touched it in a while"],
];

/**
 * A block is coloured only when something in it needs a look: red if anyone is
 * overdue, else amber if anyone is waiting on you. A block where the work is
 * simply moving stays plain.
 */
export const worst = (tones: Tone[]): Tone | undefined => (["failed", "needs"] as Tone[]).find((t) => tones.includes(t));

/** A summary bar's segment by its name: who is waiting on you, who failed, who is quiet; the rest are moving. */
const NAME_TONE: Record<string, Tone> = { "awaiting review": "needs", overdue: "failed", rejected: "failed", withdrew: "waiting", "no reply": "waiting" };
export const toneOfName = (name: string): Tone => NAME_TONE[name] ?? "running";
