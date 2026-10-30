"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sendBotCommand, type BotCommandOutcome } from "@/lib/client/bot-tasks";
import { requireClient } from "@/lib/client/session";
import type { ActivityError, ActivityNotice } from "./messages";

// Retry and Nudge, from Grokbot Activity or the Inbox, on the member's own
// client: bot_task_command decides again and audits it as `dashboard`. Posted
// fields are request data, so they are re-read, and only those two commands
// pass: send_invite and cancel are not offered anywhere. This queues; it never
// calls a bot, and the notify tick delivers.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISSUE_KEY = /^(app|appr|draft|bot)-[0-9a-f-]{36}$/i;

const ERRORS: Record<Extract<BotCommandOutcome, { ok: false }>["error"], ActivityError> = { not_found: "bot_gone", forbidden: "bot_forbidden", closed: "bot_closed" };

/** Only codes and ids go in the URL, never a name or a message. */
function back(from: "inbox" | "activity", i: string | null, code: { notice: ActivityNotice } | { error: ActivityError }): never {
  const qs = new URLSearchParams();
  if (from === "inbox" && i) qs.set("i", i);
  if ("notice" in code) qs.set("notice", code.notice);
  else qs.set("error", code.error);
  return redirect(`/client/${from}?${qs}`);
}

export async function botCommandAction(form: FormData): Promise<void> {
  const member = await requireClient();
  const from = form.get("from") === "inbox" ? "inbox" : "activity";
  const taskId = form.get("taskId");
  const command = form.get("command");
  if (typeof taskId !== "string" || !UUID.test(taskId) || (command !== "retry" && command !== "nudge")) return back(from, null, { error: "bot_gone" });
  const here = `bot-${taskId}`;

  let outcome: BotCommandOutcome;
  try {
    outcome = await sendBotCommand(member.db, member.actorId, { taskId, command }, new Date());
  } catch (err) {
    console.error("[client-activity] command failed:", err instanceof Error ? err.message : err);
    return back(from, here, { error: "bot_failed" });
  }
  if (!outcome.ok) return back(from, here, { error: ERRORS[outcome.error] });

  revalidatePath("/client/activity");
  revalidatePath("/client/inbox");
  // On to the next issue, as the page sent it.
  const next = form.get("next");
  return back(from, typeof next === "string" && ISSUE_KEY.test(next) ? next : null, { notice: !outcome.changed ? "bot_unchanged" : command === "retry" ? "retry_queued" : "nudge_queued" });
}
