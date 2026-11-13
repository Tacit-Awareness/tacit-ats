import type { BindSupabaseResult } from "@tacit-ats/core";
import { memberTransaction, type MemberTransaction } from "@tacit-ats/member-db";
import { createUserClient, type Db } from "@tacit/db";

// Relative and without ".js": see apps/mcp/CLAUDE.md.
import type { AccessClaims } from "./oauth";

/**
 * Who a verified access token is, as a member of a client org, and the
 * database client that acts as them.
 *
 * The token is a Supabase Auth OAuth token on this project, already checked
 * (client/oauth.ts: signature, issuer, `aud` naming this connector, a
 * `client_id`, `role: authenticated`). It names the member (`sub`) and,
 * through the access token hook, the company picked on the consent page
 * (`org_id` = orgs.id), with a key the database trusts, so it goes to the
 * database as it is: nothing is minted. A first sign-in binds through
 * client/bind.ts (the one privileged module, passed in as `bindSupabase`).
 * The database is then asked who the token is, so the tools and the policies
 * agree by construction, as on the /client portal.
 */

export type AccessLevel = "limited" | "elevated" | "admin";

export type ClientMember = {
  db: Db;
  /**
   * The same member as `db`, as direct Postgres transactions
   * (@tacit-ats/member-db): the database sees the token's own claims, so the
   * same policies decide.
   */
  pg: MemberTransaction;
  actorId: string;
  /** Tacit's id for the org (orgs.id). */
  orgId: string;
  accessLevel: AccessLevel;
  /** The Supabase Auth user the token names. */
  subject: string;
};

export type MemberRefusal = "no_org" | "ambiguous_org" | "email_unverified" | "not_invited" | "subject_mismatch" | "token_rejected";

export type MemberGate = { status: "ok"; member: ClientMember } | { status: "forbidden"; reason: MemberRefusal };

export type MemberDeps = {
  supabaseUrl: string;
  publishableKey: string;
  /** Binds a first sign-in by the address Supabase Auth has verified (client/bind.ts's bindSupabaseMember). */
  bindSupabase: (userId: string) => Promise<BindSupabaseResult>;
};

const isAccessLevel = (v: unknown): v is AccessLevel => v === "limited" || v === "elevated" || v === "admin";

export async function resolveMember(claims: AccessClaims, deps: MemberDeps): Promise<MemberGate> {
  const bound = await deps.bindSupabase(claims.subject);
  if (bound.status !== "ok") return { status: "forbidden", reason: bound.reason };
  // Bound just now: this token predates it and names no company. Signing in again issues one that does.
  if (!claims.orgId) return { status: "forbidden", reason: bound.companies > 1 ? "ambiguous_org" : "no_org" };

  const db = createUserClient(deps.supabaseUrl, deps.publishableKey, () => claims.token);
  const [actor, level, org] = await Promise.all([db.rpc("current_actor_id"), db.rpc("current_access_level"), db.rpc("current_org_id")]);
  if (actor.error || level.error || org.error || !actor.data || !org.data || !isAccessLevel(level.data)) {
    console.error(
      "[client-mcp] the database did not resolve the token to a member:",
      actor.error?.message ?? level.error?.message ?? org.error?.message ?? "no member",
    );
    // Bound and still nobody: they left that company since the token was issued.
    return { status: "forbidden", reason: actor.error || level.error || org.error ? "token_rejected" : "not_invited" };
  }
  return {
    status: "ok",
    member: { db, pg: memberTransaction(claims.dbClaims), actorId: actor.data, orgId: org.data, accessLevel: level.data, subject: claims.subject },
  };
}

/** What a refused member is told. No names or addresses: the reason is all they get. */
export const REFUSAL_TEXT: Record<MemberRefusal, string> = {
  no_org: "This sign-in names no company. Sign in again to choose the company to work in.",
  ambiguous_org: "You belong to more than one company. Sign in again and choose the company you want to work in.",
  email_unverified: "Your email address has not been verified. Verify it, then sign in again.",
  not_invited: "You have not been invited to your company's Tacit workspace. Ask an admin there to invite this address.",
  subject_mismatch: "This email is linked to another sign-in. Ask your admin to re-send the invitation, or contact your Tacit partner.",
  token_rejected: "Tacit could not open your workspace. Contact your Tacit partner.",
};
