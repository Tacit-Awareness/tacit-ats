import type { Db } from "@tacit/db";

import type { AccessLevel, IdentityProvider } from "./orgs.js";

/**
 * A client org's admin inviting their own team (apps/internal's /client/team).
 *
 * The staff path (orgs.ts inviteOrgMember) runs on the service role. This one
 * runs on the admin's OWN database client: the actor row is written by the
 * `invite_org_member` definer function, which checks that the caller is an
 * admin and writes only into the caller's org (20261014120000_client_invites).
 * The org is never a parameter; it is whichever org the token carries. WorkOS
 * sends the email afterwards, and a first invitation it refuses is withdrawn
 * again, so nobody is left invited who was never told.
 */

export class ClientInviteError extends Error {
  constructor(
    readonly code: "forbidden" | "invalid" | "already_member" | "provider_failed",
    message: string,
  ) {
    super(message);
    this.name = "ClientInviteError";
  }
}

/** What WorkOS needs beyond core's IdentityProvider to take an invitation back. */
export type InvitationRevoker = {
  revokeInvitations(input: { email: string; organizationId: string }): Promise<void>;
};

export type ClientInviteResult = { actorId: string; resent: boolean };

export type PendingInvite = {
  actorId: string;
  displayName: string;
  email: string;
  accessLevel: AccessLevel;
  invitedAt: string;
};

function refusal(error: { code?: string; message: string }): ClientInviteError | Error {
  switch (error.code) {
    case "42501":
      return new ClientInviteError("forbidden", error.message);
    case "22023":
      return new ClientInviteError("invalid", error.message);
    case "23505":
      return new ClientInviteError("already_member", error.message);
    default:
      return new Error(error.message);
  }
}

export async function inviteClientMember(
  db: Db,
  idp: IdentityProvider,
  input: {
    email: string;
    displayName: string;
    accessLevel: AccessLevel;
    /** The WorkOS organization on the inviter's own token. */
    workosOrgId: string;
    /** The inviter's WorkOS user, named in the invitation email. */
    inviterUserId?: string;
  },
): Promise<ClientInviteResult> {
  const email = input.email.trim().toLowerCase();
  const { data, error } = await db.rpc("invite_org_member", {
    p_email: email,
    p_display_name: input.displayName,
    p_access_level: input.accessLevel,
  });
  if (error) throw refusal(error);
  const row = data?.[0];
  if (!row) throw new Error("invite_org_member returned nothing");

  try {
    await idp.sendInvitation({ email, organizationId: input.workosOrgId, inviterUserId: input.inviterUserId });
  } catch (err) {
    // A re-send leaves the existing invitation as it was; a first one is undone.
    if (!row.resent) {
      const undo = await db.rpc("withdraw_org_invite", { p_actor: row.actor_id });
      if (undo.error) console.error(`[client-invite] could not withdraw ${row.actor_id} after WorkOS refused:`, undo.error.message);
    }
    throw new ClientInviteError(
      "provider_failed",
      `The invitation was not sent: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { actorId: row.actor_id, resent: row.resent };
}

/** Who has been invited and not signed in yet. Empty unless the caller is an admin. */
export async function listPendingInvites(db: Db): Promise<PendingInvite[]> {
  const { data, error } = await db.rpc("org_pending_invites");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    actorId: r.actor_id,
    displayName: r.display_name,
    email: r.email,
    accessLevel: r.access_level as AccessLevel,
    invitedAt: r.invited_at,
  }));
}

/**
 * Take back an invitation nobody has accepted: the actor goes, then WorkOS's
 * pending invitation for the address is revoked. The second step is
 * best-effort; if it fails, accepting the email signs nobody in, because there
 * is no actor left to bind to.
 */
export async function withdrawClientInvite(
  db: Db,
  idp: InvitationRevoker,
  input: { actorId: string; workosOrgId: string },
): Promise<{ withdrawn: boolean }> {
  const pending = (await listPendingInvites(db)).find((p) => p.actorId === input.actorId);
  const { data, error } = await db.rpc("withdraw_org_invite", { p_actor: input.actorId });
  if (error) throw refusal(error);
  if (!data) return { withdrawn: false };
  if (pending) {
    try {
      await idp.revokeInvitations({ email: pending.email, organizationId: input.workosOrgId });
    } catch (err) {
      console.error("[client-invite] the WorkOS invitation was not revoked:", err instanceof Error ? err.message : err);
    }
  }
  return { withdrawn: true };
}
