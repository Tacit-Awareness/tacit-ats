import {
  bindClientActor,
  bindSupabaseUser,
  type BindClientResult,
  type BindSupabaseResult,
  type ClientIdentity,
  type SupabaseIdentity,
} from "@tacit-ats/core";
import { getSupabaseServiceClient } from "@tacit/db";

/**
 * The one place the client area reaches past RLS, and the only file under
 * lib/client or app/client allowed to import a privileged database client
 * (src/client-area.test.ts). A first sign-in has to: until the invited actor
 * carries the user's subject, the user's own token resolves no org.
 *
 * Takes the identity and nothing else, and hands back a verdict and nothing
 * else: the service client never leaves this module. Callers pass only what
 * the identity provider vouched for (WorkOS's sealed session, or Supabase
 * Auth's verified user), never anything from the request.
 */
export async function bindInvitedActor(who: ClientIdentity): Promise<BindClientResult> {
  return bindClientActor(getSupabaseServiceClient(), who);
}

/** The same for a Supabase Auth user: binds every pending invitation for their verified email. */
export async function bindInvitedUser(who: SupabaseIdentity): Promise<BindSupabaseResult> {
  return bindSupabaseUser(getSupabaseServiceClient(), who);
}
