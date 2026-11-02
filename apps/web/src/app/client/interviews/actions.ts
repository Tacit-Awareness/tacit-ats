"use server";

import { revalidatePath } from "next/cache";
import { parseFeedback, type FeedbackState } from "@/lib/client/feedback-rules";
import { fileFeedback } from "@/lib/client/feedback";
import { requireClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";

// Filing your own feedback from the reader. It answers in place (FeedbackState),
// as the candidate page's note does: a refusal hands the draft back, so nothing
// typed is lost or rides in a URL, and the notes never reach a log.

export async function fileFeedbackAction(prev: FeedbackState, form: FormData): Promise<FeedbackState> {
  const member = await requireClient();
  const parsed = parseFeedback(form);
  if (!parsed.ok) {
    if (parsed.error === null) return { filed: prev.filed };
    return { filed: prev.filed, error: parsed.error, draft: parsed.draft };
  }

  let outcome: Awaited<ReturnType<typeof fileFeedback>>;
  try {
    outcome = await fileFeedback(member.db, toolCtx(member), parsed.input);
  } catch (err) {
    console.error("[client-feedback] file failed:", err instanceof Error ? err.message : "write failed");
    return { filed: prev.filed, error: "failed", draft: parsed.draft };
  }
  if (!outcome.ok) return { filed: prev.filed, error: outcome.error, draft: parsed.draft };
  // The reader, Home's Interviews tab, the Inbox's feedback issues and the candidate's story all read it.
  revalidatePath("/client", "layout");
  return { filed: prev.filed + 1 };
}
