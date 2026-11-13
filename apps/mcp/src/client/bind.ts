import { bindSupabaseUser, type BindSupabaseResult } from "@tacit-ats/core";
import { getSupabaseServiceClient } from "@tacit/db";

/**
 * The one place the client connector reaches past RLS for sign-in, and one of
 * the few files under src/client allowed a privileged database client
 * (src/client-connector.test.ts). A first sign-in has to: until the invited
 * actor carries the user's subject, no token resolves an org for them. Same
 * rule as apps/web's lib/client/bind.ts: identity in, verdict out, the client
 * never leaves. The address and whether it is verified come from Supabase
 * Auth's own record of the user the token names, never from the token or the
 * request.
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
