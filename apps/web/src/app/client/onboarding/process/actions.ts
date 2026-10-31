"use server";

import { revalidatePath } from "next/cache";
import { applyProcess, previewApply, saveProcess, type ApplyAnswer } from "@/lib/client/process";
import { requireClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import type { SaveAnswer } from "./messages";

// The process's writes, on the signed-in admin's own client: core's audited tools
// and the policies decide. Answers, not redirects: the drawing is on the page and a
// refusal has to leave it there.

export async function saveProcessAction(input: { graph: unknown; expectedUpdatedAt: string | null }): Promise<SaveAnswer> {
  const member = await requireClient();
  const answer = await saveProcess(member.db, toolCtx(member), input);
  // The checklist beside every step counts the process.
  if (answer.ok) revalidatePath("/client/onboarding", "layout");
  return answer;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What Apply would do. Writes nothing. */
export async function previewApplyAction(expectedUpdatedAt: string): Promise<ApplyAnswer> {
  const member = await requireClient();
  return previewApply(member.db, toolCtx(member), expectedUpdatedAt);
}

/** The steps come from what is saved, read again here: the page only says which jobs. */
export async function applyProcessAction(input: { expectedUpdatedAt: string; jobIds: string[] }): Promise<ApplyAnswer> {
  const member = await requireClient();
  const jobIds = Array.isArray(input.jobIds) ? input.jobIds.filter((id) => typeof id === "string" && UUID.test(id)) : [];
  const answer = await applyProcess(member.db, toolCtx(member), { expectedUpdatedAt: input.expectedUpdatedAt, jobIds });
  if (answer.ok && answer.updated) revalidatePath("/client", "layout");
  return answer;
}
