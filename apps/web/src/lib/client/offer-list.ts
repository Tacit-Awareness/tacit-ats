import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import type { Offer } from "./offer-rules";
import { readOffers } from "./offers";

// The Offer page's read (design/tacit-tickets's Offers), on the member's OWN
// client: which applications have offers (`offers`, which only whoever may
// manage the job reads), each one's offers through the candidate page's own
// readOffers (core's getOffers, with its approval), who and for which job, and
// which requests wait on this member's own sign-off (core's listMyApprovals).
// lib/client/offer-page-rules.ts groups it.

/** Applications with offers the page reads at most. */
export const OFFER_APPS_MAX = 300;

export type OfferRow = {
  offer: Offer;
  applicationId: string;
  jobId: string;
  candidateId: string;
  name: string;
  jobTitle: string;
  stage: string;
  /** The approval request waiting on this member, when there is one. */
  myRequestId: string | null;
};

export async function readOfferList(db: Db, ctx: clientTools.ClientToolCtx): Promise<{ rows: OfferRow[]; capped: boolean }> {
  if (ctx.accessLevel === "limited") return { rows: [], capped: false };
  const { data: had, error } = await db.from("offers").select("application_id").order("created_at", { ascending: false }).limit(OFFER_APPS_MAX * 3);
  if (error) throw new Error(error.message);
  const ids = [...new Set((had ?? []).map((o) => o.application_id))].slice(0, OFFER_APPS_MAX);
  if (!ids.length) return { rows: [], capped: false };

  const [offers, apps, approvals] = await Promise.all([
    readOffers(db, ctx, ids),
    db.from("applications").select("id, stage, role_id, person_id, people(display_name), roles(title)").in("id", ids),
    clientTools.listMyApprovals(db, ctx).catch((err: unknown) => {
      if (err instanceof clientTools.ClientToolError && err.code === "forbidden") return [];
      throw err;
    }),
  ]);
  if (apps.error) throw new Error(apps.error.message);
  const mine = new Map(approvals.flatMap((a) => (a.kind === "offer" && a.offerId ? [[a.offerId, a.requestId] as const] : [])));
  const app = new Map((apps.data ?? []).map((a) => [a.id, a]));

  const rows = Object.entries(offers).flatMap(([applicationId, list]) => {
    const a = app.get(applicationId);
    if (!a) return [];
    return list.map((offer) => ({
      offer,
      applicationId,
      jobId: a.role_id,
      candidateId: a.person_id,
      name: a.people?.display_name ?? "Unnamed candidate",
      jobTitle: a.roles?.title ?? "",
      stage: a.stage,
      myRequestId: mine.get(offer.offerId) ?? null,
    }));
  });
  return { rows, capped: ids.length >= OFFER_APPS_MAX };
}
