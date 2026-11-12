import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { createUserClient, type Db } from "@tacit/db";
import { bindInvitedActor, bindInvitedUser } from "./bind";
import { CLIENT_CHOOSE_COMPANY_PATH, CLIENT_REFRESH_PATH, REFRESHED_COOKIE, clientAuthProvider } from "./config";
import { signedInClaims, supabaseAuthClient } from "./supabase-auth";

/**
 * Who is signed in to the client area, and the database client that acts as
 * them. The client here carries the user's own access token (WorkOS's, or
 * Supabase Auth's with CLIENT_AUTH_PROVIDER=supabase) and the publishable key, so every read and write is decided by RLS
 * (20261013120000_client_permissions). No function in the client area gets
 * any other database client.
 */
export type AccessLevel = "limited" | "elevated" | "admin";

export type ClientContext = {
  db: Db;
  actorId: string;
  accessLevel: AccessLevel;
  /** workosOrgId is the org's WorkOS organization: set for every org until the cutover, null after. */
  org: { id: string; name: string; slug: string; workosOrgId: string | null; brandAccent: string | null; brandLogoUrl: string | null };
  /** workosUserId is null for a Supabase Auth sign-in. */
  user: { email: string; name: string; workosUserId: string | null };
};

export type ClientGate =
  | { status: "ok"; ctx: ClientContext }
  | {
      status: "forbidden";
      /**
       * signed_out: no session (the proxy should have redirected).
       * not_invited / no_org / unknown_org / email_unverified / subject_mismatch: see bindClientActor.
       * token_rejected: the database would not act on the token. Supabase does not
       * trust the WorkOS issuer yet, or the token carries no org.
       */
      reason: "signed_out" | "not_invited" | "no_org" | "unknown_org" | "email_unverified" | "subject_mismatch" | "token_rejected";
    };

const isAccessLevel = (v: unknown): v is AccessLevel => v === "limited" || v === "elevated" || v === "admin";

/**
 * Only a 401 or 403 is the database refusing this token. Anything else is the
 * database not answering, an outage and no fault in anyone's sign-in, so it
 * throws to the error screen, which offers a retry, and not to the refusal, which
 * tells them to contact Tacit.
 */
function unlessRefused(status: number): void {
  if (status !== 401 && status !== 403) throw new Error(`the database did not answer (${status})`);
}

// Cached per request: the client layout's sidebar and the page both ask, and
// a first sign-in must bind once.
export const resolveClient = cache(async (): Promise<ClientGate> =>
  clientAuthProvider() === "supabase" ? resolveSupabase() : resolveWorkos(),
);

async function resolveWorkos(): Promise<ClientGate> {
  const auth = await withAuth();
  if (!auth.user || !auth.accessToken) return { status: "forbidden", reason: "signed_out" };
  const workosOrgId = auth.organizationId;

  const token = auth.accessToken;
  const db = createUserClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_PUBLISHABLE_KEY ?? "", () => token);

  // Ask the database who this token is, rather than deciding here: the answer
  // is the same one every policy will use.
  let who = await db.rpc("current_actor_id");
  if (who.error) {
    console.error("[client] the database refused the access token:", who.error.message);
    unlessRefused(who.status);
    return { status: "forbidden", reason: "token_rejected" };
  }
  if (!who.data) {
    // Not bound yet. A first sign-in is matched to the actor an admin invited.
    const bound = await bindInvitedActor({
      workosUserId: auth.user.id,
      workosOrgId: auth.organizationId,
      email: auth.user.email,
      emailVerified: auth.user.emailVerified === true,
    });
    if (bound.status !== "ok") return { status: "forbidden", reason: bound.reason };
    who = await db.rpc("current_actor_id");
    // Bound, and the database still resolves nobody: the token's org claim is
    // missing or does not match (the WorkOS JWT template, most likely).
    if (who.error || !who.data) return { status: "forbidden", reason: "token_rejected" };
  }

  const [level, org] = await Promise.all([
    db.rpc("current_access_level"),
    db.from("orgs").select("id, name, slug, brand_accent, brand_logo_url").maybeSingle(),
  ]);
  // The database matched the token's org claim to get this far, so it is set;
  // checked anyway, since an invitation is sent into it.
  if (level.error) unlessRefused(level.status);
  if (org.error) unlessRefused(org.status);
  if (level.error || org.error || !org.data || !isAccessLevel(level.data) || !workosOrgId) {
    return { status: "forbidden", reason: "token_rejected" };
  }

  const name = [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") || auth.user.email;
  return {
    status: "ok",
    ctx: {
      db,
      actorId: who.data,
      accessLevel: level.data,
      org: {
        id: org.data.id,
        name: org.data.name,
        slug: org.data.slug,
        workosOrgId,
        brandAccent: org.data.brand_accent,
        brandLogoUrl: org.data.brand_logo_url,
      },
      user: { email: auth.user.email, name, workosUserId: auth.user.id },
    },
  };
}

/**
 * A Supabase Auth sign-in. The token's org_id comes from the access token
 * hook (20261112000000_supabase_auth_groundwork), so a first sign-in binds,
 * then sends the browser to refresh the token, since a server component cannot
 * write cookies; someone in several companies with none chosen goes to the
 * picker. Both are redirects, so a page or an action never runs half signed in.
 */
async function resolveSupabase(): Promise<ClientGate> {
  const auth = await supabaseAuthClient();
  const claims = await signedInClaims(auth);
  if (!claims) return { status: "forbidden", reason: "signed_out" };
  const { data: session } = await auth.auth.getSession();
  const token = session.session?.access_token;
  if (!token) return { status: "forbidden", reason: "signed_out" };
  const db = createUserClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_PUBLISHABLE_KEY ?? "", () => token);

  const who = await db.rpc("current_actor_id");
  if (who.error) {
    console.error("[client] the database refused the access token:", who.error.message);
    unlessRefused(who.status);
    return { status: "forbidden", reason: "token_rejected" };
  }
  if (!who.data) {
    // Asks Supabase Auth, not just the cookie: an account deleted since its
    // token was issued still has a validly signed token.
    const { data: user, error: userError } = await auth.auth.getUser();
    if (userError || !user.user) return { status: "forbidden", reason: "signed_out" };
    const bound = await bindInvitedUser({
      userId: claims.sub,
      email: user.user.email ?? claims.email,
      emailVerified: Boolean(user.user.email_confirmed_at),
    });
    if (bound.status !== "ok") return { status: "forbidden", reason: bound.reason };
    // Several companies and none on the token: let them choose. Otherwise the
    // token predates the binding (or names a company they left): re-issue it,
    // once; the refresh route stops a second round trip from looping.
    if (bound.companies > 1 && !claims.org_id) redirect(CLIENT_CHOOSE_COMPANY_PATH);
    // Just refreshed and still nobody: the hook isn't adding org_id (not
    // registered on this project). Say so instead of looping.
    if ((await cookies()).get(REFRESHED_COOKIE)) return { status: "forbidden", reason: "token_rejected" };
    redirect(CLIENT_REFRESH_PATH);
  }

  const [level, org, me] = await Promise.all([
    db.rpc("current_access_level"),
    db.from("orgs").select("id, name, slug, workos_org_id, brand_accent, brand_logo_url").maybeSingle(),
    // The name the admin invited them by: Supabase Auth holds no name.
    db.from("org_members").select("display_name").eq("id", who.data).maybeSingle(),
  ]);
  if (level.error) unlessRefused(level.status);
  if (org.error) unlessRefused(org.status);
  if (level.error || org.error || !org.data || !isAccessLevel(level.data)) {
    return { status: "forbidden", reason: "token_rejected" };
  }

  const email = claims.email ?? "";
  const name = me.data?.display_name?.trim() || email;
  return {
    status: "ok",
    ctx: {
      db,
      actorId: who.data,
      accessLevel: level.data,
      org: {
        id: org.data.id,
        name: org.data.name,
        slug: org.data.slug,
        workosOrgId: org.data.workos_org_id,
        brandAccent: org.data.brand_accent,
        brandLogoUrl: org.data.brand_logo_url,
      },
      user: { email, name, workosUserId: null },
    },
  };
}

/**
 * For server actions in the client area: the first statement of every one.
 * Throws for anyone who is not a signed-in, invited member of a client org.
 */
export async function requireClient(): Promise<ClientContext> {
  const gate = await resolveClient();
  if (gate.status !== "ok") throw new Error(`unauthenticated: ${gate.reason}`);
  return gate.ctx;
}
