import type { Db, TablesInsert, TablesUpdate } from "@tacit/db";

import { parseDueDate } from "../pipeline/pipeline.js";
import { memberNames, offerApprovals, type OfferApproval } from "./approvals.js";
import { withAudit } from "./audit.js";
import { ClientToolError, type ClientToolCtx } from "./context.js";

/**
 * Offers and rejection reasons for the client connector
 * (20261014230000_offers_rejection_reasons). Same rules as the rest of
 * client-tools: the member's own client, and the policies decide. An offer is
 * read and written by whoever can manage its job; the database refuses a
 * second open offer, a transition out of order, a closed offer changing and
 * an extended offer's terms changing, and the checks here only say so first,
 * in a sentence. Nothing here moves an application's stage.
 */

export const OFFER_STATUSES = ["draft", "extended", "accepted", "declined", "withdrawn"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];
export const REJECTION_KINDS = ["rejected", "withdrew"] as const;
export type RejectionKind = (typeof REJECTION_KINDS)[number];

const CLOSED: readonly OfferStatus[] = ["accepted", "declined", "withdrawn"];
const NEXT: Record<OfferStatus, readonly OfferStatus[]> = {
  draft: ["extended", "withdrawn"],
  extended: ["accepted", "declined", "withdrawn"],
  accepted: [],
  declined: [],
  withdrawn: [],
};
const SALARY_MAX = 100_000_000;
const TERM_MAX = 500;
const OFFER_NOTES_MAX = 5000;

// ---------------------------------------------------------------------------
// Rejection reasons
// ---------------------------------------------------------------------------

export type RejectionReason = { reasonId: string; kind: RejectionKind; name: string };

export async function listRejectionReasons(db: Db, ctx: ClientToolCtx): Promise<RejectionReason[]> {
  if (ctx.accessLevel === "limited") {
    throw new ClientToolError("forbidden", "Interviewers do not close applications, so they have no rejection reasons.");
  }
  const { data, error } = await db
    .from("rejection_reasons")
    .select("id, kind, name")
    .is("archived_at", null)
    .order("kind")
    .order("position")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ reasonId: r.id, kind: r.kind as RejectionKind, name: r.name }));
}

/** The reason, if the member can see it and it fits the stage the application is closing at. */
export async function reasonForStage(db: Db, reasonId: string, stage: "rejected" | "withdrawn"): Promise<RejectionReason> {
  const { data, error } = await db
    .from("rejection_reasons").select("id, kind, name, archived_at").eq("id", reasonId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.archived_at) {
    throw new ClientToolError("not_found", "No rejection reason with that id. list_rejection_reasons has them.");
  }
  const want: RejectionKind = stage === "rejected" ? "rejected" : "withdrew";
  if (data.kind !== want) {
    throw new ClientToolError(
      "invalid",
      stage === "rejected"
        ? "That reason is for a candidate who withdrew. Use one of the rejected reasons, or move them to withdrawn."
        : "That reason is for a candidate the company rejected. Use one of the withdrew reasons, or move them to rejected.",
    );
  }
  return { reasonId: data.id, kind: want, name: data.name };
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

export type Offer = {
  offerId: string;
  applicationId: string;
  status: OfferStatus;
  salary: number | null;
  currency: string;
  bonus: string | null;
  equity: string | null;
  startDate: string | null;
  expiresOn: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  extendedAt: string | null;
  resolvedAt: string | null;
  /**
   * Its approval (20261016110000_client_approvals): null when the job has no
   * offer approval flow and the offer was never sent for approval.
   */
  approval: OfferApproval | null;
};

const OFFER_COLUMNS =
  "id, application_id, status, salary, currency, bonus, equity, start_date, expires_on, notes, created_by_actor_id, created_at, extended_at, resolved_at";

type OfferRow = {
  id: string; application_id: string; status: string; salary: number | null; currency: string; bonus: string | null;
  equity: string | null; start_date: string | null; expires_on: string | null; notes: string | null;
  created_by_actor_id: string | null; created_at: string; extended_at: string | null; resolved_at: string | null;
};

const toOffer = (r: OfferRow, names: Map<string, string | null>): Omit<Offer, "approval"> => ({
  offerId: r.id,
  applicationId: r.application_id,
  status: r.status as OfferStatus,
  salary: r.salary,
  currency: r.currency,
  bonus: r.bonus,
  equity: r.equity,
  startDate: r.start_date,
  expiresOn: r.expires_on,
  notes: r.notes,
  createdBy: r.created_by_actor_id ? (names.get(r.created_by_actor_id) ?? null) : null,
  createdAt: r.created_at,
  extendedAt: r.extended_at,
  resolvedAt: r.resolved_at,
});

/** The application, if the member can read it and may handle offers on its job. */
async function offerApplication(db: Db, ctx: ClientToolCtx, applicationId: string): Promise<{ id: string; role_id: string }> {
  if (ctx.accessLevel === "limited") {
    throw new ClientToolError("forbidden", "Offers are for the people who manage the job, not interviewers.");
  }
  const { data, error } = await db.from("applications").select("id, role_id").eq("id", applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ClientToolError("not_found", "No application with that id that you can see. get_pipeline and get_candidate list them.");
  const { data: allowed, error: permError } = await db.rpc("can_on_role", { p_role: data.role_id, perm: "can_manage_job" });
  if (permError) throw new Error(permError.message);
  if (allowed !== true) {
    throw new ClientToolError("forbidden", "Only the people who manage this job (an admin, its hiring manager or recruiter) handle its offers.");
  }
  return data;
}

export async function getOffers(db: Db, ctx: ClientToolCtx, input: { applicationId: string }): Promise<Offer[]> {
  const app = await offerApplication(db, ctx, input.applicationId);
  const { data, error } = await db
    .from("offers").select(OFFER_COLUMNS).eq("application_id", app.id).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as OfferRow[];
  const approvals = rows.length ? await offerApprovals(db, app.role_id, rows.map((r) => r.id)) : null;
  const names = await memberNames(db, [...rows.map((r) => r.created_by_actor_id), ...(approvals?.actorIds ?? [])]);
  return rows.map((r) => ({ ...toOffer(r, names), approval: approvals?.forOffer(r.id, names) ?? null }));
}

export type OfferTerms = {
  salary?: number | null;
  currency?: string;
  bonus?: string | null;
  equity?: string | null;
  startDate?: string | null;
  expiresOn?: string | null;
  notes?: string | null;
};

/** Checked terms in the table's shape; only what was passed. */
function termColumns(terms: OfferTerms): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (terms.salary !== undefined) {
    if (terms.salary !== null && (!Number.isInteger(terms.salary) || terms.salary < 0 || terms.salary > SALARY_MAX)) {
      throw new ClientToolError("invalid", "A salary is a whole number a year, in the offer's currency.");
    }
    out.salary = terms.salary;
  }
  if (terms.currency !== undefined) {
    const c = terms.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) throw new ClientToolError("invalid", "A currency is a three-letter code, like USD or EUR.");
    out.currency = c;
  }
  for (const [key, column, max, label] of [
    ["bonus", "bonus", TERM_MAX, "A bonus"],
    ["equity", "equity", TERM_MAX, "Equity"],
    ["notes", "notes", OFFER_NOTES_MAX, "Notes"],
  ] as const) {
    const value = terms[key];
    if (value === undefined) continue;
    const v = value?.trim() || null;
    if (v && v.length > max) throw new ClientToolError("invalid", `${label} is at most ${max} characters.`);
    out[column] = v;
  }
  for (const [key, column, label] of [["startDate", "start_date", "A start date"], ["expiresOn", "expires_on", "An expiry date"]] as const) {
    const value = terms[key];
    if (value === undefined) continue;
    if (value === null || value === "") {
      out[column] = null;
      continue;
    }
    const d = parseDueDate(value);
    if (!d) throw new ClientToolError("invalid", `${label} must be YYYY-MM-DD.`);
    out[column] = d;
  }
  return out;
}

const withoutNotes = (columns: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(columns).filter(([k]) => k !== "notes"));

/** The database's own refusals (22023 from the offer trigger, 23505 for a second open offer) as sentences. */
function offerWriteError(error: { code?: string; message: string }): Error {
  if (error.code === "23505") {
    return new ClientToolError("invalid", "This application already has an open offer. Change it with update_offer, or withdraw it first.");
  }
  if (error.code === "22023" && /approv/.test(error.message)) {
    // The offer approval gate (20261016110000_client_approvals).
    return new ClientToolError(
      "invalid",
      `Not saved: ${error.message}. request_approval with the offer_id asks for it; get_offers shows where it stands.`,
    );
  }
  if (error.code === "22023") return new ClientToolError("invalid", `Not saved: ${error.message}.`);
  return new Error(error.message);
}

export async function createOffer(
  db: Db,
  ctx: ClientToolCtx,
  input: { applicationId: string } & OfferTerms,
): Promise<{ offerId: string }> {
  const columns = termColumns(input);
  const app = await offerApplication(db, ctx, input.applicationId);
  const { data: open, error } = await db
    .from("offers").select("id, status").eq("application_id", app.id).in("status", ["draft", "extended"]).maybeSingle();
  if (error) throw new Error(error.message);
  if (open) {
    throw new ClientToolError(
      "invalid",
      `This application already has an open offer (${open.id}, ${open.status}). Change it with update_offer, or withdraw it first.`,
    );
  }
  return withAudit(db, ctx, { action: "offer.create", entity: "offer" }, async () => {
    const offerId = globalThis.crypto.randomUUID();
    const row = { id: offerId, application_id: app.id, ...columns } as TablesInsert<"offers">;
    const { error: insertError } = await db.from("offers").insert(row);
    if (insertError) throw offerWriteError(insertError);
    // The notes stay out of the audit row, as feedback's do; the terms are the record.
    return { result: { offerId }, entityId: offerId, after: { application_id: app.id, status: "draft", ...withoutNotes(columns) }, changed: true };
  });
}

export async function updateOffer(
  db: Db,
  ctx: ClientToolCtx,
  input: { offerId: string; status?: OfferStatus } & OfferTerms,
): Promise<{ outcome: "updated" | "unchanged" | "changed_since"; status: OfferStatus; changed: string[] }> {
  if (input.status !== undefined && !OFFER_STATUSES.includes(input.status)) {
    throw new ClientToolError("invalid", `An offer's status is one of ${OFFER_STATUSES.join(", ")}.`);
  }
  const columns = termColumns(input);
  if (ctx.accessLevel === "limited") {
    throw new ClientToolError("forbidden", "Offers are for the people who manage the job, not interviewers.");
  }
  const { data, error } = await db.from("offers").select(OFFER_COLUMNS).eq("id", input.offerId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ClientToolError("not_found", "No offer with that id that you can see. get_offers lists them.");
  const current = data as OfferRow;
  const status = current.status as OfferStatus;

  const next: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(columns)) {
    if (value !== (current as Record<string, unknown>)[column]) next[column] = value;
  }
  if (input.status !== undefined && input.status !== status) next.status = input.status;
  const changed = Object.keys(next);
  if (!changed.length) return { outcome: "unchanged", status, changed: [] };

  if (CLOSED.includes(status)) {
    throw new ClientToolError("invalid", `That offer was ${status} and is closed. Draft a new one with create_offer.`);
  }
  if (next.status !== undefined && !NEXT[status].includes(next.status as OfferStatus)) {
    throw new ClientToolError("invalid", `An offer that is ${status} can only become ${NEXT[status].join(" or ")}.`);
  }
  const terms = changed.filter((c) => c !== "status" && c !== "notes");
  if (status !== "draft" && terms.length) {
    throw new ClientToolError(
      "invalid",
      "An extended offer's terms do not change, so what was extended stays on record. Withdraw it and draft a new one.",
    );
  }

  const before = Object.fromEntries(changed.filter((c) => c !== "notes").map((k) => [k, (current as Record<string, unknown>)[k]]));
  return withAudit(db, ctx, { action: "offer.update", entity: "offer" }, async () => {
    // Conditional on the status read, so two people closing the same offer record one outcome.
    const { data: updated, error: updateError } = await db
      .from("offers").update(next as TablesUpdate<"offers">).eq("id", current.id).eq("status", status).select("id");
    if (updateError) throw offerWriteError(updateError);
    const ok = !!updated?.length;
    return {
      result: ok
        ? { outcome: "updated" as const, status: (next.status as OfferStatus | undefined) ?? status, changed }
        : { outcome: "changed_since" as const, status, changed: [] },
      entityId: current.id,
      before,
      after: withoutNotes(next),
      changed: ok,
    };
  });
}
