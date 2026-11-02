import type { Db } from "@tacit/db";
import { clientTools } from "@tacit-ats/core";
import type { OfferInput, OfferMoveInput } from "./candidate-edit-rules";
import type { Offer } from "./offer-rules";

// The candidate page's offers on the member's OWN client: clientTools' audited
// getOffers, createOffer, updateOffer and requestApproval, the connector's own,
// with source `dashboard`, so the policies decide again (whoever can manage the
// job). Offer terms never reach a URL or a log, only a code does. The checks
// here say a stale page's answer first: core would take a withdraw of an offer
// someone extended since, and this one was asked of the draft on the page.

export type OfferError = "offer_forbidden" | "offer_gone" | "offer_exists" | "offer_approval" | "offer_changed" | "rate_limited";
export type OfferNotice = "offer_drafted" | "offer_saved" | "offer_extended" | "offer_accepted" | "offer_declined" | "offer_withdrawn" | "offer_asked" | "unchanged";
export type OfferOutcome = { ok: true; notice: OfferNotice } | { ok: false; error: OfferError };

/**
 * The offers of each application the member may handle offers on, newest first.
 * An application they may not is left out, which is how the page knows to draw
 * nothing: an interviewer is not asked, and neither getOffers' refusal counts
 * as a failure. Any other failure throws, as a read that came back empty would
 * offer a second draft.
 */
export async function readOffers(db: Db, ctx: clientTools.ClientToolCtx, applicationIds: string[]): Promise<Record<string, Offer[]>> {
  if (ctx.accessLevel === "limited") return {};
  const reads = await Promise.all(
    applicationIds.map(async (applicationId) => {
      try {
        return [applicationId, await clientTools.getOffers(db, ctx, { applicationId })] as const;
      } catch (err) {
        if (err instanceof clientTools.ClientToolError && (err.code === "forbidden" || err.code === "not_found")) return null;
        throw err;
      }
    }),
  );
  return Object.fromEntries(reads.filter((r) => r !== null));
}

/** A refusal as this page's code. `invalid` is the page being out of date once the form's fields were read back. */
function refused(err: unknown): { ok: false; error: OfferError } {
  if (!(err instanceof clientTools.ClientToolError)) throw err;
  switch (err.code) {
    case "forbidden":
      return { ok: false, error: "offer_forbidden" };
    case "not_found":
      return { ok: false, error: "offer_gone" };
    case "rate_limited":
      return { ok: false, error: "rate_limited" };
    default:
      if (/approv/i.test(err.message)) return { ok: false, error: "offer_approval" };
      return { ok: false, error: /open offer/.test(err.message) ? "offer_exists" : "offer_changed" };
  }
}

async function offerStatus(db: Db, offerId: string): Promise<string | null> {
  const { data, error } = await db.from("offers").select("status").eq("id", offerId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.status ?? null;
}

/** Drafts an offer, or changes the terms of the draft the page showed. Moves no stage and sends nothing. */
export async function saveOffer(db: Db, ctx: clientTools.ClientToolCtx, input: OfferInput): Promise<OfferOutcome> {
  try {
    if (!input.offerId) {
      const { data: app, error } = await db.from("applications").select("stage").eq("id", input.applicationId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!app) return { ok: false, error: "offer_gone" };
      if (["hired", "rejected", "withdrawn"].includes(app.stage)) return { ok: false, error: "offer_changed" };
      await clientTools.createOffer(db, ctx, { applicationId: input.applicationId, ...input.terms });
      return { ok: true, notice: "offer_drafted" };
    }
    const status = await offerStatus(db, input.offerId);
    if (!status) return { ok: false, error: "offer_gone" };
    if (status !== "draft") return { ok: false, error: "offer_changed" };
    const r = await clientTools.updateOffer(db, ctx, { offerId: input.offerId, ...input.terms });
    if (r.outcome === "changed_since") return { ok: false, error: "offer_changed" };
    return { ok: true, notice: r.outcome === "updated" ? "offer_saved" : "unchanged" };
  } catch (err) {
    return refused(err);
  }
}

const MOVED = { extended: "offer_extended", accepted: "offer_accepted", declined: "offer_declined", withdrawn: "offer_withdrawn" } as const;

/** Moves the offer on from the status the page showed. Records what happened, and changes neither the stage nor anything the candidate sees. */
export async function moveOffer(db: Db, ctx: clientTools.ClientToolCtx, input: OfferMoveInput): Promise<OfferOutcome> {
  try {
    const status = await offerStatus(db, input.offerId);
    if (!status) return { ok: false, error: "offer_gone" };
    if (status !== input.from) return { ok: false, error: "offer_changed" };
    const r = await clientTools.updateOffer(db, ctx, { offerId: input.offerId, status: input.status });
    return r.outcome === "updated" ? { ok: true, notice: MOVED[input.status] } : { ok: false, error: "offer_changed" };
  } catch (err) {
    return refused(err);
  }
}

/** Sends a draft to the job's approvers, who get it in their Inbox. */
export async function askOfferApproval(db: Db, ctx: clientTools.ClientToolCtx, offerId: string): Promise<OfferOutcome> {
  try {
    const r = await clientTools.requestApproval(db, ctx, { offerId });
    return { ok: true, notice: r.outcome === "requested" ? "offer_asked" : "unchanged" };
  } catch (err) {
    return refused(err);
  }
}
