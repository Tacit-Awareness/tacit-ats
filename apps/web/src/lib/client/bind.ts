import { bindSupabaseUser, hasPendingInvitation, type BindSupabaseResult, type SupabaseIdentity } from "@tacit-ats/core";
import { getSupabaseServiceClient } from "@tacit/db";

/**
 * The one place the client area reaches past RLS for sign-in, and one of the
 * few files under lib/client or app/client allowed a privileged database
 * client (src/client-area.test.ts). A first sign-in has to: until the invited
 * actor carries the user's subject, their own token resolves no org.
 *
 * Takes the identity Supabase Auth vouched for (its verified user, never
 * anything from the request) and hands back a verdict: binds every pending
 * invitation for that verified email. The service client never leaves.
 */
export async function bindInvitedUser(who: SupabaseIdentity): Promise<BindSupabaseResult> {
  return bindSupabaseUser(getSupabaseServiceClient(), who);
}

/**
 * For someone already signed in to a company: binds an invitation to another
 * one that has arrived since (the admin's invite emails nobody who already has
 * an account; they are told to sign in and pick the company). Asked on every
 * request, so it first makes one cheap read for an unclaimed invitation to the
 * token's address, and only then reads Supabase Auth's own record of the user
 * and binds on its verified address, as apps/mcp's bindSupabaseMember does on
 * every call. True when a company was added.
 */
export async function bindNewInvitations(userId: string, tokenEmail: string | null | undefined): Promise<boolean> {
  const service = getSupabaseServiceClient();
  if (!(await hasPendingInvitation(service, tokenEmail))) return false;
  const { data, error } = await service.auth.admin.getUserById(userId);
  if (error || !data.user) return false;
  const bound = await bindSupabaseUser(service, {
    userId,
    email: data.user.email,
    emailVerified: Boolean(data.user.email_confirmed_at),
  });
  return bound.status === "ok" && bound.firstSignIn;
}
