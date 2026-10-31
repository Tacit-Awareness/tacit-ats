"use server";

import { revalidatePath } from "next/cache";
import { clientTools } from "@tacit-ats/core";
import { profileFromForm } from "@/lib/client/interviewer-profile";
import { requireClient } from "@/lib/client/session";
import { toolCtx } from "@/lib/client/tool-ctx";
import type { ProfileAnswer, ProfileError } from "./messages";

// The profile dialog's write. The team's (invitations, access, titles) are on
// Onboarding's People step, in ../onboarding/actions.ts.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
};

const PROFILE_REFUSALS: Partial<Record<clientTools.ClientToolErrorCode, ProfileError>> = {
  forbidden: "forbidden",
  not_found: "member_gone",
  rate_limited: "rate_limited",
};

// clientTools' audited setInterviewerProfile on the member's own client, the
// policies decide: their own at any level, anyone's for an admin. It answers
// the dialog and redirects nowhere, since a refusal has to leave what they
// typed in front of them. A save or a refused stale one both revalidate: the
// page then has the version a second Save needs, and the profile as it stands.
export async function saveProfileAction(form: FormData): Promise<ProfileAnswer> {
  const member = await requireClient();
  const actorId = str(form, "actorId");
  if (!UUID.test(actorId)) return { ok: false, error: "member_gone" };
  try {
    const { outcome } = await clientTools.setInterviewerProfile(member.db, toolCtx(member), {
      memberId: actorId,
      expectedUpdatedAt: str(form, "version") || null,
      profile: profileFromForm(form),
    });
    revalidatePath("/client/interviewers");
    if (outcome === "stale") return { ok: false, error: "stale" };
    return { ok: true, notice: outcome === "changed" ? "profile_saved" : "profile_unchanged" };
  } catch (err) {
    if (err instanceof clientTools.ClientToolError) {
      if (err.code === "invalid") return { ok: false, invalid: err.message, field: err.field };
      const error = PROFILE_REFUSALS[err.code];
      if (error) return { ok: false, error };
    }
    console.error("[client-team] saving an interviewer profile failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "failed" };
  }
}
