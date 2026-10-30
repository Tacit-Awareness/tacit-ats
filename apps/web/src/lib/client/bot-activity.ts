import type { ConfirmCopy } from "./inbox-decisions";

// Grokbot Activity's rules and words (design/tats's #activity, its `feedLine`,
// `todoOf` and `needsAttention`), on what `bot_tasks` records. Pure:
// lib/client/bot-tasks.ts reads, this decides what needs a member and says it.
// Every name, step and error here is plain text, never markup. A line says only
// what the row records: `done` on an ask is that the bot heard back, not that
// the answer was yes, and there is no "picked Daniel", because a task does not
// store who was picked.

export type BotStep = { label: string; at: string | null };

/** A member's command on the task, as `bot_task_commands` keeps it. */
export type BotCommandRecord = { command: string; status: string; error: string | null; createdAt: string };

export type BotPerson = { id: string; name: string | null };

export type BotTask = {
  id: string;
  kind: string;
  status: string;
  needsYou: boolean;
  error: string | null;
  steps: BotStep[];
  createdAt: string;
  updatedAt: string;
  /** The member the bot serves, when the task names one. */
  actor: BotPerson | null;
  /** Who it is waiting on: a member or the candidate. */
  waitingOn: (BotPerson & { type: "member" | "candidate" }) | null;
  /** Where it is waiting: slack, imessage, email, other. */
  channel: string | null;
  /** Null for a task with no application behind it, which is for the member it serves and admins. */
  application: { id: string; roleId: string | null; addedBy: string | null; merged: boolean } | null;
  candidate: { id: string; name: string } | null;
  jobTitle: string | null;
  commands: BotCommandRecord[];
};

const HOUR = 3_600_000;

/**
 * How long a member's command answers for a task the bot has said nothing more
 * about: the day the notify tick gives any task before it calls it stale. A
 * failed task stays `failed` until the bot reports, so without this one retry
 * would either hide it for good or never hide it at all.
 */
export const ASKED_HOLD_MS = 24 * HOUR;

const OPEN = new Set(["running", "waiting"]);

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

const possessive = (name: string) => (name === "you" ? "your" : /s$/i.test(name) ? `${name}'` : `${name}'s`);

/** "45m", "3h", "2d 4h": how design/tats's `dur` says a wait. */
export function waited(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return hours % 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${Math.floor(hours / 24)}d`;
}

type KindWords = {
  title: string;
  verb: string;
  ing: string;
  past: (member: string | null) => string;
  /** The word before the candidate: "sent the Testbench to Ada". */
  to: string;
};

const KINDS: Record<string, KindWords> = {
  find_interviewer: { title: "Find an interviewer", verb: "find an interviewer", ing: "finding an interviewer", past: () => "found an interviewer", to: "for" },
  ask_interviewer: { title: "Ask an interviewer", verb: "ask an interviewer", ing: "asking an interviewer", past: (m) => `heard back from ${m ?? "an interviewer"}`, to: "about" },
  schedule_interview: { title: "Schedule the interview", verb: "schedule the interview", ing: "scheduling the interview", past: (m) => `booked the interview${m ? ` with ${m}` : ""}`, to: "for" },
  get_read: { title: "Get the read", verb: "get the read", ing: "getting the read", past: (m) => (m ? `got ${possessive(m)} read` : "got the read"), to: "on" },
  send_testbench: { title: "Send the Testbench", verb: "send the Testbench", ing: "sending the Testbench", past: () => "sent the Testbench", to: "to" },
  send_rejection: { title: "Send the rejection", verb: "send the rejection", ing: "sending the rejection", past: () => "sent the rejection", to: "to" },
  send_invite: { title: "Send the invite", verb: "send the invite", ing: "sending the invite", past: () => "sent the invite", to: "to" },
  other: { title: "A task", verb: "finish a task", ing: "working on a task", past: () => "finished a task", to: "for" },
};

const kindOf = (kind: string): KindWords => KINDS[kind] ?? KINDS.other!;

/** "Your Grokbot", "Daniel's Grokbot", or the company's when the task serves no one. */
export function botName(t: Pick<BotTask, "actor">, me: string): string {
  if (t.actor?.id === me) return "Your Grokbot";
  return t.actor?.name ? `${possessive(firstName(t.actor.name))} Grokbot` : "The Grokbot";
}

const memberWord = (p: BotPerson | null, me: string) => (!p ? null : p.id === me ? "you" : p.name ? firstName(p.name) : null);

export type BotState = "failed" | "stuck" | "waiting" | "running" | "done" | "cancelled";

export function botState(t: Pick<BotTask, "status" | "needsYou">): BotState {
  if (OPEN.has(t.status)) return t.needsYou ? "stuck" : t.status === "waiting" ? "waiting" : "running";
  return t.status === "failed" ? "failed" : t.status === "cancelled" ? "cancelled" : "done";
}

export function statusLabel(t: BotTask, me: string): string {
  const s = botState(t);
  if (s === "failed") return "Failed";
  if (s === "done") return "Done";
  if (s === "cancelled") return "Cancelled";
  const on = t.waitingOn?.id === me ? "you" : t.waitingOn?.name ? firstName(t.waitingOn.name) : null;
  if (s === "stuck") return on ? `No reply from ${on}` : "Not moving";
  return s === "waiting" ? `Waiting on ${on ?? "a reply"}` : "Running";
}

/** One piece of a line: plain, the names it picks out, or what went wrong. */
export type LinePart = string | { b: string } | { bad: string };

export const plainLine = (parts: LinePart[]) => parts.map((p) => (typeof p === "string" ? p : "b" in p ? p.b : p.bad)).join("");

/** One line per task, said the way a person would (design/tats's `feedLine`). */
export function logLine(t: BotTask, me: string): LinePart[] {
  const k = kindOf(t.kind);
  const bot = { b: botName(t, me) };
  const about = (word: string): LinePart[] => (t.candidate ? [` ${word} `, { b: t.candidate.name }] : []);
  const s = botState(t);
  if (s === "failed") return [bot, " ", { bad: `failed to ${k.verb}` }, ...about(k.to)];
  if (s === "cancelled") return [bot, ` stopped trying to ${k.verb}`, ...about(k.to)];
  const member = t.waitingOn?.type === "member" ? t.waitingOn : t.actor;
  if (s === "done") return [bot, ` ${k.past(memberWord(member, me))}`, ...about(k.to)];
  if (t.status === "waiting" && t.waitingOn) {
    const wait = s === "stuck" ? { bad: "is still waiting on" } : "is waiting on";
    if (t.waitingOn.type === "candidate") return [bot, " ", wait, " ", { b: t.waitingOn.name ?? t.candidate?.name ?? "the candidate" }];
    return [bot, " ", wait, " ", { b: memberWord(t.waitingOn, me) ?? "a teammate" }, ...about("about")];
  }
  if (s === "stuck") return [bot, " ", { bad: "is stuck" }, ` ${k.ing}`, ...about(k.to)];
  return [bot, ` is ${k.ing}`, ...about(k.to)];
}

/** Newest first: what the member last asked the bot to do. */
const commandsNewestFirst = (t: BotTask) => [...t.commands].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

/**
 * Does this task need a member now? Failed, or flagged `needs_you` while open
 * (by the bot, or by the notify tick on a task that has not moved in a day),
 * and not on an application merged away. Once a member has asked, it leaves
 * until the bot reports again or the hold runs out, and a pending command that
 * has outlived the hold (no bot is taking them) brings it back to say so.
 */
export function needsAttention(t: BotTask, now: number): boolean {
  if (t.application?.merged) return false;
  if (t.status !== "failed" && !(t.needsYou && OPEN.has(t.status))) return false;
  const asked = commandsNewestFirst(t).find((c) => c.status === "pending" || c.status === "sent");
  if (!asked) return true;
  const answered = Date.parse(t.updatedAt) > Date.parse(asked.createdAt);
  return answered || now - Date.parse(asked.createdAt) >= ASKED_HOLD_MS;
}

export type BotCommandName = "retry" | "nudge";

/** The fix, and what its confirmation says: a command makes the bot act where nobody can take it back. */
export type BotFix = { taskId: string; command: BotCommandName; label: string; copy: ConfirmCopy };

export type BotAttention = {
  taskId: string;
  /** `waiting` names someone to chase; `failed` is the bot's own trouble. */
  tone: "failed" | "waiting";
  what: string;
  why: string;
  fix: BotFix;
  /** The fix is already asked for and not yet picked up: nothing to press. */
  queued: string | null;
  /** The last command never reached the bot. */
  missed: string | null;
};

const REACHES_CANDIDATE: Record<string, string> = { send_rejection: "rejection", send_testbench: "Testbench", send_invite: "invite" };
const CHANNEL: Record<string, string> = { slack: "in Slack", imessage: "by iMessage", email: "by email" };

function retryCopy(t: BotTask, bot: string): ConfirmCopy {
  const k = kindOf(t.kind);
  const name = t.candidate?.name ?? "the candidate";
  const thing = REACHES_CANDIDATE[t.kind];
  return {
    title: `Retry: ${k.verb}${t.candidate ? ` ${k.to} ${t.candidate.name}` : ""}?`,
    body: thing ? `${bot} tries again, and the ${thing} can reach ${name} this time. That can't be taken back.` : `${bot} tries again. It works out how, so anything it sends can't be taken back from here.`,
    confirm: "Retry",
    danger: false,
  };
}

function nudgeCopy(t: BotTask, bot: string, who: string, self: boolean): ConfirmCopy {
  const where = t.channel ? (CHANNEL[t.channel] ?? "") : "";
  return {
    title: self ? "Remind you?" : `Nudge ${who}?`,
    body: `${bot} reminds ${self ? "you" : who}${where ? ` ${where}` : ""}. It writes the message, and it can't be taken back.`,
    confirm: self ? "Remind me" : "Nudge",
    danger: false,
  };
}

function didNotReach(t: BotTask): string | null {
  const last = commandsNewestFirst(t)[0];
  if (last?.status !== "failed") return null;
  return `Your last ${last.command === "retry" || last.command === "nudge" ? last.command : "request"} didn't reach the bot.`;
}

function queuedNote(t: BotTask, command: BotCommandName, now: number): string | null {
  const pending = t.commands.find((c) => c.status === "pending" && c.command === command);
  if (!pending) return null;
  const word = command === "retry" ? "Retry" : "Nudge";
  return `${word} asked for ${waited(now - Date.parse(pending.createdAt))} ago. The bot hasn't picked it up.`;
}

/**
 * What a member sees on a task that needs them, said plainly, with its one fix
 * (design/tats's `todoOf`). A failed task is retried. One waiting on a named
 * person is nudged. Anything else that has stopped is retried too: there is
 * nobody to nudge.
 */
export function attentionOf(t: BotTask, me: string, now: number): BotAttention {
  const k = kindOf(t.kind);
  const bot = botName(t, me);
  const name = t.candidate?.name ?? null;
  const quiet = `No update in ${waited(now - Date.parse(t.updatedAt))}`;
  const nudges = t.commands.filter((c) => c.command === "nudge" && c.status === "sent").length;
  const nudged = nudges ? `, nudged ${nudges === 1 ? "once" : `${nudges} times`}` : "";
  const common = { taskId: t.id, missed: didNotReach(t) };

  if (t.status === "waiting" && t.waitingOn) {
    const self = t.waitingOn.id === me;
    const who = self ? "You" : t.waitingOn.name ? firstName(t.waitingOn.name) : t.waitingOn.type === "candidate" ? (name ? firstName(name) : "The candidate") : "A teammate";
    const said = self ? "haven't" : "hasn't";
    const about = t.waitingOn.type === "candidate" || !name ? "" : t.kind === "get_read" ? ` on ${name}` : ` about ${name}`;
    const label = self ? "Remind me" : `Nudge ${who}`;
    return {
      ...common,
      tone: "waiting",
      what: t.kind === "get_read" ? `${who} ${said} sent a read${about}` : `${who} ${said} replied${about}`,
      why: `${quiet}${nudged}`,
      fix: { taskId: t.id, command: "nudge", label, copy: nudgeCopy(t, bot, who, self) },
      queued: queuedNote(t, "nudge", now),
    };
  }

  const subject = name ? ` ${k.to} ${name}` : "";
  const sending = REACHES_CANDIDATE[t.kind];
  const what = t.status !== "failed" ? `${k.title}${subject} isn't moving` : sending ? `The ${sending}${subject} didn't send` : `${k.title}${subject} didn't go through`;
  return {
    ...common,
    tone: "failed",
    what,
    why: t.error || quiet,
    fix: { taskId: t.id, command: "retry", label: "Retry", copy: retryCopy(t, bot) },
    queued: queuedNote(t, "retry", now),
  };
}

/** The steps as a member reads them, newest last, each with how long ago. */
export const stepLines = (steps: BotStep[], now: number) => steps.map((s) => ({ label: s.label, age: s.at ? `${waited(now - Date.parse(s.at))} ago` : null }));

export type StepLine = ReturnType<typeof stepLines>[number];

export type LogRow = {
  id: string;
  /** The member the bot serves, as design/tats draws each interviewer's bot. */
  avatar: string;
  line: LinePart[];
  at: string;
  age: string;
  state: BotState;
  status: string;
  job: string | null;
  error: string | null;
  steps: StepLine[];
  note: string | null;
  candidateHref: string | null;
  /** Lower-cased, for the search box. */
  search: string;
};

export function logRow(t: BotTask, me: string, now: number): LogRow {
  const line = logLine(t, me);
  const job = t.jobTitle;
  const status = statusLabel(t, me);
  return {
    id: t.id,
    avatar: t.actor?.name ?? "Grokbot",
    line,
    at: t.updatedAt,
    age: `${waited(now - Date.parse(t.updatedAt))} ago`,
    state: botState(t),
    status,
    job,
    error: t.error,
    steps: stepLines(t.steps, now),
    note: t.application?.merged ? "This application was merged into another." : didNotReach(t),
    candidateHref: t.candidate ? `/client/candidates/${t.candidate.id}` : null,
    search: [plainLine(line), kindOf(t.kind).title, status, job, t.candidate?.name].filter(Boolean).join(" ").toLowerCase(),
  };
}

/** Whether a row answers the search box: every word, anywhere in what it says. */
export function matchesLog(row: Pick<LogRow, "search">, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => row.search.includes(w));
}

/** Rows under their day, in the order they came: newest first, as the log reads. */
export function groupByDay<T extends { at: string }>(rows: T[], dayOf: (iso: string) => string): { day: string; rows: T[] }[] {
  const days: { day: string; rows: T[] }[] = [];
  for (const row of rows) {
    const day = dayOf(row.at);
    const last = days.at(-1);
    if (last?.day === day) last.rows.push(row);
    else days.push({ day, rows: [row] });
  }
  return days;
}
