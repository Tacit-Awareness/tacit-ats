"use server";

import { revalidatePath } from "next/cache";
import { saveProcess } from "@/lib/client/process";
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
