"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { webFileStore } from "@/lib/client/file-store";
import { addReferral, referralFile, type AddReferralOutcome } from "@/lib/client/referrals";
import { requireClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import type { ReferralError, ReferralState } from "./messages";

// "Add referral": lib/client/referrals.ts's addReferral runs the audited
// clientTools.addCandidate on the signed-in member's own client, with source
// `referral` and the referrer in `source_detail`, which checks can_add_people()
// and can_edit_pipeline on the job first; the policies decide again on the
// inserts. Posted fields are request data, so the job id is re-checked.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(form: FormData, key: string): string | null {
  const v = form.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

// A refusal answers the form, which keeps what was typed; once added, the list
// says so. Only codes go in the URL, never a name, an address or a message.
const refused = (error: ReferralError): ReferralState => ({ status: "error", error });

export async function addReferralAction(_prev: ReferralState, form: FormData): Promise<ReferralState> {
  const member = await requireClient();
  const jobId = form.get("jobId");
  if (typeof jobId !== "string" || !UUID.test(jobId)) return refused("invalid_job");

  const file = await referralFile(form.get("resume"));
  if (file === "invalid") return refused("invalid_file");

  let outcome: AddReferralOutcome;
  try {
    outcome = await addReferral(member.db, toolCtx(member), {
      jobId,
      name: text(form, "name") ?? "",
      email: text(form, "email"),
      linkedinUrl: text(form, "linkedinUrl"),
      referredBy: form.get("referredBy"),
      note: text(form, "note"),
      file,
    }, webFileStore());
  } catch (err) {
    console.error("[client-referrals] adding a referral failed:", err instanceof Error ? err.message : err);
    return refused("failed");
  }
  if (!outcome.ok) return refused(outcome.error);

  revalidatePath("/client/referrals");
  revalidatePath("/client/applicants");
  revalidatePath("/client/pipeline");
  revalidatePath(`/client/jobs/${jobId}`);
  redirect(`/client/referrals?notice=${outcome.status}`);
}
