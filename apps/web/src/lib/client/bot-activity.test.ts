import { describe, expect, test } from "vitest";
import { ASKED_HOLD_MS, attentionOf, botName, botState, groupByDay, logLine, logRow, matchesLog, needsAttention, plainLine, stepLines, statusLabel, waited, type BotCommandRecord, type BotTask } from "./bot-activity";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const HOUR = 3_600_000;
const hoursAgo = (h: number) => new Date(NOW - h * HOUR).toISOString();
const ME = "me";

const ada = { id: "p-ada", name: "Ada Lovelace" };
const daniel = { id: "a-dan", name: "Daniel Okafor" };

const task = (over: Partial<BotTask> = {}): BotTask => ({
  id: "t1",
  kind: "schedule_interview",
  status: "running",
  needsYou: false,
  error: null,
  steps: [],
  createdAt: hoursAgo(72),
  updatedAt: hoursAgo(2),
  actor: daniel,
  waitingOn: null,
  channel: null,
  application: { id: "app", roleId: "job", addedBy: null, merged: false },
  candidate: ada,
  jobTitle: "Engineer",
  commands: [],
  ...over,
});

const command = (over: Partial<BotCommandRecord> = {}): BotCommandRecord => ({ command: "retry", status: "sent", error: null, createdAt: hoursAgo(1), ...over });
const line = (t: BotTask, me = ME) => plainLine(logLine(t, me));
const waitingOnDaniel = { ...daniel, type: "member" as const };

describe("waited", () => {
  test("says a wait the way design/tats does", () => {
    expect(waited(45 * 60_000)).toBe("45m");
    expect(waited(3 * HOUR)).toBe("3h");
    expect(waited(24 * HOUR)).toBe("1d");
    expect(waited(52 * HOUR)).toBe("2d 4h");
    expect(waited(-5)).toBe("0m");
  });
});

describe("the bot's name", () => {
  test("yours, someone's, or the company's when it serves no one", () => {
    expect(botName({ actor: { id: ME, name: "Ryan" } }, ME)).toBe("Your Grokbot");
    expect(botName({ actor: daniel }, ME)).toBe("Daniel's Grokbot");
    expect(botName({ actor: { id: "x", name: "James Ross" } }, ME)).toBe("James' Grokbot");
    expect(botName({ actor: null }, ME)).toBe("The Grokbot");
    expect(botName({ actor: { id: "x", name: null } }, ME)).toBe("The Grokbot");
  });
});

describe("what a task's state is", () => {
  test("an open task is stuck only when flagged", () => {
    expect(botState(task({ status: "waiting" }))).toBe("waiting");
    expect(botState(task({ status: "running" }))).toBe("running");
    expect(botState(task({ status: "waiting", needsYou: true }))).toBe("stuck");
    expect(botState(task({ status: "failed" }))).toBe("failed");
    expect(botState(task({ status: "done" }))).toBe("done");
    expect(botState(task({ status: "cancelled" }))).toBe("cancelled");
  });

  test("the row's label names who it waits on", () => {
    expect(statusLabel(task({ status: "waiting", waitingOn: waitingOnDaniel }), ME)).toBe("Waiting on Daniel");
    expect(statusLabel(task({ status: "waiting", needsYou: true, waitingOn: waitingOnDaniel }), ME)).toBe("No reply from Daniel");
    expect(statusLabel(task({ status: "waiting", needsYou: true }), ME)).toBe("Not moving");
    expect(statusLabel(task({ status: "waiting", waitingOn: { id: ME, name: "Ryan", type: "member" } }), ME)).toBe("Waiting on you");
  });
});

describe("a log line", () => {
  test("says each kind plainly, naming only what is recorded", () => {
    expect(line(task({ status: "done" }))).toBe("Daniel's Grokbot booked the interview with Daniel for Ada Lovelace");
    expect(line(task({ kind: "get_read", status: "done" }))).toBe("Daniel's Grokbot got Daniel's read on Ada Lovelace");
    expect(line(task({ kind: "ask_interviewer", status: "done" }))).toBe("Daniel's Grokbot heard back from Daniel about Ada Lovelace");
    expect(line(task({ kind: "find_interviewer", status: "done", actor: null }))).toBe("The Grokbot found an interviewer for Ada Lovelace");
    expect(line(task({ kind: "send_testbench", status: "done" }))).toBe("Daniel's Grokbot sent the Testbench to Ada Lovelace");
    expect(line(task({ kind: "send_rejection", status: "running" }))).toBe("Daniel's Grokbot is sending the rejection to Ada Lovelace");
    expect(line(task({ kind: "other", status: "running" }))).toBe("Daniel's Grokbot is working on a task for Ada Lovelace");
  });

  test("a kind this page doesn't know reads as a task, never as nothing", () => {
    expect(line(task({ kind: "something_new", status: "done" }))).toBe("Daniel's Grokbot finished a task for Ada Lovelace");
  });

  test("a failure is the bad part, a wait names who", () => {
    expect(logLine(task({ status: "failed" }), ME)).toEqual([{ b: "Daniel's Grokbot" }, " ", { bad: "failed to schedule the interview" }, " for ", { b: "Ada Lovelace" }]);
    expect(line(task({ status: "waiting", waitingOn: waitingOnDaniel }))).toBe("Daniel's Grokbot is waiting on Daniel about Ada Lovelace");
    expect(line(task({ status: "waiting", waitingOn: { id: ada.id, name: ada.name, type: "candidate" } }))).toBe("Daniel's Grokbot is waiting on Ada Lovelace");
    expect(line(task({ status: "cancelled" }))).toBe("Daniel's Grokbot stopped trying to schedule the interview for Ada Lovelace");
  });

  test("stuck says so, and a task with no candidate names none", () => {
    expect(line(task({ status: "waiting", needsYou: true, waitingOn: waitingOnDaniel }))).toBe("Daniel's Grokbot is still waiting on Daniel about Ada Lovelace");
    expect(line(task({ status: "running", needsYou: true }))).toBe("Daniel's Grokbot is stuck scheduling the interview for Ada Lovelace");
    expect(line(task({ status: "running", candidate: null, application: null }))).toBe("Daniel's Grokbot is scheduling the interview");
  });

  test("you are you, not your first name", () => {
    const mine = task({ actor: { id: ME, name: "Ryan Huang" }, kind: "get_read", status: "done" });
    expect(line(mine)).toBe("Your Grokbot got your read on Ada Lovelace");
  });
});

describe("what needs a member", () => {
  test("a failed task does, a healthy one doesn't", () => {
    expect(needsAttention(task({ status: "failed" }), NOW)).toBe(true);
    expect(needsAttention(task({ status: "waiting" }), NOW)).toBe(false);
    expect(needsAttention(task({ status: "done" }), NOW)).toBe(false);
  });

  test("an open task flagged needs_you does; a closed one never, whatever the flag says", () => {
    expect(needsAttention(task({ status: "waiting", needsYou: true }), NOW)).toBe(true);
    expect(needsAttention(task({ status: "running", needsYou: true }), NOW)).toBe(true);
    expect(needsAttention(task({ status: "done", needsYou: true }), NOW)).toBe(false);
    expect(needsAttention(task({ status: "cancelled", needsYou: true }), NOW)).toBe(false);
  });

  test("not on an application merged away", () => {
    expect(needsAttention(task({ status: "failed", application: { id: "a", roleId: "j", addedBy: null, merged: true } }), NOW)).toBe(false);
  });

  test("a retry takes a failed task out, until the bot says more", () => {
    const asked = task({ status: "failed", updatedAt: hoursAgo(3), commands: [command({ createdAt: hoursAgo(1) })] });
    expect(needsAttention(asked, NOW)).toBe(false);
    // The bot reported again after it, and it is still failed: that is news.
    expect(needsAttention({ ...asked, updatedAt: hoursAgo(0.5) }, NOW)).toBe(true);
  });

  test("the same moment counts as asked: bot_task_command stamps both in one transaction", () => {
    const at = hoursAgo(1);
    expect(needsAttention(task({ status: "failed", updatedAt: at, commands: [command({ createdAt: at })] }), NOW)).toBe(false);
  });

  test("a bot that took the command and never answers is back after the hold", () => {
    const asked = (ms: number) => task({ status: "failed", updatedAt: new Date(NOW - ms - HOUR).toISOString(), commands: [command({ createdAt: new Date(NOW - ms).toISOString() })] });
    expect(needsAttention(asked(ASKED_HOLD_MS - 1), NOW)).toBe(false);
    expect(needsAttention(asked(ASKED_HOLD_MS), NOW)).toBe(true);
  });

  test("a command that failed or was cancelled is no answer", () => {
    expect(needsAttention(task({ status: "failed", commands: [command({ status: "failed" })] }), NOW)).toBe(true);
    expect(needsAttention(task({ status: "failed", commands: [command({ status: "cancelled" })] }), NOW)).toBe(true);
  });

  test("the newest command that was delivered is the one that counts", () => {
    const commands = [command({ createdAt: hoursAgo(50) }), command({ createdAt: hoursAgo(1), status: "pending" })];
    expect(needsAttention(task({ status: "failed", updatedAt: hoursAgo(60), commands }), NOW)).toBe(false);
  });

  test("a pending command nobody picks up comes back to say so", () => {
    const t = task({ status: "failed", updatedAt: hoursAgo(60), commands: [command({ status: "pending", createdAt: hoursAgo(30) })] });
    expect(needsAttention(t, NOW)).toBe(true);
    expect(attentionOf(t, ME, NOW).queued).toBe("Retry asked for 1d 6h ago. The bot hasn't picked it up.");
  });
});

describe("the fix", () => {
  test("a failed task is retried, in the prototype's words", () => {
    const a = attentionOf(task({ status: "failed", error: "Slack refused it" }), ME, NOW);
    expect(a).toMatchObject({ tone: "failed", what: "Schedule the interview for Ada Lovelace didn't go through", why: "Slack refused it", queued: null, missed: null });
    expect(a.fix).toMatchObject({ command: "retry", label: "Retry" });
  });

  test("a send says it didn't send, and no error reads as how long", () => {
    const a = attentionOf(task({ kind: "send_testbench", status: "failed", updatedAt: hoursAgo(5) }), ME, NOW);
    expect(a.what).toBe("The Testbench to Ada Lovelace didn't send");
    expect(a.why).toBe("No update in 5h");
  });

  test("a retry that can reach the candidate says so before it happens", () => {
    for (const [kind, thing] of [["send_rejection", "rejection"], ["send_testbench", "Testbench"], ["send_invite", "invite"]] as const) {
      expect(attentionOf(task({ kind, status: "failed" }), ME, NOW).fix.copy.body).toContain(`the ${thing} can reach Ada Lovelace`);
    }
    expect(attentionOf(task({ kind: "find_interviewer", status: "failed" }), ME, NOW).fix.copy.body).not.toContain("can reach");
  });

  test("someone not answering is nudged by name, with where", () => {
    const a = attentionOf(task({ kind: "get_read", status: "waiting", needsYou: true, waitingOn: waitingOnDaniel, channel: "slack", updatedAt: hoursAgo(50) }), ME, NOW);
    expect(a).toMatchObject({ tone: "waiting", what: "Daniel hasn't sent a read on Ada Lovelace", why: "No update in 2d 2h" });
    expect(a.fix).toMatchObject({ command: "nudge", label: "Nudge Daniel" });
    expect(a.fix.copy).toMatchObject({ title: "Nudge Daniel?", confirm: "Nudge" });
    expect(a.fix.copy.body).toContain("reminds Daniel in Slack");
  });

  test("it counts the nudges that reached the bot", () => {
    const stuck = task({ status: "waiting", needsYou: true, waitingOn: waitingOnDaniel, updatedAt: hoursAgo(5) });
    const sent = command({ command: "nudge", createdAt: hoursAgo(40) });
    expect(attentionOf({ ...stuck, commands: [sent] }, ME, NOW).why).toBe("No update in 5h, nudged once");
    expect(attentionOf({ ...stuck, commands: [sent, sent] }, ME, NOW).why).toBe("No update in 5h, nudged 2 times");
    expect(attentionOf({ ...stuck, commands: [{ ...sent, status: "failed" }] }, ME, NOW).why).toBe("No update in 5h");
  });

  test("a candidate not answering is said as them, on no job's words", () => {
    const a = attentionOf(task({ status: "waiting", needsYou: true, waitingOn: { id: ada.id, name: ada.name, type: "candidate" } }), ME, NOW);
    expect(a.what).toBe("Ada hasn't replied");
    expect(a.fix.label).toBe("Nudge Ada");
  });

  test("waiting on yourself: a reminder, not a nudge of you", () => {
    const a = attentionOf(task({ status: "waiting", needsYou: true, waitingOn: { id: ME, name: "Ryan", type: "member" } }), ME, NOW);
    expect(a.what).toBe("You haven't replied about Ada Lovelace");
    expect(a.fix).toMatchObject({ command: "nudge", label: "Remind me" });
    expect(a.fix.copy.title).toBe("Remind you?");
  });

  test("stopped with nobody to nudge is retried", () => {
    const a = attentionOf(task({ status: "running", needsYou: true }), ME, NOW);
    expect(a).toMatchObject({ tone: "failed", what: "Schedule the interview for Ada Lovelace isn't moving" });
    expect(a.fix.command).toBe("retry");
  });

  test("the same command already queued has nothing to press", () => {
    const a = attentionOf(task({ status: "waiting", needsYou: true, waitingOn: waitingOnDaniel, commands: [command({ command: "nudge", status: "pending", createdAt: hoursAgo(3) })] }), ME, NOW);
    expect(a.queued).toBe("Nudge asked for 3h ago. The bot hasn't picked it up.");
  });

  test("a command that never reached the bot says so", () => {
    expect(attentionOf(task({ status: "failed", commands: [command({ status: "failed", error: "stale" })] }), ME, NOW).missed).toBe("Your last retry didn't reach the bot.");
    expect(attentionOf(task({ status: "failed", commands: [command({ status: "failed", command: "cancel" })] }), ME, NOW).missed).toBe("Your last request didn't reach the bot.");
  });

  test("a bot's error is taken as text and passed on as text", () => {
    const text = '<img src=x onerror="alert(1)"> and "quotes"';
    expect(attentionOf(task({ status: "failed", error: text }), ME, NOW).why).toBe(text);
  });
});

describe("a log row", () => {
  test("carries what the page shows and nothing else of the task's", () => {
    const row = logRow(task({ status: "failed", error: "No calendar", steps: [{ label: "Asked Daniel", at: hoursAgo(3) }, { label: "Gave up", at: null }] }), ME, NOW);
    expect(row).toMatchObject({ id: "t1", avatar: "Daniel Okafor", state: "failed", status: "Failed", job: "Engineer", error: "No calendar", age: "2h ago", candidateHref: "/client/candidates/p-ada" });
    expect(row.steps).toEqual([{ label: "Asked Daniel", age: "3h ago" }, { label: "Gave up", age: null }]);
  });

  test("a merged application says so", () => {
    expect(logRow(task({ application: { id: "a", roleId: "j", addedBy: null, merged: true } }), ME, NOW).note).toBe("This application was merged into another.");
  });

  test("no candidate, no link", () => {
    expect(logRow(task({ candidate: null, application: null }), ME, NOW).candidateHref).toBeNull();
  });
});

describe("searching the log", () => {
  const row = logRow(task({ status: "done" }), ME, NOW);
  test("by name, whatever the case, in any order", () => {
    expect(matchesLog(row, "ada")).toBe(true);
    expect(matchesLog(row, "LOVELACE ada")).toBe(true);
    expect(matchesLog(row, "daniel")).toBe(true);
  });
  test("by the kind and the job too", () => {
    expect(matchesLog(row, "schedule")).toBe(true);
    expect(matchesLog(row, "engineer")).toBe(true);
  });
  test("every word must match", () => {
    expect(matchesLog(row, "ada zebra")).toBe(false);
  });
  test("an empty box is everything, spaces too", () => {
    expect(matchesLog(row, "")).toBe(true);
    expect(matchesLog(row, "   ")).toBe(true);
  });
  test("regex characters are just characters", () => {
    expect(matchesLog(row, ".*")).toBe(false);
    expect(matchesLog(row, "(")).toBe(false);
  });
});

describe("grouping by day", () => {
  test("keeps the order and makes a heading a run of days", () => {
    const rows = [{ at: "a1" }, { at: "a2" }, { at: "b1" }];
    expect(groupByDay(rows, (iso) => iso[0]!)).toEqual([
      { day: "a", rows: [rows[0], rows[1]] },
      { day: "b", rows: [rows[2]] },
    ]);
  });
  test("nothing is no days", () => {
    expect(groupByDay([], () => "x")).toEqual([]);
  });
});

test("stepLines keeps a step with no time", () => {
  expect(stepLines([{ label: "One", at: null }], NOW)).toEqual([{ label: "One", age: null }]);
});
