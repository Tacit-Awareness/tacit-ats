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

// ---------------------------------------------------------------------------
// Connector consent (/client/oauth/consent): Supabase Auth's OAuth server sends
// a member here to let an MCP client (Claude, tats) work as them. They are
// already signed in (the proxy saw to that), so this reads the authorization
// on their own session, records the company they pick for it
// (choose_connector_company, which the access token hook pins to the session
// and turns into the token's aud and org_id), and approves or denies.
// ---------------------------------------------------------------------------

export type ConsentRead =
  | { kind: "ask"; clientName: string; redirectUri: string | null; email: string }
  /** Approved before for this app: Supabase answered with the redirect already. */
  | { kind: "approved"; redirectUrl: string; email: string }
  | { kind: "gone" };

const CONSENT_ID = /^[A-Za-z0-9_-]{1,200}$/;
export const isConsentId = (id: unknown): id is string => typeof id === "string" && CONSENT_ID.test(id);

async function memberSession(): Promise<{ token: string; email: string } | null> {
  const auth = await supabaseAuthClient();
  const claims = await signedInClaims(auth);
  const { data } = await auth.auth.getSession();
  const token = data.session?.access_token;
  return claims && token ? { token, email: claims.email ?? "" } : null;
}

async function oauthApi(path: string, token: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${process.env.SUPABASE_URL ?? ""}/auth/v1/oauth/authorizations/${path}`, {
    method: init.method,
    headers: {
      apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) return null;
  return (await response.json().catch(() => null)) as Record<string, unknown> | null;
}

const urlOrNull = (v: unknown): string | null => (typeof v === "string" && URL.canParse(v) ? v : null);

export async function readConsent(authorizationId: string): Promise<ConsentRead> {
  if (clientAuthProvider() !== "supabase" || !isConsentId(authorizationId)) return { kind: "gone" };
  const me = await memberSession();
  if (!me) return { kind: "gone" };
  const details = await oauthApi(encodeURIComponent(authorizationId), me.token, { method: "GET" });
  if (!details) return { kind: "gone" };
  if (!("authorization_id" in details)) {
    const redirectUrl = urlOrNull(details.redirect_url);
    return redirectUrl ? { kind: "approved", redirectUrl, email: me.email } : { kind: "gone" };
  }
  const client = details.client as { name?: unknown; client_name?: unknown } | undefined;
  const name = [client?.name, client?.client_name].find((n): n is string => typeof n === "string" && n.trim() !== "");
  return { kind: "ask", clientName: name ?? "An AI app", redirectUri: urlOrNull(details.redirect_uri), email: me.email };
}

/** The connector URLs this page may approve (CLIENT_MCP_RESOURCE_URL, comma-separated). */
function allowedResources(): Set<string> {
  return new Set((process.env.CLIENT_MCP_RESOURCE_URL ?? "").split(",").map((r) => r.trim().replace(/\/+$/, "")).filter(Boolean));
}

const GONE = "This connection request has expired or was already answered. Start the connection again from your AI app.";

/**
 * Approve (with the company picked) or deny. `approved` says the page was told
 * the app is already approved: the redirect is then the one the page holds, and
 * only the company is recorded, before the app redeems its code.
 */
export async function consentAction(input: { authorizationId: unknown; orgId: unknown; approve: unknown; approved: unknown }): Promise<AuthAnswer> {
  if (clientAuthProvider() !== "supabase") return UNAVAILABLE;
  if (!isConsentId(input.authorizationId)) return { error: GONE };
  const me = await memberSession();
  if (!me) return { to: CLIENT_SIGN_IN_PATH };
  const id = encodeURIComponent(input.authorizationId);

  if (input.approve !== true) {
    const denied = await oauthApi(`${id}/consent`, me.token, { method: "POST", body: { action: "deny" } });
    const to = urlOrNull(denied?.redirect_url);
    return to ? { to } : { error: GONE };
  }

  const orgId = str(input.orgId, 64);
  if (!orgId) return { error: "Choose a company." };
  const db = createUserClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_PUBLISHABLE_KEY ?? "", () => me.token);
  const chosen = await db.rpc("choose_connector_company" as never, { p_authorization_id: input.authorizationId, p_org: orgId } as never);
  const row = (chosen.data as { resource: string | null }[] | null)?.[0];
  if (chosen.error || !row) return { error: chosen.error?.code === "42501" ? "You're not a member of that company." : GONE };
  // Supabase doesn't check the resource an app asks for, so this page does:
  // approving a token for a URL that isn't our connector would hand it out for nothing of ours.
  const resource = row.resource?.replace(/\/+$/, "") ?? "";
  if (!allowedResources().has(resource)) {
    await oauthApi(`${id}/consent`, me.token, { method: "POST", body: { action: "deny" } });
    return { error: "This app asked for access to something that isn't a Tacit connector, so it was refused." };
  }

  if (input.approved === true) return { to: "approved" };
  const approved = await oauthApi(`${id}/consent`, me.token, { method: "POST", body: { action: "approve" } });
  const to = urlOrNull(approved?.redirect_url);
  return to ? { to } : { error: GONE };
}
