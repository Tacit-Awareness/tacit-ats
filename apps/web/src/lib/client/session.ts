import { cache } from "react";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { createUserClient, type Db } from "@tacit/db";
import { bindInvitedActor } from "./bind";

/**
 * Who is signed in to the client area, and the database client that acts as
 * them. The client here carries the user's own WorkOS access token and the
 * publishable key, so every read and write is decided by RLS
 * (20261013120000_client_permissions). No function in the client area gets
 * any other database client.
 */
export type AccessLevel = "limited" | "elevated" | "admin";

export type ClientContext = {
  db: Db;
  actorId: string;
  accessLevel: AccessLevel;
  org: { id: string; name: string; slug: string; workosOrgId: string };
  user: { email: string; name: string; workosUserId: string };
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

// Cached per request: the client layout's sidebar and the page both ask, and
// a first sign-in must bind once.
export const resolveClient = cache(async (): Promise<ClientGate> => {
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
    db.from("orgs").select("id, name, slug").maybeSingle(),
  ]);
  // The database matched the token's org claim to get this far, so it is set;
  // checked anyway, since an invitation is sent into it.
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
      org: { id: org.data.id, name: org.data.name, slug: org.data.slug, workosOrgId },
      user: { email: auth.user.email, name, workosUserId: auth.user.id },
    },
  };
});

/**
 * For server actions in the client area: the first statement of every one.
 * Throws for anyone who is not a signed-in, invited member of a client org.
 */
export async function requireClient(): Promise<ClientContext> {
  const gate = await resolveClient();
  if (gate.status !== "ok") throw new Error(`unauthenticated: ${gate.reason}`);
  return gate.ctx;
}
