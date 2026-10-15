import { bindClientActor, type BindClientResult, type ClientIdentity } from "@tacit-ats/core";
import { getSupabaseServiceClient } from "@tacit/db";

/**
 * The one place the client area reaches past RLS, and the only file under
 * lib/client or app/client allowed to import a privileged database client
 * (src/client-area.test.ts). A first sign-in has to: until the invited actor
 * carries the user's WorkOS subject, the user's own token resolves no org.
 *
 * Takes the identity and nothing else, and hands back a verdict and nothing
 * else: the service client never leaves this module. Callers pass only what
 * WorkOS vouched for in the sealed session, never anything from the request.
 */
export async function bindInvitedActor(who: ClientIdentity): Promise<BindClientResult> {
  return bindClientActor(getSupabaseServiceClient(), who);
}
