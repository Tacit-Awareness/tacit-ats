import type { Db } from "@tacit/db";

/**
 * First sign-in for a member of a client org: ties a WorkOS user to the actor
 * an admin invited (docs/superpowers/specs/2026-10-13-ats-parity-design.md, 1c).
 *
 * Invite-first. Nothing here creates an actor: someone who can sign in but was
 * never invited is refused. The org comes from the WorkOS organization in the
 * verified token and nowhere else, and only a `client` org answers: Tacit's own
 * teammates sign in another way and must not gain a row here by this route.
 *
 * `db` is a service-role client. A user's own token cannot do this: until the
 * actor carries their subject, RLS resolves no org for them at all. That makes
 * this one of the few places a client request reaches past RLS, so every input
 * must come from the identity provider, never from the request.
 */
export type ClientIdentity = {
  /** The WorkOS user id: the token's `sub`. */
  workosUserId: string;
  /** The WorkOS organization the session is for: the token's `org_id`. */
  workosOrgId: string | null | undefined;
  email: string | null | undefined;
  /** Whether WorkOS reports the address as verified. */
  emailVerified: boolean;
};

export type BindClientResult =
  | { status: "ok"; actorId: string; orgId: string; firstSignIn: boolean }
  | {
      status: "forbidden";
      reason: "no_org" | "unknown_org" | "email_unverified" | "not_invited" | "subject_mismatch";
    };

const likeEscape = (s: string) => s.replace(/[\\%_]/g, "\\$&");

export async function bindClientActor(db: Db, who: ClientIdentity): Promise<BindClientResult> {
  if (!who.workosUserId) return { status: "forbidden", reason: "not_invited" };
  if (!who.workosOrgId) return { status: "forbidden", reason: "no_org" };

  const { data: org, error: orgError } = await db
    .from("orgs").select("id").eq("workos_org_id", who.workosOrgId).eq("kind", "client").maybeSingle();
  if (orgError) throw new Error(orgError.message);
  if (!org) return { status: "forbidden", reason: "unknown_org" };

  // Seen before: the subject is already on an actor in this org. An archived
  // actor is refused the same way as someone never invited.
  const { data: bound, error: boundError } = await db
    .from("actors").select("id, archived_at").eq("org_id", org.id).eq("auth_subject", who.workosUserId).maybeSingle();
  if (boundError) throw new Error(boundError.message);
  if (bound) {
    if (bound.archived_at) return { status: "forbidden", reason: "not_invited" };
    return { status: "ok", actorId: bound.id, orgId: org.id, firstSignIn: false };
  }

  // An unverified address proves nothing about who is signing in, and the
  // match below is on the address alone.
  const email = who.email?.trim().toLowerCase();
  if (!email || !who.emailVerified) return { status: "forbidden", reason: "email_unverified" };

  const { data: invited, error: invitedError } = await db
    .from("actors").select("id, auth_subject")
    .eq("org_id", org.id).ilike("email", likeEscape(email)).is("archived_at", null).maybeSingle();
  if (invitedError) throw new Error(invitedError.message);
  if (!invited) return { status: "forbidden", reason: "not_invited" };
  if (invited.auth_subject && invited.auth_subject !== who.workosUserId) {
    return { status: "forbidden", reason: "subject_mismatch" };
  }

  // Conditional on still being unbound, so two first requests racing with
  // different subjects cannot both win.
  const { data: claimed, error: bindError } = await db
    .from("actors").update({ auth_subject: who.workosUserId })
    .eq("id", invited.id).eq("org_id", org.id).is("auth_subject", null).select("id");
  if (bindError) throw new Error(bindError.message);
  if (!claimed?.length) {
    const { data: now, error: rereadError } = await db
      .from("actors").select("auth_subject").eq("id", invited.id).maybeSingle();
    if (rereadError) throw new Error(rereadError.message);
    if (now?.auth_subject !== who.workosUserId) return { status: "forbidden", reason: "subject_mismatch" };
  }
  return { status: "ok", actorId: invited.id, orgId: org.id, firstSignIn: true };
}

/**
 * First sign-in through Supabase Auth on the client project (the move off
 * WorkOS). A Supabase token carries no company until the access token hook
 * finds an actor for it, so this binds by verified email alone: every pending
 * invitation (an unbound, unarchived actor in a `client` org) whose address
 * matches takes the user's id as its subject. Invite-first as above: nothing
 * is created, and someone invited nowhere is refused.
 *
 * An actor already bound to another subject (a WorkOS user, before the
 * cutover's rebind) is left alone: the connector still signs that member in
 * through WorkOS until the cutover, and rebinding here would lock it out.
 *
 * `db` is a service-role client; every input comes from Supabase Auth's
 * verified user, never the request.
 */
export type SupabaseIdentity = {
  /** The Supabase Auth user id: the token's `sub`. */
  userId: string;
  email: string | null | undefined;
  /** Supabase Auth's `email_confirmed_at` is set. */
  emailVerified: boolean;
};

export type BindSupabaseResult =
  | { status: "ok"; companies: number; firstSignIn: boolean }
  | { status: "forbidden"; reason: "email_unverified" | "not_invited" | "subject_mismatch" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function bindSupabaseUser(db: Db, who: SupabaseIdentity): Promise<BindSupabaseResult> {
  if (!UUID.test(who.userId)) return { status: "forbidden", reason: "not_invited" };

  const { data: bound, error: boundError } = await db
    .from("actors").select("id, orgs!actors_org_id_fkey!inner(kind)")
    .eq("auth_subject", who.userId).is("archived_at", null).eq("orgs.kind", "client");
  if (boundError) throw new Error(boundError.message);

  const email = who.email?.trim().toLowerCase();
  if (!email || !who.emailVerified) {
    return bound?.length
      ? { status: "ok", companies: bound.length, firstSignIn: false }
      : { status: "forbidden", reason: "email_unverified" };
  }

  const { data: invited, error: invitedError } = await db
    .from("actors").select("id, auth_subject, orgs!actors_org_id_fkey!inner(kind)")
    .ilike("email", likeEscape(email)).is("archived_at", null).eq("orgs.kind", "client");
  if (invitedError) throw new Error(invitedError.message);

  let claimed = 0;
  for (const actor of invited ?? []) {
    if (actor.auth_subject) continue;
    // Conditional on still being unbound, so a race with another subject cannot both win.
    const { data, error } = await db
      .from("actors").update({ auth_subject: who.userId })
      .eq("id", actor.id).is("auth_subject", null).select("id");
    if (error) throw new Error(error.message);
    claimed += data?.length ?? 0;
  }

  const companies = (bound?.length ?? 0) + claimed;
  if (companies > 0) return { status: "ok", companies, firstSignIn: claimed > 0 };
  const elsewhere = (invited ?? []).some((a) => a.auth_subject && a.auth_subject !== who.userId);
  return { status: "forbidden", reason: elsewhere ? "subject_mismatch" : "not_invited" };
}
