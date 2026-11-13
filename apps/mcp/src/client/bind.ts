import { bindClientActor, bindSupabaseUser, type BindClientResult, type BindSupabaseResult, type ClientIdentity } from "@tacit-ats/core";
import { getSupabaseServiceClient } from "@tacit/db";

/**
 * The one place the client connector reaches past RLS, and one of only two
 * files under src/client allowed a privileged database client
 * (src/client-connector.test.ts). Matching a first sign-in to the actor an
 * admin invited has to: until that actor carries the user's subject, no
 * token resolves an org for them. Same rule as apps/web's
 * lib/client/bind.ts: identity in, verdict out, the client never leaves.
 */
export async function bindMember(who: ClientIdentity): Promise<BindClientResult> {
  return bindClientActor(getSupabaseServiceClient(), who);
}

/**
 * A Supabase Auth user's first connector sign-in (CLIENT_AUTH_PROVIDER=supabase):
 * their address and whether it is verified come from Supabase Auth's own
 * record of the user the token names, never from the token or the request.
 */
export async function bindSupabaseMember(userId: string): Promise<BindSupabaseResult> {
  const service = getSupabaseServiceClient();
  const { data, error } = await service.auth.admin.getUserById(userId);
  if (error || !data.user) return { status: "forbidden", reason: "not_invited" };
  return bindSupabaseUser(service, {
    userId,
    email: data.user.email,
    emailVerified: Boolean(data.user.email_confirmed_at),
  });
}
