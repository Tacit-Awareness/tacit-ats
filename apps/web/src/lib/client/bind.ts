import { bindSupabaseUser, type BindSupabaseResult, type SupabaseIdentity } from "@tacit-ats/core";
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
