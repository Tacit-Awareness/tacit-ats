import type postgres from "postgres";
import { memberPool } from "./connection.js";

/**
 * A member's database identity: the claims of their access token, already
 * verified by the caller (signature, issuer, audience, expiry), passed through
 * unchanged. The database reads them exactly as it reads a token PostgREST
 * verified: `auth.jwt()`, so `current_actor_id()` (`sub` and `org_id` today),
 * `current_org_id()`, `current_access_level()` and every policy behave as they
 * do over HTTP.
 *
 * Only `role` is fixed: always `authenticated`, the one role a member acts as.
 * `sub` is who. `org_id` is which company (WorkOS's organization today; with
 * Supabase Auth, the one its access-token hook adds). Anything else on the
 * token rides along for the policies that want it.
 */
export type MemberClaims = {
  readonly role: "authenticated";
  readonly sub: string;
  readonly org_id?: string;
  readonly [claim: string]: unknown;
};

/**
 * The transaction, as the member. postgres.js's tagged template: values are
 * always parameters, never spliced into the text.
 *
 * Never `reset role`, `set role` or `set_config('request.jwt.claims', ...)` in
 * here: withMember checks the role and the claims are still the member's
 * before it commits, and rolls the whole transaction back if not.
 */
export type MemberSql = postgres.TransactionSql;

/** A member's transactions, with their claims already bound (what a request context carries). */
export type MemberTransaction = <T>(fn: (sql: MemberSql) => Promise<T>) => Promise<T>;

/** authenticated's own statement_timeout, which `set role` does not apply (role settings apply at login). */
const STATEMENT_TIMEOUT = "8s";

export class MemberClaimsError extends Error {
  constructor(message: string) {
    super(`withMember: ${message}`);
    this.name = "MemberClaimsError";
  }
}

/** The claims as the JSON the database will read, or a refusal before any connection is made. */
export function memberClaimsJson(claims: MemberClaims): string {
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) throw new MemberClaimsError("claims must be an object");
  if (claims.role !== "authenticated") throw new MemberClaimsError("a member acts only as role `authenticated`");
  if (typeof claims.sub !== "string" || !claims.sub.trim()) throw new MemberClaimsError("claims need the member's `sub`");
  if (claims.org_id !== undefined && (typeof claims.org_id !== "string" || !claims.org_id.trim())) {
    throw new MemberClaimsError("`org_id`, when given, must be a non-empty string");
  }
  return JSON.stringify(claims);
}

/**
 * One transaction on the transaction pooler, as one member, with RLS deciding
 * everything it reads and writes:
 *
 *   begin;
 *   set local role authenticated;                 -- set_config('role', ..., true)
 *   set_config('request.jwt.claims', <claims>, true);
 *   set local statement_timeout = '8s';
 *   ...fn's statements...
 *   -- still authenticated, still these claims?
 *   commit;                                       -- or rollback, if fn throws
 *
 * The three settings go in one statement, as PostgREST sets them, so a
 * request costs one round trip more than its own SQL (and one for the check).
 * `local` means they end with the transaction: the pooler's server connection
 * goes back to the next transaction as it came. Anything fn throws rolls back
 * everything fn wrote, across every table.
 */
export async function withMember<T>(claims: MemberClaims, fn: (sql: MemberSql) => Promise<T>): Promise<T> {
  const json = memberClaimsJson(claims);
  const result = await memberPool().begin(async (sql) => {
    await sql`select
      set_config('role', 'authenticated', true),
      set_config('request.jwt.claims', ${json}, true),
      set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true)`;
    const value = await fn(sql);
    const [still] = await sql<{ role: string; claims: string | null }[]>`
      select current_user::text as role, current_setting('request.jwt.claims', true) as claims`;
    if (still?.role !== "authenticated" || still.claims !== json) {
      throw new Error("withMember: the transaction stopped acting as the member; rolled back");
    }
    return { value };
  });
  return (result as { value: T }).value;
}

/** Binds a member's claims once, for a request context to carry. */
export function memberTransaction(claims: MemberClaims): MemberTransaction {
  memberClaimsJson(claims);
  return (fn) => withMember(claims, fn);
}
