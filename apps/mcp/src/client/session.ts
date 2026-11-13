import type { BindClientResult, BindSupabaseResult, ClientIdentity } from "@tacit-ats/core";
import { memberTransaction, type MemberTransaction } from "@tacit-ats/member-db";
import { CLIENT_MEMBER_ISSUER, CLIENT_MEMBER_ROLE, createUserClient, mintClientMemberToken, type Db, type MemberTokenSigner } from "@tacit/db";

// Relative and without ".js": see apps/mcp/CLAUDE.md.
import type { AccessClaims } from "./oauth";
import type { OrganizationLookup } from "./workos";

/**
 * Who a verified access token is, as a member of a client org, and the
 * database client that acts as them.
 *
 * The token has already been checked (signature, issuer, audience, expiry).
 * What is left: which organization it is for (the token's `org_id`, else the
 * user's one membership), the invited actor it binds to (core's
 * bindClientActor, through the one privileged module passed in as `bind`),
 * and a database client whose every request carries a fresh member token for
 * exactly that user and org. The database is then asked who that is, so the
 * tools and the policies agree by construction, as on the /client portal.
 */

export type AccessLevel = "limited" | "elevated" | "admin";

export type ClientMember = {
  db: Db;
  /**
   * The same member as `db`, as direct Postgres transactions
   * (@tacit-ats/member-db): the database sees the claims the member token
   * carries, so the same policies decide.
   */
  pg: MemberTransaction;
  actorId: string;
  /** Tacit's id for the org (orgs.id). */
  orgId: string;
  accessLevel: AccessLevel;
  /** The user the token names: a WorkOS user, or a Supabase Auth user. */
  subject: string;
  /**
   * The organization invitations are sent into: WorkOS's for WorkOS, or with
   * Supabase our own orgs.id (the invitation provider takes it as it is).
   */
  workosOrgId: string;
};

export type MemberRefusal =
  | "no_org"
  | "ambiguous_org"
  | "unknown_org"
  | "email_unverified"
  | "not_invited"
  | "subject_mismatch"
  | "token_rejected";

export type MemberGate = { status: "ok"; member: ClientMember } | { status: "forbidden"; reason: MemberRefusal };

export type MemberDeps = {
  supabaseUrl: string;
  publishableKey: string;
  /** Null only with Supabase, which mints nothing. */
  signer: MemberTokenSigner | null;
  bind: (who: ClientIdentity) => Promise<BindClientResult>;
  /** Null when the connector has no WorkOS API key: the token must then name the org. */
  soleOrganization: ((subject: string) => Promise<OrganizationLookup>) | null;
  /** Null when the connector has no WorkOS API key: the token must then carry the email. */
  verifiedEmail: ((subject: string) => Promise<string | null>) | null;
  /** Supabase Auth sign-ins: binds a first sign-in by the address Supabase Auth has verified (client/bind.ts). */
  bindSupabase?: (userId: string) => Promise<BindSupabaseResult>;
  now?: () => number;
};

const isAccessLevel = (v: unknown): v is AccessLevel => v === "limited" || v === "elevated" || v === "admin";

export async function resolveMember(claims: AccessClaims, deps: MemberDeps): Promise<MemberGate> {
  if (claims.supabase) return resolveSupabaseMember(claims, claims.supabase, deps);
  let workosOrgId = claims.orgId;
  if (!workosOrgId) {
    const lookup = deps.soleOrganization ? await deps.soleOrganization(claims.subject) : { status: "none" as const };
    if (lookup.status === "ambiguous") return { status: "forbidden", reason: "ambiguous_org" };
    if (lookup.status !== "ok") return { status: "forbidden", reason: "no_org" };
    workosOrgId = lookup.organizationId;
  }

  const identity = (email: string | null): ClientIdentity => ({
    workosUserId: claims.subject,
    workosOrgId,
    email,
    emailVerified: email !== null,
  });
  let bound = await deps.bind(identity(claims.email));
  // A first sign-in needs a verified address; ask WorkOS only then.
  if (bound.status === "forbidden" && bound.reason === "email_unverified" && !claims.email && deps.verifiedEmail) {
    const email = await deps.verifiedEmail(claims.subject);
    if (email) bound = await deps.bind(identity(email));
  }
  if (bound.status !== "ok") return { status: "forbidden", reason: bound.reason };

  const now = deps.now ?? Date.now;
  const member = { subject: claims.subject, workosOrgId };
  const signer = deps.signer;
  if (!signer) return { status: "forbidden", reason: "token_rejected" };
  const db = createUserClient(deps.supabaseUrl, deps.publishableKey, () => mintClientMemberToken(signer, member, now()));

  // Ask the database who the token is: the same answer every policy will use.
  const [actor, level] = await Promise.all([db.rpc("current_actor_id"), db.rpc("current_access_level")]);
  if (actor.error || level.error || actor.data !== bound.actorId || !isAccessLevel(level.data)) {
    console.error(
      "[client-mcp] the database did not resolve the member token to the bound actor:",
      actor.error?.message ?? level.error?.message ?? "mismatch",
    );
    return { status: "forbidden", reason: "token_rejected" };
  }
  // The member token's identity claims, as the database reads them from it,
  // for the transactions that skip PostgREST.
  const pg = memberTransaction({ role: CLIENT_MEMBER_ROLE, aud: CLIENT_MEMBER_ROLE, iss: CLIENT_MEMBER_ISSUER, sub: claims.subject, org_id: workosOrgId });
  return {
    status: "ok",
    member: { db, pg, actorId: bound.actorId, orgId: bound.orgId, accessLevel: level.data, subject: claims.subject, workosOrgId },
  };
}

/**
 * A Supabase Auth OAuth token (CLIENT_AUTH_PROVIDER=supabase). It already
 * names the member (`sub`) and, through the access token hook, the company
 * picked on the consent page (`org_id` = orgs.id), with `role: authenticated`
 * and a key the database trusts, so it goes to the database as it is: nothing
 * is minted. A first sign-in binds through client/bind.ts; a token with no
 * company is refused, since the hook pins one per connector session.
 */
async function resolveSupabaseMember(
  claims: AccessClaims,
  issued: NonNullable<AccessClaims["supabase"]>,
  deps: MemberDeps,
): Promise<MemberGate> {
  if (!deps.bindSupabase) return { status: "forbidden", reason: "token_rejected" };
  const bound = await deps.bindSupabase(claims.subject);
  if (bound.status !== "ok") return { status: "forbidden", reason: bound.reason };
  // Bound just now: this token predates it and names no company. Signing in again issues one that does.
  if (!claims.orgId) return { status: "forbidden", reason: bound.companies > 1 ? "ambiguous_org" : "no_org" };

  const db = createUserClient(deps.supabaseUrl, deps.publishableKey, () => issued.token);
  const [actor, level, org] = await Promise.all([db.rpc("current_actor_id"), db.rpc("current_access_level"), db.rpc("current_org_id")]);
  if (actor.error || level.error || org.error || !actor.data || !org.data || !isAccessLevel(level.data)) {
    console.error(
      "[client-mcp] the database did not resolve the Supabase token to a member:",
      actor.error?.message ?? level.error?.message ?? org.error?.message ?? "no member",
    );
    // Bound and still nobody: they left that company since the token was issued.
    return { status: "forbidden", reason: actor.error || level.error || org.error ? "token_rejected" : "not_invited" };
  }
  const pg = memberTransaction(issued.claims);
  return {
    status: "ok",
    member: { db, pg, actorId: actor.data, orgId: org.data, accessLevel: level.data, subject: claims.subject, workosOrgId: org.data },
  };
}

/** What a refused member is told. No names or addresses: the reason is all they get. */
export const REFUSAL_TEXT: Record<MemberRefusal, string> = {
  no_org: "This sign-in is not for a company on Tacit. Sign in again through your company's invitation.",
  ambiguous_org: "You belong to more than one company. Sign in again and choose the company you want to work in.",
  unknown_org: "Your company does not have a Tacit workspace yet. Contact your Tacit partner.",
  email_unverified: "Your email address has not been verified. Verify it, then sign in again.",
  not_invited: "You have not been invited to your company's Tacit workspace. Ask an admin there to invite this address.",
  subject_mismatch: "This email is linked to another sign-in. Sign in the way you did the first time, or ask your admin to re-send the invitation.",
  token_rejected: "Tacit could not open your workspace. Contact your Tacit partner.",
};
