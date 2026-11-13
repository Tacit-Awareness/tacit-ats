import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CLIENT_SIGN_IN_PATH } from "@/lib/client/config";
import { signedInClaims, supabaseAuthClient } from "@/lib/client/supabase-auth";
import { SetPasswordScreen } from "../screens";

export const metadata: Metadata = { title: "Set your password · tATS" };

// Reached from an invitation or a reset email, through /client/auth/confirm,
// which has signed the person in and says `welcome` for an invitation.
export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const auth = await supabaseAuthClient();
  const claims = await signedInClaims(auth);
  if (!claims) redirect(CLIENT_SIGN_IN_PATH);
  const { welcome } = await searchParams;
  return <SetPasswordScreen email={claims.email} joining={welcome === "1" ? "your team on tATS" : undefined} />;
}
