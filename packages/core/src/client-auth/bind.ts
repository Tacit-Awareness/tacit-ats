import type { Db } from "@tacit/db";

const likeEscape = (s: string) => s.replace(/[\\%_]/g, "\\$&");

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
