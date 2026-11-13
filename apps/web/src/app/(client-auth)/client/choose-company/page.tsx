import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createUserClient } from "@tacit/db";
import { CLIENT_SIGN_IN_PATH } from "@/lib/client/config";
import { signedInClaims, supabaseAuthClient } from "@/lib/client/supabase-auth";
import { CompanyPickerScreen } from "../screens";

export const metadata: Metadata = { title: "Choose a company · tATS" };

// For someone who belongs to more than one company: my_sign_in_orgs() on their
// own token lists them, and choosing one re-issues the token with it.
export default async function ChooseCompanyPage() {
  const auth = await supabaseAuthClient();
  const claims = await signedInClaims(auth);
  const { data: session } = await auth.auth.getSession();
  const token = session.session?.access_token;
  if (!claims || !token) redirect(CLIENT_SIGN_IN_PATH);
  const db = createUserClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_PUBLISHABLE_KEY ?? "", () => token);
  const { data, error } = await db.rpc("my_sign_in_orgs" as never);
  if (error) throw new Error(error.message);
  const companies = ((data ?? []) as { id: string; name: string; slug: string }[]).map(({ id, name, slug }) => ({ id, name, slug }));
  return <CompanyPickerScreen companies={companies} email={claims.email} />;
}
