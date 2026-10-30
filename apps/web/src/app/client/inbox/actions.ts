"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearOverdueAction, touchApplication } from "@/lib/client/inbox";
import { requireClient } from "@/lib/client/session";
import type { InboxError, InboxNotice } from "./messages";

// The Inbox's two writes, both the candidate page's: clear an overdue next
// action, or log a touch. Core's pipeline functions on the member's own
// client, so the policies decide again. Posted fields are request data, so
// the id and the `next` key are re-read.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISSUE_KEY = /^(app|appr|draft)-[0-9a-f-]{36}$/i;

// Only codes and ids go in the URL, never a name or a message.
const back = (params: { i?: string | null; notice?: InboxNotice; error?: InboxError }): never => {
  const qs = new URLSearchParams();
  if (params.i) qs.set("i", params.i);
  if (params.notice) qs.set("notice", params.notice);
  if (params.error) qs.set("error", params.error);
  return redirect(`/client/inbox?${qs}`);
};

export async function fixIssueAction(form: FormData): Promise<void> {
  const { db, actorId } = await requireClient();
  const applicationId = form.get("applicationId");
  const write = form.get("write");
  if (typeof applicationId !== "string" || !UUID.test(applicationId) || (write !== "done" && write !== "touch")) return back({ error: "not_found" });
  const next = form.get("next");
  const i = typeof next === "string" && ISSUE_KEY.test(next) ? next : null;
  const expected = form.get("expected");

  let outcome: Awaited<ReturnType<typeof touchApplication>>;
  try {
    outcome = write === "done" ? await clearOverdueAction(db, actorId, { applicationId, nextAction: typeof expected === "string" ? expected : null }, new Date()) : await touchApplication(db, actorId, applicationId);
  } catch (err) {
    console.error("[client-inbox] fix failed:", err instanceof Error ? err.message : err);
    return back({ i: `app-${applicationId}`, error: "failed" });
  }
  if (!outcome.ok) return back({ i: `app-${applicationId}`, error: outcome.error === "forbidden" ? "forbidden" : "not_found" });

  revalidatePath("/client/inbox");
  revalidatePath("/client/pipeline");
  // On to the next issue: the one below it in the list, as the page sent it.
  return back({ i, notice: !outcome.changed ? "unchanged" : write === "done" ? "done" : "touched" });
}
