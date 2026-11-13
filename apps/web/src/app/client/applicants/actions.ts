"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { homeSubBase, hrefAt } from "@/lib/client/home-tabs";
import { DEFAULT_RANGE, parseRange } from "@/lib/client/inbox-digest";
import { isRoute, routeApplicant } from "@/lib/client/applicants";
import { draftReply, sendDraft } from "@/lib/client/email";
import { webFileStore } from "@/lib/client/file-store";
import { addApplicant, type IntakeOutcome } from "@/lib/client/intake";
import { webMailer } from "@/lib/client/mailer";
import { referralFile } from "@/lib/client/referrals";
import { requireClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import type { ApplicantError, ApplicantNotice, IntakeError, IntakeState, ReplyState } from "./messages";

// New Applicants' routing bar: interview, or decline with a reason, on its
// own page, in Home's tab or in the Inbox's pop-up (a `home` or `inbox` flag
// says which, and the redirect goes back there).
// lib/client/applicants.ts's routeApplicant runs core's moveStage on
// the signed-in member's own client, so the policies decide whether it lands
// (can_edit_pipeline on the job). Posted fields are request data, so every id
// and choice is re-checked. The reply box's two writes are clientTools' draft
// and send on the same client, with source `dashboard`, and always two posts:
// nothing here both writes a draft and sends it. A subject or body never goes
// in the URL or the log. "Add applicant" is lib/client/intake.ts's
// addApplicant, the audited clientTools.addCandidate with source `sourced`,
// as "Add referral" is with source `referral`.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(form: FormData, key: string): string | null {
  const v = form.get(key);
  return typeof v === "string" && UUID.test(v) ? v : null;
}

// Only codes and ids go in the URL, never a name or a message.
const back = (form: FormData, params: { a?: string | null; notice?: ApplicantNotice; error?: ApplicantError }): never => {
  const qs = new URLSearchParams();
  const home = form.get("home") === "1";
  // From the Inbox's pop-up: back to its digest range, where `a` opens that ticket in the pop-up again.
  const inbox = !home && form.has("inbox");
  const range = inbox ? parseRange(form.get("inbox")) : DEFAULT_RANGE;
  if (range !== DEFAULT_RANGE) qs.set("range", String(range));
  if (params.a) qs.set("a", params.a);
  if (params.notice) qs.set("notice", params.notice);
  if (params.error) qs.set("error", params.error);
  // A flag and never a path: the form names no place to go.
  return redirect(hrefAt(home ? homeSubBase("tickets") : inbox ? "/client/inbox" : "/client/applicants", qs));
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
  // The Inbox lists who is newly in too.
  revalidatePath("/client/inbox");
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
    // The template it started from, if any: only an id, recorded on the draft; the words are what the box posted.
    const template = id(form, "templateId");
    outcome = await draftReply(member.db, toolCtx(member), webMailer(), { candidateId, applicationId, subject, body, ...(template ? { template } : {}) });
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

function text(form: FormData, key: string): string | null {
  const v = form.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

const refused = (error: IntakeError): IntakeState => ({ status: "error", error });

/**
 * "Add applicant", from the intake composer: the name, the addresses and the
 * job it understood (and the member corrected), the rest of what they wrote as
 * the note, and a resume. A refusal answers the composer, which keeps what was
 * typed; once added, New Applicants opens on them and says so.
 */
export async function addApplicantAction(_prev: IntakeState, form: FormData): Promise<IntakeState> {
  const member = await requireClient();
  const jobId = form.get("jobId");
  if (typeof jobId !== "string" || !UUID.test(jobId)) return refused("invalid_job");

  const file = await referralFile(form.get("resume"));
  if (file === "invalid") return refused("invalid_file");

  let outcome: IntakeOutcome;
  try {
    outcome = await addApplicant(member.db, toolCtx(member), {
      jobId,
      name: text(form, "name") ?? "",
      email: text(form, "email"),
      linkedinUrl: text(form, "linkedinUrl"),
      note: text(form, "note"),
      file,
    }, webFileStore());
  } catch (err) {
    console.error("[client-applicants] adding an applicant failed:", err instanceof Error ? err.message : err);
    return refused("failed");
  }
  if (!outcome.ok) return refused(outcome.error);

  revalidatePath("/client/applicants");
  revalidatePath("/client");
  revalidatePath("/client/pipeline");
  revalidatePath("/client/candidates");
  revalidatePath(`/client/jobs/${jobId}`);
  return back(form, { a: outcome.applicationId, notice: outcome.status });
}
