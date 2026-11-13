import type { Metadata } from "next";
import { createUserClient } from "@tacit/db";
import { readConsent } from "@/lib/client/auth-ops";
import { bindInvitedUser } from "@/lib/client/bind";
import { supabaseAuthClient } from "@/lib/client/supabase-auth";
import { ConsentScreen } from "./screen";

export const metadata: Metadata = { title: "Connect an AI app · tATS" };

// Where Supabase Auth's OAuth server sends a member to approve an MCP client
// (its "authorization path" on the tacit-ats project). The proxy has already
// signed them in and come back here, so the request is read on their session.
export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const { authorization_id: authorizationId = null } = await searchParams;
  const read = authorizationId ? await readConsent(authorizationId) : ({ kind: "gone" } as const);

  let companies: { id: string; name: string; slug: string }[] = [];
  if (read.kind !== "gone") {
    const auth = await supabaseAuthClient();
    // Someone whose first sign-in is through an AI app has pending invitations
    // and no company yet: link them first, by the address Supabase Auth has
    // verified, as the web app's own first sign-in does (lib/client/session.ts).
    const { data: user } = await auth.auth.getUser();
    if (user.user) {
      await bindInvitedUser({ userId: user.user.id, email: user.user.email, emailVerified: Boolean(user.user.email_confirmed_at) });
    }
    const { data } = await auth.auth.getSession();
    const token = data.session?.access_token;
    if (token) {
      const db = createUserClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_PUBLISHABLE_KEY ?? "", () => token);
      const { data: rows } = await db.rpc("my_sign_in_orgs" as never);
      companies = ((rows ?? []) as typeof companies).map(({ id, name, slug }) => ({ id, name, slug }));
    }
  }
  return <ConsentScreen authorizationId={read.kind === "gone" ? null : authorizationId} read={read} companies={companies} />;
}
