import { createUserClient } from "@tacit/db";
import { CLIENT_PREFIX, CLIENT_SIGN_IN_PATH, clientAuthProvider, safeClientNext } from "@/lib/client/config";
import { signedInClaims, supabaseAuthClient } from "@/lib/client/supabase-auth";

// What Supabase Auth's sign-in screens do (CLIENT_AUTH_PROVIDER=supabase),
// served by app/(client-auth)/client/auth/[op]/route.ts. Each acts only on the
// caller's own session, with the publishable key: signing in, asking for a
// reset email, choosing a password or a company. None can name anyone else.
// They are a route and not server actions because they are how a member gets
// a session at all, so they cannot start with requireClient().
//
// Each answers `{ error }` (a sentence the screen shows) or `{ to }`.

export type AuthAnswer = { error: string } | { to: string };

const UNAVAILABLE: AuthAnswer = { error: "Sign-in isn't available here." };

function words(message: string | undefined): string {
  if (!message) return "Something went wrong. Try again.";
  if (/invalid login credentials/i.test(message)) return "Email or password is incorrect";
  if (/email not confirmed/i.test(message)) return "Confirm your email first: open the link we sent you.";
  if (/rate limit|too many/i.test(message)) return "Too many tries. Wait a minute, then try again.";
  if (/weak|pwned|leaked/i.test(message)) return "Choose a stronger password: this one appears in known data breaches.";
  if (/should be different/i.test(message)) return "Choose a password different from your old one.";
  if (/at least \d+ characters/i.test(message)) return "Use at least 8 characters.";
  return "Something went wrong. Try again.";
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

export async function signInAction(input: { email: unknown; password: unknown; next?: unknown }): Promise<AuthAnswer> {
  if (clientAuthProvider() !== "supabase") return UNAVAILABLE;
  const email = str(input.email, 320)?.trim().toLowerCase();
  const password = str(input.password, 512);
  if (!email || !password) return { error: "Email or password is incorrect" };
  const auth = await supabaseAuthClient();
  const { error } = await auth.auth.signInWithPassword({ email, password });
  if (error) return { error: words(error.message) };
  return { to: safeClientNext(typeof input.next === "string" ? input.next : null) };
}

export async function requestResetAction(input: { email: unknown }): Promise<AuthAnswer> {
  if (clientAuthProvider() !== "supabase") return UNAVAILABLE;
  const email = str(input.email, 320)?.trim().toLowerCase();
  if (!email) return { error: "Enter your work email." };
  const auth = await supabaseAuthClient();
  // The email's link is supabase/templates/recovery.html's, to /client/auth/confirm.
  // Supabase answers the same for an address it doesn't know, so this never says who has an account.
  const { error } = await auth.auth.resetPasswordForEmail(email);
  if (error && /rate limit|too many/i.test(error.message)) return { error: words(error.message) };
  return { to: CLIENT_SIGN_IN_PATH };
}

export async function setPasswordAction(input: { password: unknown }): Promise<AuthAnswer> {
  if (clientAuthProvider() !== "supabase") return UNAVAILABLE;
  const password = str(input.password, 512);
  if (!password || password.length < 8) return { error: "Use at least 8 characters." };
  const auth = await supabaseAuthClient();
  if (!(await signedInClaims(auth))) return { error: "This link has expired. Ask for a new one." };
  const { error } = await auth.auth.updateUser({ password });
  if (error) return { error: words(error.message) };
  return { to: CLIENT_PREFIX };
}

export async function pickCompanyAction(input: { orgId: unknown }): Promise<AuthAnswer> {
  if (clientAuthProvider() !== "supabase") return UNAVAILABLE;
  const orgId = str(input.orgId, 64);
  if (!orgId) return { error: "Choose a company." };
  const auth = await supabaseAuthClient();
  const { data: session } = await auth.auth.getSession();
  const token = session.session?.access_token;
  if (!token || !(await signedInClaims(auth))) return { to: CLIENT_SIGN_IN_PATH };
  // set_active_org checks the caller is an active member there, on their own token.
  const db = createUserClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_PUBLISHABLE_KEY ?? "", () => token);
  const { error } = await db.rpc("set_active_org" as never, { p_org: orgId } as never);
  if (error) return { error: "You're not a member of that company." };
  // Re-issue the token now, in an action that can write the cookie, so it carries the company.
  const refreshed = await auth.auth.refreshSession();
  if (refreshed.error) return { to: CLIENT_SIGN_IN_PATH };
  return { to: CLIENT_PREFIX };
}

export async function signOutAction(): Promise<AuthAnswer> {
  if (clientAuthProvider() !== "supabase") return UNAVAILABLE;
  const auth = await supabaseAuthClient();
  await auth.auth.signOut();
  return { to: CLIENT_SIGN_IN_PATH };
}
