"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isRoute, routeApplicant } from "@/lib/client/applicants";
import { requireClient } from "@/lib/client/session";
import type { ApplicantError, ApplicantNotice } from "./messages";

// Applicant Tickets' routing bar: screening, interview, or decline with a
// reason. lib/client/applicants.ts's routeApplicant runs core's moveStage on
// the signed-in member's own client, so the policies decide whether it lands
// (can_edit_pipeline on the job). Posted fields are request data, so every id
// and choice is re-checked.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(form: FormData, key: string): string | null {
  const v = form.get(key);
  return typeof v === "string" && UUID.test(v) ? v : null;
}

// Only codes and ids go in the URL, never a name or a message.
const back = (params: { a?: string | null; notice?: ApplicantNotice; error?: ApplicantError }): never => {
  const qs = new URLSearchParams();
  if (params.a) qs.set("a", params.a);
  if (params.notice) qs.set("notice", params.notice);
  if (params.error) qs.set("error", params.error);
  return redirect(`/client/applicants?${qs}`);
};

export async function routeApplicantAction(form: FormData): Promise<void> {
  const { db, actorId } = await requireClient();
  const applicationId = id(form, "applicationId");
  const route = form.get("route");
  if (!applicationId || !isRoute(route)) return back({ error: "not_found" });

  let outcome: Awaited<ReturnType<typeof routeApplicant>>;
  try {
    outcome = await routeApplicant(db, actorId, { applicationId, route, reasonId: id(form, "reasonId") });
  } catch (err) {
    console.error("[client-applicants] routing failed:", err instanceof Error ? err.message : err);
    return back({ a: applicationId, error: "failed" });
  }
  if (!outcome.ok) return back({ a: applicationId, error: outcome.error });

  revalidatePath("/client/applicants");
  revalidatePath("/client/pipeline");
  // On to the next ticket: the one below it in the list, as the page sent it.
  return back({ a: id(form, "next"), notice: outcome.route });
}
