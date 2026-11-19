"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isCommand } from "@/lib/client/bot-task-rules";
import { commandTicket } from "@/lib/client/bot-tasks";
import { requireClient } from "@/lib/client/session";

// A ticket's buttons (design/tacit-tickets's TicketPanel): Retry, Nudge or
// Cancel, queued for the company's bot through `bot_task_command` on the
// member's own token (lib/client/bot-tasks.ts), which decides whether they may.
// Posted fields are request data: the task id and the command are re-checked,
// and only codes and ids go back in the URL.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function ticketCommandAction(form: FormData): Promise<void> {
  const { db } = await requireClient();
  const taskId = form.get("taskId");
  const command = form.get("command");
  const back = new URLSearchParams();
  if (typeof taskId !== "string" || !UUID.test(taskId) || !isCommand(command)) {
    back.set("error", "not_found");
    return redirect(`/client/tickets?${back}`);
  }
  back.set("t", taskId);
  const outcome = await commandTicket(db, taskId, command);
  if (outcome.ok) {
    back.set("notice", command);
    revalidatePath("/client/tickets");
  } else back.set("error", outcome.error);
  return redirect(`/client/tickets?${back}`);
}
