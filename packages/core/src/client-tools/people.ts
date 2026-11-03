import type { Db, TablesInsert } from "@tacit/db";

import { findPersonByIdentifier } from "@tacit/core";
import { ClientToolError, type ClientToolCtx } from "./context.js";

/**
 * Find-or-create a person by email, for every client path that adds someone
 * (add_candidate, add_prospect, the web's referrals over add_candidate).
 *
 * people.email is not unique, so two adds of one new address at the same
 * moment each miss the lookup and each insert (the stress test made 4 people
 * from a burst of 8). The people trigger indexes a row's email in
 * person_identifiers with `on conflict do nothing`, so only the first row gets
 * the identifier and the rest are invisible to later email dedupe. This module
 * does what a member's own token can about that:
 *
 *   - one normalisation of the address (trim + lowercase), the same one
 *     @tacit/core's normalizeIdentifier and the database's trigger use;
 *   - the lookup checks the identifier, then the people row itself, so a row
 *     that lost the identifier race is still found;
 *   - after an insert, the email identifier is claimed for the new row
 *     (client_add_contact; a no-op when the trigger already wrote it). If
 *     another person owns it, this add lost a race: the owner is reused and
 *     the row just made is removed when the member may (admins);
 *   - a unique violation (23505) on the insert, which a unique index on the
 *     org's normalised email will raise once it lands in tacit-internal
 *     (docs/migrations-needed/unique-candidate-email.md), re-reads and reuses
 *     the person who won.
 *
 * Only a lock or a constraint in the database closes the race completely;
 * the doc above has the SQL.
 */

/** Postgres's unique_violation. */
export const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}

/**
 * An email as it is stored and matched: trimmed (any whitespace, as JS's
 * trim) and lowercased; nothing left is null. Validation is not done here
 * (parseCandidateIdentity does it); this is only the key.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = raw?.trim().toLowerCase();
  return v ? v : null;
}

/** An ilike pattern that matches `value` exactly, ignoring case: % _ and \ escaped. */
function exactILike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The person the member can see under this email in their org: the one that
 * owns the email identifier, else the oldest whose own email column matches
 * (a row that lost the identifier race, or an address on file in another case).
 */
export async function findPersonByEmail(db: Db, orgId: string, email: string): Promise<string | null> {
  const key = normalizeEmail(email);
  if (!key) return null;
  const owner = await findPersonByIdentifier(db, "email", key, orgId);
  if (owner) return owner;
  const { data, error } = await db
    .from("people")
    .select("id")
    .eq("org_id", orgId)
    .ilike("email", exactILike(key))
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  return (data as Array<{ id: string }> | null)?.[0]?.id ?? null;
}

export type FoundOrAdded = { personId: string; created: boolean };

/**
 * The person under `email` (as findPersonByEmail), else a new people row with
 * `input`. Without an email there is nothing to match on and a row is always
 * made. The id is made here and nothing is read back: on a member's token a
 * RETURNING row must pass the people read policy, whose helpers cannot see a
 * row inserted by the same statement.
 */
export async function findOrAddPerson(
  db: Db,
  ctx: Pick<ClientToolCtx, "orgId" | "actorId">,
  input: {
    name: string; email: string | null; linkedinUrl: string | null; extra?: Partial<TablesInsert<"people">>;
    /** The caller has just looked the email up itself and found no one. */
    lookedUp?: boolean;
  },
): Promise<FoundOrAdded> {
  const email = normalizeEmail(input.email);
  if (email && !input.lookedUp) {
    const existing = await findPersonByEmail(db, ctx.orgId, email);
    if (existing) return { personId: existing, created: false };
  }

  const id = globalThis.crypto.randomUUID();
  const { error } = await db.from("people").insert({
    // Named, not left to the tenant trigger: the policy refuses any org but the member's own.
    id,
    org_id: ctx.orgId,
    display_name: input.name,
    email,
    linkedin_url: input.linkedinUrl,
    // Lets an elevated member edit (and claim the email for) someone they just added who is in no job yet.
    added_by_actor_id: ctx.actorId,
    ...input.extra,
  });
  if (error) {
    if (!email || !isUniqueViolation(error)) throw new Error(error.message);
    // Someone else added this address first and the database said so.
    const winner = await findPersonByEmail(db, ctx.orgId, email);
    if (winner) return { personId: winner, created: false };
    throw new ClientToolError(
      "invalid",
      "Someone with that email is already in your company's records, somewhere you can't see. Ask an admin at your company to add them.",
      "email",
    );
  }
  if (!email) return { personId: id, created: true };

  const owner = await claimEmail(db, ctx.orgId, id, email);
  if (owner === id) return { personId: id, created: true };
  // Lost the race: another add of this address landed first. Use theirs, and
  // take ours back where the member may (only admins delete people); left
  // behind, it has no application yet and merge_candidates folds it in.
  const { error: deleteError } = await db.from("people").delete().eq("id", id);
  if (deleteError) console.error(`[client-tools] could not remove duplicate person ${id}:`, deleteError.message);
  return { personId: owner, created: false };
}

/**
 * Makes sure `email` is indexed in person_identifiers, and says who owns it:
 * `personId` itself, or the person who got there first. The people trigger
 * writes the identifier on insert unless another row already holds it;
 * client_add_contact (a definer: the member token has no insert on the table)
 * writes it when the trigger did not and is a null when it is on file. A
 * refusal to write it (an elevated member's add they cannot edit) or an owner
 * the member cannot see leaves the new row as the answer, as before.
 */
async function claimEmail(db: Db, orgId: string, personId: string, email: string): Promise<string> {
  const { data, error } = await db.rpc("client_add_contact", { p_person: personId, p_kind: "email", p_value: email });
  if (error) {
    console.error(`[client-tools] could not index the email of person ${personId}:`, error.message);
    return personId;
  }
  if (data !== null) return personId;
  const owner = await findPersonByIdentifier(db, "email", email, orgId);
  return owner ?? personId;
}
