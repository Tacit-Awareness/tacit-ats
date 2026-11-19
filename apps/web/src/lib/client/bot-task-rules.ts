import type { InterviewTimes } from "./pipeline-columns";

// Tickets' rules (design/tacit-tickets's Tickets, on tATS's bot_tasks), pure and
// unit-tested: a task's status as the page groups it, what it can be told to do,
// its words, and the interview round a candidate is at. The read is
// lib/client/bot-tasks.ts; the page app/client/tickets/page.tsx.

export const TASK_STATUSES = ["needs", "failed", "waiting", "running", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_LABEL: Record<TaskStatus, string> = { needs: "Needs You", failed: "Failed", waiting: "Waiting", running: "Running", done: "Done", cancelled: "Cancelled" };

export const KIND_LABEL: Record<string, string> = {
  find_interviewer: "Find Interviewer",
  ask_interviewer: "Ask Interviewer",
  schedule_interview: "Schedule Interview",
  get_read: "Get Read",
  send_testbench: "Send Testbench",
  send_rejection: "Send Rejection",
  send_invite: "Send Invite",
  other: "Other",
};
export const kindLabel = (kind: string) => KIND_LABEL[kind] ?? "Other";

/** What a member can tell the bot (the `bot_task_command` function's own list, less Send Invite: tATS keeps no draft on a task to send). */
export const COMMANDS = ["retry", "nudge", "cancel"] as const;
export type TaskCommand = (typeof COMMANDS)[number];
export const COMMAND_LABEL: Record<TaskCommand, string> = { retry: "Retry", nudge: "Nudge", cancel: "Cancel" };
export const isCommand = (v: unknown): v is TaskCommand => typeof v === "string" && (COMMANDS as readonly string[]).includes(v);

/** The bot flagged it, or it went stale while open: it needs the member. Otherwise its own status. */
export const statusOf = (t: { status: string; needsYou: boolean }): TaskStatus =>
  t.needsYou && (t.status === "waiting" || t.status === "running") ? "needs" : (TASK_STATUSES as readonly string[]).includes(t.status) ? (t.status as TaskStatus) : "running";

export const isOpenStatus = (s: TaskStatus) => s !== "done" && s !== "cancelled";

/** Which commands make sense for a task as it stands, as the prototype offers them. */
export function commandsFor(status: string): TaskCommand[] {
  if (status === "failed") return ["retry", "cancel"];
  if (status === "waiting") return ["nudge", "cancel"];
  if (status === "running") return ["cancel"];
  return [];
}

export type TaskStep = { label: string; at: string | null };

/** The bot's steps, opaque labels, as stored: anything that isn't a labelled step is dropped. */
export function stepsOf(raw: unknown): TaskStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((s) => {
    if (!s || typeof s !== "object") return [];
    const label = (s as { label?: unknown }).label;
    const at = (s as { at?: unknown }).at;
    return typeof label === "string" && label.trim() ? [{ label: label.trim(), at: typeof at === "string" ? at : null }] : [];
  });
}

/** The one line that says where a task stands: its error, who it waits on, or its last step. */
export function standing(t: { status: string; error: string | null; waitingOn: string | null; waitingChannel: string | null; steps: TaskStep[] }): string {
  if (t.status === "failed") return t.error ?? "Failed";
  if (t.status === "waiting" && t.waitingOn) return t.waitingChannel ? `${t.waitingOn} on ${CHANNEL[t.waitingChannel] ?? "another channel"}` : `Waiting on ${t.waitingOn}`;
  return t.steps[t.steps.length - 1]?.label ?? "";
}
const CHANNEL: Record<string, string> = { slack: "Slack", imessage: "iMessage", email: "Email", other: "another channel" };

export const NOT_BOOKED = "Not Booked Yet";

/** The round someone in interviews is at: their next booked interview's step, else the last one held, else not booked. */
export function roundOf(interviews: InterviewTimes[], now: number): string {
  const upcoming = interviews.filter((i) => i.status === "scheduled" && Date.parse(i.endsAt) > now).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  if (upcoming) return upcoming.step?.trim() || "Interview";
  const held = interviews.filter((i) => i.status === "done" || (i.status === "scheduled" && Date.parse(i.endsAt) <= now)).sort((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt))[0];
  return held ? held.step?.trim() || "Interview" : NOT_BOOKED;
}

/** The rounds as blocks: not booked first, then the company's process order where a name matches it, then the rest by name. */
export function roundOrder(rounds: string[], process: string[] | null): string[] {
  const at = new Map((process ?? []).map((n, i) => [n.trim().toLowerCase(), i]));
  const rank = (r: string) => (r === NOT_BOOKED ? -1 : (at.get(r.toLowerCase()) ?? Number.MAX_SAFE_INTEGER));
  return [...new Set(rounds)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** "4m", "3h", "2d", "5w": how long ago a task last moved, as the prototype's age column. */
export function age(iso: string, now: number): string {
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (m < 60) return `${Math.max(1, m)}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  const d = Math.floor(m / 1440);
  return d < 14 ? `${d}d` : `${Math.floor(d / 7)}w`;
}
