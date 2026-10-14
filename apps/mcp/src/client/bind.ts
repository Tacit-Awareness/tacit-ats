import { bindClientActor, type BindClientResult, type ClientIdentity } from "@tacit/core";
import { getSupabaseServiceClient } from "@tacit/db";

/**
 * The one place the client connector reaches past RLS, and one of only two
 * files under src/client allowed a privileged database client
 * (src/client-connector.test.ts). Matching a first sign-in to the actor an
 * admin invited has to: until that actor carries the user's WorkOS subject,
 * no token resolves an org for them. Same rule as apps/internal's
 * lib/client/bind.ts: identity in, verdict out, the client never leaves.
 */
export async function bindMember(who: ClientIdentity): Promise<BindClientResult> {
  return bindClientActor(getSupabaseServiceClient(), who);
}
