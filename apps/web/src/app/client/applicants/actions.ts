"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { homeSubBase, hrefAt } from "@/lib/client/home-tabs";
import { isRoute, routeApplicant } from "@/lib/client/applicants";
import { draftReply, sendDraft } from "@/lib/client/email";
import { webMailer } from "@/lib/client/mailer";
import { requireClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import type { ApplicantError, ApplicantNotice, ReplyState } from "./messages";

// New Applicants' routing bar: interview, or decline with a reason.
// lib/client/applicants.ts's routeApplicant runs core's moveStage on
// the signed-in member's own client, so the policies decide whether it lands
// (can_edit_pipeline on the job). Posted fields are request data, so every id
// and choice is re-checked. The reply box's two writes are clientTools' draft
// and send on the same client, with source `dashboard`, and always two posts:
// nothing here both writes a draft and sends it. A subject or body never goes
// in the URL or the log.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(form: FormData, key: string): string | null {
  const v = form.get(key);
  return typeof v === "string" && UUID.test(v) ? v : null;
}

// Only codes and ids go in the URL, never a name or a message.
const back = (form: FormData, params: { a?: string | null; notice?: ApplicantNotice; error?: ApplicantError }): never => {
  const qs = new URLSearchParams();
  if (params.a) qs.set("a", params.a);
  if (params.notice) qs.set("notice", params.notice);
  if (params.error) qs.set("error", params.error);
  // A flag and never a path: the form names no place to go.
  return redirect(hrefAt(form.get("home") === "1" ? homeSubBase("tickets") : "/client/applicants", qs));
};

export async function routeApplicantAction(form: FormData): Promise<void> {
  const { db, actorId } = await requireClient();
  const applicationId = id(form, "applicationId");
  const route = form.get("route");
  if (!applicationId || !isRoute(route)) return back(form, { error: "not_found" });

  let outcome: Awaited<ReturnType<typeof routeApplicant>>;
  try {
    outcome = await routeApplicant(db, actorId, { applicationId, route, reasonId: id(form, "reasonId") });
  } catch (err) {
    console.error("[client-applicants] routing failed:", err instanceof Error ? err.message : err);
    return back(form, { a: applicationId, error: "failed" });
  }
  if (!outcome.ok) return back(form, { a: applicationId, error: outcome.error });

  revalidatePath("/client/applicants");
  revalidatePath("/client");
  revalidatePath("/client/pipeline");
  // On to the next ticket: the one below it in the list, as the page sent it.
  return back(form, { a: id(form, "next"), notice: outcome.route });
}

/** "Review draft": writes a draft and sends nothing. The page then shows what was stored. */
export async function draftReplyAction(_: ReplyState, form: FormData): Promise<ReplyState> {
  const member = await requireClient();
  const applicationId = id(form, "applicationId");
  const candidateId = id(form, "candidateId");
  const subject = form.get("subject");
  const body = form.get("body");
  if (!applicationId || !candidateId || typeof subject !== "string" || typeof body !== "string") return { error: "That application isn't one you can see any more. No draft was written." };

  let outcome: Awaited<ReturnType<typeof draftReply>>;
  try {
    outcome = await draftReply(member.db, toolCtx(member), webMailer(), { candidateId, applicationId, subject, body });
  } catch (err) {
    console.error("[client-applicants] draft failed:", err instanceof Error ? err.message : err);
    return { error: "That didn't work. No draft was written." };
  }
  if (!outcome.ok) return { error: outcome.error };

  revalidatePath("/client/applicants");
  revalidatePath("/client");
  return back(form, { a: applicationId });
}

/** Send, on the draft the page showed: that stored draft, exactly as stored. */
export async function sendReplyAction(form: FormData): Promise<void> {
  const member = await requireClient();
  const applicationId = id(form, "applicationId");
  const draftId = id(form, "draftId");
  if (!applicationId || !draftId) return back(form, { error: "send_gone" });

  let outcome: Awaited<ReturnType<typeof sendDraft>>;
  try {
    outcome = await sendDraft(member.db, toolCtx(member), webMailer(), draftId);
  } catch (err) {
    console.error("[client-applicants] send failed:", err instanceof Error ? err.message : err);
    return back(form, { a: applicationId, error: "send_failed" });
  }
  revalidatePath("/client/applicants");
  revalidatePath("/client");
  if (!outcome.ok) return back(form, { a: applicationId, error: outcome.error });

  revalidatePath("/client/inbox");
  revalidatePath("/client/pipeline");
  // Stays on the ticket: a reply routes nobody.
  return back(form, { a: applicationId, notice: "sent" });
}
